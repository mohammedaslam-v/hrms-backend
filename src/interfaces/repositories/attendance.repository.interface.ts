import {
  AttendanceRecord,
  CheckInInput,
  CheckOutInput,
  DatabaseNow,
  DayContext,
  WorkSchedule,
} from '../../models/attendance.model';

export interface IAttendanceRepository {
  /**
   * The date and time according to the database, not the Node process.
   * See the note on `DatabaseNow` — this is a correctness requirement.
   */
  now(): Promise<DatabaseNow>;

  /** Shift and weekly off. Null when there is no such employee. */
  findSchedule(employeeId: number): Promise<WorkSchedule | null>;

  /** Declared closure and approved leave for one day, in a single round trip. */
  findDayContext(employeeId: number, date: string): Promise<DayContext>;

  /**
   * The same, for a span of days, keyed by date. Two queries rather than one
   * per day — the weekly chart needs seven and a month view will need thirty.
   */
  findDayContextRange(
    employeeId: number,
    from: string,
    to: string,
  ): Promise<Map<string, DayContext>>;

  findByDate(employeeId: number, date: string): Promise<AttendanceRecord | null>;

  /**
   * The stint currently open — checked in, not yet checked out.
   *
   * Check-out looks the row up this way rather than by today's date, because a
   * night shift is closed on the following calendar day. Bounded to the last two
   * days so a punch somebody forgot to close last week cannot be reopened by
   * tonight's check-out.
   */
  findOpenPunch(employeeId: number): Promise<AttendanceRecord | null>;

  /** The most recent stint, open or closed, within the last two days. */
  findLatestPunch(employeeId: number): Promise<AttendanceRecord | null>;

  /** Stored days in the range, oldest first. Days never punched are simply absent. */
  findRange(employeeId: number, from: string, to: string): Promise<AttendanceRecord[]>;

  /**
   * Records the arrival. Returns null when the day already has a login, so a
   * double tap cannot move someone's check-in time — the guard is in the SQL,
   * not only in the service, because two requests can arrive at once.
   */
  checkIn(input: CheckInInput): Promise<AttendanceRecord | null>;

  /**
   * Records the departure. Returns null when there is no open check-in to close
   * — either it was never opened, or it is already closed.
   */
  checkOut(input: CheckOutInput): Promise<AttendanceRecord | null>;

  /** Records a punch in the audit log, so a correction is never anonymous. */
  recordAudit(
    actorEmployeeId: number,
    action: string,
    entityId: number | null,
    before: unknown,
    after: unknown,
  ): Promise<void>;
}
