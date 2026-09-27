import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import {
  IReimbursementRepository,
  ReimbursementRowDetails,
} from './reimbursement.repository.interface';
import {
  ReimbursementCategory,
  ReimbursementItem,
  ReimbursementStatus,
  ReimbursementSummary,
} from './reimbursement.model';

interface DbReimbursementRow extends RowDataPacket {
  id: number;
  ref: string;
  employee_id: number;
  employee_name?: string;
  employee_code?: string;
  department?: string | null;
  category: ReimbursementCategory;
  title: string;
  description: string | null;
  expense_date: string;
  claim_amount: string | number;
  approved_amount: string | number | null;
  has_receipt: number;
  receipt_path?: string | null;
  receipt_filename: string | null;
  receipt_mime_type?: string | null;
  status: ReimbursementStatus;
  rejection_reason: string | null;
  admin_notes: string | null;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_on: string | null;
  payment_date: string | null;
  payment_reference: string | null;
  created_at: string;
  updated_at: string;
}

export class ReimbursementRepository implements IReimbursementRepository {
  constructor(private readonly pool: Pool) {}

  async getNextRef(): Promise<string> {
    const year = new Date().getFullYear();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM hrms_reimbursement_requests WHERE YEAR(created_at) = ?',
      [year],
    );
    const count = (rows[0]?.count ?? 0) + 1;
    return `EXP-${year}-${String(count).padStart(4, '0')}`;
  }

  async create(data: {
    ref: string;
    employeeId: number;
    category: string;
    title: string;
    description: string | null;
    expenseDate: string;
    claimAmount: number;
    receiptPath: string | null;
    receiptFilename: string | null;
    receiptMimeType: string | null;
  }): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO hrms_reimbursement_requests
        (ref, employee_id, category, title, description, expense_date, claim_amount, receipt_path, receipt_filename, receipt_mime_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
      [
        data.ref,
        data.employeeId,
        data.category,
        data.title,
        data.description,
        data.expenseDate,
        data.claimAmount,
        data.receiptPath,
        data.receiptFilename,
        data.receiptMimeType,
      ],
    );
    return result.insertId;
  }

  async findByEmployeeId(employeeId: number): Promise<ReimbursementItem[]> {
    const sql = `
      SELECT r.id, r.ref, r.employee_id, r.category, r.title, r.description,
             DATE_FORMAT(r.expense_date, '%Y-%m-%d') as expense_date,
             r.claim_amount, r.approved_amount,
             (CASE WHEN r.receipt_path IS NOT NULL AND r.receipt_path != '' THEN 1 ELSE 0 END) as has_receipt,
             r.receipt_filename, r.status, r.rejection_reason, r.admin_notes,
             r.decided_by, d.full_name as decided_by_name,
             DATE_FORMAT(r.decided_on, '%Y-%m-%d %H:%i') as decided_on,
             DATE_FORMAT(r.payment_date, '%Y-%m-%d') as payment_date,
             r.payment_reference,
             DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') as created_at,
             DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i') as updated_at
        FROM hrms_reimbursement_requests r
        LEFT JOIN hrms_employees d ON r.decided_by = d.id
       WHERE r.employee_id = ?
       ORDER BY r.id DESC
    `;
    const [rows] = await this.pool.query<DbReimbursementRow[]>(sql, [employeeId]);
    return rows.map((r) => this.mapRow(r));
  }

  async findAll(statusFilter?: string): Promise<ReimbursementItem[]> {
    const params: (string | null)[] = [];
    let whereClause = '';
    if (statusFilter && statusFilter !== 'All') {
      whereClause = 'WHERE r.status = ?';
      params.push(statusFilter);
    }

    const sql = `
      SELECT r.id, r.ref, r.employee_id, e.full_name as employee_name, e.employee_code, e.department,
             r.category, r.title, r.description,
             DATE_FORMAT(r.expense_date, '%Y-%m-%d') as expense_date,
             r.claim_amount, r.approved_amount,
             (CASE WHEN r.receipt_path IS NOT NULL AND r.receipt_path != '' THEN 1 ELSE 0 END) as has_receipt,
             r.receipt_filename, r.status, r.rejection_reason, r.admin_notes,
             r.decided_by, d.full_name as decided_by_name,
             DATE_FORMAT(r.decided_on, '%Y-%m-%d %H:%i') as decided_on,
             DATE_FORMAT(r.payment_date, '%Y-%m-%d') as payment_date,
             r.payment_reference,
             DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') as created_at,
             DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i') as updated_at
        FROM hrms_reimbursement_requests r
        JOIN hrms_employees e ON r.employee_id = e.id
        LEFT JOIN hrms_employees d ON r.decided_by = d.id
       ${whereClause}
       ORDER BY FIELD(r.status, 'Pending', 'Approved', 'Paid', 'Rejected', 'Cancelled'), r.id DESC
    `;
    const [rows] = await this.pool.query<DbReimbursementRow[]>(sql, params);
    return rows.map((r) => this.mapRow(r));
  }

  async findById(id: number): Promise<ReimbursementRowDetails | null> {
    const sql = `
      SELECT r.id, r.ref, r.employee_id, e.full_name as employee_name, e.employee_code, e.department,
             r.category, r.title, r.description,
             DATE_FORMAT(r.expense_date, '%Y-%m-%d') as expense_date,
             r.claim_amount, r.approved_amount,
             r.receipt_path, r.receipt_filename, r.receipt_mime_type,
             (CASE WHEN r.receipt_path IS NOT NULL AND r.receipt_path != '' THEN 1 ELSE 0 END) as has_receipt,
             r.status, r.rejection_reason, r.admin_notes,
             r.decided_by, d.full_name as decided_by_name,
             DATE_FORMAT(r.decided_on, '%Y-%m-%d %H:%i') as decided_on,
             DATE_FORMAT(r.payment_date, '%Y-%m-%d') as payment_date,
             r.payment_reference,
             DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') as created_at,
             DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i') as updated_at
        FROM hrms_reimbursement_requests r
        JOIN hrms_employees e ON r.employee_id = e.id
        LEFT JOIN hrms_employees d ON r.decided_by = d.id
       WHERE r.id = ?
    `;
    const [rows] = await this.pool.query<DbReimbursementRow[]>(sql, [id]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      ...this.mapRow(r),
      receiptPath: r.receipt_path || null,
      receiptMimeType: r.receipt_mime_type || null,
    };
  }

  async updateDecision(
    id: number,
    data: {
      status: 'Approved' | 'Rejected';
      approvedAmount: number | null;
      rejectionReason: string | null;
      adminNotes: string | null;
      decidedBy: number;
    },
  ): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_reimbursement_requests
         SET status = ?,
             approved_amount = ?,
             rejection_reason = ?,
             admin_notes = ?,
             decided_by = ?,
             decided_on = NOW()
       WHERE id = ?`,
      [
        data.status,
        data.approvedAmount,
        data.rejectionReason,
        data.adminNotes,
        data.decidedBy,
        id,
      ],
    );
  }

  async markPaid(
    id: number,
    data: {
      paymentDate: string;
      paymentReference: string | null;
    },
  ): Promise<void> {
    await this.pool.execute(
      `UPDATE hrms_reimbursement_requests
         SET status = 'Paid',
             payment_date = ?,
             payment_reference = ?
       WHERE id = ?`,
      [data.paymentDate, data.paymentReference, id],
    );
  }

  async cancel(id: number, employeeId: number): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE hrms_reimbursement_requests
         SET status = 'Cancelled'
       WHERE id = ? AND employee_id = ? AND status = 'Pending'`,
      [id, employeeId],
    );
    return result.affectedRows > 0;
  }

  async getEmployeeSummary(employeeId: number): Promise<ReimbursementSummary> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT
           COALESCE(SUM(claim_amount), 0) as totalClaimed,
           COALESCE(SUM(CASE WHEN status = 'Approved' THEN approved_amount ELSE 0 END), 0) as totalApproved,
           COALESCE(SUM(CASE WHEN status = 'Paid' THEN approved_amount ELSE 0 END), 0) as totalPaid,
           COALESCE(SUM(CASE WHEN status = 'Pending' THEN claim_amount ELSE 0 END), 0) as totalPending,
           COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) as pendingCount
         FROM hrms_reimbursement_requests
        WHERE employee_id = ? AND status != 'Cancelled'`,
      [employeeId],
    );
    const r = rows[0] || {};
    return {
      totalClaimed: Number(r.totalClaimed || 0),
      totalApproved: Number(r.totalApproved || 0),
      totalPaid: Number(r.totalPaid || 0),
      totalPending: Number(r.totalPending || 0),
      pendingCount: Number(r.pendingCount || 0),
    };
  }

  async getCompanySummary(): Promise<ReimbursementSummary> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT
           COALESCE(SUM(claim_amount), 0) as totalClaimed,
           COALESCE(SUM(CASE WHEN status = 'Approved' THEN approved_amount ELSE 0 END), 0) as totalApproved,
           COALESCE(SUM(CASE WHEN status = 'Paid' THEN approved_amount ELSE 0 END), 0) as totalPaid,
           COALESCE(SUM(CASE WHEN status = 'Pending' THEN claim_amount ELSE 0 END), 0) as totalPending,
           COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) as pendingCount
         FROM hrms_reimbursement_requests
        WHERE status != 'Cancelled'`,
    );
    const r = rows[0] || {};
    return {
      totalClaimed: Number(r.totalClaimed || 0),
      totalApproved: Number(r.totalApproved || 0),
      totalPaid: Number(r.totalPaid || 0),
      totalPending: Number(r.totalPending || 0),
      pendingCount: Number(r.pendingCount || 0),
    };
  }

  private mapRow(r: DbReimbursementRow): ReimbursementItem {
    return {
      id: r.id,
      ref: r.ref,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      employeeCode: r.employee_code,
      department: r.department,
      category: r.category,
      title: r.title,
      description: r.description,
      expenseDate: r.expense_date,
      claimAmount: Number(r.claim_amount),
      approvedAmount: r.approved_amount !== null ? Number(r.approved_amount) : null,
      hasReceipt: Boolean(r.has_receipt),
      receiptFilename: r.receipt_filename,
      status: r.status,
      rejectionReason: r.rejection_reason,
      adminNotes: r.admin_notes,
      decidedBy: r.decided_by,
      decidedByName: r.decided_by_name,
      decidedOn: r.decided_on,
      paymentDate: r.payment_date,
      paymentReference: r.payment_reference,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
