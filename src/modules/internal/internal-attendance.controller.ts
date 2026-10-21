import { Request, RequestHandler } from 'express';
import { IAttendanceService } from '../attendance/attendance.service.interface';
import { InternalAttendanceRepository } from './internal-attendance.repository';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { parseDeviceFix } from '../attendance/geofence.domain';

/**
 * The admin panel's header Check in / Check out, for the admin's OWN attendance.
 *
 * admin-backend has already authenticated the admin and passes their admins.id;
 * it never lets the browser choose whose id is sent. The punch itself goes
 * through the same AttendanceService as the HRMS Today card, so lateness, shift
 * days and statuses are identical whichever app it was made from.
 */
export class InternalAttendanceController {
  constructor(
    private readonly attendanceService: IAttendanceService,
    private readonly repository: InternalAttendanceRepository,
  ) {}

  /** `linked: false` means "not an HRMS employee" — the panel shows no buttons. */
  getToday: RequestHandler = asyncHandler(async (req, res) => {
    const employeeId = await this.repository.findActiveEmployeeIdByAdminId(this.readAdminId(req));
    if (!employeeId) {
      res.json({ success: true, data: { linked: false, today: null } });
      return;
    }
    res.json({
      success: true,
      data: { linked: true, today: await this.attendanceService.getToday(employeeId) },
    });
  });

  checkIn: RequestHandler = asyncHandler(async (req, res) => {
    const employeeId = await this.requireEmployee(req);
    res.status(201).json({
      success: true,
      data: {
        linked: true,
        today: await this.attendanceService.checkIn(employeeId, parseDeviceFix(req.body)),
      },
    });
  });

  checkOut: RequestHandler = asyncHandler(async (req, res) => {
    const employeeId = await this.requireEmployee(req);
    res.json({
      success: true,
      data: {
        linked: true,
        today: await this.attendanceService.checkOut(employeeId, parseDeviceFix(req.body)),
      },
    });
  });

  private async requireEmployee(req: Request): Promise<number> {
    const employeeId = await this.repository.findActiveEmployeeIdByAdminId(this.readAdminId(req));
    if (!employeeId) throw ApiError.notFound('This account is not an HRMS employee.');
    return employeeId;
  }

  private readAdminId(req: Request): number {
    const id = Number(req.params.adminId);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.badRequest('adminId must be a positive integer');
    }
    return id;
  }
}
