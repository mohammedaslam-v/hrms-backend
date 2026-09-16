/**
 * Attendance — pure functions, no database and no clock.
 *
 * Policy (Bambinos). A day is measured one of TWO ways, and which one applies to
 * a person is `hrms_employees.attendance_mode`:
 *
 *   · PUNCH — the employee records their own day by pressing check in and check
 *     out, and active hours are the span between the two. This is a
 *     DECLARATION: the numbers mean exactly that and nothing more.
 *   · ACTIVITY — for the people who work inside the admin portals all day and
 *     would never press a button, the day is measured from what those portals
 *     saw. The day is cut into 48 half-hour slots and a slot counts if anything
 *     happened inside it. This is an OBSERVATION, and it is the weaker of the
 *     two: it cannot see a phone call, a meeting, or a conversation with a
 *     parent on WhatsApp.
 *
 *   · Lateness is `late_by_minutes > lateGraceMinutes`, and the grace window is
 *     company policy read from `hrms_fy_config` — never a constant in here.
 *     LATENESS IS NOT DERIVED IN ACTIVITY MODE AT ALL. First activity is not
 *     arrival: someone at their desk from 10:00 who spends forty minutes on a
 *     call has done nothing wrong, and calling them Late would be the most
 *     damaging false signal this module could produce. Observation answers
 *     "were they working", never "were they punctual".
 *   · A day with no punch is not automatically an absence. It may be a holiday,
 *     a weekly off, approved leave, or simply a day that has not finished yet.
 *   · Shifts may cross midnight — 23:00 to 07:00, 18:00 to 03:00. A night shift
 *     belongs to the day it STARTED, so one shift is still one row and its hours
 *     are never split across two dates. Activity slots are folded onto the shift
 *     day by the same rule, so both modes agree about which day a night was.
 *
 * Everything is computed from what was stored every time it is shown, so a
 * correction cannot leave a stale total behind it.
 *
 * Times are 'HH:MM' or 'HH:MM:SS' strings and dates are 'YYYY-MM-DD' strings,
 * end to end — the same convention the leave domain uses, so nothing here can be
 * shifted by a timezone.
 */

import { addDays, eachDate } from '../../shared/dates';
import { LeaveType } from '../leave/leave.domain';

// Re-exported so callers in this module keep one import.
export { addDays, eachDate };

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
  /**
   * Observed half-hour slots, for people on `attendance_mode = 'activity'`.
   *
   * Its presence — not its value — is what selects the mode: an empty mask is a
   * real answer meaning "the portals saw nothing today", which is different from
   * `null` meaning "this person is measured by punching". When it is set, hours
   * come from here and lateness is not derived at all.
   */
  slots?: SlotMask | null;
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

/** 0 = Sunday … 6 = Saturday. UTC, so no timezone can shift the day. */
function weekdayIndexOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function dayNameOf(date: string): string {
  return DAY_NAMES[weekdayIndexOf(date)];
}

/**
 * The Monday-to-Sunday week containing `date`.
 *
 * A real calendar week, not the last seven days. It resets on Monday, which
 * means early in the week most of the chart is days that have not happened yet —
 * they resolve as 'Not in yet' and draw empty, which is the honest picture.
 *
 * Monday-first because the working week is, and because a Sunday-first week puts
 * the commonest weekly off at the START of the chart rather than the end.
 */
export function calendarWeek(date: string): string[] {
  // Sunday is index 0, so shift it to the end: Mon = 0 … Sun = 6.
  const sinceMonday = (weekdayIndexOf(date) + 6) % 7;
  const monday = addDays(date, -sinceMonday);
  return eachDate(monday, addDays(monday, 6));
}

export const isWeeklyOff = (date: string, weeklyOff: string[]): boolean =>
  weeklyOff.includes(dayNameOf(date));

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

// ------------------------------------------------------- observed activity

/**
 * Half an hour. Deliberately a constant here rather than a row in
 * `hrms_fy_config` alongside `late_grace_minutes`: a stored mask only means
 * anything against the slot size it was written with, so making this a setting
 * would let somebody silently reinterpret every historical row. Changing it is
 * a migration, not a configuration change.
 *
 * Coarse on purpose, too. A finer grain would describe someone's day minute by
 * minute; half an hour cannot show when you took a call or stepped out.
 */
