import { RequestHandler } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { IPresenceService } from './presence.service.interface';

export class PresenceController {
  constructor(private readonly presenceService: IPresenceService) {}

  /** GET /presence/online — no id in the path: you get your own scope. */
  getOnline: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.json({ success: true, data: await this.presenceService.getOnline(employeeId) });
  });

  /** GET /presence/count — the closed pill's number, in your scope. */
  getCount: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.json({ success: true, data: await this.presenceService.getCount(employeeId) });
  });

  /** GET /presence/board — the open dropdown: everyone in scope, by shift. */
  getBoard: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.json({ success: true, data: await this.presenceService.getBoard(employeeId) });
  });

  /**
   * GET /presence/days?from=&to=[&employeeId=] — time on the admin panel per
   * day. Without employeeId it is your own; with it, the service checks you
   * may open that person's My Page.
   */
  getAdminActivity: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const raw = req.query.employeeId;
    const subjectId = raw === undefined || raw === '' ? viewerId : Number(raw);
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      throw ApiError.badRequest('employeeId must be a valid employee id.');
    }
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    res.json({
      success: true,
      data: await this.presenceService.getAdminActivity(viewerId, subjectId, from, to),
    });
  });
}
