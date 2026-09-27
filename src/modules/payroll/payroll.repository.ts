import { Pool, RowDataPacket } from 'mysql2/promise';
import {
  IPayrollRepository,
  PayrollEmployeeDbRow,
  PayrollPayoutDbInfo,
} from './payroll.repository.interface';

export class PayrollRepository implements IPayrollRepository {
  constructor(private readonly pool: Pool) {}

  async findActiveEmployeesForMonth(
    startDate: string,
    endDate: string,
  ): Promise<PayrollEmployeeDbRow[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, employee_code, full_name, designation, department,
              employment_type, work_state, date_of_joining, date_of_leaving,
              bank_name, account_no, ifsc_code
         FROM hrms_employees
        WHERE date_of_joining <= ?
          AND (date_of_leaving IS NULL OR date_of_leaving >= ?)
          AND deleted_at IS NULL
        ORDER BY id ASC`,
      [endDate, startDate],
    );

    return rows.map((r) => ({
      id: Number(r.id),
      employeeCode: String(r.employee_code),
      fullName: String(r.full_name),
      designation: String(r.designation || 'Associate'),
      department: String(r.department || 'General'),
      employmentType: String(r.employment_type || 'Full-time'),
      workState: String(r.work_state || 'Karnataka'),
      dateOfJoining: String(r.date_of_joining),
      dateOfLeaving: r.date_of_leaving ? String(r.date_of_leaving) : null,
      bankName: r.bank_name ? String(r.bank_name) : null,
      accountNo: r.account_no ? String(r.account_no) : null,
      ifscCode: r.ifsc_code ? String(r.ifsc_code) : null,
    }));
  }

  async findPayoutsMapForMonth(
    monthDate: string,
  ): Promise<Map<number, PayrollPayoutDbInfo>> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, employee_id, razorpay_payout_id, status, utr, failure_reason
         FROM hrms_payouts
        WHERE payout_type = 'salary' AND reference_id = ?
        ORDER BY id ASC`,
      [monthDate],
    );

    const map = new Map<number, PayrollPayoutDbInfo>();
    for (const r of rows) {
      map.set(Number(r.employee_id), {
        id: Number(r.id),
        razorpayPayoutId: r.razorpay_payout_id ? String(r.razorpay_payout_id) : null,
        status: String(r.status),
        utr: r.utr ? String(r.utr) : null,
        failureReason: r.failure_reason ? String(r.failure_reason) : null,
      });
    }
    return map;
  }
}
