import { AttendanceStatus, WeekBar } from './attendance.domain';
import { LeaveType } from '../leave/leave.domain';
import { GeofencePolicy } from './geofence.domain';

/** One stored day of attendance — a row of `hrms_attendance`. */
export interface AttendanceRecord {
  id: number;
  employeeId: number;
  date: string;
  status: AttendanceStatus;
  loginAt: string | null;
  logoutAt: string | null;
  activeHours: number;
  lateByMinutes: number;
  leaveType: LeaveType | null;
  holidayName: string | null;
  source: 'app' | 'manual' | 'import';
  editedBy: number | null;
  editNote: string | null;
}

/**
 * The database clock. Every timestamp in this module comes from here.
 *
 * Not a convenience — a correctness requirement. The Node process and MariaDB
 * can sit in different timezones (UTC vs IST), and both admin repositories carry
 * warnings that mixing them silently shifts values by 5h30m. Attendance compares
 * a punch against a shift start, so a 5h30m error would mark a whole company
 * late every morning.
 */
export interface DatabaseNow {
  date: string;
  time: string;
}

/** The employee's working pattern — what a day is judged against. */
export interface WorkSchedule {
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: string[];
  dateOfLeaving: string | null;
  /**
   * `admins.role` — CSR, SSM, Admin and so on. Null for the one employee with
   * no `admins` row. Read against ACTIVITY_MEASURED_ROLES in attendance.config
   * to decide where the WEEK's hours come from; it has no bearing on punching.
   */
  portalRole: string | null;
  /** `hrms_employees.work_mode`. Decides who is fenced — see geofence.domain. */
  workMode: string | null;
  /** `hrms_employees.home_lat/home_lng`. Null until saved. */
  homeLat: number | null;
  homeLng: number | null;
}

/**
 * Everything about a day that is not the punch itself: whether the company was
 * closed, and whether the person was on approved leave. Both are needed to
 * decide what the day was.
 */
export interface DayContext {
  holidayName: string | null;
  leave: { type: LeaveType; isHalfDay: boolean } | null;
}

export interface CheckInInput {
  employeeId: number;
  date: string;
  loginAt: string;
  status: AttendanceStatus;
  lateByMinutes: number;
}

/** A whole day as an admin decided it, written with source = 'manual'. */
export interface ManualDayInput {
  employeeId: number;
  date: string;
  status: AttendanceStatus;
  loginAt: string | null;
  logoutAt: string | null;
  activeHours: number;
  lateByMinutes: number;
  leaveType: LeaveType | null;
  editedBy: number | null;
  note: string;
}

/** What an admin can set a day to, from the attendance calendar. */
export const DAY_EDIT_STATUSES = [
  'Present',
  'Earned leave',
  'Half earned leave',
  'Unpaid full day',
  'Unpaid half day',
  'LOP full day',
  'LOP half day',
] as const;
export type DayEditStatus = (typeof DAY_EDIT_STATUSES)[number];

export interface EditDayDto {
  status: DayEditStatus;
  /** HH:MM. Required for Present; optional for the half days. */
  loginAt: string | null;
  /** HH:MM. May be null only for today, while the person is still in. */
  logoutAt: string | null;
  /** Required for the half days. */
  halfDaySession: 'first' | 'second' | null;
  /** Why — required, kept in edit_note and the audit log. */
  note: string;
}

/** A month (or any window) of days for the calendar card. */
export interface CalendarView {
  from: string;
  to: string;
  today: string;
  /** True when the viewer may correct days — an admin looking at someone else. */
  canEdit: boolean;
  days: WeekBar[];
}

export interface CheckOutInput {
  /**
   * The row being closed, addressed by id rather than by date: a night shift is
   * checked out on the day AFTER the one it is filed against.
   */
  id: number;
  logoutAt: string;
  activeHours: number;
}

/**
 * The Today card. Carries `serverTime` so the browser can tick a running clock
 * from the same source the punches were stamped with, rather than from the
 * viewer's own machine.
 */
/**
 * The Today card. Always the person's own declaration — check in and check out —
 * whatever their role. Observed activity feeds the WEEK chart only.
 */
export interface TodayView {
  date: string;
  serverTime: string;
  status: AttendanceStatus;
  loginAt: string | null;
  logoutAt: string | null;
  recheckInAt?: string | null;
  /** Settled hours. Zero until check-out — the running figure is presentational. */
  activeHours: number;
  lateByMinutes: number;
  shiftStart: string;
  shiftEnd: string;
  canCheckIn: boolean;
  canCheckOut: boolean;
  /**
   * Set when this person may only punch from certain places — the office and/or
   * their home location. The browser uses it to ask for location and grey the
   * buttons out; the server judges the fix again on every punch. Null means
   * punch from anywhere.
   */
  geofence: GeofencePolicy | null;
}


export interface TodayBoardKpis {
  onTime: number;
  late: number;
  absent: number;
  leave: number;
  off: number;
  total: number;
}

export interface TodayBoardRow {
  employeeId: number;
  code: string;
  name: string;
  department: string | null;
  workMode: string;
  shiftStart: string;
  shiftEnd: string;
  loginAt: string | null;
  logoutAt: string | null;
  activeHours: number;
  lateByMinutes: number;
  status: AttendanceStatus;
  leaveType: string | null;
}

export interface TodayBoardDto {
  date: string;
  kpis: TodayBoardKpis;
  quickCounts: Record<string, number>;
  roster: TodayBoardRow[];
}

export interface AttendanceRangeRow {
  date: string;
  dayName: string;
  employeeId: number;
  code: string;
  name: string;
  department: string | null;
  shiftStart: string;
  shiftEnd: string;
  loginAt: string | null;
  logoutAt: string | null;
  activeHours: number;
  lateByMinutes: number;
  status: AttendanceStatus;
}

export interface AttendanceRangeDto {
  from: string;
  to: string;
  totalCount: number;
  rows: AttendanceRangeRow[];
}

export interface PunctualityEmployeeSummary {
  employeeId: number;
  code: string;
  name: string;
  department: string | null;
  workingDays: number;
  onTime: number;
  late: number;
  absent: number;
  leave: number;
  halfDay: number;
  totalActiveHours: number;
  avgActiveHours: number;
  punctuality: number;
}

export interface PunctualitySummaryDto {
  from: string;
  to: string;
  summary: PunctualityEmployeeSummary[];
}
