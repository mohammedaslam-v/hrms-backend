import { LeaveType } from './leave.domain';
import {
  ApplyLeaveDto,
  ApprovalsView,
  DecideLeaveDto,
  DecisionResult,
  LeavePreview,
  MyLeaveView,
} from './leave.model';

export interface ILeaveService {
  /** Balance, accrual ledger, request history and the holiday calendar. */
  getMyLeave(employeeId: number): Promise<MyLeaveView>;

  /** Live feedback for the apply form — writes nothing. */
  preview(
    employeeId: number,
    fromDate: string,
    toDate: string,
    leaveType: LeaveType,
    isHalfDay: boolean,
  ): Promise<LeavePreview>;

  apply(employeeId: number, dto: ApplyLeaveDto): Promise<MyLeaveView>;

  /** Only the owner may cancel, and only while the request is still pending. */
  cancel(employeeId: number, requestId: number, byName: string): Promise<MyLeaveView>;

  /** Leave details for another employee, authorized by reporting line or admin tier. */
  getForEmployee(viewerId: number, subjectId: number): Promise<MyLeaveView>;

  previewForEmployee(
    viewerId: number,
    subjectId: number,
    fromDate: string,
    toDate: string,
    leaveType: LeaveType,
    isHalfDay: boolean,
  ): Promise<LeavePreview>;

  applyForEmployee(
    viewerId: number,
    subjectId: number,
    dto: ApplyLeaveDto,
  ): Promise<MyLeaveView>;

  cancelForEmployee(
    viewerId: number,
    subjectId: number,
    requestId: number,
    byName: string,
  ): Promise<MyLeaveView>;

  // ---------------------------------------------------------------- approvals

  /** Pending queue, team balances and the request log, scoped to the manager's tree. */
  getApprovals(managerId: number): Promise<ApprovalsView>;

  /**
   * Approve or reject. Approving more days than the balance covers converts the
   * excess to loss of pay; the balance itself never goes below zero.
   */
  decide(managerId: number, dto: DecideLeaveDto): Promise<DecisionResult>;
}
