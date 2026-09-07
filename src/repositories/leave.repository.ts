import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { HalfDaySession, LeaveStatus, LeaveType } from '../domain/leave';
import {
  ILeaveRepository,
  StoredLeaveRequest,
} from '../interfaces/repositories/leave.repository.interface';
import { ApplyLeaveDto, HolidayRecord, LeaveContext, LeaveYearConfig } from '../models/leave.model';
import { recordAudit } from './sql/audit';
import { REPORTING_TREE_CTE, reportingTreeParams } from './sql/reporting-tree';

interface LeaveYearRow extends RowDataPacket {
  leave_year: number;
  start_date: string;
  end_date: string;
  leave_per_month: string;
  annual_entitlement: string;
  carry_cap: string;
}

interface HolidayRow extends RowDataPacket {
  holiday_date: string;
  name: string;
}

interface ContextRow extends RowDataPacket {
  id: number;
  opening_leave: string;
  date_of_joining: string;
  date_of_leaving: string | null;
  weekly_off: string | null;
}

interface RequestRow extends RowDataPacket {
  id: number;
  employee_id: number;
  ref: string;
  leave_type: LeaveType;
  from_date: string;
  to_date: string;
  days: string;
  unpaid_days: string;
  is_half_day: number;
  half_day_session: HalfDaySession | null;
  status: LeaveStatus;
  reason: string;
  applied_on: string;
  decided_by_name: string | null;
}

interface SumRow extends RowDataPacket {
  total: string | null;
}

interface TreeRow extends RowDataPacket {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string | null;
}

const REQUEST_COLUMNS = `l.id, l.employee_id, l.ref, l.leave_type, l.from_date, l.to_date,
  l.days, l.unpaid_days, l.is_half_day, l.half_day_session,
  l.status, l.reason, l.applied_on, d.full_name AS decided_by_name`;

const mapRequest = (row: RequestRow): StoredLeaveRequest => ({
  id: row.id,
  employeeId: row.employee_id,
  ref: row.ref,
  leaveType: row.leave_type,
  fromDate: row.from_date,
  toDate: row.to_date,
  days: Number(row.days),
  unpaidDays: Number(row.unpaid_days),
  isHalfDay: row.is_half_day === 1,
  halfDaySession: row.half_day_session,
  status: row.status,
  reason: row.reason,
  appliedOn: row.applied_on,
  decidedBy: row.decided_by_name,
});

export class LeaveRepository implements ILeaveRepository {
  constructor(private readonly pool: Pool) {}

  async findLeaveYearForDate(date: string): Promise<LeaveYearConfig | null> {
    const [rows] = await this.pool.execute<LeaveYearRow[]>(
      `SELECT leave_year, start_date, end_date, leave_per_month, annual_entitlement, carry_cap
         FROM hrms_leave_years
        WHERE ? BETWEEN start_date AND end_date`,
      [date],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      leaveYear: row.leave_year,
      startDate: row.start_date,
      endDate: row.end_date,
      leavePerMonth: Number(row.leave_per_month),
      annualEntitlement: Number(row.annual_entitlement),
      carryCap: Number(row.carry_cap),
    };
  }

  /**
   * Queried by date range rather than by financial-year key, because the leave
   * year (Jan–Dec) does not line up with the financial year. Normally returns
   * nothing: Bambinos declares no festival holidays, so the 24 days cover them.
   */
  async findHolidays(from: string, to: string): Promise<HolidayRecord[]> {
    const [rows] = await this.pool.execute<HolidayRow[]>(
      `SELECT holiday_date, name FROM hrms_holidays
        WHERE holiday_date BETWEEN ? AND ? ORDER BY holiday_date`,
      [from, to],
    );
    return rows.map((r) => ({ date: r.holiday_date, name: r.name }));
  }

