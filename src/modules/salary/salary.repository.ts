import { Pool, RowDataPacket } from "mysql2/promise";
import {
  EmployeeSalaryMeta,
  FrozenPayslipRow,
  ISalaryRepository,
  LoanRow,
} from "./salary.repository.interface";

interface EmpRow extends RowDataPacket {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  date_of_joining: string;
  date_of_leaving: string | null;
  pan: string | null;
  uan: string | null;
  bank_account: string | null;
  work_state: string;
  employment_type: string;
}

interface SlipRow extends RowDataPacket, FrozenPayslipRow {}
interface LRow extends RowDataPacket, LoanRow {}
interface LopRow extends RowDataPacket {
  from_date: string;
  to_date: string;
}

export class SalaryRepository implements ISalaryRepository {
  constructor(private readonly pool: Pool) {}

  async findEmployeeMeta(employeeId: number): Promise<EmployeeSalaryMeta | null> {
    const [rows] = await this.pool.execute<EmpRow[]>(
      `SELECT id, employee_code, full_name, designation, department,
              date_of_joining, date_of_leaving, pan, uan, bank_account,
              work_state, employment_type
         FROM hrms_employees
        WHERE id = ?`,
      [employeeId],
    );
    const r = rows[0];
    if (!r) return null;

    const isContractor =
      (r.employment_type || "").toLowerCase().includes("contract") ||
      (r.designation || "").toLowerCase().includes("contract") ||
      (r.department || "").toLowerCase().includes("contract");

    return {
      id: r.id,
      code: r.employee_code,
      name: r.full_name,
      title: r.designation || "Associate",
      department: r.department || "General",
      dateOfJoining: r.date_of_joining,
      dateOfLeaving: r.date_of_leaving,
      pan: r.pan || "PENDING",
      uan: r.uan || "—",
      bankAccount: r.bank_account || "—",
      workState: r.work_state || "Karnataka",
      isContractor,
    };
  }

  async findFrozenPayslip(employeeId: number, payMonth: string): Promise<FrozenPayslipRow | null> {
    const [rows] = await this.pool.execute<SlipRow[]>(
      `SELECT id, payroll_run_id, employee_id, pay_month, month_days, payable_days,
              lop_days, basic, hra, special_allowance, gross, pf_wage,
              employee_pf, employer_pf, eps, employer_epf, professional_tax,
              tds, loan_emi, total_deductions, net_pay, computation
         FROM hrms_payslips
        WHERE employee_id = ? AND pay_month = ?
        LIMIT 1`,
      [employeeId, payMonth],
    );
    return rows[0] || null;
  }

  async findFrozenHistory(employeeId: number): Promise<FrozenPayslipRow[]> {
    const [rows] = await this.pool.execute<SlipRow[]>(
      `SELECT id, payroll_run_id, employee_id, pay_month, month_days, payable_days,
              lop_days, basic, hra, special_allowance, gross, pf_wage,
              employee_pf, employer_pf, eps, employer_epf, professional_tax,
              tds, loan_emi, total_deductions, net_pay, computation
         FROM hrms_payslips
        WHERE employee_id = ?
        ORDER BY pay_month DESC`,
      [employeeId],
    );
    return rows;
  }

  async findActiveLoans(employeeId: number): Promise<LoanRow[]> {
    const [rows] = await this.pool.execute<LRow[]>(
      `SELECT id, employee_id, purpose, principal, emi, interest_rate,
              start_month, tenure_months, status
         FROM hrms_employee_loans
        WHERE employee_id = ? AND status = 'active'
        ORDER BY id DESC`,
      [employeeId],
    );
    return rows;
  }

  async findActiveLoan(employeeId: number): Promise<LoanRow | null> {
    const [rows] = await this.pool.execute<LRow[]>(
      `SELECT id, employee_id, purpose, principal, emi, interest_rate,
              start_month, tenure_months, status
         FROM hrms_employee_loans
        WHERE employee_id = ? AND status = 'active'
        ORDER BY id DESC
        LIMIT 1`,
      [employeeId],
    );
    return rows[0] || null;
  }

  async findApprovedLopDays(employeeId: number, payMonth: string): Promise<number> {
    const [rows] = await this.pool.execute<LopRow[]>(
      `SELECT from_date, to_date
         FROM hrms_leave_requests
        WHERE employee_id = ?
          AND status = 'Approved'
          AND leave_type = 'Unpaid'
          AND (DATE_FORMAT(from_date, '%Y-%m') = ? OR DATE_FORMAT(to_date, '%Y-%m') = ?)`,
      [employeeId, payMonth, payMonth],
    );

    let totalLop = 0;
    for (const row of rows) {
      const start = new Date(row.from_date);
      const end = new Date(row.to_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const mKey = d.toISOString().slice(0, 7);
        if (mKey === payMonth) totalLop += 1;
      }
    }
    return totalLop;
  }
}
