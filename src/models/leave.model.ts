import { HalfDaySession, LeaveLedger, LeaveRequestRecord, LeaveType } from '../domain/leave';

export {
  LeaveType,
  LeaveStatus,
  LeaveRequestRecord,
  LeaveLedger,
  HalfDaySession,
} from '../domain/leave';

/** Per-employee inputs the ledger needs, read once per request. */
export interface LeaveContext {
  employeeId: number;
  openingLeave: number;
  dateOfJoining: string;
  dateOfLeaving: string | null;
  weeklyOff: string[];
}

export interface LeaveYearConfig {
  leaveYear: number;
  startDate: string;
  endDate: string;
  leavePerMonth: number;
  annualEntitlement: number;
  carryCap: number;
}

export interface HolidayRecord {
  date: string;
  name: string;
}

export interface ApplyLeaveDto {
  leaveType: LeaveType;
  /** Required when isHalfDay — which half the employee is taking. */
  halfDaySession?: HalfDaySession | null;
  fromDate: string;
  toDate: string;
  isHalfDay: boolean;
  reason: string;
}

/** Live feedback for the apply form, before anything is written. */
export interface LeavePreview {
  days: number;
  /** Weekly offs and holidays inside the range that are not deducted. */
  skippedDays: number;
  balanceNow: number;
  balanceAfter: number;
  paidDays: number;
  unpaidDays: number;
  canSubmit: boolean;
  message: string;
}

export interface MyLeaveView {
  ledger: LeaveLedger;
  requests: (LeaveRequestRecord & {
    reason: string;
    appliedOn: string;
    decidedBy: string | null;
    isHalfDay: boolean;
    halfDaySession: HalfDaySession | null;
    /**
     * Days of this request that fall inside the months computed so far. A
     * request running into a future month has only its elapsed portion counted,
     * which is what keeps the accrual ledger's arithmetic balanced.
     */
    daysCounted: number;
  })[];
  // The holiday calendar is not part of this view — per the design it belongs to
  // Leave approvals (Policy & holidays). Holidays are still applied server-side
  // when counting the working days in a request.
  policy: {
    leaveYear: number;
    leavePerMonth: number;
    annualEntitlement: number;
    carryCap: number;
    weeklyOff: string[];
  };
  /** Leave days taken per month of the FY, for the chart. */
  monthlyTaken: { month: string; days: number }[];
}

// ---------------------------------------------------------------- approvals

/** A pending request as the approver sees it, with the consequence of approving. */
export interface PendingApproval {
  id: number;
  ref: string;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  designation: string | null;
  leaveType: LeaveType;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  appliedOn: string;
  isHalfDay: boolean;
  halfDaySession: HalfDaySession | null;
  /** Balance before the decision, and what it becomes if approved. */
  balanceNow: number;
  balanceAfter: number;
  /** How the days would split if approved right now. */
  paidDays: number;
  unpaidDays: number;
  /**
   * True when approving would cost the employee pay. The balance itself never
   * goes below zero — the shortfall is settled as loss of pay in that month —
   * so this is flagged for an explicit confirmation rather than blocked.
   */
  createsLossOfPay: boolean;
}

/** One row of the consolidated team balances table. */
export interface TeamBalanceRow {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  opening: number;
  credited: number;
  taken: number;
  lop: number;
  pending: number;
  balance: number;
  lastLeaveOn: string | null;
}

export interface ApprovalsView {
  pending: PendingApproval[];
  balances: TeamBalanceRow[];
  log: (LeaveRequestRecord & {
    employeeName: string;
    reason: string;
    appliedOn: string;
    decidedBy: string | null;
  })[];
  policy: {
    leaveYear: number;
    leavePerMonth: number;
    annualEntitlement: number;
    carryCap: number;
  };
  teamSize: number;
}

export interface DecideLeaveDto {
  requestId: number;
  decision: 'Approved' | 'Rejected';
  note?: string;
}

/** What the approver is told after deciding — the conversion is not silent. */
export interface DecisionResult {
  view: ApprovalsView;
  message: string;
  convertedToUnpaid: boolean;
}
