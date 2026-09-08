import { RequestHandler } from 'express';
import { LeaveType } from './leave.domain';
import { IAuthService } from '../auth/auth.service.interface';
import { ILeaveService } from './leave.service.interface';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApplyLeaveDto } from './leave.model';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';

const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class LeaveController {
  constructor(
    private readonly leaveService: ILeaveService,
    private readonly authService: IAuthService,
  ) {}

  getMine: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.json({ success: true, data: await this.leaveService.getMyLeave(employeeId) });
  });

  preview: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const fromDate = this.readDate(req.query.from, 'from');
    const toDate = this.readDate(req.query.to, 'to');
    const leaveType = this.readType(req.query.type);
    const isHalfDay = req.query.halfDay === 'true';

    res.json({
      success: true,
      data: await this.leaveService.preview(employeeId, fromDate, toDate, leaveType, isHalfDay),
    });
  });

  apply: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const dto = this.toApplyDto(req.body);
    res.status(201).json({ success: true, data: await this.leaveService.apply(employeeId, dto) });
  });

  cancel: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const requestId = this.readId(req.params.id);

    // The cancellation note records who acted, so read the signed-in name.
    const me = await this.authService.getCurrentEmployee(employeeId);
    res.json({
      success: true,
      data: await this.leaveService.cancel(employeeId, requestId, me.fullName),
    });
  });

  // ---------------------------------------------------------------- parsing

  private readDate(raw: unknown, field: string): string {
    if (typeof raw !== 'string' || !ISO_DATE.test(raw)) {
      throw ApiError.badRequest(`${field} must be a date in YYYY-MM-DD form.`);
    }
    return raw;
  }

  private readType(raw: unknown): LeaveType {
    if (typeof raw !== 'string' || !LEAVE_TYPES.includes(raw as LeaveType)) {
      throw ApiError.badRequest(`Leave type must be one of: ${LEAVE_TYPES.join(', ')}.`);
    }
    return raw as LeaveType;
  }

  private readId(raw: unknown): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.badRequest('id must be a positive integer');
    }
    return id;
  }

  private toApplyDto(body: unknown): ApplyLeaveDto {
    const b = (body ?? {}) as Record<string, unknown>;
    return {
      leaveType: this.readType(b.leaveType),
      fromDate: this.readDate(b.fromDate, 'fromDate'),
      toDate: this.readDate(b.toDate, 'toDate'),
      isHalfDay: b.isHalfDay === true,
      halfDaySession:
        b.halfDaySession === 'first' || b.halfDaySession === 'second' ? b.halfDaySession : null,
      reason: typeof b.reason === 'string' ? b.reason.trim() : '',
    };
  }

  // ---------------------------------------------------------------- approvals

  getApprovals: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const view = await this.leaveService.getApprovals(employeeId);
    res.json({ success: true, data: view });
  });

  decide: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const requestId = this.readId(req.params.id);
    const decision = body.decision === 'Rejected' ? 'Rejected' : body.decision === 'Approved' ? 'Approved' : null;
    if (!decision) {
      throw ApiError.badRequest('decision must be Approved or Rejected.');
    }
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined;

    const result = await this.leaveService.decide(employeeId, { requestId, decision, note });
    res.json({ success: true, data: result });
  });
}
