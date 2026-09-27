export type PayoutType = 'salary' | 'loan' | 'reimbursement';
export type PayoutStatus = 'queued' | 'pending' | 'processing' | 'processed' | 'failed' | 'reversed' | 'rejected' | 'cancelled';
export type PayoutMode = 'NEFT' | 'IMPS' | 'RTGS';

export interface PayoutRecord {
  id: number;
  payoutType: PayoutType;
  referenceId: string;
  employeeId: number;
  adminId: number;
  amount: number;
  amountPaise: number;
  razorpayPayoutId: string | null;
  razorpayContactId: string | null;
  razorpayFundAccountId: string | null;
  status: PayoutStatus;
  mode: PayoutMode;
  purpose: string;
  narration: string | null;
  utr: string | null;
  failureReason: string | null;
  failureDescription: string | null;
  failureSource: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeBankMeta {
  employeeId: number;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  phone: string | null;
  bankName: string | null;
  accountNo: string | null;
  ifscCode: string | null;
  razorpayContactId: string | null;
  razorpayFundAccountId: string | null;
}

export interface PushSalaryPayoutDto {
  month: string;
  employeeIds: number[];
  mode?: PayoutMode;
}

export interface PushSalaryResultItem {
  employeeId: number;
  employeeCode: string;
  fullName: string;
  amount: number;
  payoutId?: number;
  razorpayPayoutId?: string | null;
  status: PayoutStatus;
  error?: string;
}

export interface PushSalaryResponseDto {
  month: string;
  totalRequested: number;
  totalSuccess: number;
  totalFailed: number;
  totalAmount: number;
  items: PushSalaryResultItem[];
}

export interface PushLoanPayoutDto {
  loanId: number;
  mode?: PayoutMode;
}

export interface PushLoanResponseDto {
  loanId: number;
  employeeId: number;
  amount: number;
  payoutId: number;
  razorpayPayoutId: string | null;
  status: PayoutStatus;
  utr?: string | null;
}

export interface CsvReconciliationResult {
  totalRows: number;
  updatedCount: number;
  notFoundCount: number;
  skippedCount: number;
  details: {
    payoutId: string;
    oldStatus?: string;
    newStatus: string;
    utr?: string;
    updated: boolean;
  }[];
}
