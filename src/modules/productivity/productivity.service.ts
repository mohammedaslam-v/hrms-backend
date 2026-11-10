import { addDays, eachDate } from '../../shared/dates';
import { activeHours } from '../attendance/attendance.domain';
import { IAttendanceRepository } from '../attendance/attendance.repository.interface';
import type { AttendanceRecord } from '../attendance/attendance.model';
import { ILeaveRepository } from '../leave/leave.repository.interface';
import { ILeaveService } from '../leave/leave.service.interface';
import { IPresenceService } from '../presence/presence.service.interface';
import { IWorkActivityRepository } from '../work-activity/work-activity.repository.interface';
import type { WorkActivity } from '../work-activity/work-activity.model';
import {
  LOOKBACK_DAYS,
  PRODUCTIVITY_FROM,
  activityMinutesFor,
  isMet,
  reasonFor,
  skipReason,
  windowFor,
  type ProductivityFigures,
  type ProductivityOutcome,
} from './productivity.domain';
import { ProductivityDecision, RuledEmployee, SettleSummary } from './productivity.model';
import { IProductivityRepository } from './productivity.repository.interface';
import { IProductivityService } from './productivity.service.interface';

/** The departments the rule covers. Sales only for now (Sajan, 7 Nov 2026). */
const RULED_DEPARTMENTS = ['sales'];

/** At most one run per instance in this long, however many requests arrive. */
const KICK_EVERY_MS = 5 * 60_000;

const EMPTY: SettleSummary = { checked: 0, decided: 0, met: 0, earned: 0, unpaid: 0, failed: 0 };

/**
 * Decides Sales working days by productive time — see productivity.domain.ts
 * for the rule.
 *
 * Runs in the background, a few minutes apart, started by ordinary API traffic
 * (`kick`) — HRMS is called every minute by the panels' trackers, so there is
 * always traffic, and Cloud Run has no timer of its own that survives scaling
 * to zero. An admin can also run it on demand. Every run looks back a week, so
 * a quiet spell only delays a decision, never loses one.
 *
 * A day is decided once. The decision is claimed in `hrms_productivity_days`
 * before anything is written, so two instances never both decide it, and an
 * admin's later edit from the calendar is never undone.
 *
 * The writes are the ones the admin calendar makes: an approved single-day
 * leave (setDayLeave) and a manual attendance row carrying the reason, which is
 * what the calendar shows when the day is clicked.
 */
export class ProductivityService implements IProductivityService {
  private running: Promise<SettleSummary> | null = null;
  private lastKick = 0;

  constructor(
    private readonly repository: IProductivityRepository,
    private readonly attendanceRepository: IAttendanceRepository,
    private readonly leaveRepository: ILeaveRepository,
    private readonly leaveService: ILeaveService,
    private readonly workActivityRepository: IWorkActivityRepository,
    private readonly presenceService: IPresenceService,
  ) {}

  kick(): void {
    const at = Date.now();
    if (at - this.lastKick < KICK_EVERY_MS) return;
    this.lastKick = at;
    this.settleDue()
      .then((s) => {
        if (s.decided || s.failed) console.log('Productivity settlement:', JSON.stringify(s));
      })
      .catch((err) => console.error('Productivity settlement failed:', err));
  }

  settleDue(): Promise<SettleSummary> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async run(): Promise<SettleSummary> {
    const now = await this.attendanceRepository.now();
    const nowStamp = `${now.date} ${now.time.slice(0, 5)}`;
    const lookback = addDays(now.date, -LOOKBACK_DAYS);
    const from = lookback > PRODUCTIVITY_FROM ? lookback : PRODUCTIVITY_FROM;
    // A night shift starting today is decided tomorrow; a day shift can be
    // decided tonight. Yesterday's night shift needs today's activities.
    const to = now.date;
    if (to < from) return { ...EMPTY };

    const staff = (await this.repository.findRuledEmployees(RULED_DEPARTMENTS)).filter(
      (e) => (!e.dateOfLeaving || e.dateOfLeaving >= from) && (!e.dateOfJoining || e.dateOfJoining <= to),
    );
    if (staff.length === 0) return { ...EMPTY };
    const ids = staff.map((e) => e.id);

    const [decided, records, holidays, leaves, activities, panelDays] = await Promise.all([
      this.repository.findDecided(ids, from, to),
      this.attendanceRepository.findRangeFor(ids, from, to),
      this.attendanceRepository.findHolidaysBetween(from, to),
      this.leaveRepository.findRequestsForEmployees(ids, from, to),
      this.workActivityRepository.findRangeForMany(ids, from, addDays(to, 1)),
      this.presenceService.adminPanelForReport(ids, from, to),
    ]);

    const recordOf = new Map(records.map((r) => [`${r.employeeId}|${r.date}`, r]));
    const summary: SettleSummary = { ...EMPTY };

    for (const e of staff) {
      for (const date of eachDate(from, to)) {
        if (decided.has(`${e.id}|${date}`)) continue;
        const window = windowFor(date, e.shiftStart, e.shiftEnd);
        if (nowStamp < window.decideAt) continue;

        const record = recordOf.get(`${e.id}|${date}`) ?? null;
        const leave = leaves.find(
          (l) =>
            l.employeeId === e.id &&
            l.fromDate <= date &&
            l.toDate >= date &&
            (l.status === 'Approved' || l.status === 'Pending'),
        );
        const skip = skipReason({
          date,
          dateOfJoining: e.dateOfJoining,
          dateOfLeaving: e.dateOfLeaving,
          weeklyOff: e.weeklyOff,
          holiday: holidays.has(date),
          leave: leave ? (leave.status as 'Approved' | 'Pending') : null,
          record,
        });
        if (skip) continue;
        summary.checked++;

        try {
          const panelSeconds = window.night
            ? e.adminId
              ? ((await this.repository.findPanelSecondsBetween([e.adminId], window.from, window.decideAt)).get(
                  e.adminId,
                ) ?? 0)
              : 0
            : (panelDays.get(e.id)?.get(date)?.activeSeconds ?? 0);
          const figures: ProductivityFigures = {
            panelMinutes: Math.floor(panelSeconds / 60),
            activityMinutes: activityMinutesFor(date, window, (activities.get(e.id) ?? []) as WorkActivity[]),
          };
          const outcome = await this.outcomeFor(e, date, figures);
          const decision: ProductivityDecision = {
            employeeId: e.id,
            date,
            ...figures,
            outcome: outcome.outcome,
            reason: reasonFor(figures, outcome.outcome),
          };

          if (!(await this.repository.claim(decision))) continue;
          try {
            await this.apply(e, decision, record, outcome.asLeave);
          } catch (err) {
            await this.repository.release(e.id, date);
            throw err;
          }
          summary.decided++;
          summary[decision.outcome]++;
        } catch (err) {
          summary.failed++;
          console.error(`Productivity: could not decide ${date} for employee ${e.id}:`, err);
        }
      }
    }
    return summary;
  }

