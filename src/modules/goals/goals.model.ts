import { GoalDirection, GoalPeriod, GoalStatus, GoalType, Milestone } from './goals.domain';

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
