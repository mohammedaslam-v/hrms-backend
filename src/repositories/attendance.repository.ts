import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AttendanceStatus, eachDate } from '../domain/attendance';
import { LeaveType } from '../domain/leave';
import { IAttendanceRepository } from '../interfaces/repositories/attendance.repository.interface';
import {
  AttendanceRecord,
  CheckInInput,
  CheckOutInput,
  DatabaseNow,
  DayContext,
  WorkSchedule,
} from '../models/attendance.model';
import { recordAudit } from './sql/audit';

interface NowRow extends RowDataPacket {
  d: string;
  t: string;
}

interface ScheduleRow extends RowDataPacket {
  shift_start: string;
  shift_end: string;
  weekly_off: string | null;
  date_of_leaving: string | null;
}

interface ContextRow extends RowDataPacket {
  holiday_name: string | null;
  leave_type: LeaveType | null;
  is_half_day: number | null;
}

interface HolidayRow extends RowDataPacket {
  holiday_date: string;
  name: string;
}

interface LeaveSpanRow extends RowDataPacket {
  from_date: string;
  to_date: string;
  leave_type: LeaveType;
  is_half_day: number;
}

interface AttendanceRow extends RowDataPacket {
  id: number;
  employee_id: number;
  att_date: string;
  status: AttendanceStatus;
  login_at: string | null;
  logout_at: string | null;
  active_hours: string;
  late_by_minutes: number;
  leave_type: LeaveType | null;
  holiday_name: string | null;
  source: 'app' | 'manual' | 'import';
  edited_by: number | null;
  edit_note: string | null;
}

const COLUMNS = `id, employee_id, att_date, status, login_at, logout_at,
  active_hours, late_by_minutes, leave_type, holiday_name, source, edited_by, edit_note`;

/**
 * A unique-key collision — here, two check-ins racing for the same day. It is
 * an expected outcome rather than a fault, so it is matched precisely and any
 * other database error is rethrown.
 */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: string }).code === 'ER_DUP_ENTRY';

const mapRecord = (row: AttendanceRow): AttendanceRecord => ({
  id: row.id,
  employeeId: row.employee_id,
  date: row.att_date,
  status: row.status,
  // TIME comes back as HH:MM:SS; the whole module works in HH:MM.
  loginAt: row.login_at ? row.login_at.slice(0, 5) : null,
  logoutAt: row.logout_at ? row.logout_at.slice(0, 5) : null,
  // DECIMAL arrives as a string from the driver.
  activeHours: Number(row.active_hours),
  lateByMinutes: row.late_by_minutes,
  leaveType: row.leave_type,
  holidayName: row.holiday_name,
  source: row.source,
  editedBy: row.edited_by,
  editNote: row.edit_note,
});

export class AttendanceRepository implements IAttendanceRepository {
  constructor(private readonly pool: Pool) {}

  async now(): Promise<DatabaseNow> {
    const [rows] = await this.pool.query<NowRow[]>('SELECT CURDATE() AS d, CURTIME() AS t');
    return { date: rows[0].d, time: rows[0].t.slice(0, 5) };
  }

