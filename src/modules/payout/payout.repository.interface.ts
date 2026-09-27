import {
  PayoutRecord,
  EmployeeBankMeta,
  PayoutType,
  PayoutStatus,
} from './payout.model';

export interface IPayoutRepository {
  findEmployeeBankMeta(employeeId: number): Promise<EmployeeBankMeta | null>;
  updateEmployeeRazorpayIds(
    employeeId: number,
    contactId: string | null,
    fundAccountId: string | null,
  ): Promise<void>;
  updateEmployeeBankDetails(
    employeeId: number,
    bankName: string,
    accountNo: string,
    ifscCode: string,
  ): Promise<void>;
  findActivePayout(
    payoutType: PayoutType,
    referenceId: string,
    employeeId: number,
  ): Promise<PayoutRecord | null>;
  createPayout(
    data: Omit<PayoutRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PayoutRecord>;
  updatePayoutRazorpayInfo(
    id: number,
    razorpayPayoutId: string,
    status: PayoutStatus,
    failureReason?: string | null,
    failureDescription?: string | null,
  ): Promise<void>;
  updatePayoutStatusByRazorpayId(
    razorpayPayoutId: string,
    status: PayoutStatus,
    utr?: string | null,
    failureReason?: string | null,
    failureDescription?: string | null,
  ): Promise<PayoutRecord | null>;
  findPayoutByRazorpayId(razorpayPayoutId: string): Promise<PayoutRecord | null>;
  findPayoutById(id: number): Promise<PayoutRecord | null>;
  listPayoutsForMonth(month: string): Promise<PayoutRecord[]>;
  updateLoanDisbursement(
    loanId: number,
    payoutId: number,
    status: 'pending_disbursement' | 'active' | 'disbursement_failed',
  ): Promise<void>;
  findLoanById(
    loanId: number,
  ): Promise<{ id: number; employeeId: number; amount: number; status: string } | null>;
}
