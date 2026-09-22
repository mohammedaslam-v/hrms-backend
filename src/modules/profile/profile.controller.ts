import { RequestHandler } from 'express';
import { IProfileService } from './profile.service.interface';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { DismissEmployeeDto, DocumentKey, SaveDocumentDto, ToggleSalaryDto } from './profile.model';

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

  deleteDocument: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = req.params.id ? this.readId(req.params.id) : employeeId;
    const key = req.params.key as DocumentKey;

    await this.profileService.deleteDocument(employeeId, subjectId, key);
    res.json({ success: true, message: 'Document deleted successfully.' });
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

  toggleLogin: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.id);
    const disabled = Boolean(req.body?.disabled);

    const result = await this.profileService.toggleLogin(employeeId, subjectId, disabled);
    res.json({
      success: true,
      message: disabled ? 'Employee login has been disabled.' : 'Employee login has been enabled.',
      data: result,
    });
  });

  dismissEmployee: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.id);
    const body = (req.body ?? {}) as DismissEmployeeDto;

    if (!body.lastWorkingDay) {
      throw ApiError.badRequest('Last working day is required.');
    }

    await this.profileService.dismissEmployee(employeeId, subjectId, body);
    res.json({
      success: true,
      message: 'Employee exit details recorded successfully.',
    });
  });

  toggleSalary: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.id);
    const body = (req.body ?? {}) as ToggleSalaryDto;

    const result = await this.profileService.toggleSalary(employeeId, subjectId, body);
    res.json({
      success: true,
      message: body.stopped ? 'Salary disbursement stopped.' : 'Salary disbursement resumed.',
      data: result,
    });
  });

  updateEmploymentType: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.id);
    const employmentType = String(req.body?.employmentType || "Full-time");

    const result = await this.profileService.updateEmploymentType(employeeId, subjectId, employmentType);
    res.json({
      success: true,
      message: `Employment type updated to ${result.employmentType}.`,
      data: result,
    });
  });

  deleteEmployee: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = this.readId(req.params.id);

    await this.profileService.deleteEmployee(employeeId, subjectId);
    res.json({
      success: true,
      message: 'Employee record deleted successfully.',
    });
  });

  updateCompensation: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const subjectId = req.params.id ? this.readId(req.params.id) : employeeId;

    const result = await this.profileService.updateCompensation(
      employeeId,
      subjectId,
      req.body,
    );

    res.json({
      success: true,
      message: "Compensation updated successfully.",
      data: result,
    });
  });

  private readId(raw: unknown): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.badRequest('id must be a positive integer');
    }
    return id;
  }
}
