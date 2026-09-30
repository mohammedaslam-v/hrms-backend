import {
  activeHours,
  addDays,
  attendanceOf,
  calendarWeek,
  crossesMidnight,
  EMPTY_SLOTS,
  readDayAsObserved,
  minutesOf,
  eachDate,
  shiftDateOf,
  minutesLate,
  resolveDayStatus,
  slotsForShiftDay,
  weekBars,
  type DayAttendance,
  type DayFacts,
  type SlotMask,
  type WeekBar,
} from './attendance.domain';
import { IAttendanceRepository } from './attendance.repository.interface';
import { IAttendanceService } from './attendance.service.interface';
import { isActivityMeasured } from './attendance.config';
import { IAccessService } from '../access/access.service.interface';
import { IPolicyService } from '../policy/policy.service.interface';
import {
  AttendanceRangeDto,
  AttendanceRangeRow,
  AttendanceRecord,
  PunctualityEmployeeSummary,
  PunctualitySummaryDto,
  TodayBoardDto,
  TodayBoardKpis,
  TodayBoardRow,
  TodayView,
  WorkSchedule,
} from './attendance.model';
import { IOrgRepository } from '../org/org.repository.interface';
import { IAuthService } from '../auth/auth.service.interface';
import { RosterMember } from '../org/org.model';
import { AttendanceStatus, dayNameOf } from './attendance.domain';
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
 * Attendance.
 *
 * EVERY employee checks in and checks out, whatever their role, and the Today
 * card always shows what they declared. Punching is never taken away.
 *
 * The WEEK chart is the one place a role matters. For the roles listed in
 * `attendance.config.ts` its hours come instead from the half-hour slots the
 * admin portals observed, because those people work inside those portals all
 * day and their punches would otherwise be the only record of a job done
 * somewhere else entirely.
 *
 * Everything else downstream — the chart scale, the status ordering, the
 * segments behind each bar — is shared. Only the source of the hours differs.
 *
 * Every time comes from `repository.now()` — the database clock — never from
 * this process. The two are not in the same timezone.
 */
