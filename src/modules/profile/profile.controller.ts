import { RequestHandler } from 'express';
import { IProfileService } from './profile.service.interface';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';

export class ProfileController {
  constructor(private readonly profileService: IProfileService) {}

  /** Your own profile. The subject is the session, never a parameter. */
  getMine: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.json({ success: true, data: await this.profileService.getProfile(employeeId, employeeId) });
  });

  /**
   * Someone else's. The service decides whether this viewer has any claim on it,
   * so the controller only has to produce a well-formed id.
   */
  getOne: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.id);
    res.json({ success: true, data: await this.profileService.getProfile(employeeId, subjectId) });
  });

  private readId(raw: unknown): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.badRequest('id must be a positive integer');
    }
    return id;
  }
}
