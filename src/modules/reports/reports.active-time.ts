import { coveredMinutes } from '../work-activity/work-activity.domain';
import { type AttendanceDay, type ReportDayStatus } from './reports.attendance';

/*
 * The "Active time" tab on Attendance & activity: per person, per day, two
 * figures side by side —
 *
 *   panel — time actively used on the Bambinos panels (the presence tracker's
 *           daily total, every panel added together);
 *   shift — time checked in, with the day's status (Leave, Weekly off, …)
 *           wherever there were no working hours to show.
 *
 * Pure: the service loads the facts and this assembles them, so the rules are
 * tested without a database.
 */

/** One person's day. `status` null = not with the company that day. */
export interface ActiveTimeDay {
  date: string;
  panelSeconds: number;
  /** Checked-in minutes; today's open check-in counts up to now. */
  shiftMinutes: number;
  status: ReportDayStatus | null;
}

export interface ActiveTimeRow {
  employeeId: number;
  code: string;
  name: string;
  department: string | null;
  shiftStart: string;
  shiftEnd: string;
  days: ActiveTimeDay[];
  totals: { panelSeconds: number; shiftMinutes: number };
}

export interface ActiveTimePerson {
  id: number;
  code: string;
  name: string;
  department: string | null;
}

export interface ActiveTimeView {
  from: string;
  to: string;
  /** India date — the frontend greys days after it. */
  today: string;
  dates: string[];
  /** Everyone the viewer may pick in the filter, whatever is selected now. */
  people: ActiveTimePerson[];
  rows: ActiveTimeRow[];
}

export interface ActiveTimeMember {
  id: number;
  employeeCode: string;
  fullName: string;
  department: string | null;
  shiftStart: string;
  shiftEnd: string;
}

const hm = (t: string): string => t.slice(0, 5);

/** Checked-in minutes for a day: settled hours, or up to now while still in. */
export function shiftMinutesOf(day: AttendanceDay, today: string, nowTime: string): number {
  if (day.loginAt && !day.logoutAt && day.date === today) {
    return coveredMinutes([{ from: day.loginAt, to: null }], nowTime);
  }
  return Math.round(day.activeHours * 60);
}

export function buildActiveTimeRows(
  members: ActiveTimeMember[],
  dates: string[],
  attendance: Map<number, Map<string, AttendanceDay>>,
  panel: Map<number, Map<string, { activeSeconds: number }>>,
  today: string,
  nowTime: string,
): ActiveTimeRow[] {
  return members
    .map((m) => {
      const att = attendance.get(m.id);
      const pan = panel.get(m.id);
      const days = dates.map((date): ActiveTimeDay => {
        const day = att?.get(date);
        return {
          date,
          panelSeconds: pan?.get(date)?.activeSeconds ?? 0,
          shiftMinutes: day ? shiftMinutesOf(day, today, nowTime) : 0,
          status: day?.status ?? null,
        };
      });
      return {
        employeeId: m.id,
        code: m.employeeCode,
        name: m.fullName,
        department: m.department,
        shiftStart: hm(m.shiftStart),
        shiftEnd: hm(m.shiftEnd),
        days,
        totals: {
          panelSeconds: days.reduce((s, d) => s + d.panelSeconds, 0),
          shiftMinutes: days.reduce((s, d) => s + d.shiftMinutes, 0),
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
