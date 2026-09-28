import { AttendanceStatus } from '../attendance/attendance.domain';

/**
 * The operations dashboard, as the prototype's `renderOpsDash()` defines it.
 *
 * Admin sees the whole company; a manager sees their reporting tree. Which one
 * is decided in the service against the org tree, never by the page.
 */

/** One of the five figures across the top. */
export interface DashboardKpis {
  /** Everyone in scope. */
  headcount: number;
  /** In today — on time, late or on a half day. */
  loggedIn: number;
  late: number;
  /** A finished day with nothing recorded. Not the same as "not in yet". */
  noLogin: number;
  onLeave: number;
}

export interface DepartmentHours {
  department: string;
  hours: number;
  /** Share of the busiest department, 0–100. The bar's width. */
  percent: number;
}

/**
 * One line in "Needs your attention".
 *
 * `goTo` is a nav key the page turns into a link. It is null when the screen
 * that would answer the item does not exist yet — the line still says the thing,
 * it just is not clickable.
 */
export interface AttentionItem {
  kind: 'approvals' | 'late' | 'no-login' | 'goals-at-risk';
  title: string;
  detail: string;
  tone: 'violet' | 'coral' | 'maroon' | 'saffron';
  goTo: string | null;
}

/** A row of the live attendance table. */
export interface LiveRow {
  employeeId: number;
  name: string;
  department: string | null;
  workMode: string;
  shiftStart: string;
  shiftEnd: string;
  loginAt: string | null;
  activeHours: number;
  status: AttendanceStatus;
}

export interface OnLeaveToday {
  employeeId: number;
  name: string;
  leaveType: string;
}

export interface DashboardView {
  /** The date everything on this page is about, from the database clock. */
  date: string;
  scope: 'company' | 'team';
  kpis: DashboardKpis;
  departments: DepartmentHours[];
  attention: AttentionItem[];
  live: LiveRow[];
  onLeave: OnLeaveToday[];
}
