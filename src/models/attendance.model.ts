import { AttendanceStatus } from '../domain/attendance';
import { LeaveType } from '../domain/leave';

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

/** The employee's working pattern — what a punch is judged against. */
export interface WorkSchedule {
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: string[];
  dateOfLeaving: string | null;
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
export interface TodayView {
  date: string;
  serverTime: string;
  status: AttendanceStatus;
  loginAt: string | null;
  logoutAt: string | null;
  /** Settled hours. Zero until check-out — the running figure is presentational. */
  activeHours: number;
  lateByMinutes: number;
  shiftStart: string;
  shiftEnd: string;
  canCheckIn: boolean;
  canCheckOut: boolean;
}
