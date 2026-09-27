import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { IPayoutRepository } from './payout.repository.interface';
import {
  PayoutRecord,
  EmployeeBankMeta,
  PayoutType,
  PayoutStatus,
  PayoutMode,
} from './payout.model';

interface PayoutRow extends RowDataPacket {
  id: number;
  payout_type: PayoutType;
  reference_id: string;
  employee_id: number;
  admin_id: number;
  amount: string | number;
  amount_paise: string | number;
  razorpay_payout_id: string | null;
  razorpay_contact_id: string | null;
  razorpay_fund_account_id: string | null;
  status: PayoutStatus;
  mode: PayoutMode;
  purpose: string;
  narration: string | null;
  utr: string | null;
  failure_reason: string | null;
  failure_description: string | null;
  failure_source: string | null;
  idempotency_key: string;
  created_at: Date;
  updated_at: Date;
}

const mapPayout = (r: PayoutRow): PayoutRecord => ({
  id: Number(r.id),
  payoutType: r.payout_type,
  referenceId: String(r.reference_id),
  employeeId: Number(r.employee_id),
  adminId: Number(r.admin_id),
  amount: Number(r.amount),
  amountPaise: Number(r.amount_paise),
  razorpayPayoutId: r.razorpay_payout_id,
  razorpayContactId: r.razorpay_contact_id,
  razorpayFundAccountId: r.razorpay_fund_account_id,
  status: r.status,
  mode: r.mode,
  purpose: String(r.purpose || 'salary'),
  narration: r.narration,
  utr: r.utr,
  failureReason: r.failure_reason,
  failureDescription: r.failure_description,
  failureSource: r.failure_source,
  idempotencyKey: String(r.idempotency_key),
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
  updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : '',
});

export class PayoutRepository implements IPayoutRepository {
  constructor(private readonly pool: Pool) {}

