import {
  addMonths,
  computeLedger,
  daysByMonth,
  eachDay,
  LeaveLedger,
  LeaveType,
  monthKeyOf,
  projectRequest,
  workingDaysBetween,
} from '../domain/leave';
import {
  ILeaveRepository,
  StoredLeaveRequest,
} from '../interfaces/repositories/leave.repository.interface';
import { ILeaveService } from '../interfaces/services/leave.service.interface';
import {
  ApplyLeaveDto,
  ApprovalsView,
  DecideLeaveDto,
  DecisionResult,
  HolidayRecord,
  LeaveContext,
  LeavePreview,
  LeaveYearConfig,
  PendingApproval,
  TeamBalanceRow,
  MyLeaveView,
} from '../models/leave.model';
import { ApiError } from '../utils/api-error';

interface Resolved {
  context: LeaveContext;
  year: LeaveYearConfig;
  holidays: HolidayRecord[];
  holidaySet: Set<string>;
  requests: StoredLeaveRequest[];
  ledger: LeaveLedger;
  /** Kept so a proposed request can be projected through the same simulation. */
  ledgerInput: Parameters<typeof computeLedger>[0];
}

export class LeaveService implements ILeaveService {
  constructor(private readonly leaveRepository: ILeaveRepository) {}

  async getMyLeave(employeeId: number): Promise<MyLeaveView> {
    return this.buildView(await this.resolve(employeeId));
  }

  async preview(
    employeeId: number,
    fromDate: string,
    toDate: string,
    leaveType: LeaveType,
    isHalfDay: boolean,
  ): Promise<LeavePreview> {
    const resolved = await this.resolve(employeeId);
    return this.buildPreview(resolved, fromDate, toDate, leaveType, isHalfDay);
  }

  async apply(employeeId: number, dto: ApplyLeaveDto): Promise<MyLeaveView> {
    const resolved = await this.resolve(employeeId);

    if (!dto.reason.trim()) {
      throw ApiError.badRequest('Add a short reason so your manager has the context.');
    }
    if (dto.toDate < dto.fromDate) {
      throw ApiError.badRequest('The end date must be on or after the start date.');
    }
    if (dto.fromDate < resolved.context.dateOfJoining) {
      throw ApiError.badRequest('You cannot apply for dates before your joining date.');
    }
    // "Half day" alone is ambiguous for the employee and the approver.
    if (dto.isHalfDay && dto.halfDaySession !== 'first' && dto.halfDaySession !== 'second') {
      throw ApiError.badRequest('Choose which half of the day you are taking.');
    }

    const preview = this.buildPreview(
      resolved,
      dto.fromDate,
      dto.toDate,
      dto.leaveType,
      dto.isHalfDay,
    );

    // A range made only of weekly offs and holidays deducts nothing, so accepting
    // it as a zero-day request would just be confusing.
    if (preview.days <= 0) {
      throw ApiError.badRequest(
        'Those dates are all weekly offs, so nothing would be deducted.',
      );
    }

    const clash = await this.leaveRepository.findOverlapping(
      employeeId,
      dto.fromDate,
      dto.toDate,
    );
    if (clash) {
      throw new ApiError(
        409,
        `That overlaps ${clash.ref} (${clash.fromDate} to ${clash.toDate}).`,
      );
    }

    await this.leaveRepository.create(employeeId, dto, preview.days);
    return this.buildView(await this.resolve(employeeId));
  }

  async cancel(employeeId: number, requestId: number, byName: string): Promise<MyLeaveView> {
    const request = await this.leaveRepository.findById(requestId);
    if (!request || request.employeeId !== employeeId) {
      // Same response whether it does not exist or belongs to someone else.
      throw ApiError.notFound('That request could not be found.');
    }
    if (request.status !== 'Pending') {
      throw ApiError.badRequest(`${request.ref} has already been ${request.status.toLowerCase()}.`);
    }

    await this.leaveRepository.cancel(requestId, byName);
    return this.buildView(await this.resolve(employeeId));
  }

  // ---------------------------------------------------------------- approvals

