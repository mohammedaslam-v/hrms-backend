import type { WorkActivity, WorkActivityType } from '../work-activity/work-activity.model';
import type { ReportDayStatus } from './reports.attendance';
import type { ActiveTimePerson } from './reports.active-time';

/*
 * The "Activities" tab on Attendance & activity: one row per person per day,
 *
 *   panel      — time actively used on the Bambinos panels that day;
 *   activities — the calls, meetings and other work they recorded, each with
 *                its note, from–to and length, and their total.
 *
 * A day appears when there is something on it: at least one activity, or
 * panel time. A day with neither is left out — it would be an empty row.
 *
 * Pure: the service loads the facts and this assembles them.
 */

export interface ActivityItem {
  id: number;
  type: WorkActivityType;
  note: string | null;
  /** HH:MM, India time. */
  startTime: string;
  endTime: string;
  minutes: number;
}

export interface ActivityDayRow {
  date: string;
  employeeId: number;
  code: string;
  name: string;
  department: string | null;
  panelSeconds: number;
  /** Weekly off / Holiday is shown under the date; null otherwise. */
  dayOff: 'Weekly off' | 'Holiday' | null;
  /** Sum of the listed activities' lengths, so the row adds up. */
  activityMinutes: number;
  activities: ActivityItem[];
}

export interface ActivitiesView {
  from: string;
  to: string;
  today: string;
  /** Everyone the viewer may pick in the filter, whatever is selected now. */
  people: ActiveTimePerson[];
  /** Newest date first, then by name. */
  rows: ActivityDayRow[];
}

export interface ActivitiesMember {
  id: number;
  employeeCode: string;
  fullName: string;
  department: string | null;
}

/** Under a minute of panel time is noise from opening a tab, not work. */
const MIN_PANEL_SECONDS = 60;

const toMinutes = (t: string): number => {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};

export function activityMinutes(a: Pick<WorkActivity, 'startTime' | 'endTime'>): number {
  return Math.max(0, toMinutes(a.endTime) - toMinutes(a.startTime));
}

export function buildActivityRows(
  members: ActivitiesMember[],
  dates: string[],
  activities: Map<number, WorkActivity[]>,
  panel: Map<number, Map<string, { activeSeconds: number }>>,
  status: Map<number, Map<string, { status: ReportDayStatus | null }>>,
): ActivityDayRow[] {
  const rows: ActivityDayRow[] = [];
  for (const m of members) {
    const byDate = new Map<string, WorkActivity[]>();
    for (const a of activities.get(m.id) ?? []) {
      const list = byDate.get(a.date) ?? [];
      list.push(a);
      byDate.set(a.date, list);
    }
    for (const date of dates) {
      const items = (byDate.get(date) ?? [])
        .slice()
        .sort((x, y) => x.startTime.localeCompare(y.startTime))
        .map(
          (a): ActivityItem => ({
            id: a.id,
            type: a.type,
            note: a.note,
            startTime: a.startTime.slice(0, 5),
            endTime: a.endTime.slice(0, 5),
            minutes: activityMinutes(a),
          }),
        );
      const panelSeconds = panel.get(m.id)?.get(date)?.activeSeconds ?? 0;
      if (items.length === 0 && panelSeconds < MIN_PANEL_SECONDS) continue;

      const dayStatus = status.get(m.id)?.get(date)?.status ?? null;
      rows.push({
        date,
        employeeId: m.id,
        code: m.employeeCode,
        name: m.fullName,
        department: m.department,
        panelSeconds,
        dayOff: dayStatus === 'Weekly off' || dayStatus === 'Holiday' ? dayStatus : null,
        activityMinutes: items.reduce((s, a) => s + a.minutes, 0),
        activities: items,
      });
    }
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}
