import { Pool, RowDataPacket } from 'mysql2/promise';
import {
  IReportsRepository,
  RawEmployeeRow,
  RawLoanRow,
  RawCompensationRevision,
} from './reports.repository.interface';

export class ReportsRepository implements IReportsRepository {
  private columnCache = new Map<string, boolean>();

  constructor(private readonly pool: Pool) {}

  async hasColumn(tableName: string, columnName: string): Promise<boolean> {
    const key = `${tableName}.${columnName}`;
    if (this.columnCache.has(key)) return this.columnCache.get(key)!;
    try {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SHOW COLUMNS FROM ?? LIKE ?`,
        [tableName, columnName],
      );
      const exists = rows.length > 0;
      this.columnCache.set(key, exists);
      return exists;
    } catch {
      return false;
    }
  }

  private async buildEmployeeSelect(): Promise<string> {
    const hasGender = await this.hasColumn('hrms_employees', 'gender');
    const hasConfDate = await this.hasColumn('hrms_employees', 'confirmation_date');
    const hasExp = await this.hasColumn('hrms_employees', 'total_experience');
    const hasPfNo = await this.hasColumn('hrms_employees', 'pf_number');

    const genderSql = hasGender ? 'e.gender' : 'NULL AS gender';
    const confDateSql = hasConfDate ? 'e.confirmation_date' : 'NULL AS confirmation_date';
    const expSql = hasExp ? 'e.total_experience' : 'NULL AS total_experience';
    const pfNoSql = hasPfNo ? 'e.pf_number' : 'NULL AS pf_number';

    return `
      e.id,
      e.employee_code,
      e.full_name,
      e.work_email,
      e.phone,
      e.designation,
      e.department,
      e.date_of_joining,
      e.date_of_leaving,
      ${genderSql},
      ${confDateSql},
      ${expSql},
      ${pfNoSql},
      e.employment_type,
      e.work_state,
      e.pan,
      e.uan,
      e.date_of_birth,
      e.bank_name,
      e.account_no,
      e.ifsc_code,
      e.manager_id,
      m.employee_code AS manager_code,
      m.full_name AS manager_name,
      e.is_notice_serving,
      e.last_working_day,
      e.resignation_date,
      e.resignation_reason
    `;
  }

  async findActiveEmployees(department?: string): Promise<RawEmployeeRow[]> {
    const selectFields = await this.buildEmployeeSelect();
    const hasStatus = await this.hasColumn('hrms_employees', 'status');
    const hasIsActive = await this.hasColumn('hrms_employees', 'is_active');

    const params: any[] = [];
    let sql = `
      SELECT ${selectFields}
        FROM hrms_employees e
        LEFT JOIN hrms_employees m ON m.id = e.manager_id
       WHERE e.deleted_at IS NULL
         AND (e.date_of_leaving IS NULL OR e.date_of_leaving >= CURRENT_DATE())
    `;

    if (hasStatus) {
      sql += " AND (e.status IS NULL OR LOWER(e.status) = 'active')";
    }
    if (hasIsActive) {
      sql += " AND (e.is_active IS NULL OR e.is_active = 1)";
    }

    if (department && department !== 'ALL') {
      sql += ' AND e.department = ?';
      params.push(department);
    }
    sql += ' ORDER BY e.id ASC';

    const [rows] = await this.pool.query<RowDataPacket[]>(sql, params);
    return rows as RawEmployeeRow[];
  }

  async findAllEmployees(): Promise<RawEmployeeRow[]> {
    const selectFields = await this.buildEmployeeSelect();
    const [rows] = await this.pool.query<RowDataPacket[]>(`
      SELECT ${selectFields}
        FROM hrms_employees e
        LEFT JOIN hrms_employees m ON m.id = e.manager_id
       WHERE e.deleted_at IS NULL
       ORDER BY e.id ASC
    `);
    return rows as RawEmployeeRow[];
  }

  async findLoans(): Promise<RawLoanRow[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`
      SELECT l.id,
             l.employee_id,
             e.employee_code,
             e.full_name AS employee_name,
             e.department,
             e.work_state,
             e.date_of_joining,
             l.principal,
             l.emi,
             l.tenure_months,
             l.start_month,
             l.status,
             l.purpose,
             l.disbursed_at
        FROM hrms_employee_loans l
        JOIN hrms_employees e ON e.id = l.employee_id
       ORDER BY l.id ASC
    `);
    return rows as RawLoanRow[];
  }

  async findRecentJoinees(from: string, to: string, department?: string): Promise<RawEmployeeRow[]> {
    const selectFields = await this.buildEmployeeSelect();
    const params: any[] = [from, to];
    let sql = `
      SELECT ${selectFields}
        FROM hrms_employees e
        LEFT JOIN hrms_employees m ON m.id = e.manager_id
       WHERE e.deleted_at IS NULL
         AND e.date_of_joining >= ?
         AND e.date_of_joining <= ?
    `;
    if (department && department !== 'ALL') {
      sql += ' AND e.department = ?';
      params.push(department);
    }
    sql += ' ORDER BY e.date_of_joining DESC';

    const [rows] = await this.pool.query<RowDataPacket[]>(sql, params);
    return rows as RawEmployeeRow[];
  }

  async findRecentResignees(from: string, to: string, department?: string): Promise<RawEmployeeRow[]> {
    const selectFields = await this.buildEmployeeSelect();
    const params: any[] = [from, to, from, to, from, to];
    let sql = `
      SELECT ${selectFields}
        FROM hrms_employees e
        LEFT JOIN hrms_employees m ON m.id = e.manager_id
       WHERE e.deleted_at IS NULL
         AND (
           (e.last_working_day >= ? AND e.last_working_day <= ?)
           OR (e.date_of_leaving >= ? AND e.date_of_leaving <= ?)
           OR (e.resignation_date >= ? AND e.resignation_date <= ?)
           OR e.is_notice_serving = 1
         )
    `;
    if (department && department !== 'ALL') {
      sql += ' AND e.department = ?';
      params.push(department);
    }
    sql += ' ORDER BY COALESCE(e.last_working_day, e.date_of_leaving, e.resignation_date) DESC';

    const [rows] = await this.pool.query<RowDataPacket[]>(sql, params);
    return rows as RawEmployeeRow[];
  }

  async findCompensationHistory(): Promise<RawCompensationRevision[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`
      SELECT c.id,
             c.employee_id,
             e.employee_code,
             e.full_name AS employee_name,
             e.date_of_joining,
             c.effective_from,
             c.ctc,
             c.variable_pay,
             c.bonus,
             c.revision_note,
             c.created_at
        FROM hrms_employee_compensation c
        JOIN hrms_employees e ON e.id = c.employee_id
       WHERE e.deleted_at IS NULL
       ORDER BY c.employee_id ASC, c.effective_from DESC, c.id DESC
    `);
    return rows as RawCompensationRevision[];
  }
}
