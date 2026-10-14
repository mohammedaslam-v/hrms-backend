import { RequestHandler } from 'express';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ICompanyPolicyService } from './company-policy.service.interface';

export class CompanyPolicyController {
  constructor(private readonly service: ICompanyPolicyService) {}

  getAll: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;

    const policies = await this.service.getAll(employeeId, { search, status, category });
    res.json({ success: true, data: policies });
  });

  getById: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      throw ApiError.badRequest('Invalid policy ID.');
    }

    const policy = await this.service.getById(employeeId, id);
    res.json({ success: true, data: policy });
  });

  create: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const policy = await this.service.create(employeeId, req.body);
    res.status(201).json({
      success: true,
      data: policy,
      message: 'Policy created successfully.',
    });
  });

  update: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      throw ApiError.badRequest('Invalid policy ID.');
    }

    const policy = await this.service.update(employeeId, id, req.body);
    res.json({
      success: true,
      data: policy,
      message: 'Policy updated successfully.',
    });
  });

  delete: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      throw ApiError.badRequest('Invalid policy ID.');
    }

    await this.service.delete(employeeId, id);
    res.json({
      success: true,
      message: 'Policy deleted successfully.',
    });
  });

  uploadAttachment: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const { fileName, fileBase64 } = req.body;
    const result = await this.service.uploadAttachment(employeeId, fileName, fileBase64);
    res.status(201).json({
      success: true,
      data: result,
      message: 'Attachment uploaded successfully.',
    });
  });

  getAttachmentFile: RequestHandler = asyncHandler(async (req, res) => {
    // Express 5: /files/*key captures the remaining path as an array of
    // already-decoded segments in req.params.key
    const raw = (req.params as { key?: string | string[] }).key;
    const key = Array.isArray(raw) ? raw.join('/') : raw || (req.query.key as string);
    const { buffer, mimeType, filename } = await this.service.getAttachmentFile(key);
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(filename)}"`,
    );
    res.send(buffer);
  });
}
