import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ProductivityDecision, RuledEmployee } from './productivity.model';
import { IProductivityRepository } from './productivity.repository.interface';

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

export class ProductivityRepository implements IProductivityRepository {
  constructor(private readonly pool: Pool) {}

  async findRuledEmployees(departments: string[]): Promise<RuledEmployee[]> {
    if (departments.length === 0) return [];
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, admin_id, department, shift_start, shift_end, weekly_off,
              DATE_FORMAT(date_of_joining, '%Y-%m-%d') AS date_of_joining,
              DATE_FORMAT(date_of_leaving, '%Y-%m-%d') AS date_of_leaving
         FROM hrms_employees
        WHERE LOWER(TRIM(department)) IN (${placeholders(departments.length)})
          AND employee_code NOT LIKE 'TEST-%'`,
      departments.map((d) => d.toLowerCase()),
    );
    return rows.map((r) => ({
      id: Number(r.id),
      adminId: r.admin_id ? Number(r.admin_id) : null,
      department: r.department,
      shiftStart: String(r.shift_start).slice(0, 5),
      shiftEnd: String(r.shift_end).slice(0, 5),
      weeklyOff: r.weekly_off ? String(r.weekly_off).split(',').filter(Boolean) : [],
      dateOfJoining: r.date_of_joining ?? null,
      dateOfLeaving: r.date_of_leaving ?? null,
    }));
  }

  async findDecided(employeeIds: number[], from: string, to: string): Promise<Set<string>> {
    const out = new Set<string>();
    if (employeeIds.length === 0) return out;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT employee_id, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date
         FROM hrms_productivity_days
        WHERE employee_id IN (${placeholders(employeeIds.length)}) AND work_date BETWEEN ? AND ?`,
      [...employeeIds, from, to],
    );
    for (const r of rows) out.add(`${r.employee_id}|${r.work_date}`);
    return out;
  }

  async claim(d: ProductivityDecision): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT IGNORE INTO hrms_productivity_days
         (employee_id, work_date, panel_minutes, activity_minutes, outcome, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [d.employeeId, d.date, d.panelMinutes, d.activityMinutes, d.outcome, d.reason],
    );
    // An ignored duplicate inserts nothing: 0 rows, whatever CLIENT_FOUND_ROWS says.
    return result.affectedRows === 1;
  }

  async release(employeeId: number, date: string): Promise<void> {
    await this.pool.execute(`DELETE FROM hrms_productivity_days WHERE employee_id = ? AND work_date = ?`, [
      employeeId,
      date,
    ]);
  }

  async findPanelSecondsBetween(adminIds: number[], from: string, to: string): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (adminIds.length === 0) return out;
    // An hour is counted when it starts inside the window. The window's own
    // edges are whole hours for every shift on the hour, which all of them are.
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT admin_id, SUM(active_seconds) AS seconds
         FROM admin_panel_presence_hour
        WHERE admin_id IN (${placeholders(adminIds.length)})
          AND hour_start >= ? AND hour_start < ?
        GROUP BY admin_id`,
      [...adminIds, `${from}:00`, `${to}:00`],
    );
    for (const r of rows) out.set(Number(r.admin_id), Number(r.seconds) || 0);
    return out;
  }
}
