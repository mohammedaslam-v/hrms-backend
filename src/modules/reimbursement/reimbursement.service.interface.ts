import {
  AdminReimbursementsView,
  ApproveReimbursementDto,
  CreateReimbursementDto,
  EmployeeReimbursementsView,
  MarkPaidReimbursementDto,
  ReimbursementItem,
  RejectReimbursementDto,
} from './reimbursement.model';

export interface IReimbursementService {
  getMyReimbursements(employeeId: number): Promise<EmployeeReimbursementsView>;
  createReimbursement(
    employeeId: number,
    dto: CreateReimbursementDto,
  ): Promise<ReimbursementItem>;
  getReceiptFile(
    viewerId: number,
    claimId: number,
  ): Promise<{ fullPath: string; mimeType: string; filename: string }>;
  cancelClaim(viewerId: number, claimId: number): Promise<void>;
  getAllForAdmin(
    viewerId: number,
    statusFilter?: string,
  ): Promise<AdminReimbursementsView>;
  approveClaim(
    viewerId: number,
    claimId: number,
    dto: ApproveReimbursementDto,
  ): Promise<void>;
  rejectClaim(
    viewerId: number,
    claimId: number,
    dto: RejectReimbursementDto,
  ): Promise<void>;
  markPaid(
    viewerId: number,
    claimId: number,
    dto: MarkPaidReimbursementDto,
  ): Promise<void>;
}
