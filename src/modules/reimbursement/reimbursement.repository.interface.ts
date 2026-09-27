import {
  ReimbursementItem,
  ReimbursementSummary,
} from './reimbursement.model';

export interface ReimbursementRowDetails extends ReimbursementItem {
  receiptPath: string | null;
  receiptMimeType: string | null;
}

export interface IReimbursementRepository {
  getNextRef(): Promise<string>;
  create(data: {
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
  }): Promise<number>;
  findByEmployeeId(employeeId: number): Promise<ReimbursementItem[]>;
  findAll(statusFilter?: string): Promise<ReimbursementItem[]>;
  findById(id: number): Promise<ReimbursementRowDetails | null>;
  updateDecision(
    id: number,
    data: {
      status: 'Approved' | 'Rejected';
      approvedAmount: number | null;
      rejectionReason: string | null;
      adminNotes: string | null;
      decidedBy: number;
    },
  ): Promise<void>;
  markPaid(
    id: number,
    data: {
      paymentDate: string;
      paymentReference: string | null;
    },
  ): Promise<void>;
  cancel(id: number, employeeId: number): Promise<boolean>;
  getEmployeeSummary(employeeId: number): Promise<ReimbursementSummary>;
  getCompanySummary(): Promise<ReimbursementSummary>;
}
