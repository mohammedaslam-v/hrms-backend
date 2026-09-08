import { LeaveRequestRecord } from './leave.domain';
import { ApplyLeaveDto, HolidayRecord, LeaveContext, LeaveYearConfig } from './leave.model';

export interface StoredLeaveRequest extends LeaveRequestRecord {
  employeeId: number;
  isHalfDay: boolean;
  halfDaySession: 'first' | 'second' | null;
  reason: string;
  appliedOn: string;
  decidedBy: string | null;
}

export interface ILeaveRepository {
  /** The leave year (Jan–Dec) containing the given date. */
  findLeaveYearForDate(date: string): Promise<LeaveYearConfig | null>;

  /** Declared closures in the range. Normally empty — see the repository note. */
  findHolidays(from: string, to: string): Promise<HolidayRecord[]>;

  findLeaveContext(employeeId: number): Promise<LeaveContext | null>;

  /** Requests overlapping the leave year, in date order. */
  findRequestsInYear(
    employeeId: number,
    yearStart: string,
    yearEnd: string,
  ): Promise<StoredLeaveRequest[]>;

  /** Signed sum of encashment / lapse / correction entries for the year. */
  sumAdjustments(employeeId: number, leaveYear: number): Promise<number>;

  /** A pending or approved request touching the same dates blocks a new one. */
  findOverlapping(
    employeeId: number,
    fromDate: string,
    toDate: string,
  ): Promise<StoredLeaveRequest | null>;

  create(employeeId: number, dto: ApplyLeaveDto, days: number): Promise<StoredLeaveRequest>;

  findById(requestId: number): Promise<StoredLeaveRequest | null>;

  cancel(requestId: number, byName: string): Promise<void>;

  // ---------------------------------------------------------------- approvals


  /** Pending requests belonging to the given employees, oldest first. */
  findPendingForEmployees(employeeIds: number[]): Promise<StoredLeaveRequest[]>;

  /** Decided requests for the log, most recent first. */
  findRequestsForEmployees(
    employeeIds: number[],
    yearStart: string,
    yearEnd: string,
    limit: number,
  ): Promise<StoredLeaveRequest[]>;

  /**
   * Records the decision, including how many of the days the balance could not
   * cover. Those become loss of pay; the rest still draw from the balance.
   */
  decide(
    requestId: number,
    decision: 'Approved' | 'Rejected',
    decidedBy: number,
    note: string | null,
    unpaidDays: number,
  ): Promise<void>;

  recordAudit(
    actorEmployeeId: number,
    action: string,
    entityId: number,
    before: unknown,
    after: unknown,
  ): Promise<void>;
}
