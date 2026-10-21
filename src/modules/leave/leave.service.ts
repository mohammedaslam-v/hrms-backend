import {
  addMonths,
  computeLedger,
  daysByMonth,
  eachDay,
  formatMonthRange,
  LeaveLedger,
  LeaveType,
  monthKeyOf,
  projectRequest,
  workingDaysBetween,
} from './leave.domain';
import { IOrgRepository } from '../org/org.repository.interface';
import { IAccessService } from '../access/access.service.interface';
import { IAuthService } from '../auth/auth.service.interface';
import {
  ILeaveRepository,
  StoredLeaveRequest,
} from './leave.repository.interface';
import { DayLeaveChoice, ILeaveService } from './leave.service.interface';
import {
  ApplyLeaveDto,
  ApprovalsView,
  DecideLeaveDto,
  DecisionResult,
  EditApprovedLeaveDto,
  EditApprovedResult,
  HolidayRecord,
  LeaveContext,
  LeavePreview,
  LeaveYearConfig,
  PendingApproval,
  TeamBalanceRow,
  MyLeaveView,
  OnLeaveEmployee,
} from './leave.model';
import { ApiError } from '../../utils/api-error';

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
  constructor(
    private readonly leaveRepository: ILeaveRepository,
    // Who reports to whom belongs to the org module, not to leave. Approvals
    // and profile access must never answer that question differently.
    private readonly orgRepository: IOrgRepository,
    private readonly accessService?: IAccessService,
    private readonly authService?: IAuthService,
  ) {}

  async getMyLeave(employeeId: number): Promise<MyLeaveView> {
    const view = this.buildView(await this.resolve(employeeId));
    if (this.authService) {
      try {
        const emp = await this.authService.getCurrentEmployee(employeeId);
        view.employee = {
          id: emp.id,
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          designation: emp.designation ?? null,
        };
      } catch {}
    }
    view.isSelf = true;
    return view;
  }

  async getForEmployee(viewerId: number, subjectId: number): Promise<MyLeaveView> {
    if (this.accessService) {
      await this.accessService.require(viewerId, subjectId);
    }
    const view = this.buildView(await this.resolve(subjectId));
    if (this.authService) {
      try {
        const emp = await this.authService.getCurrentEmployee(subjectId);
        view.employee = {
          id: emp.id,
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          designation: emp.designation ?? null,
        };
      } catch {}
    }
    view.isSelf = viewerId === subjectId;
    return view;
  }

  async previewForEmployee(
    viewerId: number,
    subjectId: number,
    fromDate: string,
    toDate: string,
    leaveType: LeaveType,
    isHalfDay: boolean,
  ): Promise<LeavePreview> {
    if (this.accessService) {
      await this.accessService.require(viewerId, subjectId);
    }
    return this.preview(subjectId, fromDate, toDate, leaveType, isHalfDay);
  }

  async applyForEmployee(
    viewerId: number,
    subjectId: number,
    dto: ApplyLeaveDto,
  ): Promise<MyLeaveView> {
    if (this.accessService) {
      const access = await this.accessService.require(viewerId, subjectId);
      if (access !== "manager" && access !== "admin" && access !== "self") {
        throw ApiError.forbidden("You do not have permission to apply leave for this employee.");
      }
    }
    const view = await this.apply(subjectId, dto);
    if (this.authService) {
      try {
        const emp = await this.authService.getCurrentEmployee(subjectId);
        view.employee = {
          id: emp.id,
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          designation: emp.designation ?? null,
        };
      } catch {}
    }
    view.isSelf = viewerId === subjectId;
    return view;
  }

  async cancelForEmployee(
    viewerId: number,
    subjectId: number,
    requestId: number,
    byName: string,
  ): Promise<MyLeaveView> {
    if (this.accessService) {
      await this.accessService.require(viewerId, subjectId);
    }
    const view = await this.cancel(subjectId, requestId, byName);
    if (this.authService) {
      try {
        const emp = await this.authService.getCurrentEmployee(subjectId);
        view.employee = {
          id: emp.id,
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          designation: emp.designation ?? null,
        };
      } catch {}
    }
    view.isSelf = viewerId === subjectId;
    return view;
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


  async getOnLeaveToday(): Promise<OnLeaveEmployee[]> {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    return this.leaveRepository.findOnLeaveToday(today);
  }

  async getApprovals(managerId: number): Promise<ApprovalsView> {
    const viewer = this.authService ? await this.authService.getCurrentEmployee(managerId) : null;
    const isAdmin = viewer?.tiers.includes('admin') ?? false;

    const team = await this.orgRepository.findReportingTree(managerId);
    const teamIds = team.map((t) => t.id);

    const today = new Date().toISOString().slice(0, 10);
    const year = await this.leaveRepository.findLeaveYearForDate(today);
    if (!year) {
      throw new ApiError(503, 'Leave policy is not configured for the current leave year.');
    }

    // When an admin is logged in, show all pending leave approval requests.
    // For managers, only their reporting tree's requests are shown.
    const pendingRequests = isAdmin
      ? await this.leaveRepository.findPendingForEmployees()
      : await this.leaveRepository.findPendingForEmployees(teamIds);

    // The ledger for each report, plus any applicant whose request is pending,
    // so the queue can show the consequence of a decision and the balances table can be built.
    const ledgers = new Map<number, Awaited<ReturnType<LeaveService['resolve']>>>();
    for (const member of team) {
      ledgers.set(member.id, await this.resolve(member.id));
    }
    for (const req of pendingRequests) {
      if (!ledgers.has(req.employeeId)) {
        ledgers.set(req.employeeId, await this.resolve(req.employeeId));
      }
    }

    const pending: PendingApproval[] = pendingRequests.map((request) => {
      const resolved = ledgers.get(request.employeeId)!;
      const member = team.find((t) => t.id === request.employeeId);
      const employeeName = member?.fullName ?? request.employeeName ?? '—';
      const employeeCode = member?.employeeCode ?? request.employeeCode ?? '—';
      const designation = member?.designation ?? request.designation ?? null;

      // Project the request through the month-by-month simulation, excluding it
      // from the baseline so it is not counted twice.
      const projected = this.project(resolved, request);

      return {
        id: request.id,
        ref: request.ref,
        employeeId: request.employeeId,
        employeeName,
        employeeCode,
        designation,
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

    const balanceMembers = [...team];
    if (isAdmin) {
      for (const req of pendingRequests) {
        if (!balanceMembers.some((m) => m.id === req.employeeId)) {
          balanceMembers.push({
            id: req.employeeId,
            employeeCode: req.employeeCode ?? '—',
            fullName: req.employeeName ?? '—',
            designation: req.designation ?? null,
          });
        }
      }
    }

    const balances: TeamBalanceRow[] = balanceMembers.map((member) => {
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
      isAdmin ? undefined : teamIds,
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
        employeeId: r.employeeId,
        leaveType: r.leaveType,
        fromDate: r.fromDate,
        toDate: r.toDate,
        days: r.days,
        unpaidDays: r.unpaidDays,
        status: r.status,
        employeeName: r.employeeName ?? nameOf.get(r.employeeId) ?? '—',
        reason: r.reason,
        appliedOn: r.appliedOn,
        decidedBy: r.decidedBy,
        isHalfDay: r.isHalfDay,
        halfDaySession: r.halfDaySession,
      })),
      policy: {
        leaveYear: year.leaveYear,
        leavePerMonth: year.leavePerMonth,
        annualEntitlement: year.annualEntitlement,
        carryCap: year.carryCap,
      },
      teamSize: team.length,
      isAdmin,
    };
  }

  async decide(managerId: number, dto: DecideLeaveDto): Promise<DecisionResult> {
    const request = await this.leaveRepository.findById(dto.requestId);
    if (!request) throw ApiError.notFound('That request could not be found.');

    const viewer = this.authService ? await this.authService.getCurrentEmployee(managerId) : null;
    const isAdmin = viewer?.tiers.includes('admin') ?? false;

    // Scope check: the request must belong to someone in this manager's tree, unless viewer is admin.
    // A manager cannot decide their own leave, and the tree excludes them.
    if (!isAdmin) {
      const team = await this.orgRepository.findReportingTree(managerId);
      const member = team.find((t) => t.id === request.employeeId);
      if (!member) {
        // Same response as a missing request, so this cannot be used to probe ids.
        throw ApiError.notFound('That request could not be found.');
      }
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
  async editApproved(adminId: number, dto: EditApprovedLeaveDto): Promise<EditApprovedResult> {
    const viewer = this.authService ? await this.authService.getCurrentEmployee(adminId) : null;
    const isAdmin = viewer?.tiers.includes('admin') ?? false;
    if (!isAdmin) {
      throw ApiError.forbidden('Only administrators can edit approved leave requests.');
    }

    const request = await this.leaveRepository.findById(dto.requestId);
    if (!request) {
      throw ApiError.notFound('That leave request could not be found.');
    }

    if (request.status !== 'Approved') {
      throw ApiError.badRequest(
        `Only approved leave requests can be edited. This request is currently ${request.status.toLowerCase()}.`,
      );
    }

    // Validation
    if (!dto.fromDate || !dto.toDate) {
      throw ApiError.badRequest('From date and To date are required.');
    }
    if (dto.fromDate > dto.toDate) {
      throw ApiError.badRequest('From date cannot be after To date.');
    }

    if (dto.isHalfDay) {
      if (dto.fromDate !== dto.toDate) {
        throw ApiError.badRequest('A half-day leave cannot span multiple calendar dates.');
      }
      if (!dto.halfDaySession) {
        throw ApiError.badRequest('Half-day session (first half or second half) is required for half-day leave.');
      }
    }

    const trimmedNote = (dto.adminNote || '').trim();
    if (!trimmedNote || trimmedNote.length < 3) {
      throw ApiError.badRequest('A valid admin reason / modification note is required.');
    }

    const resolved = await this.resolve(request.employeeId);
    let newDays: number;
    if (dto.isHalfDay) {
      newDays = 0.5;
    } else {
      newDays = workingDaysBetween(
        dto.fromDate,
        dto.toDate,
        resolved.context.weeklyOff,
        resolved.holidaySet,
      );
    }

    if (newDays <= 0) {
      throw ApiError.badRequest(
        'Selected date range contains no working days (all days fall on weekly offs or declared holidays).',
      );
    }

// Extension allowed per requirement; balance/LOP projected below

    // Overlap check with other leaves of this employee (excluding this request)
    const overlap = await this.leaveRepository.findOverlappingExcluding(
      request.employeeId,
      dto.fromDate,
      dto.toDate,
      request.id,
    );
    if (overlap) {
      throw ApiError.badRequest(
        `The requested dates conflict with another ${overlap.status.toLowerCase()} leave request (${overlap.ref}: ${overlap.fromDate} to ${overlap.toDate}).`,
      );
    }

    // Calculate unpaid days / LOP
    let newUnpaidDays = 0;
    if (dto.leaveType === 'Unpaid') {
      newUnpaidDays = newDays;
    } else {
      const updatedMockRequest: StoredLeaveRequest = {
        ...request,
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        days: newDays,
        leaveType: dto.leaveType,
        isHalfDay: dto.isHalfDay,
        halfDaySession: dto.isHalfDay ? (dto.halfDaySession as any) : null,
      };
      const projected = this.project(resolved, updatedMockRequest);
      newUnpaidDays = projected.lopDays;
    }

    const adminName = viewer?.fullName || 'Admin';
    await this.leaveRepository.updateApprovedLeave(request.id, {
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      days: newDays,
      unpaidDays: newUnpaidDays,
      isHalfDay: dto.isHalfDay,
      halfDaySession: dto.isHalfDay ? (dto.halfDaySession as any) : null,
      leaveType: dto.leaveType,
      adminNote: trimmedNote,
      adminName,
    });

    await this.leaveRepository.recordAudit(
      adminId,
      'leave.approved_edited',
      request.id,
      {
        fromDate: request.fromDate,
        toDate: request.toDate,
        days: request.days,
        unpaidDays: request.unpaidDays,
        leaveType: request.leaveType,
        isHalfDay: request.isHalfDay,
        halfDaySession: request.halfDaySession,
      },
      {
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        days: newDays,
        unpaidDays: newUnpaidDays,
        leaveType: dto.leaveType,
        isHalfDay: dto.isHalfDay,
        halfDaySession: dto.isHalfDay ? dto.halfDaySession : null,
        adminNote: trimmedNote,
      },
    );

    const clearedAttendanceCount = await this.leaveRepository.clearAttendanceForLeaveDates(
      request.employeeId,
      dto.fromDate,
      dto.toDate,
      dto.leaveType,
      dto.isHalfDay,
      adminId,
      request.ref,
    );

    const updatedRequest = await this.leaveRepository.findById(request.id);
    const daysDiff = Math.round((request.days - newDays) * 10) / 10;
    let message = `${request.ref} updated successfully.`;
    if (daysDiff > 0) {
      message += ` Duration reduced by ${daysDiff} day(s), restored to employee balance.`;
    } else if (daysDiff < 0) {
      message += ` Duration extended by ${Math.abs(daysDiff)} day(s).`;
      if (newUnpaidDays > 0) {
        message += ` (${newUnpaidDays} day(s) marked as loss of pay).`;
      }
    }
    if (clearedAttendanceCount > 0) {
      message += ` Past attendance on ${clearedAttendanceCount} day(s) cleared.`;
    }

    return {
      view: await this.getApprovals(adminId),
      message,
      updatedRequest: updatedRequest!,
    };
  }

  async setDayLeave(
    adminId: number,
    employeeId: number,
    date: string,
    choice: DayLeaveChoice | null,
    note: string,
  ): Promise<string | null> {
    const existing = await this.leaveRepository.findOverlapping(employeeId, date, date);

    if (existing) {
      if (existing.status === 'Pending') {
        throw new ApiError(
          409,
          `${existing.ref} is still pending for this day. Approve or reject it from Leave approvals first.`,
        );
      }
      // Splitting a range in two from a single day's window is too easy to get
      // wrong silently, so it stays with the screen built for editing ranges.
      if (existing.fromDate !== existing.toDate) {
        throw new ApiError(
          409,
          `This day is part of ${existing.ref} (${existing.fromDate} to ${existing.toDate}). Edit that leave from Leave approvals instead.`,
        );
      }

      if (!choice) {
        const viewer = this.authService ? await this.authService.getCurrentEmployee(adminId) : null;
        await this.leaveRepository.cancelApproved(
          existing.id,
          `[Cancelled by ${viewer?.fullName ?? 'Admin'} from attendance calendar]: ${note}`,
        );
        await this.leaveRepository.recordAudit(
          adminId,
          'leave.approved_cancelled',
          existing.id,
          { status: existing.status },
          { status: 'Cancelled', note },
        );
        return `${existing.ref} cancelled.`;
      }

      const sameAlready =
        existing.leaveType === choice.leaveType &&
        existing.isHalfDay === choice.isHalfDay &&
        (!choice.isHalfDay || existing.halfDaySession === choice.halfDaySession);
      if (sameAlready) return null;

      const result = await this.editApproved(adminId, {
        requestId: existing.id,
        fromDate: date,
        toDate: date,
        leaveType: choice.leaveType,
        isHalfDay: choice.isHalfDay,
        halfDaySession: choice.halfDaySession,
        adminNote: note,
      });
      return result.message;
    }

    if (!choice) return null;

    if (choice.isHalfDay && choice.halfDaySession !== 'first' && choice.halfDaySession !== 'second') {
      throw ApiError.badRequest('Choose which half of the day was taken.');
    }

    const resolved = await this.resolve(employeeId);
    if (date < resolved.context.dateOfJoining) {
      throw ApiError.badRequest('That date is before the employee joined.');
    }
    const preview = this.buildPreview(resolved, date, date, choice.leaveType, choice.isHalfDay);
    if (preview.days <= 0) {
      throw ApiError.badRequest('That day is a weekly off, so there is no leave to record.');
    }

    const created = await this.leaveRepository.create(
      employeeId,
      {
        leaveType: choice.leaveType,
        halfDaySession: choice.isHalfDay ? choice.halfDaySession : null,
        fromDate: date,
        toDate: date,
        isHalfDay: choice.isHalfDay,
        reason: note,
      },
      preview.days,
    );

    // Same rule as editApproved: unpaid is unpaid in full; anything else is
    // projected through the month-by-month ledger.
    const unpaid =
      choice.leaveType === 'Unpaid'
        ? preview.days
        : this.project(await this.resolve(employeeId), created).lopDays;

    await this.leaveRepository.decide(
      created.id,
      'Approved',
      adminId,
      `Marked by admin from the attendance calendar: ${note}`,
      unpaid,
    );
    await this.leaveRepository.recordAudit(
      adminId,
      'leave.admin_marked',
      created.id,
      null,
      { date, ...choice, unpaidDays: unpaid, note },
    );

    return unpaid > 0 && choice.leaveType !== 'Unpaid'
      ? `${created.ref} recorded — ${unpaid} day(s) as loss of pay, the balance did not cover it.`
      : `${created.ref} recorded.`;
  }

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
    const futureCredit = projected.futureCredit;
    const futureMonths = projected.futureMonths;

    let balanceExplanation: string;
    if (futureCredit > 0) {
      const monthLabel = formatMonthRange(futureMonths);
      if (unpaid > 0) {
        balanceExplanation = `${paid} of these ${days} day${days === 1 ? '' : 's'} are covered (Balance ${ledger.balance} + ${futureCredit} credited in ${monthLabel}); ${unpaid} would be loss of pay. Balance after: ${projected.balanceAfter}.`;
      } else {
        balanceExplanation = `All ${days} day${days === 1 ? '' : 's'} are covered. Balance: ${ledger.balance} (+${futureCredit} credited in ${monthLabel}) − ${days} day${days === 1 ? '' : 's'} = ${projected.balanceAfter} once approved.`;
      }
    } else {
      if (unpaid > 0) {
        balanceExplanation = `${paid} of these ${days} day${days === 1 ? '' : 's'} are covered by your balance; ${unpaid} would be loss of pay. Balance ${ledger.balance} → ${projected.balanceAfter}.`;
      } else {
        balanceExplanation = `All ${days} day${days === 1 ? '' : 's'} are covered. Balance ${ledger.balance} → ${projected.balanceAfter} once approved.`;
      }
    }

    return {
      days,
      skippedDays,
      balanceNow: ledger.balance,
      balanceAfter: projected.balanceAfter,
      paidDays: paid,
      unpaidDays: unpaid,
      canSubmit: true,
      message:
        (isHalfDay
          ? `${workingDays} working day${workingDays === 1 ? '' : 's'} at half a day each = ${days} days. `
          : '') + balanceExplanation,
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