  async getApprovals(managerId: number): Promise<ApprovalsView> {
    const team = await this.leaveRepository.findReportingTree(managerId);
    const teamIds = team.map((t) => t.id);

    const today = new Date().toISOString().slice(0, 10);
    const year = await this.leaveRepository.findLeaveYearForDate(today);
    if (!year) {
      throw new ApiError(503, 'Leave policy is not configured for the current leave year.');
    }

    // The ledger for each report, so the queue can show the consequence of a
    // decision and the balances table can be built from the same numbers.
    const ledgers = new Map<number, Awaited<ReturnType<LeaveService['resolve']>>>();
    for (const member of team) {
      ledgers.set(member.id, await this.resolve(member.id));
    }

    const pendingRequests = await this.leaveRepository.findPendingForEmployees(teamIds);

    const pending: PendingApproval[] = pendingRequests.map((request) => {
      const resolved = ledgers.get(request.employeeId)!;
      const member = team.find((t) => t.id === request.employeeId)!;
      // Project the request through the month-by-month simulation, excluding it
      // from the baseline so it is not counted twice.
      const projected = this.project(resolved, request);

      return {
        id: request.id,
        ref: request.ref,
        employeeId: request.employeeId,
        employeeName: member.fullName,
        employeeCode: member.employeeCode,
        designation: member.designation,
        leaveType: request.leaveType,
        fromDate: request.fromDate,
        toDate: request.toDate,
        days: request.days,
        reason: request.reason,
        appliedOn: request.appliedOn,
        isHalfDay: request.isHalfDay,
        halfDaySession: request.halfDaySession,
        balanceNow: resolved.ledger.balance,
        balanceAfter: projected.balanceAfter,
        paidDays: projected.paidDays,
        unpaidDays: projected.lopDays,
        createsLossOfPay: projected.lopDays > 0,
      };
    });

    const balances: TeamBalanceRow[] = team.map((member) => {
      const l = ledgers.get(member.id)!.ledger;
      return {
        employeeId: member.id,
        employeeCode: member.employeeCode,
        employeeName: member.fullName,
        designation: member.designation,
        opening: l.opening,
        credited: l.credited,
        taken: l.taken,
        lop: l.lop,
        pending: l.pending,
        balance: l.balance,
        lastLeaveOn: l.lastLeaveOn,
      };
    });

    const logRows = await this.leaveRepository.findRequestsForEmployees(
      teamIds,
      year.startDate,
      year.endDate,
      200,
    );
    const nameOf = new Map(team.map((t) => [t.id, t.fullName]));

    return {
      pending,
      balances,
      log: logRows.map((r) => ({
        id: r.id,
        ref: r.ref,
        leaveType: r.leaveType,
        fromDate: r.fromDate,
        toDate: r.toDate,
        days: r.days,
        unpaidDays: r.unpaidDays,
        status: r.status,
        employeeName: nameOf.get(r.employeeId) ?? '—',
        reason: r.reason,
        appliedOn: r.appliedOn,
        decidedBy: r.decidedBy,
      })),
      policy: {
        leaveYear: year.leaveYear,
        leavePerMonth: year.leavePerMonth,
        annualEntitlement: year.annualEntitlement,
        carryCap: year.carryCap,
      },
      teamSize: team.length,
    };
  }

  async decide(managerId: number, dto: DecideLeaveDto): Promise<DecisionResult> {
    const request = await this.leaveRepository.findById(dto.requestId);
    if (!request) throw ApiError.notFound('That request could not be found.');

    // Scope check: the request must belong to someone in this manager's tree.
    // A manager cannot decide their own leave, and the tree excludes them.
    const team = await this.leaveRepository.findReportingTree(managerId);
    const member = team.find((t) => t.id === request.employeeId);
    if (!member) {
      // Same response as a missing request, so this cannot be used to probe ids.
      throw ApiError.notFound('That request could not be found.');
    }

    if (request.status !== 'Pending') {
      throw ApiError.badRequest(
        `${request.ref} has already been ${request.status.toLowerCase()}.`,
      );
    }

    let convertedToUnpaid = false;
    let message: string;

    if (dto.decision === 'Rejected') {
      await this.leaveRepository.decide(request.id, 'Rejected', managerId, dto.note ?? null, 0);
      message = `${request.ref} rejected.`;
    } else {
      const resolved = await this.resolve(request.employeeId);
      const projected = this.project(resolved, request);
      const unpaid = projected.lopDays;
      convertedToUnpaid = unpaid > 0;

      // `unpaid_days` is stored as a record of what the approver was shown. The
      // ledger derives loss of pay independently, month by month, so the two
      // cannot disagree about the balance.
      await this.leaveRepository.decide(
        request.id,
        'Approved',
        managerId,
        dto.note ?? null,
        unpaid,
      );

      message = convertedToUnpaid
        ? `${request.ref} approved — ${projected.paidDays} paid and ${unpaid} as loss of pay.`
        : `${request.ref} approved.`;
    }

    await this.leaveRepository.recordAudit(
      managerId,
      dto.decision === 'Approved' ? 'leave.approved' : 'leave.rejected',
      request.id,
      { status: request.status, leaveType: request.leaveType },
      {
        status: dto.decision,
        leaveType: convertedToUnpaid ? 'Unpaid' : request.leaveType,
        convertedToUnpaid,
      },
    );

    return { view: await this.getApprovals(managerId), message, convertedToUnpaid };
  }