  async findEmployeeBankMeta(employeeId: number): Promise<EmployeeBankMeta | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, employee_code, full_name, work_email, phone,
              bank_name, account_no, ifsc_code,
              razorpay_contact_id, razorpay_fund_account_id
         FROM hrms_employees
        WHERE id = ? LIMIT 1`,
      [employeeId],
    );
    const r = rows[0];
    if (!r) return null;

    return {
      employeeId: Number(r.id),
      employeeCode: String(r.employee_code),
      fullName: String(r.full_name),
      workEmail: String(r.work_email),
      phone: r.phone ? String(r.phone) : null,
      bankName: r.bank_name ? String(r.bank_name) : null,
      accountNo: r.account_no ? String(r.account_no) : null,
      ifscCode: r.ifsc_code ? String(r.ifsc_code) : null,
      razorpayContactId: r.razorpay_contact_id ? String(r.razorpay_contact_id) : null,
      razorpayFundAccountId: r.razorpay_fund_account_id ? String(r.razorpay_fund_account_id) : null,
    };
  }

  async updateEmployeeRazorpayIds(
    employeeId: number,
    contactId: string | null,
    fundAccountId: string | null,
  ): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_employees
         SET razorpay_contact_id = COALESCE(?, razorpay_contact_id),
             razorpay_fund_account_id = COALESCE(?, razorpay_fund_account_id),
             updated_at = NOW()
       WHERE id = ?`,
      [contactId, fundAccountId, employeeId],
    );
  }

  async updateEmployeeBankDetails(
    employeeId: number,
    bankName: string,
    accountNo: string,
    ifscCode: string,
  ): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_employees
         SET bank_name = ?, account_no = ?, ifsc_code = ?, updated_at = NOW()
       WHERE id = ?`,
      [bankName, accountNo, ifscCode, employeeId],
    );
  }

  async findActivePayout(
    payoutType: PayoutType,
    referenceId: string,
    employeeId: number,
  ): Promise<PayoutRecord | null> {
    const [rows] = await this.pool.execute<PayoutRow[]>(
      `SELECT * FROM hrms_payouts
        WHERE payout_type = ? AND reference_id = ? AND employee_id = ?
          AND status NOT IN ('failed', 'reversed', 'rejected', 'cancelled')
        ORDER BY id DESC LIMIT 1`,
      [payoutType, referenceId, employeeId],
    );
    return rows[0] ? mapPayout(rows[0]) : null;
  }

  async createPayout(
    data: Omit<PayoutRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PayoutRecord> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_payouts (
        payout_type, reference_id, employee_id, admin_id, amount, amount_paise,
        razorpay_payout_id, razorpay_contact_id, razorpay_fund_account_id,
        status, mode, purpose, narration, utr, failure_reason, failure_description,
        failure_source, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        data.payoutType,
        data.referenceId,
        data.employeeId,
        data.adminId,
        data.amount,
        data.amountPaise,
        data.razorpayPayoutId,
        data.razorpayContactId,
        data.razorpayFundAccountId,
        data.status,
        data.mode,
        data.purpose,
        data.narration,
        data.utr,
        data.failureReason,
        data.failureDescription,
        data.failureSource,
        data.idempotencyKey,
      ],
    );
    const created = await this.findPayoutById(result.insertId);
    if (!created) throw new Error(`Failed to retrieve created payout ${result.insertId}`);
    return created;
  }

  async updatePayoutRazorpayInfo(
    id: number,
    razorpayPayoutId: string,
    status: PayoutStatus,
    failureReason?: string | null,
    failureDescription?: string | null,
  ): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_payouts
         SET razorpay_payout_id = ?, status = ?,
             failure_reason = ?, failure_description = ?, updated_at = NOW()
       WHERE id = ?`,
      [razorpayPayoutId, status, failureReason || null, failureDescription || null, id],
    );
  }

  async updatePayoutStatusByRazorpayId(
    razorpayPayoutId: string,
    status: PayoutStatus,
    utr?: string | null,
    failureReason?: string | null,
    failureDescription?: string | null,
  ): Promise<PayoutRecord | null> {
    await this.pool.execute(
      `UPDATE hrms_payouts
         SET status = ?,
             utr = COALESCE(?, utr),
             failure_reason = COALESCE(?, failure_reason),
             failure_description = COALESCE(?, failure_description),
             updated_at = NOW()
       WHERE razorpay_payout_id = ?`,
      [status, utr || null, failureReason || null, failureDescription || null, razorpayPayoutId],
    );
    return this.findPayoutByRazorpayId(razorpayPayoutId);
  }

  async findPayoutByRazorpayId(razorpayPayoutId: string): Promise<PayoutRecord | null> {
    const [rows] = await this.pool.execute<PayoutRow[]>(
      `SELECT * FROM hrms_payouts WHERE razorpay_payout_id = ? LIMIT 1`,
      [razorpayPayoutId],
    );
    return rows[0] ? mapPayout(rows[0]) : null;
  }

  async findPayoutById(id: number): Promise<PayoutRecord | null> {
    const [rows] = await this.pool.execute<PayoutRow[]>(
      `SELECT * FROM hrms_payouts WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? mapPayout(rows[0]) : null;
  }

  async listPayoutsForMonth(month: string): Promise<PayoutRecord[]> {
    const [rows] = await this.pool.execute<PayoutRow[]>(
      `SELECT * FROM hrms_payouts
        WHERE payout_type = 'salary' AND reference_id = ?
        ORDER BY id ASC`,
      [month],
    );
    return rows.map(mapPayout);
  }

  async updateLoanDisbursement(
    loanId: number,
    payoutId: number,
    status: 'pending_disbursement' | 'active' | 'disbursement_failed',
  ): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_employee_loans
         SET status = ?,
             disbursement_payout_id = ?,
             disbursed_at = IF(? = 'active', NOW(), disbursed_at),
             updated_at = NOW()
       WHERE id = ?`,
      [status, payoutId, status, loanId],
    );
  }

  async findLoanById(
    loanId: number,
  ): Promise<{ id: number; employeeId: number; amount: number; status: string } | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, employee_id, principal AS amount, status FROM hrms_employee_loans WHERE id = ? LIMIT 1`,
      [loanId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      employeeId: Number(r.employee_id),
      amount: Number(r.amount),
      status: String(r.status),
    };
  }
}
