import { GoalApprovalStatus, GoalDirection, GoalPeriod, GoalStatus, GoalType, Milestone } from './goals.domain';

export { GoalApprovalStatus };

/**
 * The column widths in `hrms_goals`, named once.
 *
 * MySQL rejects an over-long value outright rather than truncating it, and that
 * error reached the browser as a bare "Internal server error" — a paragraph
 * typed into Notes was enough to trigger it, back when that column was 500.
 *
 * These numbers must match the column widths in `hrms_goals` — note was
 * widened to varchar(1000) on 9 Oct 2026. Raising one here without running the
 * matching ALTER on the database puts the trap straight back.
 */
export const GOAL_LIMITS = {
  title: 255,
  unit: 10,
  note: 1000,
} as const;

export interface GoalView {
  id: number;
  ref: string;
  employeeId: number;
  employeeName?: string;
  title: string;
  goalType: GoalType;
  period: GoalPeriod;
  /** e.g. "Q2 · Jul–Sep", computed from the financial year's own start. */
  periodLabel: string;

  /** 0–100, derived on every read. Never stored. */
  progress: number;
  status: GoalStatus;

  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  direction: GoalDirection;
  note: string | null;

  setOn: string;
  setterName: string | null;
  approvalStatus: GoalApprovalStatus;
  approvedBy?: number | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  approverName?: string | null;

  /** Only meaningful for a checklist goal; zero and zero for a metric. */
  milestonesDone: number;
  milestonesTotal: number;
  milestones: Milestone[];
}

export interface MyGoalsSummaryView {
  goalsThisYear: number;
  averageProgress: number;
  needingAttention: number;
  achieved: number;
  goals: GoalView[];
}

export interface MemberGoalsGroup {
  employeeId: number;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  managerId?: number | null;
  managerName?: string | null;
  goalsCount: number;
  averageProgress: number;
  goals: GoalView[];
}

export interface TeamGoalsSummaryView {
  totalGoals: number;
  onTrack: number;
  atRisk: number;
  achievedSoFar: number;
  members: MemberGoalsGroup[];
}

export interface CreateGoalDto {
  employeeId: number;
  title: string;
  goalType: GoalType;
  period: GoalPeriod;
  targetValue?: number | null;
  currentValue?: number | null;
  unit?: string | null;
  direction?: GoalDirection;
  note?: string | null;
  milestones?: string[];
}


export interface UpdateGoalDto {
  title: string;
  goalType: GoalType;
  period: GoalPeriod;
  targetValue?: number | null;
  currentValue?: number | null;
  unit?: string | null;
  direction?: GoalDirection;
  note?: string | null;
  milestones?: string[];
}

export interface RejectGoalDto {
  reason?: string | null;
}
