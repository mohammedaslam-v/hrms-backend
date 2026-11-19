import { windowFor } from '../productivity/productivity.domain';
import { AdminPanelDay, PanelHour } from './presence.model';

/**
 * Night shifts on the panel-time figures.
 *
 * `admin_panel_presence_day` is one row per calendar date, so a 21:00–07:00
 * shift lands in two rows, and the second also holds the next shift's evening.
 * For a shift crossing midnight, each shift date is rebuilt from the hourly
 * table over the same window the Sales productivity rule counts (6 h before
 * the start to 4 h after the end), so the calendar, the Active time tab and the
 * Activities tab say what the rule decides on. Every hour falls in at most one
 * window, so nothing is counted twice.
 *
 * Pure: no database and no clock.
 */

/**
 * The first shift date whose hourly figures are complete. Before it only the
 * HRMS half of the panels wrote the hourly table (admin-backend's half was
 * deployed on 11 Nov 2026), so earlier nights keep the calendar-day figure.
 */
export const HOURLY_PANEL_FROM = '2026-11-12';

const hm = (stamp: string): string => stamp.slice(11, 16);

/** A stamp minus some seconds, 'YYYY-MM-DD HH:MM', never before `floor`. */
function earlierBy(stamp: string, seconds: number, floor: string): string {
  const t = Date.parse(`${stamp.replace(' ', 'T')}:00Z`) - seconds * 1000;
  const back = new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  return back < floor ? floor : back;
}

/**
 * `days` (calendar-day rows) with every shift date from HOURLY_PANEL_FROM on
 * replaced by its night window's hours. Day shifts must not be passed in.
 */
export function nightShiftDays(
  dates: string[],
  shiftStart: string,
  shiftEnd: string,
  days: AdminPanelDay[],
  hours: PanelHour[],
): AdminPanelDay[] {
  const byDate = new Map(days.map((d) => [d.date, d]));

  for (const date of dates) {
    if (date < HOURLY_PANEL_FROM) continue;
    const w = windowFor(date, shiftStart, shiftEnd);
    const inside = hours
      .filter((h) => h.hourStart >= w.from && h.hourStart < w.decideAt && h.activeSeconds > 0)
      .sort((a, b) => (a.hourStart < b.hourStart ? -1 : 1));

    if (inside.length === 0) {
      byDate.delete(date);
      continue;
    }
    const first = inside[0];
    const last = inside[inside.length - 1];
    byDate.set(date, {
      date,
      // The hour table keeps only each hour's last ping, so the first moment is
      // estimated as that last ping minus the hour's active time.
      firstSeen: hm(earlierBy(first.lastSeenAt, first.activeSeconds, first.hourStart)),
      lastSeen: hm(last.lastSeenAt),
      activeSeconds: inside.reduce((s, h) => s + h.activeSeconds, 0),
      sessions: byDate.get(date)?.sessions ?? 1,
    });
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
