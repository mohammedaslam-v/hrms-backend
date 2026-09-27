import { RequestHandler } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { IReimbursementService } from './reimbursement.service.interface';

export class ReimbursementController {
  constructor(private readonly reimbursementService: IReimbursementService) {}

  getMyReimbursements: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const data = await this.reimbursementService.getMyReimbursements(employeeId);
    res.json({ success: true, data });
  });

  createReimbursement: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const item = await this.reimbursementService.createReimbursement(
      employeeId,
      req.body,
    );
    res.status(201).json({ success: true, data: item });
  });

  getReceiptFile: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const claimId = Number(req.params.id);
    if (isNaN(claimId) || claimId <= 0) {
      throw ApiError.badRequest('Invalid claim ID.');
    }
    const { fullPath, mimeType, filename } =
      await this.reimbursementService.getReceiptFile(employeeId, claimId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${filename}"`,
    );
    res.sendFile(fullPath);
  });

  cancelClaim: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const claimId = Number(req.params.id);
    if (isNaN(claimId) || claimId <= 0) {
      throw ApiError.badRequest('Invalid claim ID.');
    }
    await this.reimbursementService.cancelClaim(employeeId, claimId);
    res.json({ success: true, message: 'Reimbursement claim cancelled.' });
  });

  getAllForAdmin: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const statusFilter =
      typeof req.query.status === 'string' ? req.query.status : undefined;
    const data = await this.reimbursementService.getAllForAdmin(
      employeeId,
      statusFilter,
    );
    res.json({ success: true, data });
  });

  approveClaim: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const claimId = Number(req.params.id);
    if (isNaN(claimId) || claimId <= 0) {
      throw ApiError.badRequest('Invalid claim ID.');
    }
    await this.reimbursementService.approveClaim(employeeId, claimId, req.body);
    res.json({
      success: true,
      message: 'Reimbursement claim approved successfully.',
    });
  });

  rejectClaim: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const claimId = Number(req.params.id);
    if (isNaN(claimId) || claimId <= 0) {
      throw ApiError.badRequest('Invalid claim ID.');
    }
    await this.reimbursementService.rejectClaim(employeeId, claimId, req.body);
    res.json({
      success: true,
      message: 'Reimbursement claim rejected.',
    });
  });

  markPaid: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const claimId = Number(req.params.id);
    if (isNaN(claimId) || claimId <= 0) {
      throw ApiError.badRequest('Invalid claim ID.');
    }
    await this.reimbursementService.markPaid(employeeId, claimId, req.body);
    res.json({
      success: true,
      message: 'Reimbursement marked as paid.',
    });
  });
}
