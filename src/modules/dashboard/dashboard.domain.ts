/**
 * Dashboard — pure functions, no database and no clock.
 *
 * Everything the operations dashboard shows is a count or a grouping over days
 * that have already been resolved by the attendance domain. Nothing here reads
 * a punch or a slot; it is handed finished days and turns them into the five
 * figures, the department bars and the attention list.
 *
 * Kept pure for the same reason as the rest: the interesting decisions — what
 * counts as "logged in", what counts as an absence — are policy, and policy
 * deserves tests that need no fixtures.
 */

import { AttendanceStatus, DayAttendance } from '../attendance/attendance.domain';
import {
  AttentionItem,
  DashboardKpis,
  DepartmentHours,
} from './dashboard.model';

/** A person on the roster, paired with their resolved day. */
export interface PersonDay {
  employeeId: number;
  name: string;
  department: string | null;
  day: DayAttendance;
}

/**
 * Statuses that mean the person turned up.
 *
 * A half day counts: they worked. 'Not in yet' does not, because the day has
 * not finished — counting it as present would inflate the morning figure and
 * counting it as absent would libel everyone before lunch.
 */
const PRESENT: readonly AttendanceStatus[] = ['On time', 'Late', 'Half day'];

export const isPresent = (status: AttendanceStatus): boolean => PRESENT.includes(status);

export function kpisOf(people: PersonDay[]): DashboardKpis {
  let loggedIn = 0;
  let late = 0;
  let noLogin = 0;
  let onLeave = 0;

  for (const { day } of people) {
    if (isPresent(day.status)) loggedIn++;
    if (day.status === 'Late') late++;
    // Only a finished day with nothing on it. 'Not in yet' is deliberately not
    // counted here — the prototype used 'Absent' for exactly this reason.
    if (day.status === 'Absent') noLogin++;
    if (day.status === 'Leave' || day.status === 'Half day') onLeave++;
  }

  return { headcount: people.length, loggedIn, late, noLogin, onLeave };
}

/**
 * Active hours today, grouped by department and sorted by who worked most.
 *
 * People with no department are gathered under one heading rather than dropped:
 * at Bambinos almost nobody has one set, and silently omitting them would make
 * the chart claim the company did no work today.
 */
export function departmentHours(people: PersonDay[]): DepartmentHours[] {
  const totals = new Map<string, number>();

  for (const { department, day } of people) {
    if (day.activeHours <= 0) continue;
    const key = department?.trim() || 'No department set';
    totals.set(key, (totals.get(key) ?? 0) + day.activeHours);
  }

  const rows = [...totals.entries()]
    .map(([department, hours]) => ({ department, hours: round1(hours), percent: 0 }))
    .sort((a, b) => b.hours - a.hours);

  const busiest = Math.max(...rows.map((r) => r.hours), 1);
  for (const row of rows) row.percent = Math.round((row.hours / busiest) * 100);

  return rows;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** First names, for the "Aaliya, Harish and 3 others" style of summary line. */
export function namesSummary(people: PersonDay[], show = 3): string {
  const firsts = people.map((p) => p.name.split(' ')[0]);
  if (firsts.length <= show) return firsts.join(', ');
  return `${firsts.slice(0, show).join(', ')} and ${firsts.length - show} more`;
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

export interface AttentionInput {
  people: PersonDay[];
  pendingApprovals: number;
  goalsAtRisk: { name: string; title: string }[];
}

/**
 * What needs a decision, most actionable first.
 *
 * `goTo` is null for the attendance items on purpose. The screen that would
 * answer them — Attendance & activity — is not built, and a link to a
 * placeholder is worse than no link. The live table further down this same page
 * already shows exactly who they are.
 */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.pendingApprovals > 0) {
    items.push({
      kind: 'approvals',
      title: `${plural(input.pendingApprovals, 'leave request')} waiting on you`,
      detail: 'Nobody can plan around a decision that has not been made.',
      tone: 'violet',
      goTo: 'leave',
    });
  }

  const late = input.people.filter((p) => p.day.status === 'Late');
  if (late.length > 0) {
    items.push({
      kind: 'late',
      title: `${plural(late.length, 'late login')} today`,
      detail: namesSummary(late),
      tone: 'coral',
      goTo: null,
    });
  }

  const absent = input.people.filter((p) => p.day.status === 'Absent');
  if (absent.length > 0) {
    items.push({
      kind: 'no-login',
      title: `${absent.length} with no login activity`,
      detail: namesSummary(absent),
      tone: 'maroon',
      goTo: null,
    });
  }

  if (input.goalsAtRisk.length > 0) {
    items.push({
      kind: 'goals-at-risk',
      title: `${plural(input.goalsAtRisk.length, 'goal')} slipping behind`,
      detail: input.goalsAtRisk
        .slice(0, 2)
        .map((g) => `${g.name.split(' ')[0]} — ${g.title}`)
        .join('; '),
      tone: 'saffron',
      goTo: 'teamgoals',
    });
  }

  return items;
}
