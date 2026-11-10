import { addDays } from '../../shared/dates';

/*
 * The productivity rule (Sajan, 7 Nov 2026).
 *
 * For Sales, from 10 Nov 2026: a working day needs productive time — panel
 * time plus recorded activities — of at least 90% of 9 hours (8h 06m).
 *
 *   met      → the day stands. With no check-in, attendance is marked for the
 *              shift; a check-in left open is closed at the shift's end.
 *   not met  → a full day of earned leave if the balance covers it, otherwise
 *              a full day of unpaid leave (LOP).
 *
 * A day on leave (approved, or still pending), a weekly off or a holiday is
 * left alone. The decision waits until four hours after the shift ends, so a
 * late call can still be recorded, and is made once: an admin's later edit of
 * the day from the calendar is final.
 *
 * Night shifts belong to the date they start, the same rule attendance uses
 * everywhere. Their leave and weekly off are read on that date, and their
 * productive time is counted across midnight, from 6 hours before the shift
 * starts to the end of the grace — which panel time per hour makes possible.
 *
 * Pure: no database and no clock. Times are India time, 'YYYY-MM-DD HH:MM'.
 */

/** The first shift day the rule decides. */
export const PRODUCTIVITY_FROM = '2026-11-16';

/** 90% of 9 hours. */
export const REQUIRED_MINUTES = Math.round(9 * 60 * 0.9);

/** Time after the shift ends to record a late call before the day is decided. */
export const GRACE_MINUTES = 4 * 60;

/** A night shift's window opens this long before the shift starts. */
export const NIGHT_LEAD_MINUTES = 6 * 60;

/** How far back each run looks for undecided days. Covers a few missed runs. */
export const LOOKBACK_DAYS = 7;

/** Sales only, for now. "Presales" is a different department and stays out. */
export const isSalesDepartment = (department: string | null | undefined): boolean =>
  (department ?? '').trim().toLowerCase() === 'sales';

/** Does the rule decide this person's shift day? */
export const isProductivityRuled = (department: string | null | undefined, date: string): boolean =>
  isSalesDepartment(department) && date >= PRODUCTIVITY_FROM;

const minutesOf = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** `date` at `minutes` past its midnight, any number of days either way. */
export function stampAt(date: string, minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const rest = minutes - days * 1440;
  const hh = String(Math.floor(rest / 60)).padStart(2, '0');
  const mm = String(rest % 60).padStart(2, '0');
  return `${addDays(date, days)} ${hh}:${mm}`;
}

export const crossesMidnight = (shiftStart: string, shiftEnd: string): boolean =>
  minutesOf(shiftEnd) <= minutesOf(shiftStart);

export interface ProductivityWindow {
  night: boolean;
  /** Productive time is counted from here … */
  from: string;
  /** … up to here (exclusive), which is also when the day is decided. */
  decideAt: string;
}

/**
 * When the shift day `date` is decided, and the stretch of time it counts.
 *
 * A day shift counts its whole calendar day — the same figure the Active time
 * and Activities tabs show. A night shift counts from 6 hours before it starts
 * to the end of its grace the next morning.
 */
export function windowFor(date: string, shiftStart: string, shiftEnd: string): ProductivityWindow {
  const start = minutesOf(shiftStart);
  let end = minutesOf(shiftEnd);
  const night = crossesMidnight(shiftStart, shiftEnd);
  if (night) end += 1440;
  const decideAt = stampAt(date, end + GRACE_MINUTES);
  return night
    ? { night, from: stampAt(date, start - NIGHT_LEAD_MINUTES), decideAt }
    : { night, from: `${date} 00:00`, decideAt };
}

/** A recorded activity: its own date, HH:MM start and end. */
export interface TimedActivity {
  date: string;
  startTime: string;
  endTime: string;
}

const span = (a: TimedActivity) => ({
  from: `${a.date} ${a.startTime.slice(0, 5)}`,
  to: `${a.date} ${a.endTime.slice(0, 5)}`,
});

const stampMinutes = (stamp: string): number =>
  Math.round(Date.parse(`${stamp.slice(0, 10)}T${stamp.slice(11, 16)}:00Z`) / 60_000);

/**
 * Activity minutes counted for the day. A day shift takes every activity dated
 * that day, in full — the same total the Activities tab shows. A night shift
 * takes the part of each activity inside its window.
 */
export function activityMinutesFor(
  date: string,
  window: ProductivityWindow,
  activities: TimedActivity[],
): number {
  let total = 0;
  for (const a of activities) {
    const s = span(a);
    if (!window.night) {
      if (a.date === date) total += Math.max(0, stampMinutes(s.to) - stampMinutes(s.from));
      continue;
    }
    const from = s.from > window.from ? s.from : window.from;
    const to = s.to < window.decideAt ? s.to : window.decideAt;
    if (to > from) total += stampMinutes(to) - stampMinutes(from);
  }
  return total;
}

/** "8h 06m", "45m". */
export function hm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export type ProductivityOutcome = 'met' | 'earned' | 'unpaid';

export interface ProductivityFigures {
  panelMinutes: number;
  activityMinutes: number;
}

export const productiveMinutes = (f: ProductivityFigures): number => f.panelMinutes + f.activityMinutes;

export const isMet = (f: ProductivityFigures): boolean => productiveMinutes(f) >= REQUIRED_MINUTES;

/** The reason shown when the day is clicked on the calendar. */
export function reasonFor(f: ProductivityFigures, outcome: ProductivityOutcome): string {
  const figures = `${hm(productiveMinutes(f))} productive (panels ${hm(f.panelMinutes)} + activities ${hm(f.activityMinutes)})`;
  const need = hm(REQUIRED_MINUTES);
  if (outcome === 'met') return `Productivity met: ${figures}, at least ${need} needed. Attendance marked automatically.`;
  const as = outcome === 'earned' ? 'earned leave (EL)' : 'loss of pay (LOP) — no leave balance';
  return `Productivity below 90%: ${figures}, ${need} needed. Marked as ${as}.`;
}

/** Whether a day has to be left alone, and why. Null = the rule decides it. */
export type SkipReason = 'not employed' | 'holiday' | 'weekly off' | 'on leave' | 'leave pending' | 'edited by admin';

export interface DayFacts {
  date: string;
  dateOfJoining: string | null;
  dateOfLeaving: string | null;
  weeklyOff: string[];
  holiday: boolean;
  /** Approved or pending leave touching the date (any length, full or half). */
  leave: 'Approved' | 'Pending' | null;
  /** The day's attendance row, if any. */
  record: { source: string; status: string } | null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayName = (date: string): string => DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];

export function skipReason(f: DayFacts): SkipReason | null {
  if (f.dateOfJoining && f.date < f.dateOfJoining) return 'not employed';
  if (f.dateOfLeaving && f.date > f.dateOfLeaving) return 'not employed';
  if (f.holiday) return 'holiday';

  const manual = f.record?.source === 'manual';
  // An admin's per-date Weekly off, or a usual off day nobody turned into a
  // working day (the Sales week of 10–15 Nov did that with manual Absent rows).
  if (manual && f.record?.status === 'Weekly off') return 'weekly off';
  if (!manual && f.weeklyOff.includes(dayName(f.date))) return 'weekly off';

  if (f.leave === 'Approved') return 'on leave';
  if (f.leave === 'Pending') return 'leave pending';

  // Any other hand-set day — Present, Leave, Half day — is an admin's decision.
  // A manual Absent is the "this off day is a working day" marker, not a decision.
  if (manual && f.record?.status !== 'Absent') return 'edited by admin';
  return null;
}
