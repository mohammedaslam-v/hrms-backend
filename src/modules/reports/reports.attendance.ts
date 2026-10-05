import { IAttendanceRepository } from '../attendance/attendance.repository.interface';
import { isActivityMeasured } from '../attendance/attendance.config';
import {
  activeHours,
  activeHoursFromSlots,
  countSlots,
  dayNameOf,
  isWeeklyOff,
  minutesLate,
  resolveDayStatus,
  type AttendanceStatus,
  type SlotMask,
} from '../attendance/attendance.domain';

/**
 * One day of one person's attendance, as the reports need it.
 *
 * Reports used to print `10:04` for everybody on every day — a literal in the
 * row builder, with no query behind it. This is the replacement: the same facts
 * My Page derives from, assembled once for a whole date range and handed to
 * every attendance report, so the five of them cannot disagree about who was
 * late.
 */
export interface AttendanceDay {
  employeeId: number;
  date: string;
  dayName: string;
  shiftStart: string;
  shiftEnd: string;
  loginAt: string | null;
  logoutAt: string | null;
  activeHours: number;
  lateByMinutes: number;
  status: AttendanceStatus;
  /** True when the hours came from observed slots rather than a punch. */
  fromActivity: boolean;
}

/** Every day in [from, to] inclusive, as ISO dates. */
export function datesBetween(from: string, to: string, cap = 400): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && out.length < cap) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * Five bulk queries for the whole report, not five per person per day.
 *
 * A month for 175 people is 5,425 cells; fetching them one at a time is the
 * difference between a report that renders and one that times out.
 */
export async function loadAttendanceDays(
  attendance: IAttendanceRepository,
  employeeIds: number[],
  from: string,
  to: string,
  today: string,
  lateGraceMinutes: number,
): Promise<Map<number, Map<string, AttendanceDay>>> {
  const byEmployee = new Map<number, Map<string, AttendanceDay>>();
  if (employeeIds.length === 0) return byEmployee;

  const [schedules, punches, slots, holidays, leaves] = await Promise.all([
    attendance.findSchedulesFor(employeeIds),
    attendance.findRangeFor(employeeIds, from, to),
    attendance.findActivitySlotsFor(employeeIds, from, to),
    attendance.findHolidaysBetween(from, to),
    attendance.findApprovedLeavesBetween(employeeIds, from, to),
  ]);

  // Punches indexed by person and day. A night shift is filed against the day
  // it started, which is what att_date already holds.
  const punchBy = new Map<string, (typeof punches)[number]>();
  for (const p of punches) punchBy.set(`${p.employeeId}|${p.date}`, p);

  const dates = datesBetween(from, to);

  for (const employeeId of employeeIds) {
    const schedule = schedules.get(employeeId);
    const shiftStart = schedule?.shiftStart ?? '10:00';
    const shiftEnd = schedule?.shiftEnd ?? '19:00';
    const weeklyOff = schedule?.weeklyOff ?? ['Sun'];

    // Whose hours come from observed slots rather than punches. The same rule
    // My Page uses, read from admins.role rather than stored per employee.
    const measured = isActivityMeasured(schedule?.portalRole ?? null);
    const slotsForEmployee = slots.get(employeeId);

    const days = new Map<string, AttendanceDay>();

    for (const date of dates) {
      // Someone who has left has no attendance after their last day, rather
      // than a run of absences.
      if (schedule?.dateOfLeaving && date > schedule.dateOfLeaving) continue;

      // A row in hrms_attendance is not necessarily a punch: the calendar
      // writes rows for Leave and Weekly off with login_at NULL. Only a row
      // with a login time counts as somebody having turned up.
      const record = punchBy.get(`${employeeId}|${date}`) ?? null;
      const punch =
        record && record.loginAt
          ? { loginAt: record.loginAt, logoutAt: record.logoutAt }
          : null;
      // Slots only when slots were actually recorded.
      //
      // resolveDayStatus treats a non-null mask as the authority and ignores
      // the punch, which is right on My Page where an empty mask genuinely
      // means "the portals saw nothing". Here it would be wrong: nothing
      // writes hrms_activity_day in production yet — the Laravel middleware is
      // registered but attached to no route — so every activity-measured role,
      // which is all of them, would report 'Not in yet' however early they
      // punched in. Passing null falls through to the punch, the only real
      // signal available. The day a mask exists, it wins again.
      const recorded = measured ? slotsForEmployee?.get(date) : undefined;
      const mask: SlotMask | null =
        recorded != null && countSlots(recorded) > 0 ? recorded : null;

      const leave = leaves.find(
        (l) => l.employeeId === employeeId && date >= l.fromDate && date <= l.toDate,
      );

      const status = resolveDayStatus({
        date,
        today,
        weeklyOff,
        holidayName: holidays.get(date) ?? null,
        leave: leave ? { type: leave.leaveType, isHalfDay: leave.isHalfDay } : null,
        punch,
        slots: mask,
        shiftStart,
        lateGraceMinutes,
      });

      // Hours follow whichever source the person is measured by. A punch still
      // supplies the login and logout times either way — somebody on activity
      // who also pressed check in has both.
      const hours =
        mask != null && countSlots(mask) > 0
          ? activeHoursFromSlots(mask)
          : punch
            ? activeHours({ loginAt: punch.loginAt, logoutAt: punch.logoutAt })
            : 0;

      days.set(date, {
        employeeId,
        date,
        dayName: dayNameOf(date),
        shiftStart,
        shiftEnd,
        loginAt: punch?.loginAt ?? null,
        logoutAt: punch?.logoutAt ?? null,
        activeHours: hours,
        lateByMinutes:
          punch && !isWeeklyOff(date, weeklyOff)
            ? Math.max(0, minutesLate(punch.loginAt, shiftStart))
            : 0,
        status,
        fromActivity: mask != null && countSlots(mask) > 0,
      });
    }

    byEmployee.set(employeeId, days);
  }

  return byEmployee;
}

/** `10:00–19:00`, from the person's own schedule rather than a constant. */
export const shiftLabel = (day: AttendanceDay): string =>
  `${day.shiftStart.slice(0, 5)}–${day.shiftEnd.slice(0, 5)}`;

/** Times render as HH:MM; a dash reads better than an empty cell in a report. */
export const timeLabel = (time: string | null): string =>
  time ? time.slice(0, 5) : '—';