  /**
   * What approving this request would cost, run through the same month-by-month
   * simulation as the ledger. The request is removed from the baseline first so
   * it is not counted twice.
   */
  private project(resolved: Resolved, request: StoredLeaveRequest) {
    const baseline = {
      ...resolved.ledgerInput,
      requests: resolved.ledgerInput.requests.filter((r) => r.id !== request.id),
    };
    return projectRequest(baseline, { ...request, status: 'Approved' });
  }

  // ---------------------------------------------------------------- internals

  private async resolve(employeeId: number): Promise<Resolved> {
    const today = new Date().toISOString().slice(0, 10);

    const [context, year] = await Promise.all([
      this.leaveRepository.findLeaveContext(employeeId),
      this.leaveRepository.findLeaveYearForDate(today),
    ]);

    if (!context) throw ApiError.notFound('No HRMS profile found for this account.');
    if (!year) {
      throw new ApiError(
        503,
        'Leave policy is not configured for the current leave year. Contact HR.',
      );
    }

    const [holidays, requests, adjustments] = await Promise.all([
      this.leaveRepository.findHolidays(year.startDate, year.endDate),
      this.leaveRepository.findRequestsInYear(employeeId, year.startDate, year.endDate),
      this.leaveRepository.sumAdjustments(employeeId, year.leaveYear),
    ]);

    const ledgerInput = {
      openingLeave: context.openingLeave,
      carryCap: year.carryCap,
      weeklyOff: context.weeklyOff,
      holidays: new Set(holidays.map((h) => h.date)),
      dateOfJoining: context.dateOfJoining,
      dateOfLeaving: context.dateOfLeaving,
      yearStart: year.startDate,
      leavePerMonth: year.leavePerMonth,
      // Accrual runs to the current month, or to the year end if it has closed.
      uptoMonth: today > year.endDate ? monthKeyOf(year.endDate) : monthKeyOf(today),
      requests,
      adjustments,
    };
    const ledger = computeLedger(ledgerInput);

    return {
      context,
      year,
      holidays,
      holidaySet: new Set(holidays.map((h) => h.date)),
      requests,
      ledger,
      ledgerInput,
    };
  }

