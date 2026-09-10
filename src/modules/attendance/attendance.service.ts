import {
  activeHours,
  addDays,
  attendanceOf,
  crossesMidnight,
  minutesOf,
  eachDate,
  lastDays,
  shiftDateOf,
  minutesLate,
  resolveDayStatus,
  weekBars,
  type DayAttendance,
  type DayFacts,
  type WeekBar,
} from './attendance.domain';
import { IAttendanceRepository } from './attendance.repository.interface';
import { IAttendanceService } from './attendance.service.interface';
import { IAccessService } from '../access/access.service.interface';
import { IPolicyService } from '../policy/policy.service.interface';
import { TodayView, WorkSchedule } from './attendance.model';
import { ApiError } from '../../utils/api-error';

/** A year at a time is plenty for any screen, and bounds the work per request. */
const MAX_RANGE_DAYS = 366;

/**
 * How long after a night ends the card keeps showing it.
 *
 * Someone who clocks off at 07:05 wants to see the hours they just finished, not
 * an empty row for tonight. Four hours covers the walk home and breakfast; after
 * that the next shift is the more useful thing to show.
 */
const FINISHED_SHIFT_TAIL_MINUTES = 4 * 60;

/**
 * Check-in and check-out.
 *
 * Attendance at Bambinos is a DECLARATION: the employee records their own day
 * by pressing a button. Nothing here infers presence from activity, and the
 * numbers it produces mean exactly what they say and no more.
 *
 * Every time comes from `repository.now()` — the database clock — never from
 * this process. The two are not in the same timezone.
 */
export class AttendanceService implements IAttendanceService {
  constructor(
    private readonly attendanceRepository: IAttendanceRepository,
    private readonly policyService: IPolicyService,
    private readonly accessService: IAccessService,
  ) {}

  /**
   * The same day and week the person sees themselves, for someone entitled to
   * open their profile — their manager, or an admin.
   *
   * `require` throws 403 for anyone else, so a hand-typed id gets nothing. The
   * figures are identical to the employee's own view; only the ability to punch
   * is missing, and that is missing because no endpoint here writes.
   */
  async getTodayFor(viewerId: number, subjectId: number): Promise<TodayView> {
    await this.accessService.require(viewerId, subjectId);
    return this.getToday(subjectId);
  }

  async getWeekFor(viewerId: number, subjectId: number): Promise<WeekBar[]> {
    await this.accessService.require(viewerId, subjectId);
    return this.getWeek(subjectId);
  }

  async getToday(employeeId: number): Promise<TodayView> {
    const now = await this.attendanceRepository.now();
    const schedule = await this.requireSchedule(employeeId, now.date);

    // A night worker at 07:00 is finishing yesterday's shift, so the card must
    // show that stint rather than an empty row for the new calendar day. An open
    // stint always wins; otherwise fall back to the shift the clock is in now.
    const open = await this.attendanceRepository.findOpenPunch(employeeId);
    let shiftDate =
      open?.date ?? shiftDateOf(now.date, now.time, schedule.shiftStart, schedule.shiftEnd);
    let stored = open;

    if (!open) {
      // Nothing running. For a night worker in the hours just after clocking off,
      // the shift that matters is the one that ended, not the one tonight.
      const justEnded =
        crossesMidnight(schedule.shiftStart, schedule.shiftEnd) &&
        minutesOf(now.time) < minutesOf(schedule.shiftEnd) + FINISHED_SHIFT_TAIL_MINUTES;

      const latest = justEnded ? await this.attendanceRepository.findLatestPunch(employeeId) : null;
      if (latest && latest.date >= addDays(shiftDate, -1)) {
        shiftDate = latest.date;
        stored = latest;
      } else {
        stored = await this.attendanceRepository.findByDate(employeeId, shiftDate);
      }
    }

    const { facts } = await this.factsFor(employeeId, shiftDate, schedule, now.date);

    const day = attendanceOf({
      ...facts,
      punch: stored?.loginAt ? { loginAt: stored.loginAt, logoutAt: stored.logoutAt } : null,
    });

    return {
      date: shiftDate,
      serverTime: now.time,
      status: day.status,
      loginAt: day.loginAt,
      logoutAt: day.logoutAt,
      // While someone is still checked in the stored total is 0 — the running
      // figure is the browser's job to tick, from loginAt and serverTime, so a
      // clock that appears to move is never mistaken for a stored fact.
      activeHours: day.activeHours,
      lateByMinutes: day.lateByMinutes,
      shiftStart: schedule.shiftStart,
      shiftEnd: schedule.shiftEnd,
      canCheckIn: !stored?.loginAt,
      canCheckOut: Boolean(stored?.loginAt && !stored.logoutAt),
    };
  }

