import { GoalPeriod, GoalStatus, GoalType } from './goals.domain';

/**
 * One goal as My page shows it: the stored fields plus the two things that are
 * always derived — how far along it is, and what that means.
 */
export interface GoalView {
  id: number;
  ref: string;
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
  note: string | null;

  /** Only meaningful for a checklist goal; zero and zero for a metric. */
  milestonesDone: number;
  milestonesTotal: number;
}
