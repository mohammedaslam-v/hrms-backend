import { DayAttendance, WeekBar } from '../../domain/attendance';
import { TodayView } from '../../models/attendance.model';

export interface IAttendanceService {
  /** The Today card for the signed-in person. Writes nothing. */
  getToday(employeeId: number): Promise<TodayView>;

  /**
   * Records the arrival, stamped with the database clock.
   * Refuses when the day already has a check-in.
   */
  checkIn(employeeId: number): Promise<TodayView>;

  /**
   * Records the departure and settles the day's active hours.
   * Refuses when there is no open check-in to close.
   */
  checkOut(employeeId: number): Promise<TodayView>;

  /**
   * The last seven days as chart bars. Days never punched are included with
   * their derived status, so the chart shows a week rather than only the days
   * somebody happened to record.
   */
  getWeek(employeeId: number): Promise<WeekBar[]>;

  /**
   * Every day between two dates with its status resolved — the one place a
   * day's meaning is decided. Days with no punch are included, because a
   * weekly off, a day of leave and an absence are all facts about the week.
   */
  getDays(employeeId: number, from: string, to: string): Promise<DayAttendance[]>;
}