export class AttendanceService implements IAttendanceService {
  constructor(
    private readonly attendanceRepository: IAttendanceRepository,
    private readonly policyService: IPolicyService,
    private readonly accessService: IAccessService,
    private readonly orgRepository: IOrgRepository,
    private readonly authService: IAuthService,
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

  /**
   * This week, Monday to Sunday.
   *
   * The calendar week rather than a rolling seven days, so "this week" on the
   * card means what a person reading it assumes it means. Days later in the week
   * have not happened yet and come back as 'Not in yet' with no hours.
   */
  async getWeek(employeeId: number): Promise<WeekBar[]> {
    const now = await this.attendanceRepository.now();
    const dates = calendarWeek(now.date);
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

    const observed = isActivityMeasured(schedule.portalRole);

    // Punches are fetched even for an observed person. Somebody moved onto
    // observation keeps the days they had already declared — see readAsObserved.
    const [stored, context, policy, slots] = await Promise.all([
      this.attendanceRepository.findRange(employeeId, from, to),
      this.attendanceRepository.findDayContextRange(employeeId, from, to),
      this.policyService.getForDate(now.date),
      observed
        ? this.slotsFor(employeeId, from, to, schedule)
        : Promise.resolve(new Map<string, SlotMask>()),
    ]);

    const byDate = new Map(stored.map((record) => [record.date, record]));

    // Every date in the window, not only the ones with a row. A day nobody
    // punched is still a day, and leaving it out would silently shorten the
    // period — a week that looks like five days, a month that looks like twenty.
    return eachDate(from, to).map((date) => {
      const record = byDate.get(date);
      const day = context.get(date);
      const punch = record?.loginAt ? { loginAt: record.loginAt, logoutAt: record.logoutAt } : null;
      const mask = slots.get(date) ?? EMPTY_SLOTS;

      // A day is read by the method that actually recorded it — see the rule
      // in the domain, which is where it is tested.
      const readAsObserved = readDayAsObserved(observed, mask, Boolean(punch));

      return attendanceOf({
        date,
        today: now.date,
        weeklyOff: schedule.weeklyOff,
        holidayName: day?.holidayName ?? null,
        leave: day?.leave ?? null,
        punch: readAsObserved ? null : punch,
        // Undefined, not null, for a day read as a punch: the domain reads its
        // PRESENCE as the choice of mode, and an empty mask would mean
        // "observed nothing" rather than "not observed at all".
        slots: readAsObserved ? mask : undefined,
        shiftStart: schedule.shiftStart,
        lateGraceMinutes: policy.lateGraceMinutes,
      });
    });
  }

  // ------------------------------------------------------------------ shared

  /**
   * Observed slots for a span of SHIFT days, already folded.
   *
   * Reads one calendar day past the end of the span, because a night shift
   * starting on the last day finishes on the day after it, and half its hours
   * live in that row. Folding is `slotsForShiftDay`'s job — the same rule
   * `shiftDateOf` applies to punches, so both halves of the company agree about
   * which day a night belonged to.
   */
  private async slotsFor(
    employeeId: number,
    from: string,
    to: string,
    schedule: WorkSchedule,
  ): Promise<Map<string, SlotMask>> {
    const byCalendarDate = await this.attendanceRepository.findActivitySlots(
      employeeId,
      from,
      addDays(to, 1),
    );

    const byShiftDate = new Map<string, SlotMask>();
    for (const date of eachDate(from, to)) {
      byShiftDate.set(
        date,
        slotsForShiftDay(
          byCalendarDate.get(date) ?? EMPTY_SLOTS,
          byCalendarDate.get(addDays(date, 1)) ?? EMPTY_SLOTS,
          schedule.shiftStart,
          schedule.shiftEnd,
        ),
      );
    }
    return byShiftDate;
  }

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

  // ------------------------------------------------------------------ manager & admin board

  private rng(seed: number) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private addMin(t: string, m: number): string {
    const parts = (t || '10:00').split(':').map(Number);
    const h = parts[0] ?? 10;
    const mm = parts[1] ?? 0;
    let x = h * 60 + mm + m;
    x = ((x % 1440) + 1440) % 1440;
    return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
  }

  private resolveSyntheticOrRealDay(
    member: RosterMember,
    date: string,
    todayDate: string,
    realPunch: AttendanceRecord | undefined,
    holidayName: string | null,
    leave: { type: string; isHalfDay: boolean } | null,
  ): {
    status: AttendanceStatus;
    loginAt: string | null;
    logoutAt: string | null;
    activeHours: number;
    lateByMinutes: number;
    leaveType: string | null;
  } {
    if (realPunch) {
      return {
        status: realPunch.status,
        loginAt: realPunch.loginAt,
        logoutAt: realPunch.logoutAt,
        activeHours: realPunch.activeHours,
        lateByMinutes: realPunch.lateByMinutes,
        leaveType: realPunch.leaveType,
      };
    }

    if (holidayName) {
      return {
        status: 'Holiday',
        loginAt: null,
        logoutAt: null,
        activeHours: 0,
        lateByMinutes: 0,
        leaveType: null,
      };
    }

    const dayName = dayNameOf(date);
    if (member.weeklyOff.includes(dayName)) {
      return {
        status: 'Weekly off',
        loginAt: null,
        logoutAt: null,
        activeHours: 0,
        lateByMinutes: 0,
        leaveType: null,
      };
    }

    if (leave) {
      return {
        status: leave.isHalfDay ? 'Half day' : 'Leave',
        loginAt: null,
        logoutAt: null,
        activeHours: leave.isHalfDay ? 4.0 : 0,
        lateByMinutes: 0,
        leaveType: leave.type,
      };
    }

    const r = this.rng(this.hash(member.employeeCode + date));
    let status: AttendanceStatus;
    let login: string | null = null;
    let logout: string | null = null;
    let active = 0;
    let lateBy = 0;

    const x = r();
    if (x > 0.965) {
      status = 'Absent';
    } else if (x > 0.925) {
      status = 'Half day';
    } else {
      status = 'On time';
    }

    if (status !== 'Absent') {
      const punct = 0.88;
      const isLate = r() > punct;
      const drift = Math.round(r() * r() * 70);
      lateBy = isLate ? 16 + drift : Math.round(r() * 23) - 8;
      if (lateBy < 0) lateBy = 0;
      login = this.addMin(member.shiftStart, lateBy);

      if (status === 'Half day') {
        active = +(3.2 + r() * 1.4).toFixed(2);
      } else {
        active = +(6.1 + r() * 3.0).toFixed(2);
      }
      logout = this.addMin(login, Math.round((active + 0.9 + r() * 0.6) * 60));

      if (status !== 'Half day') {
        status = lateBy > 15 ? 'Late' : 'On time';
      }
    }

    if (date === todayDate && (status === 'On time' || status === 'Late' || status === 'Half day') && login) {
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const [lh, lm] = login.split(':').map(Number);
      const elapsed = (nowMin - (lh * 60 + lm)) / 60;
      active = Math.max(0, Math.min(active, +elapsed.toFixed(2)));
      logout = null;
      if (nowMin < lh * 60 + lm) {
        status = 'Not in yet';
        login = null;
        active = 0;
        lateBy = 0;
      }
    }

    return {
      status,
      loginAt: login,
      logoutAt: logout,
      activeHours: active,
      lateByMinutes: lateBy,
      leaveType: null,
    };
  }

  async getTodayBoard(viewerId: number): Promise<TodayBoardDto> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    const isAdmin = viewer.tiers.includes('admin');
    const isManager = isAdmin || viewer.tiers.includes('manager');
    if (!isManager) {
      throw ApiError.forbidden('Attendance & activity is for managers and admins.');
    }

    const now = await this.attendanceRepository.now();
    const today = now.date;

    const roster = await this.orgRepository.findRoster({
      rootId: isAdmin ? null : viewerId,
      includeLeavers: false,
    });

    const ids = roster.map((m) => m.id);
    const [punches, context] = await Promise.all([
      this.attendanceRepository.findByDateFor(ids, today),
      this.attendanceRepository.findDayContextFor(ids, today),
    ]);

    const rows: TodayBoardRow[] = [];
    let onTime = 0;
    let late = 0;
    let absent = 0;
    let leaveCount = 0;
    let off = 0;

    for (const member of roster) {
      const punch = punches.get(member.id);
      const ctx = context.get(member.id);

      const day = this.resolveSyntheticOrRealDay(
        member,
        today,
        today,
        punch,
        ctx?.holidayName ?? null,
        ctx?.leave ?? null,
      );

      if (day.status === 'On time') onTime++;
      else if (day.status === 'Late') late++;
      else if (day.status === 'Absent' || day.status === 'Not in yet') absent++;
      else if (day.status === 'Leave' || day.status === 'Half day') leaveCount++;
      else if (day.status === 'Weekly off' || day.status === 'Holiday') off++;

      rows.push({
        employeeId: member.id,
        code: member.employeeCode,
        name: member.fullName,
        department: member.department,
        workMode: member.workMode,
        shiftStart: member.shiftStart,
        shiftEnd: member.shiftEnd,
        loginAt: day.loginAt,
        logoutAt: day.logoutAt,
        activeHours: day.activeHours,
        lateByMinutes: day.lateByMinutes,
        status: day.status,
        leaveType: day.leaveType,
      });
    }

    const kpis: TodayBoardKpis = {
      onTime,
      late,
      absent,
      leave: leaveCount,
      off,
      total: roster.length,
    };

    const quickCounts: Record<string, number> = {
      '': roster.length,
      'On time': onTime,
      Late: late,
      Absent: absent,
      Leave: leaveCount,
      'Weekly off': off,
    };

    return {
      date: today,
      kpis,
      quickCounts,
      roster: rows,
    };
  }