  async checkIn(employeeId: number): Promise<TodayView> {
    const now = await this.attendanceRepository.now();
    const schedule = await this.requireSchedule(employeeId, now.date);

    // A stint left open must be closed before another can start, or the two
    // would fight over one row and the first arrival time would be lost.
    const open = await this.attendanceRepository.findOpenPunch(employeeId);
    if (open) {
      throw ApiError.badRequest(
        `You are still checked in from ${open.loginAt} on ${open.date}. Check out first.`,
      );
    }

    // The shift day, not the calendar day: someone on 23:00–07:00 clocking on at
    // 00:20 is joining the shift that began yesterday.
    const shiftDate = shiftDateOf(now.date, now.time, schedule.shiftStart, schedule.shiftEnd);
    const { facts } = await this.factsFor(employeeId, shiftDate, schedule, now.date);

    const lateByMinutes = minutesLate(now.time, schedule.shiftStart);
    const status = resolveDayStatus({ ...facts, punch: { loginAt: now.time, logoutAt: null } });

    const record = await this.attendanceRepository.checkIn({
      employeeId,
      date: shiftDate,
      loginAt: now.time,
      status,
      lateByMinutes,
    });

    if (!record) {
      // The repository declined, which means a login already exists for that
      // shift. Read it back so the message names the real time.
      const existing = await this.attendanceRepository.findByDate(employeeId, shiftDate);
      throw ApiError.badRequest(
        existing?.loginAt
          ? `You already checked in at ${existing.loginAt} for the ${existing.date} shift.`
          : 'You have already checked in for this shift.',
      );
    }

    await this.attendanceRepository.recordAudit(employeeId, 'attendance.checkIn', record.id, null, {
      date: record.date,
      loginAt: record.loginAt,
      status: record.status,
      lateByMinutes: record.lateByMinutes,
    });

    return this.getToday(employeeId);
  }

  async checkOut(employeeId: number): Promise<TodayView> {
    const now = await this.attendanceRepository.now();

    // Found by being OPEN, not by today's date. A night shift is closed on the
    // calendar day after the one it is filed against, so looking for today's row
    // would find nothing and refuse a perfectly ordinary morning check-out.
    const before = await this.attendanceRepository.findOpenPunch(employeeId);

    if (!before?.loginAt) {
      // Either nothing was opened, or it is already closed. Both mean the same
      // thing to the person reading it, but name the closed case precisely.
      const today = await this.attendanceRepository.findByDate(employeeId, now.date);
      throw ApiError.badRequest(
        today?.logoutAt
          ? `You already checked out at ${today.logoutAt} today.`
          : 'You have not checked in, so there is nothing to check out of.',
      );
    }

    // No guard on the clock going backwards: past midnight it always does, and
    // the wrap is exactly what activeHours() is for. A pair that makes no sense
    // is caught there by the maximum-stint rule instead.
    const hours = activeHours({ loginAt: before.loginAt, logoutAt: now.time });

    const record = await this.attendanceRepository.checkOut({
      id: before.id,
      logoutAt: now.time,
      activeHours: hours,
    });

    if (!record) {
      // Lost a race with another tab that checked out first. The day is closed
      // either way, so report the state rather than an error.
      return this.getToday(employeeId);
    }

    await this.attendanceRepository.recordAudit(
      employeeId,
      'attendance.checkOut',
      record.id,
      { loginAt: before.loginAt, logoutAt: null },
      { loginAt: record.loginAt, logoutAt: record.logoutAt, activeHours: record.activeHours },
    );

    return this.getToday(employeeId);
  }