  async findSchedule(employeeId: number): Promise<WorkSchedule | null> {
    const [rows] = await this.pool.execute<ScheduleRow[]>(
      `SELECT shift_start, shift_end, weekly_off, date_of_leaving
         FROM hrms_employees WHERE id = ?`,
      [employeeId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      shiftStart: row.shift_start.slice(0, 5),
      shiftEnd: row.shift_end.slice(0, 5),
      // MariaDB returns a SET column as a comma-separated string.
      weeklyOff: row.weekly_off ? row.weekly_off.split(',').filter(Boolean) : [],
      dateOfLeaving: row.date_of_leaving,
    };
  }

  async findDayContext(employeeId: number, date: string): Promise<DayContext> {
    // Both facts in one round trip. The holiday side is a company-wide lookup
    // and normally finds nothing — Bambinos declares none — while the leave side
    // is the one that matters, because leave must beat absence.
    const [rows] = await this.pool.query<ContextRow[]>(
      `SELECT
         (SELECT h.name FROM hrms_holidays h WHERE h.holiday_date = ? LIMIT 1) AS holiday_name,
         l.leave_type,
         l.is_half_day
       FROM (SELECT 1) one
       LEFT JOIN hrms_leave_requests l
         ON l.employee_id = ?
        AND l.status      = 'Approved'
        AND ? BETWEEN l.from_date AND l.to_date
       LIMIT 1`,
      [date, employeeId, date],
    );

    const row = rows[0];
    return {
      holidayName: row?.holiday_name ?? null,
      leave: row?.leave_type
        ? { type: row.leave_type, isHalfDay: row.is_half_day === 1 }
        : null,
    };
  }

  async findDayContextRange(
    employeeId: number,
    from: string,
    to: string,
  ): Promise<Map<string, DayContext>> {
    const [holidays] = await this.pool.execute<HolidayRow[]>(
      `SELECT holiday_date, name FROM hrms_holidays WHERE holiday_date BETWEEN ? AND ?`,
      [from, to],
    );

    // Requests are stored as spans, so one row can cover several of the days we
    // are asking about — expanded below rather than joined per day.
    const [leave] = await this.pool.execute<LeaveSpanRow[]>(
      `SELECT from_date, to_date, leave_type, is_half_day
         FROM hrms_leave_requests
        WHERE employee_id = ? AND status = 'Approved'
          AND from_date <= ? AND to_date >= ?`,
      [employeeId, to, from],
    );

    const context = new Map<string, DayContext>();
    const at = (date: string): DayContext => {
      const existing = context.get(date);
      if (existing) return existing;
      const fresh: DayContext = { holidayName: null, leave: null };
      context.set(date, fresh);
      return fresh;
    };

    for (const row of holidays) at(row.holiday_date).holidayName = row.name;

    for (const row of leave) {
      // Clamp the span to the window before walking it, so a year-long request
      // cannot make this loop longer than the range asked for.
      const start = row.from_date > from ? row.from_date : from;
      const end = row.to_date < to ? row.to_date : to;
      for (const date of eachDate(start, end)) {
        at(date).leave = { type: row.leave_type, isHalfDay: row.is_half_day === 1 };
      }
    }

    return context;
  }

  async findByDate(employeeId: number, date: string): Promise<AttendanceRecord | null> {
    const [rows] = await this.pool.execute<AttendanceRow[]>(
      `SELECT ${COLUMNS} FROM hrms_attendance WHERE employee_id = ? AND att_date = ?`,
      [employeeId, date],
    );
    return rows[0] ? mapRecord(rows[0]) : null;
  }

  async findOpenPunch(employeeId: number): Promise<AttendanceRecord | null> {
    // A two-day window: long enough to cover a night shift closed the next
    // morning, short enough that a stint nobody closed last week is left alone
    // for HR to correct rather than silently absorbed into tonight.
    const [rows] = await this.pool.execute<AttendanceRow[]>(
      `SELECT ${COLUMNS}
         FROM hrms_attendance
        WHERE employee_id = ?
          AND login_at  IS NOT NULL
          AND logout_at IS NULL
          AND att_date >= DATE_SUB(CURDATE(), INTERVAL 2 DAY)
        ORDER BY att_date DESC
        LIMIT 1`,
      [employeeId],
    );
    return rows[0] ? mapRecord(rows[0]) : null;
  }

  async findLatestPunch(employeeId: number): Promise<AttendanceRecord | null> {
    const [rows] = await this.pool.execute<AttendanceRow[]>(
      `SELECT ${COLUMNS}
         FROM hrms_attendance
        WHERE employee_id = ?
          AND login_at IS NOT NULL
          AND att_date >= DATE_SUB(CURDATE(), INTERVAL 2 DAY)
        ORDER BY att_date DESC
        LIMIT 1`,
      [employeeId],
    );
    return rows[0] ? mapRecord(rows[0]) : null;
  }

  async findRange(employeeId: number, from: string, to: string): Promise<AttendanceRecord[]> {
    const [rows] = await this.pool.execute<AttendanceRow[]>(
      `SELECT ${COLUMNS}
         FROM hrms_attendance
        WHERE employee_id = ? AND att_date BETWEEN ? AND ?
        ORDER BY att_date ASC`,
      [employeeId, from, to],
    );
    return rows.map(mapRecord);
  }

  async checkIn(input: CheckInInput): Promise<AttendanceRecord | null> {
    // One row per person per day, guaranteed by uq_att_employee_date. Claiming
    // that row happens in two steps, each unambiguous under concurrency.
    //
    // Why not one INSERT … ON DUPLICATE KEY UPDATE: the driver connects with
    // CLIENT_FOUND_ROWS, so `affectedRows` reports rows *matched* rather than
    // changed — it is 1 whether the row was created or left untouched, and
    // `changedRows` is 0 either way. Neither counter can tell us which branch
    // ran, so the statement cannot report whether this call was the check-in.
    // Measured against MariaDB 10.4, not assumed.

    // 1. A row may already exist for the day without a login — written by the
    //    calendar as Weekly off or Leave. Claiming it is an UPDATE whose WHERE
    //    carries the rule, so InnoDB's row lock serialises two racing callers
    //    and only the first one matches.
    const [claimed] = await this.pool.execute<ResultSetHeader>(
      `UPDATE hrms_attendance
          SET login_at = ?, status = ?, late_by_minutes = ?, source = 'app'
        WHERE employee_id = ? AND att_date = ? AND login_at IS NULL`,
      [input.loginAt, input.status, input.lateByMinutes, input.employeeId, input.date],
    );
    if (claimed.affectedRows === 1) {
      return this.findByDate(input.employeeId, input.date);
    }

    // 2. No row for the day at all. Insert one — and let the unique key decide
    //    the race: whoever loses gets a duplicate-key error, which is the
    //    correct answer of "somebody already checked in".
    try {
      await this.pool.execute<ResultSetHeader>(
        `INSERT INTO hrms_attendance
           (employee_id, att_date, status, login_at, late_by_minutes, source)
         VALUES (?, ?, ?, ?, ?, 'app')`,
        [input.employeeId, input.date, input.status, input.loginAt, input.lateByMinutes],
      );
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }

    return this.findByDate(input.employeeId, input.date);
  }

  async checkOut(input: CheckOutInput): Promise<AttendanceRecord | null> {
    // Addressed by row id, because a night shift is closed on the calendar day
    // after the one it is filed against. `logout_at IS NULL` stays in the WHERE
    // so two tabs racing to check out cannot both succeed — no row matched means
    // somebody else closed it first.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE hrms_attendance
          SET logout_at = ?, active_hours = ?
        WHERE id = ? AND login_at IS NOT NULL AND logout_at IS NULL`,
      [input.logoutAt, input.activeHours, input.id],
    );

    if (result.affectedRows === 0) return null;

    const [rows] = await this.pool.execute<AttendanceRow[]>(
      `SELECT ${COLUMNS} FROM hrms_attendance WHERE id = ?`,
      [input.id],
    );
    return rows[0] ? mapRecord(rows[0]) : null;
  }

  recordAudit(
    actorEmployeeId: number,
    action: string,
    entityId: number | null,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    return recordAudit(this.pool, {
      actorEmployeeId,
      action,
      entityType: 'hrms_attendance',
      entityId,
      before,
      after,
    });
  }
}