export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = DAY_MINUTES / SLOT_MINUTES; // 48

/**
 * A day of observed activity as a bitmask: bit N is set when the portal saw
 * something in the half hour starting N × 30 minutes after midnight.
 *
 * `bigint`, not `number`. All 48-bit values fit exactly in a double, but JS
 * bitwise operators truncate to 32 bits, so `mask & (1 << 40)` silently returns
 * nonsense. Every bit test in here goes through `hasSlot`.
 */
export type SlotMask = bigint;

export const EMPTY_SLOTS: SlotMask = 0n;

/** Which slot a time falls in. 10:04 and 10:29 are both slot 20. */
export const slotOf = (time: string): number => Math.floor(minutesOf(time) / SLOT_MINUTES);

/** The clock time a slot begins at, as 'HH:MM'. */
export function slotStartsAt(slot: number): string {
  const minutes = slot * SLOT_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export const hasSlot = (mask: SlotMask, slot: number): boolean =>
  (mask >> BigInt(slot)) % 2n === 1n;

export const withSlot = (mask: SlotMask, slot: number): SlotMask => mask | (1n << BigInt(slot));

/** How many half hours had activity in them. */
export function countSlots(mask: SlotMask): number {
  let count = 0;
  for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
    if (hasSlot(mask, slot)) count++;
  }
  return count;
}

/**
 * Observed hours: the number of half hours seen, halved.
 *
 * Two decimal places to match `hrms_attendance.active_hours DECIMAL(5,2)`,
 * though on a 30-minute grid the result is always a whole or half hour.
 */
export const activeHoursFromSlots = (mask: SlotMask): number =>
  (countSlots(mask) * SLOT_MINUTES) / 60;

/**
 * Fold the calendar days a shift touches onto the shift day it belongs to.
 *
 * A day shift is trivial — one calendar day, one mask. A night shift starting
 * on day D runs into D+1, and the rule is exactly the one `shiftDateOf` already
 * applies to punches: a moment at or before the shift's end belongs to the shift
 * that started YESTERDAY. So the shift day takes the slots after the boundary
 * from its own date, and the slots up to the boundary from the following one.
 *
 * Using the same rule in both places is the point. If punches and slots
 * disagreed about which day a night belonged to, the two halves of the company
 * would be counting different weeks.
 */
export function slotsForShiftDay(
  maskOnShiftDate: SlotMask,
  maskOnNextDate: SlotMask,
  shiftStart: string,
  shiftEnd: string,
): SlotMask {
  if (!crossesMidnight(shiftStart, shiftEnd)) return maskOnShiftDate;

  const boundary = slotOf(shiftEnd);
  let folded = EMPTY_SLOTS;

  for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
    // After the boundary on the shift's own date: the night getting under way.
    if (slot > boundary && hasSlot(maskOnShiftDate, slot)) folded = withSlot(folded, slot);
    // At or before it on the next date: the tail of the same night.
    if (slot <= boundary && hasSlot(maskOnNextDate, slot)) folded = withSlot(folded, slot);
  }

  return folded;
}

/**
 * A stretch of a day. `to` is null only for a punch still running.
 *
 * An end of '24:00' means midnight at the end of the day — not a real clock
 * reading, but the honest label for a stretch that ran to the end of the date.
 */
export interface TimeRange {
  from: string;
  to: string | null;
}

/**
 * The unbroken stretches of activity in a day, in the order they were worked.
 *
 * This is what turns "eight hours" into "10:00–13:30, 14:30–17:00, 17:30–19:30"
 * — the gaps are the point, and a total on its own hides them.
 *
 * `startSlot` sets where the walk begins so a night shift reads forwards. Its
 * folded mask holds slots at both ends of the clock (23:00–24:00 and
 * 00:00–07:00); starting the walk at midnight would report the morning first
 * and make one continuous night look like two separate stints in the wrong
 * order.
 */
export function segmentsOf(mask: SlotMask, startSlot = 0): TimeRange[] {
  const ranges: TimeRange[] = [];
  let runStart: number | null = null;

  // One extra step so a run reaching the end of the walk is still closed.
  for (let step = 0; step <= SLOTS_PER_DAY; step++) {
    const slot = (startSlot + step) % SLOTS_PER_DAY;
    const active = step < SLOTS_PER_DAY && hasSlot(mask, slot);

    if (active && runStart === null) {
      runStart = slot;
    } else if (!active && runStart !== null) {
      // Slot 0 as an END means the stretch ran to midnight, so say so.
      ranges.push({ from: slotStartsAt(runStart), to: slot === 0 ? '24:00' : slotStartsAt(slot) });
      runStart = null;
    }
  }

  return ranges;
}

