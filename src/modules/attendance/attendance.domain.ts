/**
 * Attendance — pure functions, no database and no clock.
 *
 * Policy (Bambinos):
 *   · A working day is recorded by the employee checking in and checking out.
 *     Active hours are the span between the two punches. There is no passive
 *     tracking: attendance is a DECLARATION, and the numbers here mean exactly
 *     that and nothing more.
 *   · Lateness is `late_by_minutes > lateGraceMinutes`, and the grace window is
 *     company policy read from `hrms_fy_config` — never a constant in here.
 *   · A day with no punch is not automatically an absence. It may be a holiday,
 *     a weekly off, approved leave, or simply a day that has not finished yet.
 *   · Shifts may cross midnight — 23:00 to 07:00, 18:00 to 03:00. A night shift
 *     belongs to the day it STARTED, so one shift is still one row and its hours
 *     are never split across two dates.
 *
 * Everything is computed from stored punches every time it is shown, so a
 * correction to a punch cannot leave a stale total behind it.
 *
 * Times are 'HH:MM' or 'HH:MM:SS' strings and dates are 'YYYY-MM-DD' strings,
 * end to end — the same convention the leave domain uses, so nothing here can be
 * shifted by a timezone.
 */

import { LeaveType } from '../leave/leave.domain';

export type AttendanceStatus =
  | 'On time'
  | 'Late'
  | 'Absent'
  | 'Half day'
  | 'Leave'
  | 'Weekly off'
  | 'Holiday'
  | 'Not in yet';

/** A day's punch pair. `logoutAt` is null while the person is still checked in. */
export interface Punch {
  loginAt: string;
  logoutAt: string | null;
}