  private buildPreview(
    resolved: Resolved,
    fromDate: string,
    toDate: string,
    leaveType: LeaveType,
    isHalfDay: boolean,
  ): LeavePreview {
    const { context, holidaySet, ledger } = resolved;

    if (!fromDate || !toDate || toDate < fromDate) {
      return {
        days: 0,
        skippedDays: 0,
        balanceNow: ledger.balance,
        balanceAfter: ledger.balance,
        paidDays: 0,
        unpaidDays: 0,
        canSubmit: false,
        message: 'Pick a start date and an end date that follows it.',
      };
    }

    const calendarDays = eachDay(fromDate, toDate).length;
    const workingDays = workingDaysBetween(fromDate, toDate, context.weeklyOff, holidaySet);
    // Half day applies to EVERY working day in the range, not to the request as
    // a whole: five working days at half a day each is 2.5 days, not 0.5.
    const days = isHalfDay ? Math.round(workingDays * 0.5 * 10) / 10 : workingDays;
    const skippedDays = calendarDays - workingDays;

    if (days <= 0) {
      return {
        days: 0,
        skippedDays,
        balanceNow: ledger.balance,
        balanceAfter: ledger.balance,
        paidDays: 0,
        unpaidDays: 0,
        canSubmit: false,
        message:
          'Those dates are all weekly offs — nothing would be deducted, so there is no need to apply.',
      };
    }

    if (leaveType === 'Unpaid') {
      return {
        days,
        skippedDays,
        balanceNow: ledger.balance,
        balanceAfter: ledger.balance,
        paidDays: 0,
        unpaidDays: days,
        canSubmit: true,
        message:
          'Loss of pay — salary is reduced for these days and your balance is left untouched.',
      };
    }

    // Run the proposed dates through the same month-by-month simulation the
    // ledger uses. Whether a day is paid depends on the month it falls in, so a
    // request spanning a month boundary can be covered by next month's credit.
    const projected = projectRequest(resolved.ledgerInput, {
      id: 0,
      ref: '',
      leaveType,
      fromDate,
      toDate,
      days,
      unpaidDays: 0,
      status: 'Approved',
    });
    const paid = projected.paidDays;
    const unpaid = projected.lopDays;

    return {
      days,
      skippedDays,
      balanceNow: ledger.balance,
      balanceAfter: projected.balanceAfter,
      paidDays: paid,
      unpaidDays: unpaid,
      canSubmit: true,
      // Both figures come from the projection, so the words and the numbers
      // shown beside them can never disagree.
      message:
        (isHalfDay
          ? `${workingDays} working day${workingDays === 1 ? '' : 's'} at half a day each = ${days} days. `
          : '') +
        (unpaid > 0
          ? `${paid} of these ${days} day${days === 1 ? '' : 's'} are covered by your balance; ${unpaid} would be loss of pay. Balance ${ledger.balance} → ${projected.balanceAfter}.`
          : `All ${days} day${days === 1 ? '' : 's'} are covered. Balance ${ledger.balance} → ${projected.balanceAfter} once approved.`),
    };
  }

  private buildView(resolved: Resolved): MyLeaveView {
    const { context, year, requests, ledger } = resolved;

    // Approved paid days per month, for the chart. This spans the whole financial
    // year, not just the months credited so far, otherwise leave already approved
    // for a future month would be missing from the chart while showing in the ledger.
    const monthly = new Map<string, number>();
    let chartMonth = monthKeyOf(year.startDate);
    for (let i = 0; i < 12; i++) {
      monthly.set(chartMonth, 0);
      chartMonth = addMonths(chartMonth, 1);
    }

    for (const request of requests) {
      if (request.status !== 'Approved' || request.leaveType === 'Unpaid') continue;
      for (const day of eachDay(request.fromDate, request.toDate)) {
        const month = monthKeyOf(day);
        if (!monthly.has(month)) continue;
        if (context.weeklyOff.includes(dayName(day))) continue;
        if (resolved.holidaySet.has(day)) continue;
        monthly.set(month, (monthly.get(month) ?? 0) + 1);
      }
    }

    // Months the ledger has actually walked. Anything beyond them has not been
    // credited or deducted yet, so it must not appear as a deduction.
    const monthsInPeriod = new Set(ledger.rows.map((row) => row.month));
    const countedDays = (r: StoredLeaveRequest): number => {
      if (r.status !== 'Approved') return r.days;
      let total = 0;
      for (const [month, days] of daysByMonth(r, context.weeklyOff, resolved.holidaySet)) {
        if (monthsInPeriod.has(month)) total += days;
      }
      return Math.round(total * 10) / 10;
    };

    return {
      ledger,
      requests: requests.map((r) => ({
        daysCounted: countedDays(r),
        id: r.id,
        ref: r.ref,
        leaveType: r.leaveType,
        fromDate: r.fromDate,
        toDate: r.toDate,
        days: r.days,
        unpaidDays: r.unpaidDays,
        status: r.status,
        reason: r.reason,
        appliedOn: r.appliedOn,
        isHalfDay: r.isHalfDay,
        halfDaySession: r.halfDaySession,
        decidedBy: r.decidedBy,
      })),
      policy: {
        leaveYear: year.leaveYear,
        leavePerMonth: year.leavePerMonth,
        annualEntitlement: year.annualEntitlement,
        carryCap: year.carryCap,
        weeklyOff: context.weeklyOff,
      },
      monthlyTaken: [...monthly.entries()].map(([month, days]) => ({ month, days })),
    };
  }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const dayName = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};