  /**
   * Met, or which leave. Earned when the month's balance covers a full day —
   * the leave preview projects it through the same ledger as any request —
   * otherwise unpaid. `asLeave` false is the one case the ledger cannot take:
   * a usual off day made a working day by hand, which it still counts as off.
   */
  private async outcomeFor(
    e: RuledEmployee,
    date: string,
    figures: ProductivityFigures,
  ): Promise<{ outcome: ProductivityOutcome; asLeave: boolean }> {
    if (isMet(figures)) return { outcome: 'met', asLeave: false };
    const preview = await this.leaveService.preview(e.id, date, date, 'Earned', false);
    if (preview.days <= 0) return { outcome: 'unpaid', asLeave: false };
    return { outcome: preview.unpaidDays > 0 ? 'unpaid' : 'earned', asLeave: true };
  }

  private async apply(
    e: RuledEmployee,
    d: ProductivityDecision,
    record: AttendanceRecord | null,
    asLeave: boolean,
  ): Promise<void> {
    if (d.outcome === 'met') {
      if (!record?.loginAt) {
        // No check-in: mark the shift as worked.
        const punch = { loginAt: e.shiftStart, logoutAt: e.shiftEnd };
        await this.attendanceRepository.saveManualDay({
          employeeId: e.id,
          date: d.date,
          status: 'On time',
          ...punch,
          activeHours: activeHours(punch),
          lateByMinutes: 0,
          leaveType: null,
          editedBy: null,
          note: d.reason,
        });
      } else if (!record.logoutAt) {
        // Checked in, never out: close it at the shift's end. Stays the
        // employee's own punch — the reason is in the audit and the log.
        await this.attendanceRepository.checkOut({
          id: record.id,
          logoutAt: e.shiftEnd,
          activeHours: activeHours({ loginAt: record.loginAt, logoutAt: e.shiftEnd }),
        });
      }
    } else if (asLeave) {
      const leaveType = d.outcome === 'earned' ? 'Earned' : 'Unpaid';
      await this.leaveService.setDayLeave(
        e.id,
        e.id,
        d.date,
        { leaveType, isHalfDay: false, halfDaySession: null },
        d.reason,
        `Marked automatically by the productivity rule: ${d.reason}`,
      );
      await this.attendanceRepository.saveManualDay({
        employeeId: e.id,
        date: d.date,
        status: 'Leave',
        loginAt: record?.loginAt ?? null,
        logoutAt: record?.logoutAt ?? null,
        activeHours: record?.activeHours ?? 0,
        lateByMinutes: record?.lateByMinutes ?? 0,
        leaveType,
        editedBy: null,
        note: d.reason,
      });
    } else {
      // A usual off day turned into a working day: the ledger still treats it
      // as off, so no leave can be written. Not marked = loss of pay already.
      await this.attendanceRepository.saveManualDay({
        employeeId: e.id,
        date: d.date,
        status: 'Absent',
        loginAt: record?.loginAt ?? null,
        logoutAt: record?.logoutAt ?? null,
        activeHours: 0,
        lateByMinutes: 0,
        leaveType: null,
        editedBy: null,
        note: d.reason,
      });
    }

    await this.attendanceRepository.recordAudit(e.id, 'attendance.productivity_decided', record?.id ?? null, record, d);
  }
}
