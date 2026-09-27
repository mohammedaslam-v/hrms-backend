export type ReimbursementCategory =
  | 'Travel & Conveyance'
  | 'Client Entertainment'
  | 'Office & Supplies'
  | 'Telephone & Internet'
  | 'Training & Certification'
  | 'Meals & Food'
  | 'Medical'
  | 'Other';

export type ReimbursementStatus = 'Pending' | 'Approved' | 'Rejected' | 'Paid' | 'Cancelled';

export interface ReimbursementItem {
  id: number;
  ref: string;
  employeeId: number;
  employeeName?: string;
  employeeCode?: string;
  department?: string | null;
  category: ReimbursementCategory;
  title: string;
  description: string | null;
  expenseDate: string;
  claimAmount: number;
  approvedAmount: number | null;
  hasReceipt: boolean;
  receiptFilename: string | null;
  status: ReimbursementStatus;
  rejectionReason: string | null;
  adminNotes: string | null;
  decidedBy: number | null;
  decidedByName?: string | null;
  decidedOn: string | null;
  paymentDate: string | null;
  paymentReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReimbursementSummary {
  totalClaimed: number;
  totalApproved: number;
  totalPaid: number;
  totalPending: number;
  pendingCount: number;
}

export interface EmployeeReimbursementsView {
  summary: ReimbursementSummary;
  claims: ReimbursementItem[];
}

export interface AdminReimbursementsView {
  summary: ReimbursementSummary;
  claims: ReimbursementItem[];
}

export interface CreateReimbursementDto {
  category: ReimbursementCategory;
  title: string;
  description?: string;
  expenseDate: string;
  claimAmount: number;
  fileBase64?: string;
  fileName?: string;
}

export interface ApproveReimbursementDto {
  approvedAmount: number;
  adminNotes?: string;
}

export interface RejectReimbursementDto {
  reason: string;
}

export interface MarkPaidReimbursementDto {
  paymentDate: string;
  paymentReference?: string;
}