  async findLeaveContext(employeeId: number): Promise<LeaveContext | null> {
    const [rows] = await this.pool.execute<ContextRow[]>(
      `SELECT id, opening_leave, date_of_joining, date_of_leaving, weekly_off
         FROM hrms_employees WHERE id = ?`,
      [employeeId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      employeeId: row.id,
      openingLeave: Number(row.opening_leave),
      dateOfJoining: row.date_of_joining,
      dateOfLeaving: row.date_of_leaving,
      // MariaDB returns a SET column as a comma-separated string.
      weeklyOff: row.weekly_off ? row.weekly_off.split(',').filter(Boolean) : [],
    };
  }

  async findRequestsInYear(
    employeeId: number,
    yearStart: string,
    yearEnd: string,
  ): Promise<StoredLeaveRequest[]> {
    const [rows] = await this.pool.execute<RequestRow[]>(
      `SELECT ${REQUEST_COLUMNS}
         FROM hrms_leave_requests l
         LEFT JOIN hrms_employees d ON d.id = l.decided_by
        WHERE l.employee_id = ? AND l.from_date <= ? AND l.to_date >= ?
        ORDER BY l.from_date DESC, l.id DESC`,
      [employeeId, yearEnd, yearStart],
    );
    return rows.map(mapRequest);
  }

  async sumAdjustments(employeeId: number, leaveYear: number): Promise<number> {
    const [rows] = await this.pool.execute<SumRow[]>(
      `SELECT SUM(days) AS total FROM hrms_leave_adjustments WHERE employee_id = ? AND fy = ?`,
      [employeeId, String(leaveYear)],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async findOverlapping(
    employeeId: number,
    fromDate: string,
    toDate: string,
  ): Promise<StoredLeaveRequest | null> {
    const [rows] = await this.pool.execute<RequestRow[]>(
      `SELECT ${REQUEST_COLUMNS}
         FROM hrms_leave_requests l
         LEFT JOIN hrms_employees d ON d.id = l.decided_by
        WHERE l.employee_id = ?
          AND l.status IN ('Pending','Approved')
          AND l.from_date <= ? AND l.to_date >= ?
        LIMIT 1`,
      [employeeId, toDate, fromDate],
    );
    return rows[0] ? mapRequest(rows[0]) : null;
  }

  async create(employeeId: number, dto: ApplyLeaveDto, days: number): Promise<StoredLeaveRequest> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_leave_requests
         (ref, employee_id, leave_type, from_date, to_date, days, is_half_day, half_day_session,
          reason, status, applied_on)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', CURDATE())`,
      [
        employeeId,
        dto.leaveType,
        dto.fromDate,
        dto.toDate,
        days,
        dto.isHalfDay ? 1 : 0,
        dto.isHalfDay ? (dto.halfDaySession ?? null) : null,
        dto.reason,
      ],
    );

    // The reference is derived from the row id, so it is unique without a counter.
    await this.pool.execute(
      `UPDATE hrms_leave_requests SET ref = CONCAT('LV-', LPAD(id, 5, '0')) WHERE id = ?`,
      [result.insertId],
    );

    const created = await this.findById(result.insertId);
    if (!created) throw new Error(`Leave request ${result.insertId} not found after insert`);
    return created;
  }

  async findById(requestId: number): Promise<StoredLeaveRequest | null> {
    const [rows] = await this.pool.execute<RequestRow[]>(
      `SELECT ${REQUEST_COLUMNS}
         FROM hrms_leave_requests l
         LEFT JOIN hrms_employees d ON d.id = l.decided_by
        WHERE l.id = ?`,
      [requestId],
    );
    return rows[0] ? mapRequest(rows[0]) : null;
  }

  async cancel(requestId: number, byName: string): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_leave_requests
          SET status = 'Cancelled', decision_note = ?, decided_on = CURDATE()
        WHERE id = ? AND status = 'Pending'`,
      [`Cancelled by ${byName}`, requestId],
    );
  }

  // ---------------------------------------------------------------- approvals

  async findReportingTree(
    managerId: number,
  ): Promise<{ id: number; employeeCode: string; fullName: string; designation: string | null }[]> {
    // Recursive CTE so a skip-level manager also sees their reports' reports.
    // The clause itself — and the cycle guards it carries — is shared with the
    // profile repository, so the two can never disagree about who reports to whom.
    const [rows] = await this.pool.execute<TreeRow[]>(
      `${REPORTING_TREE_CTE}
       SELECT DISTINCT e.id, e.employee_code, e.full_name, e.designation
         FROM hrms_employees e
         JOIN tree ON tree.id = e.id
        WHERE e.date_of_leaving IS NULL OR e.date_of_leaving >= CURDATE()
        ORDER BY e.full_name`,
      reportingTreeParams(managerId),
    );
    return rows.map((r) => ({
      id: r.id,
      employeeCode: r.employee_code,
      fullName: r.full_name,
      designation: r.designation,
    }));
  }

  async findPendingForEmployees(employeeIds: number[]): Promise<StoredLeaveRequest[]> {
    if (employeeIds.length === 0) return [];
    const placeholders = employeeIds.map(() => '?').join(',');
    const [rows] = await this.pool.query<RequestRow[]>(
      `SELECT ${REQUEST_COLUMNS}
         FROM hrms_leave_requests l
         LEFT JOIN hrms_employees d ON d.id = l.decided_by
        WHERE l.status = 'Pending' AND l.employee_id IN (${placeholders})
        ORDER BY l.from_date ASC, l.id ASC`,
      employeeIds,
    );
    return rows.map(mapRequest);
  }

  async findRequestsForEmployees(
    employeeIds: number[],
    yearStart: string,
    yearEnd: string,
    limit: number,
  ): Promise<StoredLeaveRequest[]> {
    if (employeeIds.length === 0) return [];
    const placeholders = employeeIds.map(() => '?').join(',');
    const [rows] = await this.pool.query<RequestRow[]>(
      `SELECT ${REQUEST_COLUMNS}
         FROM hrms_leave_requests l
         LEFT JOIN hrms_employees d ON d.id = l.decided_by
        WHERE l.employee_id IN (${placeholders})
          AND l.from_date <= ? AND l.to_date >= ?
        ORDER BY l.from_date DESC, l.id DESC
        LIMIT ?`,
      [...employeeIds, yearEnd, yearStart, limit],
    );
    return rows.map(mapRequest);
  }

  /**
   * The request keeps the type the employee chose. Any part the balance could
   * not cover is recorded in `unpaid_days` instead of relabelling the whole
   * request as Unpaid, so a partly-covered request still spends the earned days
   * the employee actually had.
   */
  async decide(
    requestId: number,
    decision: 'Approved' | 'Rejected',
    decidedBy: number,
    note: string | null,
    unpaidDays: number,
  ): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_leave_requests
          SET status = ?, decided_by = ?, decided_on = CURDATE(), decision_note = ?,
              unpaid_days = ?
        WHERE id = ? AND status = 'Pending'`,
      [decision, decidedBy, note, decision === 'Approved' ? unpaidDays : 0, requestId],
    );
  }

  async recordAudit(
    actorEmployeeId: number,
    action: string,
    entityId: number,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    await recordAudit(this.pool, {
      actorEmployeeId,
      action,
      entityType: 'hrms_leave_requests',
      entityId,
      before,
      after,
    });
  }
}
