import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ILoanRepository } from './loan.repository.interface';
import {
  AdminLoanItem,
  CreateLoanPayload,
  EligibleEmployee,
  EmployeeLoan,
  LoanStatus,
} from './loan.model';

interface LoanDbRow extends RowDataPacket {
  id: number;
  employee_id: number;
  purpose: string;
  principal: number | string;
  emi: number | string;
  interest_rate: number | string;
  start_month: string;
  tenure_months: number;
  status: LoanStatus;
  closed_at: string | null;
  closed_by: number | null;
  closed_reason: string | null;
  created_by: number | null;
  created_at: string;
  employee_name?: string;
  employee_code?: string;
  department?: string | null;
  designation?: string | null;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return monthKey;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function calculateFinalMonthKey(startMonth: string, tenureMonths: number): string {
  const [sy, sm] = startMonth.split('-').map(Number);
  const endTotalMonths = sm + tenureMonths - 1;
  const endYear = sy + Math.floor((endTotalMonths - 1) / 12);
  const endMonthNum = ((endTotalMonths - 1) % 12) + 1;
  return `${endYear}-${String(endMonthNum).padStart(2, '0')}`;
}

export class LoanRepository implements ILoanRepository {
  constructor(private readonly pool: Pool) {}

  async autoCloseCompletedLoans(): Promise<number> {
    const currentMonthKey = new Date().toISOString().slice(0, 7);
    const [rows] = await this.pool.query<LoanDbRow[]>(
      `SELECT id, start_month, tenure_months FROM hrms_employee_loans WHERE status = 'active'`,
    );

    let closedCount = 0;
    for (const loan of rows) {
      const finalMonthKey = calculateFinalMonthKey(loan.start_month, loan.tenure_months);
      // If current month is strictly greater than the final repayment month, all EMIs have completed
      if (currentMonthKey > finalMonthKey) {
        await this.pool.execute(
          `UPDATE hrms_employee_loans
              SET status = 'closed',
                  closed_at = NOW(),
                  closed_reason = 'Completed all scheduled EMI deductions'
            WHERE id = ?`,
          [loan.id],
        );
        closedCount++;
      }
    }
    return closedCount;
  }

  async findAdminLoans(statusFilter?: string): Promise<AdminLoanItem[]> {
    await this.autoCloseCompletedLoans();

    let query = `
      SELECT l.id, l.employee_id, l.purpose, l.principal, l.emi, l.interest_rate,
             l.start_month, l.tenure_months, l.status, l.closed_at, l.closed_by,
             l.closed_reason, l.created_by, l.created_at,
             e.full_name AS employee_name, e.employee_code, e.department, e.designation
        FROM hrms_employee_loans l
        JOIN hrms_employees e ON e.id = l.employee_id
    `;
    const params: (string | number)[] = [];

    if (statusFilter && (statusFilter === 'active' || statusFilter === 'closed')) {
      query += ` WHERE l.status = ? `;
      params.push(statusFilter);
    }

    query += ` ORDER BY (l.status = 'active') DESC, l.id DESC`;

    const [rows] = await this.pool.query<LoanDbRow[]>(query, params);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    return rows.map((row) => {
      const principal = Number(row.principal);
      const emi = Number(row.emi);
      const [sy, sm] = row.start_month.split('-').map(Number);
      const tenure = Number(row.tenure_months);

      const finalMonthKey = calculateFinalMonthKey(row.start_month, tenure);
      const finalMonth = formatMonthLabel(finalMonthKey);

      let paidMonths = 0;
      if (row.status === 'closed') {
        // If closed, either all tenure months were paid or closed early
        paidMonths = tenure;
      } else {
        const monthsElapsed = (currentYear - sy) * 12 + (currentMonth - sm) + 1;
        paidMonths = Math.min(tenure, Math.max(0, monthsElapsed));
      }

      const repaidAmount = Math.min(principal, paidMonths * emi);
      const outstandingAmount = row.status === 'closed' ? 0 : Math.max(0, principal - repaidAmount);

      return {
        id: row.id,
        employeeId: row.employee_id,
        employeeName: row.employee_name || 'Unknown',
        employeeCode: row.employee_code || `BAM-${row.employee_id}`,
        department: row.department || null,
        designation: row.designation || null,
        purpose: row.purpose,
        principal,
        emi,
        interestRate: Number(row.interest_rate),
        startMonth: row.start_month,
        tenureMonths: tenure,
        paidMonths,
        repaidAmount,
        outstandingAmount,
        finalMonth,
        status: row.status,
        closedAt: row.closed_at,
        closedReason: row.closed_reason,
        createdAt: row.created_at,
      };
    });
  }

