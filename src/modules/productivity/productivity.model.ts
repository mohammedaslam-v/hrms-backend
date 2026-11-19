import type { ProductivityOutcome } from './productivity.domain';

/** A Sales employee the rule may decide days for. */
export interface RuledEmployee {
  id: number;
  adminId: number | null;
  department: string | null;
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: string[];
  dateOfJoining: string | null;
  dateOfLeaving: string | null;
}

/** One decided day, kept so it is never decided twice (`hrms_productivity_days`). */
export interface ProductivityDecision {
  employeeId: number;
  date: string;
  panelMinutes: number;
  activityMinutes: number;
  outcome: ProductivityOutcome;
  reason: string;
}

/** What one settlement run did — logged, and returned by the admin endpoint. */
export interface SettleSummary {
  checked: number;
  decided: number;
  met: number;
  earned: number;
  unpaid: number;
  failed: number;
}
