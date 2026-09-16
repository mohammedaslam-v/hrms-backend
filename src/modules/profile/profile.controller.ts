import { RequestHandler } from 'express';
import { IProfileService } from './profile.service.interface';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { DocumentKey, SaveDocumentDto } from './profile.model';

export class ProfileController {
  constructor(private readonly profileService: IProfileService) {}

  getMine: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    res.json({ success: true, data: await this.profileService.getProfile(employeeId, employeeId) });
  });

  getOne: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.id);
    res.json({ success: true, data: await this.profileService.getProfile(employeeId, subjectId) });
  });

  saveDocument: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = req.params.id ? this.readId(req.params.id) : employeeId;
    const body = (req.body ?? {}) as SaveDocumentDto;

    const saved = await this.profileService.saveDocument(employeeId, subjectId, body);
    res.json({ success: true, data: saved });
  });

  downloadDocument: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = req.params.id ? this.readId(req.params.id) : employeeId;
    const key = req.params.key as DocumentKey;

    const filePath = await this.profileService.getDocumentFilePath(employeeId, subjectId, key);
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return res.redirect(filePath);
    }
    res.sendFile(filePath);
  });

  private readId(raw: unknown): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.badRequest('id must be a positive integer');
    }
    return id;
  }
}
