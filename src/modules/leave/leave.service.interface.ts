import { HalfDaySession, LeaveType } from './leave.domain';
import {
  ApplyLeaveDto,
  ApprovalsView,
  DecideLeaveDto,
  DecisionResult,
  DeleteLeaveResult,
  EditApprovedLeaveDto,
  EditApprovedResult,
  LeavePreview,
  MyLeaveView,
  OnLeaveEmployee,
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
    excludeRequestId?: number,
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
    excludeRequestId?: number,
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

  getOnLeaveToday(): Promise<OnLeaveEmployee[]>;

  /**
   * Loss-of-pay days the leave ledger settles in each month asked for
   * (`YYYY-MM`) — unpaid leave plus any leave the balance could not cover.
   * Salary reads it.
   */
  lopDaysByMonth(employeeId: number, months: string[]): Promise<Map<string, number>>;

  // ---------------------------------------------------------------- approvals

  /** Pending queue, team balances and the request log, scoped to the manager's tree. */
  getApprovals(managerId: number): Promise<ApprovalsView>;

  /**
   * Approve or reject. Approving more days than the balance covers converts the
   * excess to loss of pay; the balance itself never goes below zero.
   */
  decide(managerId: number, dto: DecideLeaveDto): Promise<DecisionResult>;

  /**
   * Admin-only: Edit an already approved leave request.
   * Shortens duration, shifts dates, or changes leave type/session.
   * Excludes extension beyond original approved duration.
   */
  editApproved(adminId: number, dto: EditApprovedLeaveDto): Promise<EditApprovedResult>;

  /**
   * Admin-only: remove a leave request of any status for good, with a reason.
   * The full row goes to the audit log first. Deleting an APPROVED request
   * also returns its days to the balance, drops the loss of pay it caused and
   * undoes what it wrote to attendance — all of which follow from the row
   * being gone, because balance and day status are derived on read.
   */
  deleteRequest(adminId: number, requestId: number, note: string): Promise<DeleteLeaveResult>;

  /**
   * Admin-only: what ONE day's leave should be, set from the attendance
   * calendar. `choice` null means the day was not leave at all.
   *
   * Writes an approved request (or edits / cancels the single-day one already
   * there), so balance and loss of pay follow exactly as for any approved leave.
   * Refuses a day inside a multi-day request, or one with a request still
   * pending — those are edited from Leave approvals. Returns what changed, or
   * null when nothing needed to.
   */
  setDayLeave(
    adminId: number,
    employeeId: number,
    date: string,
    choice: DayLeaveChoice | null,
    note: string,
    /** The approval note on a new request. Defaults to "Marked by admin …". */
    decisionNote?: string,
  ): Promise<string | null>;
}

export interface DayLeaveChoice {
  leaveType: LeaveType;
  isHalfDay: boolean;
  halfDaySession: HalfDaySession | null;
}
