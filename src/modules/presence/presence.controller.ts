import { RequestHandler } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { asyncHandler } from '../../utils/async-handler';
import { IPresenceService } from './presence.service.interface';

export class PresenceController {
  constructor(private readonly presenceService: IPresenceService) {}

  /** GET /presence/online — no id in the path: you get your own scope. */
  getOnline: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.json({ success: true, data: await this.presenceService.getOnline(employeeId) });
  });
}
