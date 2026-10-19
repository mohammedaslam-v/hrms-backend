import { HalfDaySession, LeaveType } from './leave.domain';
import {
  ApplyLeaveDto,
  ApprovalsView,
  DecideLeaveDto,
  DecisionResult,
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

  getOnLeaveToday(): Promise<OnLeaveEmployee[]>;

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
  ): Promise<string | null>;
}

export interface DayLeaveChoice {
  leaveType: LeaveType;
  isHalfDay: boolean;
  halfDaySession: HalfDaySession | null;
}
