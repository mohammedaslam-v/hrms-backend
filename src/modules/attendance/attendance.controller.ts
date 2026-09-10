import { RequestHandler } from 'express';
import { IAttendanceService } from './attendance.service.interface';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The subject is always the session. There is no route for punching someone
 * else in — an attendance record only means anything if the person made it.
 */
export class AttendanceController {
  constructor(private readonly attendanceService: IAttendanceService) {}

  getToday: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.json({ success: true, data: await this.attendanceService.getToday(employeeId) });
  });

  getWeek: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.json({ success: true, data: await this.attendanceService.getWeek(employeeId) });
  });

  /** Any window of days, with each day's status resolved. */
  getDays: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const from = this.readDate(req.query.from, 'from');
    const to = this.readDate(req.query.to, 'to');
    res.json({ success: true, data: await this.attendanceService.getDays(employeeId, from, to) });
  });

  /** Somebody else's day. Access is resolved in the service, not here. */
  getTodayForEmployee: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.employeeId);
    res.json({ success: true, data: await this.attendanceService.getTodayFor(viewerId, subjectId) });
  });

  getWeekForEmployee: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.employeeId);
    res.json({ success: true, data: await this.attendanceService.getWeekFor(viewerId, subjectId) });
  });

  checkIn: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.status(201).json({ success: true, data: await this.attendanceService.checkIn(employeeId) });
  });

  checkOut: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.json({ success: true, data: await this.attendanceService.checkOut(employeeId) });
  });

  private readId(raw: unknown): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.badRequest('employeeId must be a positive integer');
    }
    return id;
  }

  private readDate(raw: unknown, field: string): string {
    if (typeof raw !== 'string' || !ISO_DATE.test(raw)) {
      throw ApiError.badRequest(`${field} must be a date in YYYY-MM-DD form.`);
    }
    return raw;
  }
}