/**
 * Which method should be used to read ONE day.
 *
 * A person has a current mode, but a day has a history, and the two disagree the
 * moment somebody is switched. Changing a mode must not rewrite the past:
 * without this rule, moving a person onto observation on a Friday blanks the
 * whole week they had already punched, because slots do not exist for those days
 * and never will. Real recorded hours would simply disappear from the chart.
 *
 * Slots win wherever they exist. A day with none falls back to its punch.
 */
export const readDayAsObserved = (
  observed: boolean,
  slots: SlotMask,
  hasPunch: boolean,
): boolean => observed && (countSlots(slots) > 0 || !hasPunch);

/** The first and last half hours with activity, or nulls when there were none. */
export function seenBetween(mask: SlotMask): { first: string | null; last: string | null } {
  let first: number | null = null;
  let last: number | null = null;
  for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
    if (!hasSlot(mask, slot)) continue;
    if (first === null) first = slot;
    last = slot;
  }
  return {
    first: first === null ? null : slotStartsAt(first),
    // The END of the last active half hour, so a single slot reads 10:00–10:30
    // rather than 10:00–10:00.
    last: last === null ? null : slotStartsAt((last + 1) % SLOTS_PER_DAY),
  };
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

  // Observed activity. Never 'Late' — see the note in the module header: the
  // first thing someone clicked is not the moment they arrived.
  if (facts.slots != null) {
    if (countSlots(facts.slots) > 0) return 'On time';
    return facts.date >= facts.today ? 'Not in yet' : 'Absent';
  }

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
  /**
   * When the person was actually working, in order.
   *
   * One stretch for a punch — they declared a start and an end. Possibly several
   * for an observed day, and the gaps between them are the interesting part:
   * a total of eight hours says nothing about whether it was one stint or four.
   */
  segments: TimeRange[];
  /**
   * Where this day's hours came from. Per DAY, not per person: somebody whose
   * role was added to the activity list on Wednesday has punched days behind
   * them and observed days ahead, and the chart should not pretend otherwise.
   */
  source: DaySource;
}

/** How one day's hours were arrived at. */
export type DaySource = 'punch' | 'activity';

/** A whole day resolved: its status and its numbers, from one set of facts. */
export function attendanceOf(facts: DayFacts): DayAttendance {
  const status = resolveDayStatus(facts);

  // Observed. First and last seen stand in for the punches, so every screen
  // downstream keeps one shape; hours come from the slots, and lateness is
  // deliberately left at zero rather than guessed at.
  if (facts.slots != null) {
    const seen = seenBetween(facts.slots);
    return {
      date: facts.date,
      status,
      loginAt: seen.first,
      logoutAt: seen.last,
      activeHours: activeHoursFromSlots(facts.slots),
      lateByMinutes: 0,
      // Walked from the shift's own start, so a night reads forwards.
      segments: segmentsOf(facts.slots, slotOf(facts.shiftStart)),
      source: 'activity',
    };
  }

  return {
    date: facts.date,
    status,
    loginAt: facts.punch?.loginAt ?? null,
    logoutAt: facts.punch?.logoutAt ?? null,
    // Hours and lateness come from the punch whatever the status says, so a
    // Saturday shift or a half day worked around leave is never invisible.
    activeHours: facts.punch ? activeHours(facts.punch) : 0,
    lateByMinutes: facts.punch ? minutesLate(facts.punch.loginAt, facts.shiftStart) : 0,
    // A declared day is one stretch by definition. `to` stays null while the
    // person is still checked in, which the card reads as "and counting".
    segments: facts.punch ? [{ from: facts.punch.loginAt, to: facts.punch.logoutAt }] : [],
    source: 'punch',
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
  /** The stretches behind the bar, for the detail shown on hover. */
  segments: TimeRange[];
  /** Whether this day's hours were declared or observed. */
  source: DaySource;
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
    segments: day.segments,
    source: day.source,
  }));
}