  async findActiveEmployeesWithLoanStatus(): Promise<EligibleEmployee[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(`
      SELECT e.id, e.full_name AS name, e.employee_code, e.department,
             COUNT(al.id) AS active_loans_count
        FROM hrms_employees e
        LEFT JOIN hrms_employee_loans al ON al.employee_id = e.id AND al.status = 'active'
       WHERE (e.date_of_leaving IS NULL OR e.date_of_leaving >= CURDATE())
         AND (e.deleted_at IS NULL)
       GROUP BY e.id, e.full_name, e.employee_code, e.department
       ORDER BY e.full_name
    `);

    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      employeeCode: String(r.employee_code),
      department: r.department ? String(r.department) : null,
      activeLoansCount: Number(r.active_loans_count || 0),
      hasActiveLoan: Number(r.active_loans_count || 0) > 0,
    }));
  }

  async findActiveByEmployeeId(employeeId: number): Promise<EmployeeLoan | null> {
    await this.autoCloseCompletedLoans();
    const [rows] = await this.pool.execute<LoanDbRow[]>(
      `SELECT id, employee_id, purpose, principal, emi, interest_rate,
              start_month, tenure_months, status, closed_at, closed_by,
              closed_reason, created_by, created_at
         FROM hrms_employee_loans
        WHERE employee_id = ? AND status = 'active'
        ORDER BY id DESC
        LIMIT 1`,
      [employeeId],
    );
    if (!rows[0]) return null;
    return this.mapLoanRow(rows[0]);
  }

  async findById(id: number): Promise<EmployeeLoan | null> {
    const [rows] = await this.pool.execute<LoanDbRow[]>(
      `SELECT id, employee_id, purpose, principal, emi, interest_rate,
              start_month, tenure_months, status, closed_at, closed_by,
              closed_reason, created_by, created_at
         FROM hrms_employee_loans
        WHERE id = ?`,
      [id],
    );
    if (!rows[0]) return null;
    return this.mapLoanRow(rows[0]);
  }

  async findByEmployeeId(employeeId: number): Promise<EmployeeLoan[]> {
    await this.autoCloseCompletedLoans();
    const [rows] = await this.pool.execute<LoanDbRow[]>(
      `SELECT id, employee_id, purpose, principal, emi, interest_rate,
              start_month, tenure_months, status, closed_at, closed_by,
              closed_reason, created_by, created_at
         FROM hrms_employee_loans
        WHERE employee_id = ?
        ORDER BY id DESC`,
      [employeeId],
    );
    return rows.map((r) => this.mapLoanRow(r));
  }

  async createLoan(
    dto: CreateLoanPayload,
    createdBy: number,
    emi: number,
  ): Promise<EmployeeLoan> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_employee_loans (
        employee_id, purpose, principal, emi, interest_rate,
        start_month, tenure_months, status, created_by, created_at
      ) VALUES (?, ?, ?, ?, 0.00, ?, ?, 'active', ?, NOW())`,
      [
        dto.employeeId,
        dto.purpose,
        dto.principal,
        emi,
        dto.startMonth,
        dto.tenureMonths,
        createdBy,
      ],
    );

    const created = await this.findById(result.insertId);
    if (!created) {
      throw new Error(`Failed to retrieve newly created loan ${result.insertId}`);
    }
    return created;
  }

  async closeLoan(id: number, closedBy: number, reason: string): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_employee_loans
          SET status = 'closed',
              closed_at = NOW(),
              closed_by = ?,
              closed_reason = ?
        WHERE id = ?`,
      [closedBy, reason, id],
    );
  }

  private mapLoanRow(row: LoanDbRow): EmployeeLoan {
    return {
      id: row.id,
      employeeId: row.employee_id,
      purpose: row.purpose,
      principal: Number(row.principal),
      emi: Number(row.emi),
      interestRate: Number(row.interest_rate),
      startMonth: row.start_month,
      tenureMonths: row.tenure_months,
      status: row.status,
      closedAt: row.closed_at,
      closedBy: row.closed_by,
      closedReason: row.closed_reason,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }
}
