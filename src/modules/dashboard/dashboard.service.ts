import {
  attendanceOf,
  EMPTY_SLOTS,
  readDayAsObserved,
  slotsForShiftDay,
  type DayAttendance,
  type SlotMask,
} from '../attendance/attendance.domain';
import type {
  AttendanceRecord,
  DayContext,
  WorkSchedule,
} from '../attendance/attendance.model';
import { isActivityMeasured } from '../attendance/attendance.config';
import { IAttendanceRepository } from '../attendance/attendance.repository.interface';
import { ILeaveRepository } from '../leave/leave.repository.interface';
import { IGoalsRepository } from '../goals/goals.repository.interface';
import { IOrgRepository } from '../org/org.repository.interface';
import { IPolicyService } from '../policy/policy.service.interface';
import { IAuthService } from '../auth/auth.service.interface';
import { goalProgress, goalStatus, periodWindow } from '../goals/goals.domain';
import { addDays } from '../../shared/dates';
import { ApiError } from '../../utils/api-error';
import { attentionItems, departmentHours, kpisOf, type PersonDay } from './dashboard.domain';
import { IDashboardService } from './dashboard.service.interface';
import { DashboardView, LiveRow, OnLeaveToday } from './dashboard.model';

/**
 * The operations dashboard.
 *
 * It owns no table. Every figure is composed from modules that already answer
 * these questions for one person — attendance, leave, goals — read for a whole
 * roster at once. Composition rather than a fifth copy of the same SQL: if the
 * rule for what counts as Late ever changes, this page changes with it.
 *
 * Scope is decided here, not by the page. An admin sees the company; anybody
 * else sees the tree beneath them.
 */
export class DashboardService implements IDashboardService {
  constructor(
    private readonly orgRepository: IOrgRepository,
    private readonly attendanceRepository: IAttendanceRepository,
    private readonly leaveRepository: ILeaveRepository,
    private readonly goalsRepository: IGoalsRepository,
    private readonly policyService: IPolicyService,
    private readonly authService: IAuthService,
  ) {}

  async getDashboard(viewerId: number): Promise<DashboardView> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    const isAdmin = viewer.tiers.includes('admin');
    const isManager = isAdmin || viewer.tiers.includes('manager');

    if (!isManager) {
      throw ApiError.forbidden('The dashboard is for managers and admins.');
    }

    const now = await this.attendanceRepository.now();

    // An admin sees everyone; a manager sees only their own tree.
    const roster = await this.orgRepository.findRoster({
      rootId: isAdmin ? null : viewerId,
      includeLeavers: false,
    });
    const ids = roster.map((m) => m.id);

    if (ids.length === 0) {
      return {
        date: now.date,
        scope: isAdmin ? 'company' : 'team',
        kpis: { headcount: 0, loggedIn: 0, late: 0, noLogin: 0, onLeave: 0 },
        departments: [],
        attention: [],
        live: [],
        onLeave: [],
      };
    }

    // Four queries for the whole roster, plus policy. Not four per person.
    const [schedules, punches, slots, context, policy, pending] = await Promise.all([
      this.attendanceRepository.findSchedulesFor(ids),
      this.attendanceRepository.findByDateFor(ids, now.date),
      this.attendanceRepository.findActivitySlotsFor(ids, now.date, addDays(now.date, 1)),
      this.attendanceRepository.findDayContextFor(ids, now.date),
      this.policyService.getForDate(now.date),
      this.leaveRepository.findPendingForEmployees(ids),
    ]);

    const people: PersonDay[] = [];
    const live: LiveRow[] = [];
    const onLeave: OnLeaveToday[] = [];