  async getWeek(employeeId: number): Promise<WeekBar[]> {
    const now = await this.attendanceRepository.now();
    const dates = lastDays(now.date, 7);
    const days = await this.getDays(employeeId, dates[0], dates[dates.length - 1]);
    return weekBars(days, now.date);
  }

  /**
   * Every day in the window, with its status resolved.
   *
   * THE decision of Phase 2: a day's status is derived on read, never written
   * by a nightly job. It is a function of the punch, the calendar and the leave
   * record — all of them already stored — so deriving it means it cannot go
   * stale when leave is approved after the fact or a punch is corrected. There
   * is no job to schedule and nothing to re-run.
   *
   * `hrms_attendance.status` is still written at check-in, but it is a record of
   * what was true at that moment, not the authority. When the two differ, this
   * one is right.
   */
  async getDays(employeeId: number, from: string, to: string): Promise<DayAttendance[]> {
    if (to < from) throw ApiError.badRequest('The end date must not be before the start date.');
    if (eachDate(from, to).length > MAX_RANGE_DAYS) {
      throw ApiError.badRequest(`Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
    }

    const now = await this.attendanceRepository.now();
    const schedule = await this.requireSchedule(employeeId, now.date);

    const [stored, context, policy] = await Promise.all([
      this.attendanceRepository.findRange(employeeId, from, to),
      this.attendanceRepository.findDayContextRange(employeeId, from, to),
      this.policyService.getForDate(now.date),
    ]);

    const byDate = new Map(stored.map((record) => [record.date, record]));

    // Every date in the window, not only the ones with a row. A day nobody
    // punched is still a day, and leaving it out would silently shorten the
    // period — a week that looks like five days, a month that looks like twenty.
    return eachDate(from, to).map((date) => {
      const record = byDate.get(date);
      const day = context.get(date);
      return attendanceOf({
        date,
        today: now.date,
        weeklyOff: schedule.weeklyOff,
        holidayName: day?.holidayName ?? null,
        leave: day?.leave ?? null,
        punch: record?.loginAt ? { loginAt: record.loginAt, logoutAt: record.logoutAt } : null,
        shiftStart: schedule.shiftStart,
        lateGraceMinutes: policy.lateGraceMinutes,
      });
    });
  }

  // ------------------------------------------------------------------ shared

  /**
   * The facts a day is judged against, minus the punch: the schedule, whether
   * the company was closed, and whether the person was on approved leave.
   */
  private async requireSchedule(employeeId: number, onDate: string): Promise<WorkSchedule> {
    const schedule = await this.attendanceRepository.findSchedule(employeeId);
    if (!schedule) {
      throw ApiError.notFound('That employee record does not exist.');
    }
    if (schedule.dateOfLeaving && schedule.dateOfLeaving < onDate) {
      throw ApiError.badRequest('This employee has left the company.');
    }
    return schedule;
  }

  private async factsFor(
    employeeId: number,
    date: string,
    schedule: WorkSchedule,
    today: string,
  ): Promise<{ schedule: WorkSchedule; facts: Omit<DayFacts, 'punch'> }> {
    const [context, policy] = await Promise.all([
      this.attendanceRepository.findDayContext(employeeId, date),
      this.policyService.getForDate(date),
    ]);

    return {
      schedule,
      facts: {
        date,
        // A night shift filed against yesterday is still the CURRENT shift, so
        // it must not resolve as a past day with no punch — that would read as
        // an absence while the person is standing at their desk.
        today: crossesMidnight(schedule.shiftStart, schedule.shiftEnd) ? date : today,
        weeklyOff: schedule.weeklyOff,
        holidayName: context.holidayName,
        leave: context.leave,
        shiftStart: schedule.shiftStart,
        // The grace window is company policy, read fresh from hrms_fy_config so
        // an HR change takes effect on the next punch rather than the next deploy.
        lateGraceMinutes: policy.lateGraceMinutes,
      },
    };
  }
}