export interface DayFacts {
  date: string;
  /**
   * Today's date, passed in rather than read from a clock, so these functions
   * stay pure and a test can place itself on any day it likes.
   */
  today: string;
  weeklyOff: string[];
  /** Set only when HR has declared a company-wide closure. Normally null. */
  holidayName: string | null;
  /** Approved leave covering this day, if any. */
  leave: { type: LeaveType; isHalfDay: boolean } | null;
  punch: Punch | null;
  shiftStart: string;
  lateGraceMinutes: number;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

/** 'HH:MM[:SS]' to minutes since midnight. Seconds are ignored, not rounded. */
export function minutesOf(time: string): number {
  const match = TIME.exec(time);
  if (!match) throw new Error(`Not a time: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function dayNameOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export const isWeeklyOff = (date: string, weeklyOff: string[]): boolean =>
  weeklyOff.includes(dayNameOf(date));

/** Every date from `from` to `to` inclusive, oldest first. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  if (to < from) return out;
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`).getTime();
  // Bounded: a malformed range can never spin, whatever a caller passes.
  for (let i = 0; cursor.getTime() <= end && i < 400; i++) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** The `count` days ending at `endDate`, oldest first. */
export function lastDays(endDate: string, count: number): string[] {
  const start = new Date(`${endDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (count - 1));
  return eachDate(start.toISOString().slice(0, 10), endDate);
}

// ----------------------------------------------------------- overnight work

/** Half a day. Used to tell "arrived early" from "arrived very late". */
const HALF_DAY_MINUTES = 720;
const DAY_MINUTES = 1440;

/**
 * The longest a single stint can plausibly be. Beyond this a punch pair is a
 * data error rather than a very long night, and counting it would poison every
 * total downstream.
 */
export const MAX_STINT_HOURS = 18;

/** Does this shift run past midnight? 23:00–07:00 does; 10:00–19:00 does not. */
export const crossesMidnight = (shiftStart: string, shiftEnd: string): boolean =>
  minutesOf(shiftEnd) <= minutesOf(shiftStart);

/** `date` shifted by `days`, as a YYYY-MM-DD string. */
export function addDays(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

/**
 * Which day's shift a punch belongs to.
 *
 * For a day shift this is simply the date of the punch. For a night shift it is
 * the day the shift STARTED: someone on 23:00–07:00 checking in at 00:30 is
 * joining a shift that began yesterday, so the row is yesterday's.
 *
 * Anchoring on the start day is what keeps one shift in one row. Otherwise a
 * night would be split across two dates and every total downstream would have to
 * add the halves back together.
 */
export function shiftDateOf(
  punchDate: string,
  punchTime: string,
  shiftStart: string,
  shiftEnd: string,
): string {
  if (!crossesMidnight(shiftStart, shiftEnd)) return punchDate;

  // At or before the shift's end time means we are in the tail of the night that
  // started yesterday — not the beginning of tonight. Inclusive, because
  // clocking off exactly on the hour is the commonest case of all.
  if (minutesOf(punchTime) <= minutesOf(shiftEnd)) return addDays(punchDate, -1);

  return punchDate;
}

// ------------------------------------------------------------------ lateness

/**
 * Minutes past the start of the shift.
 *
 * Measured FORWARD around the clock rather than by subtraction, so it is right
 * for a shift that crosses midnight: 00:30 against a 23:00 start is 90 minutes
 * late, where subtracting gives a negative and reads as on time.
 *
 * More than half a day forward is read as arriving early instead — 22:50 against
 * a 23:00 start is ten minutes early, not 23 hours 50 late. Early is always
 * zero, never credit against a later day.
 */
export function minutesLate(loginAt: string, shiftStart: string): number {
  const forward = (minutesOf(loginAt) - minutesOf(shiftStart) + DAY_MINUTES) % DAY_MINUTES;
  return forward > HALF_DAY_MINUTES ? 0 : forward;
}

/**
 * The definition of Late, in one place.
 *
 * It decides the stored status, the late-logins report and the punctuality
 * percentage. Three readings computed from one function cannot disagree; three
 * copies of `> 15` eventually will.
 */
export const isLate = (lateByMinutes: number, lateGraceMinutes: number): boolean =>
  lateByMinutes > lateGraceMinutes;

// -------------------------------------------------------------- active hours

/**
 * Hours between checking in and checking out, to two decimal places — matching
 * `hrms_attendance.active_hours DECIMAL(5,2)`.
 *
 * A check-out earlier than the check-in means the clock passed midnight, so the
 * span wraps into the next day: 23:10 to 07:05 is 7h 55m, not a negative. This
 * needs no knowledge of the roster, because both punches always belong to the
 * same stint — check-out closes the open row, whatever the calendar says.
 *
 * A wrapped span longer than MAX_STINT_HOURS is not a very long night; it is a
 * punch pair that no longer makes sense, usually after a hand correction. Those
 * return 0 rather than an invented figure.
 */
export function activeHours(punch: Punch): number {
  if (!punch.logoutAt) return 0;

  let minutes = minutesOf(punch.logoutAt) - minutesOf(punch.loginAt);
  if (minutes < 0) minutes += DAY_MINUTES;

  if (minutes <= 0 || minutes > MAX_STINT_HOURS * 60) return 0;
  return Math.round((minutes / 60) * 100) / 100;
}

// --------------------------------------------------------------- day status

/**
 * What a day was, resolved in strict order — first match wins.
 *
 *   1. a declared company holiday
 *   2. the employee's weekly off
 *   3. approved leave
 *   4. a punch: Late or On time
 *   5. today or later, with no punch yet
 *   6. otherwise, an absence
 *
 * The order carries the meaning. Leave is tested before absence, or someone on
 * approved leave is marked absent. Holidays come before weekly offs, or the
 * holiday count is wrong for anyone whose off day lands on one. And a day that
 * has not finished cannot be an absence — that is what 'Not in yet' is for.
 */
export function resolveDayStatus(facts: DayFacts): AttendanceStatus {
  if (facts.holidayName) return 'Holiday';

  // A punch on a weekly off still records its hours — see attendanceOf() — but
  // the day is reported as the off day it was.
  if (isWeeklyOff(facts.date, facts.weeklyOff)) return 'Weekly off';

  if (facts.leave) return facts.leave.isHalfDay ? 'Half day' : 'Leave';

  if (facts.punch) {
    const late = minutesLate(facts.punch.loginAt, facts.shiftStart);
    return isLate(late, facts.lateGraceMinutes) ? 'Late' : 'On time';
  }

  // A day still running, or one yet to come, is not an absence.
  if (facts.date >= facts.today) return 'Not in yet';

  return 'Absent';
}

export interface DayAttendance {
  date: string;
  status: AttendanceStatus;
  loginAt: string | null;
  logoutAt: string | null;
  activeHours: number;
  lateByMinutes: number;
}

/** A whole day resolved: its status and its numbers, from one set of facts. */
export function attendanceOf(facts: DayFacts): DayAttendance {
  const status = resolveDayStatus(facts);
  return {
    date: facts.date,
    status,
    loginAt: facts.punch?.loginAt ?? null,
    logoutAt: facts.punch?.logoutAt ?? null,
    // Hours and lateness come from the punch whatever the status says, so a
    // Saturday shift or a half day worked around leave is never invisible.
    activeHours: facts.punch ? activeHours(facts.punch) : 0,
    lateByMinutes: facts.punch ? minutesLate(facts.punch.loginAt, facts.shiftStart) : 0,
  };
}

// ----------------------------------------------------------------- the chart

/** A full day, used as the floor of the weekly chart's scale. */
export const CHART_MINIMUM_HOURS = 9;

export interface WeekBar {
  date: string;
  dayName: string;
  status: AttendanceStatus;
  hours: number;
  /** Height as a percentage of the chart's scale, 0–100. */
  percent: number;
  isToday: boolean;
}

/**
 * The last seven days as bars.
 *
 * The scale has a nine-hour floor. Without it a week whose longest day was four
 * hours would draw a full-height bar and read like a normal week — the chart
 * would be technically correct and completely misleading.
 */
export function weekBars(days: DayAttendance[], today: string): WeekBar[] {
  const recent = [...days].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
  const scale = Math.max(CHART_MINIMUM_HOURS, ...recent.map((d) => d.activeHours));

  return recent.map((day) => ({
    date: day.date,
    dayName: dayNameOf(day.date),
    status: day.status,
    hours: day.activeHours,
    percent: Math.round((day.activeHours / scale) * 100),
    isToday: day.date === today,
  }));
}
