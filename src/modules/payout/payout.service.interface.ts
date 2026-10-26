import {
  RequestPayoutOtpResponseDto,
  PushLoanPayoutDto,
  PushReimbursementPayoutDto,
  PushReimbursementResponseDto,
  PushSalaryPayoutDto,
  PushSalaryResponseDto,
  PushSalaryResultItem,
  PushLoanResponseDto,
  CsvReconciliationResult,
  PayoutRecord,
  PayoutMode,
} from './payout.model';

export interface IPayoutService {
  ensureEmployeeFundAccount(
    employeeId: number,
  ): Promise<{ contactId: string; fundAccountId: string }>;
  pushSalaryPayouts(
    dto: PushSalaryPayoutDto,
    adminId: number,
  ): Promise<PushSalaryResponseDto>;
  pushSingleSalaryPayout(
    employeeId: number,
    month: string,
    adminId: number,
    mode?: PayoutMode,
  ): Promise<PushSalaryResultItem>;
  requestPayoutOtp(
    adminId: number,
    ipAddress: string | null,
  ): Promise<RequestPayoutOtpResponseDto>;
  pushLoanDisbursement(
    dto: PushLoanPayoutDto,
    adminId: number,
  ): Promise<PushLoanResponseDto>;
  pushReimbursementDisbursement(
    dto: PushReimbursementPayoutDto,
    adminId: number,
  ): Promise<PushReimbursementResponseDto>;
  processWebhook(
    event: string,
    payload: any,
  ): Promise<{ handled: boolean; message: string }>;
  reconcileFromCsv(csvContent: string): Promise<CsvReconciliationResult>;
  getPayoutsForMonth(month: string): Promise<PayoutRecord[]>;
  updateEmployeeBankDetails(
    employeeId: number,
    bankName: string,
    accountNo: string,
    ifscCode: string,
  ): Promise<void>;
}
