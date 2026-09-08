/**
 * Goals — pure functions, no database and no clock.
 *
 * Policy (Bambinos):
 *   · A goal belongs to one person, for one period, measured one of two ways —
 *     a number to hit, or a checklist to finish.
 *   · Periods sit inside the FINANCIAL year (April–March), not the leave year.
 *     Q4 therefore runs January to March of the following calendar year, and H2
 *     spans the year boundary.
 *   · Progress and status are DERIVED on every read. Neither is stored, so
 *     ticking a milestone cannot leave a stale percentage behind it.
 *
 * The rule that gets written wrong most often is `direction`. "Keep CAC under
 * ₹1,400" while sitting at ₹1,520 is 92% of the way there, not 109%.
 */

import { addDays, addMonths, daysBetween } from '../../shared/dates';

export type GoalType = 'metric' | 'milestone';
export type GoalPeriod = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1' | 'H2' | 'FY';
export type GoalDirection = 'up' | 'down';

/** Derived from progress against time elapsed. Never typed in by anyone. */
export type GoalStatus = 'Achieved' | 'Missed' | 'Not started' | 'At risk' | 'On track';

export interface Milestone {
  id: number;
  title: string;
  isDone: boolean;
  sortOrder: number;
}

export interface GoalRecord {
  id: number;
  ref: string;
  employeeId: number;
  title: string;
  goalType: GoalType;
  fy: string;
  period: GoalPeriod;
  /** Null for a milestone goal. */
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  direction: GoalDirection;
  note: string | null;
  milestones: Milestone[];
}

export interface PeriodWindow {
  from: string;
  to: string;
  /** e.g. "Q2 · Jul–Sep". Derived from the dates, never hardcoded. */
  label: string;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Months from the start of the financial year: [inclusive, exclusive). */
const PERIOD_MONTHS: Record<GoalPeriod, [number, number]> = {
  Q1: [0, 3],
  Q2: [3, 6],
  Q3: [6, 9],
  Q4: [9, 12],
  H1: [0, 6],
  H2: [6, 12],
  FY: [0, 12],
};

const monthNameOf = (date: string): string => MONTHS[Number(date.slice(5, 7)) - 1];

/**
 * The dates a period covers, computed from the financial year's own start.
 *
 * Derived rather than tabulated: the prototype hardcoded April 2026 to March
 * 2027, which is right for exactly one year. Reading `fyStart` from config means
 * the same code is correct in 2030, and correct again if the company ever moves
 * its financial year.
 */
export function periodWindow(period: GoalPeriod, fyStart: string): PeriodWindow {
  const [startMonth, endMonth] = PERIOD_MONTHS[period];
  const from = addMonths(fyStart, startMonth);
  // The day before the next period begins — so months of different lengths and
  // leap years need no special handling.
  const to = addDays(addMonths(fyStart, endMonth), -1);

  const label =
    period === 'FY'
      ? `Full year · ${monthNameOf(from)}–${monthNameOf(to)}`
      : `${period} · ${monthNameOf(from)}–${monthNameOf(to)}`;

  return { from, to, label };
}

/**
 * How far along the goal is, 0–100.
 *
 * Three shapes, and the `down` case is the one to read twice: for a goal where
 * lower is better, progress is target ÷ current — being *under* the target is
 * complete, and being over it is proportionally short.
 */
export function goalProgress(goal: GoalRecord): number {
  if (goal.goalType === 'milestone') {
    if (goal.milestones.length === 0) return 0;
    const done = goal.milestones.filter((m) => m.isDone).length;
    return Math.round((done / goal.milestones.length) * 100);
  }

  const target = goal.targetValue;
  const current = goal.currentValue ?? 0;
  if (target === null) return 0;

  if (goal.direction === 'down') {
    // At or below zero on a "keep it low" goal is complete — "zero escaped
    // defects" is achieved at zero, and dividing by it would not be.
    if (current <= 0) return 100;
    if (target <= 0) return 0;
    return Math.round(Math.min(target / current, 1) * 100);
  }

  if (target <= 0) return 0;
  return clamp(Math.round((current / target) * 100));
}

/**
 * What the goal's state is, resolved in order.
 *
 * `At risk` compares progress against TIME ELAPSED rather than a fixed
 * threshold: 30% halfway through a quarter is behind, and the same 30% in week
 * one is not. The tolerance is company policy from `hrms_fy_config`, never a
 * constant here.
 */
export function goalStatus(
  goal: GoalRecord,
  window: PeriodWindow,
  today: string,
  riskTolerancePct: number,
): GoalStatus {
  const progress = goalProgress(goal);

  // Hitting the target counts even after the period closed — finishing late is
  // still finishing, and reporting it as Missed would be wrong.
  if (progress >= 100) return 'Achieved';
  if (today > window.to) return 'Missed';
  if (today < window.from) return 'Not started';

  const total = daysBetween(window.from, window.to);
  const gone = daysBetween(window.from, today);
  const elapsedPct = total > 0 ? (gone / total) * 100 : 100;

  return progress < elapsedPct - riskTolerancePct ? 'At risk' : 'On track';
}

/** How much of the period has passed, 0–100. Drives the "at risk" comparison. */
export function elapsedPct(window: PeriodWindow, today: string): number {
  const total = daysBetween(window.from, window.to);
  if (total <= 0) return 100;
  return clamp(Math.round((daysBetween(window.from, today) / total) * 100));
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));