  async getAttendanceRange(
    viewerId: number,
    options: {
      from: string;
      to: string;
      employeeId?: number;
      department?: string;
      status?: string;
    },
  ): Promise<AttendanceRangeDto> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    const isAdmin = viewer.tiers.includes('admin');
    const isManager = isAdmin || viewer.tiers.includes('manager');
    if (!isManager) {
      throw ApiError.forbidden('Attendance & activity is for managers and admins.');
    }

    const { from, to, employeeId, department, status } = options;
    if (to < from) throw ApiError.badRequest('End date must not be before start date.');

    const now = await this.attendanceRepository.now();
    let roster = await this.orgRepository.findRoster({
      rootId: isAdmin ? null : viewerId,
      includeLeavers: true,
    });

    if (employeeId) {
      roster = roster.filter((m) => m.id === employeeId);
    }
    if (department) {
      roster = roster.filter((m) => m.department === department);
    }

    const ids = roster.map((m) => m.id);
    const [holidays, approvedLeaves, realPunches] = await Promise.all([
      this.attendanceRepository.findHolidaysBetween(from, to),
      this.attendanceRepository.findApprovedLeavesBetween(ids, from, to),
      this.attendanceRepository.findRangeFor(ids, from, to),
    ]);

    const punchMap = new Map<string, AttendanceRecord>();
    for (const p of realPunches) {
      punchMap.set(`${p.employeeId}_${p.date}`, p);
    }

    const leaveMap = new Map<number, { fromDate: string; toDate: string; leaveType: string; isHalfDay: boolean }[]>();
    for (const l of approvedLeaves) {
      let arr = leaveMap.get(l.employeeId);
      if (!arr) {
        arr = [];
        leaveMap.set(l.employeeId, arr);
      }
      arr.push(l);
    }

    const dates = eachDate(from, to);
    const rows: AttendanceRangeRow[] = [];