    for (const member of roster) {
      const schedule = schedules.get(member.id);
      // No schedule row means no such employee any more. Skip rather than guess.
      if (!schedule) continue;

      const day = this.resolveDay(member.id, now.date, schedule, punches, slots, context, policy);

      people.push({
        employeeId: member.id,
        name: member.fullName,
        department: member.department,
        day,
      });

      live.push({
        employeeId: member.id,
        name: member.fullName,
        department: member.department,
        workMode: member.workMode,
        shiftStart: schedule.shiftStart,
        shiftEnd: schedule.shiftEnd,
        loginAt: day.loginAt,
        activeHours: day.activeHours,
        status: day.status,
      });

      if (day.status === 'Leave' || day.status === 'Half day') {
        onLeave.push({
          employeeId: member.id,
          name: member.fullName,
          leaveType: context.get(member.id)?.leave?.type ?? 'Leave',
        });
      }
    }

    return {
      date: now.date,
      scope: isAdmin ? 'company' : 'team',
      kpis: kpisOf(people),
      departments: departmentHours(people),
      attention: attentionItems({
        people,
        pendingApprovals: pending.length,
        goalsAtRisk: await this.goalsAtRisk(roster, now.date, policy.goalRiskTolerancePct),
      }),
      // Busiest first, so the table opens on the people who are actually working.
      live: live.sort((a, b) => b.activeHours - a.activeHours),
      onLeave,
    };
  }

  /**
   * One person's day, resolved exactly the way the attendance module would.
   *
   * This repeats the source-selection rule rather than calling the attendance
   * service, because that service answers for one employee at a time and this
   * page needs 450. The rule itself — slots where they exist, otherwise the
   * punch — lives in the domain and is shared, so the two cannot drift apart
   * on the part that matters.
   */
  private resolveDay(
    employeeId: number,
    date: string,
    schedule: WorkSchedule,
    punches: Map<number, AttendanceRecord>,
    slots: Map<number, Map<string, SlotMask>>,
    context: Map<number, DayContext>,
    policy: { lateGraceMinutes: number },
  ): DayAttendance {
    const observed = isActivityMeasured(schedule.portalRole);
    const days = slots.get(employeeId);

    const mask = observed
      ? slotsForShiftDay(
          days?.get(date) ?? EMPTY_SLOTS,
          days?.get(addDays(date, 1)) ?? EMPTY_SLOTS,
          schedule.shiftStart,
          schedule.shiftEnd,
        )
      : EMPTY_SLOTS;

    const stored = punches.get(employeeId);
    const punch = stored?.loginAt ? { loginAt: stored.loginAt, logoutAt: stored.logoutAt } : null;
    const readAsObserved = readDayAsObserved(observed, mask, Boolean(punch));
    const dayContext = context.get(employeeId);

    return attendanceOf({
      date,
      // This page only ever resolves the current day, so `date` and `today` are
      // the same value — which also keeps a running night shift from resolving
      // as a finished day with nothing on it.
      today: date,
      weeklyOff: schedule.weeklyOff,
      holidayName: dayContext?.holidayName ?? null,
      leave: dayContext?.leave ?? null,
      punch: readAsObserved ? null : punch,
      slots: readAsObserved ? mask : undefined,
      shiftStart: schedule.shiftStart,
      lateGraceMinutes: policy.lateGraceMinutes,
    });
  }

  /** Goals that are behind where the calendar says they should be. */
  private async goalsAtRisk(
    roster: { id: number; fullName: string }[],
    today: string,
    tolerancePct: number,
  ): Promise<{ name: string; title: string }[]> {
    const fy = await this.policyService.getForDate(today);
    const byEmployee = await this.goalsRepository.findForEmployees(
      roster.map((m) => m.id),
      fy.fy,
    );

    const nameById = new Map(roster.map((m) => [m.id, m.fullName]));
    const risky: { name: string; title: string }[] = [];

    for (const [employeeId, goals] of byEmployee) {
      for (const goal of goals) {
        const window = periodWindow(goal.period, fy.fyStart);
        if (goalStatus(goal, window, today, tolerancePct) !== 'At risk') continue;
        if (goalProgress(goal) >= 100) continue;
        risky.push({ name: nameById.get(employeeId) ?? 'Someone', title: goal.title });
      }
    }

    return risky;
  }
}
