import { BREAK_ALLOWANCE_MINUTES, clockOf, stamp } from '../attendance/break.domain';
import type { RawBreakRow } from './reports.repository.interface';

/**
 * The Breaks report: one row per person per shift day they took a break, with
 * each break in its own column — Break 1, Break 2, … — then the count, the
 * total and what was left of the hour.
 *
 * Pure: the breaks and "now" come in, rows go out. An unended break is read the
 * same way the Today card reads it: it stopped by itself at `ends_by` once that
 * has passed, and is still running before then.
 */

export interface BreakDayRow {
  employeeId: number;
  workDate: string;
  /** "13:00–13:25 (25 min)", one per break, oldest first. */
  breaks: string[];
  totalMinutes: number;
  remainingMinutes: number;
}

const WHY: Record<string, string> = {
  checkout: 'ended at check-out',
  auto: 'stopped automatically',
};

/** How one break reads in its cell. */
function describe(b: RawBreakRow, now: string): { text: string; minutes: number } {
  const stoppedBy = b.ended_at ?? (now >= b.ends_by ? b.ends_by : null);
  const from = clockOf(b.started_at);
  if (!stoppedBy) {
    const minutes = Math.max(0, stamp(now) - stamp(b.started_at));
    return { text: `${from}–running (${minutes} min so far)`, minutes };
  }
  const minutes = Math.max(0, stamp(stoppedBy) - stamp(b.started_at));
  // A break nobody ended has no stored reason: it stopped at its own limit.
  const reason = b.ended_at ? b.end_reason : 'auto';
  const note = reason && WHY[reason] ? `, ${WHY[reason]}` : '';
  return { text: `${from}–${clockOf(stoppedBy)} (${minutes} min${note})`, minutes };
}

/**
 * Groups breaks into one row per person per shift day. `rows` must be ordered
 * by employee, day and start time — the repository returns them that way.
 */
export function breakDayRows(rows: RawBreakRow[], now: string): BreakDayRow[] {
  const result: BreakDayRow[] = [];
  let current: BreakDayRow | null = null;

  for (const b of rows) {
    if (!current || current.employeeId !== b.employee_id || current.workDate !== b.work_date) {
      current = {
        employeeId: b.employee_id,
        workDate: b.work_date,
        breaks: [],
        totalMinutes: 0,
        remainingMinutes: BREAK_ALLOWANCE_MINUTES,
      };
      result.push(current);
    }
    const { text, minutes } = describe(b, now);
    current.breaks.push(text);
    current.totalMinutes += minutes;
    current.remainingMinutes = Math.max(0, BREAK_ALLOWANCE_MINUTES - current.totalMinutes);
  }
  return result;
}

/** The widest day decides how many Break N columns the report needs. */
export const maxBreaks = (days: BreakDayRow[]): number =>
  days.reduce((max, d) => Math.max(max, d.breaks.length), 0);