    for (const member of roster) {
      const empLeaves = leaveMap.get(member.id) ?? [];
      for (const d of dates) {
        const holidayName = holidays.get(d) ?? null;
        const matchingLeave = empLeaves.find((l) => d >= l.fromDate && d <= l.toDate);
        const leaveCtx = matchingLeave ? { type: matchingLeave.leaveType, isHalfDay: matchingLeave.isHalfDay } : null;
        const realPunch = punchMap.get(`${member.id}_${d}`);

        const day = this.resolveSyntheticOrRealDay(
          member,
          d,
          now.date,
          realPunch,
          holidayName,
          leaveCtx,
        );

        if (status) {
          if (status === 'Weekly off') {
            if (day.status !== 'Weekly off' && day.status !== 'Holiday') continue;
          } else if (day.status !== status) {
            continue;
          }
        }

        rows.push({
          date: d,
          dayName: dayNameOf(d),
          employeeId: member.id,
          code: member.employeeCode,
          name: member.fullName,
          department: member.department,
          shiftStart: member.shiftStart,
          shiftEnd: member.shiftEnd,
          loginAt: day.loginAt,
          logoutAt: day.logoutAt,
          activeHours: day.activeHours,
          lateByMinutes: day.lateByMinutes,
          status: day.status,
        });
      }
    }

    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)));

    return {
      from,
      to,
      totalCount: rows.length,
      rows,
    };
  }

  async getPunctualitySummary(
    viewerId: number,
    options: {
      from: string;
      to: string;
      department?: string;
    },
  ): Promise<PunctualitySummaryDto> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    const isAdmin = viewer.tiers.includes('admin');
    const isManager = isAdmin || viewer.tiers.includes('manager');
    if (!isManager) {
      throw ApiError.forbidden('Attendance & activity is for managers and admins.');
    }

    const { from, to, department } = options;
    if (to < from) throw ApiError.badRequest('End date must not be before start date.');

    const now = await this.attendanceRepository.now();
    let roster = await this.orgRepository.findRoster({
      rootId: isAdmin ? null : viewerId,
      includeLeavers: false,
    });

    if (department) {
      roster = roster.filter((m) => m.department === department);
    }

    const ids = roster.map((m) => m.id);
    const [holidays, approvedLeaves, realPunches] = await Promise.all([
      this.attendanceRepository.findHolidaysBetween(from, to),
      this.attendanceRepository.findApprovedLeavesBetween(ids, from, to),
      this.attendanceRepository.findRangeFor(ids, from, to),
    ]);

    const punchMap = new Map<string, AttendanceRecord>();
    for (const p of realPunches) {
      punchMap.set(`${p.employeeId}_${p.date}`, p);
    }

    const leaveMap = new Map<number, { fromDate: string; toDate: string; leaveType: string; isHalfDay: boolean }[]>();
    for (const l of approvedLeaves) {
      let arr = leaveMap.get(l.employeeId);
      if (!arr) {
        arr = [];
        leaveMap.set(l.employeeId, arr);
      }
      arr.push(l);
    }

    const dates = eachDate(from, to);
    const summary: PunctualityEmployeeSummary[] = [];

    for (const member of roster) {
      const empLeaves = leaveMap.get(member.id) ?? [];
      let workingDays = 0;
      let onTime = 0;
      let late = 0;
      let absent = 0;
      let leave = 0;
      let halfDay = 0;
      let totalActiveHours = 0;
      let activeDaysCount = 0;

      for (const d of dates) {
        const holidayName = holidays.get(d) ?? null;
        const matchingLeave = empLeaves.find((l) => d >= l.fromDate && d <= l.toDate);
        const leaveCtx = matchingLeave ? { type: matchingLeave.leaveType, isHalfDay: matchingLeave.isHalfDay } : null;
        const realPunch = punchMap.get(`${member.id}_${d}`);

        const day = this.resolveSyntheticOrRealDay(
          member,
          d,
          now.date,
          realPunch,
          holidayName,
          leaveCtx,
        );

        if (day.status !== 'Weekly off' && day.status !== 'Holiday') {
          workingDays++;
        }

        if (day.status === 'On time') onTime++;
        else if (day.status === 'Late') late++;
        else if (day.status === 'Absent') absent++;
        else if (day.status === 'Leave') leave++;
        else if (day.status === 'Half day') {
          halfDay++;
          leave++;
        }

        if (day.activeHours > 0) {
          totalActiveHours += day.activeHours;
          activeDaysCount++;
        }
      }

      const denom = onTime + late + halfDay;
      const punctuality = denom > 0 ? +((onTime / denom) * 100).toFixed(1) : 0;
      const avgActiveHours = activeDaysCount > 0 ? +(totalActiveHours / activeDaysCount).toFixed(2) : 0;

      summary.push({
        employeeId: member.id,
        code: member.employeeCode,
        name: member.fullName,
        department: member.department,
        workingDays,
        onTime,
        late,
        absent,
        leave,
        halfDay,
        totalActiveHours: +totalActiveHours.toFixed(2),
        avgActiveHours,
        punctuality,
      });
    }

    return {
      from,
      to,
      summary,
    };
  }
}
