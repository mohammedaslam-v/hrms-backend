import { RequestHandler } from 'express';
import { IPresenceService } from '../presence/presence.service.interface';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';

/**
 * The admin panel's header "who is active" list.
 *
 * The board is built here, by the same code as the HRMS header, so the two
 * apps can never disagree about who is on shift, on leave or off today.
 * admin-backend has already authenticated the admin and passes their
 * admins.id; it is used only to mark "(you)", since the board is company-wide.
 */
export class InternalPresenceController {
  constructor(private readonly presenceService: IPresenceService) {}

  getBoard: RequestHandler = asyncHandler(async (req, res) => {
    // 0 = the panel could not say who is at the keyboard (an impersonated
    // session): the board is still shown, with nobody marked "(you)".
    const adminId = Number(req.params.adminId);
    if (!Number.isInteger(adminId) || adminId < 0) {
      throw ApiError.badRequest('adminId must be a whole number, 0 or more');
    }
    res.json({ success: true, data: await this.presenceService.getBoardForAdmin(adminId) });
  });
}
