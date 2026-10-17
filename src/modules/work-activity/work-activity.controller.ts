import { RequestHandler } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { IWorkActivityService } from './work-activity.service.interface';

export class WorkActivityController {
  constructor(private readonly service: IWorkActivityService) {}

  /** GET /work-activities?from=&to=[&employeeId=] — your own without employeeId. */
  list: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const raw = req.query.employeeId;
    const subjectId = raw === undefined || raw === '' ? viewerId : Number(raw);
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      throw ApiError.badRequest('employeeId must be a valid employee id.');
    }
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    res.json({ success: true, data: await this.service.listFor(viewerId, subjectId, from, to) });
  });

  /** POST /work-activities — always on your own day; no employee id is read. */
  create: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const data = await this.service.create(viewerId, (req.body ?? {}) as Record<string, unknown>);
    res.status(201).json({ success: true, data });
  });

  /** DELETE /work-activities/:id — your own, while its day is still editable. */
  remove: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId: viewerId } = req as AuthenticatedRequest;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Valid activity id is required.');
    await this.service.remove(viewerId, id);
    res.json({ success: true, message: 'Activity deleted.' });
  });
}
