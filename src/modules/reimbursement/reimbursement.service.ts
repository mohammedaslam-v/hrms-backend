import fs from 'fs';
import path from 'path';
import { ApiError } from '../../utils/api-error';
import { IAuthService } from '../auth/auth.service.interface';
import {
  AdminReimbursementsView,
  ApproveReimbursementDto,
  CreateReimbursementDto,
  EmployeeReimbursementsView,
  MarkPaidReimbursementDto,
  ReimbursementItem,
  RejectReimbursementDto,
} from './reimbursement.model';
import { IReimbursementRepository } from './reimbursement.repository.interface';
import { IReimbursementService } from './reimbursement.service.interface';

export class ReimbursementService implements IReimbursementService {
  constructor(
    private readonly reimbursementRepository: IReimbursementRepository,
    private readonly authService: IAuthService,
  ) {}

  async getMyReimbursements(
    employeeId: number,
  ): Promise<EmployeeReimbursementsView> {
    const [summary, claims] = await Promise.all([
      this.reimbursementRepository.getEmployeeSummary(employeeId),
      this.reimbursementRepository.findByEmployeeId(employeeId),
    ]);
    return { summary, claims };
  }

  async createReimbursement(
    employeeId: number,
    dto: CreateReimbursementDto,
  ): Promise<ReimbursementItem> {
    if (!dto.title || !dto.title.trim()) {
      throw ApiError.badRequest('Claim title/purpose is required.');
    }
    if (!dto.category) {
      throw ApiError.badRequest('Expense category is required.');
    }
    if (!dto.expenseDate) {
      throw ApiError.badRequest('Expense date is required.');
    }
    const claimAmount = Number(dto.claimAmount);
    if (isNaN(claimAmount) || claimAmount <= 0) {
      throw ApiError.badRequest('Claim amount must be greater than zero.');
    }

    let receiptPath: string | null = null;
    let receiptFilename: string | null = null;
    let receiptMimeType: string | null = null;

    if (dto.fileBase64) {
      let buffer: Buffer;
      let ext = 'pdf';
      let mimeType = 'application/pdf';

      const matches = dto.fileBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1].toLowerCase();
        buffer = Buffer.from(matches[2], 'base64');
        if (mimeType.includes('pdf')) ext = 'pdf';
        else if (mimeType.includes('png')) ext = 'png';
        else if (mimeType.includes('jpeg') || mimeType.includes('jpg'))
          ext = 'jpg';
      } else {
        buffer = Buffer.from(dto.fileBase64, 'base64');
        if (dto.fileName && dto.fileName.includes('.')) {
          ext = dto.fileName.split('.').pop()!.toLowerCase();
          if (ext === 'png') mimeType = 'image/png';
          else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
          else mimeType = 'application/pdf';
        }
      }

      if (buffer.length > 10 * 1024 * 1024) {
        throw ApiError.badRequest('Receipt file must not exceed 10 MB.');
      }

      const safeExt = ['pdf', 'png', 'jpg', 'jpeg'].includes(ext)
        ? ext
        : 'pdf';
      const cleanFileName = `reimb_${employeeId}_${Date.now()}.${safeExt}`;
      const uploadsDir = path.resolve(process.cwd(), 'uploads/reimbursements');
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      const fullPath = path.join(uploadsDir, cleanFileName);
      await fs.promises.writeFile(fullPath, buffer);

      receiptPath = `uploads/reimbursements/${cleanFileName}`;
      receiptFilename = dto.fileName || cleanFileName;
      receiptMimeType = mimeType;
    }

    const ref = await this.reimbursementRepository.getNextRef();
    const insertId = await this.reimbursementRepository.create({
      ref,
      employeeId,
      category: dto.category,
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      expenseDate: dto.expenseDate,
      claimAmount: Math.round(claimAmount * 100) / 100,
      receiptPath,
      receiptFilename,
      receiptMimeType,
    });

    const item = await this.reimbursementRepository.findById(insertId);
    if (!item) {
      throw new ApiError(500, 'Could not retrieve newly created claim.');
    }
    return item;
  }

  async getReceiptFile(
    viewerId: number,
    claimId: number,
  ): Promise<{ fullPath: string; mimeType: string; filename: string }> {
    const claim = await this.reimbursementRepository.findById(claimId);
    if (!claim || !claim.receiptPath) {
      throw ApiError.notFound('Receipt file not found.');
    }

    const viewer = await this.authService.getCurrentEmployee(viewerId);
    const isAdmin = viewer.tiers.includes('admin');
    if (claim.employeeId !== viewerId && !isAdmin) {
      throw ApiError.forbidden(
        'You do not have permission to view this receipt.',
      );
    }

    const fullPath = path.resolve(process.cwd(), claim.receiptPath);
    if (!fs.existsSync(fullPath)) {
      throw ApiError.notFound('Receipt file does not exist on server.');
    }

    return {
      fullPath,
      mimeType: claim.receiptMimeType || 'application/octet-stream',
      filename: claim.receiptFilename || path.basename(fullPath),
    };
  }

  async cancelClaim(viewerId: number, claimId: number): Promise<void> {
    const claim = await this.reimbursementRepository.findById(claimId);
    if (!claim) {
      throw ApiError.notFound('Reimbursement claim not found.');
    }
    if (claim.employeeId !== viewerId) {
      throw ApiError.forbidden('You can only cancel your own claims.');
    }
    if (claim.status !== 'Pending') {
      throw ApiError.badRequest(
        'Only pending reimbursement claims can be cancelled.',
      );
    }

    const ok = await this.reimbursementRepository.cancel(claimId, viewerId);
    if (!ok) {
      throw ApiError.badRequest('Could not cancel claim.');
    }
  }

  async getAllForAdmin(
    viewerId: number,
    statusFilter?: string,
  ): Promise<AdminReimbursementsView> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    if (!viewer.tiers.includes('admin')) {
      throw ApiError.forbidden(
        'Only HR or Admins can access reimbursement approvals.',
      );
    }

    const [summary, claims] = await Promise.all([
      this.reimbursementRepository.getCompanySummary(),
      this.reimbursementRepository.findAll(statusFilter),
    ]);

    return { summary, claims };
  }

  async approveClaim(
    viewerId: number,
    claimId: number,
    dto: ApproveReimbursementDto,
  ): Promise<void> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    if (!viewer.tiers.includes('admin')) {
      throw ApiError.forbidden(
        'Only HR or Admins can review and approve reimbursements.',
      );
    }

    const claim = await this.reimbursementRepository.findById(claimId);
    if (!claim) {
      throw ApiError.notFound('Reimbursement claim not found.');
    }
    if (claim.status !== 'Pending') {
      throw ApiError.badRequest(
        `Cannot approve a claim that is currently ${claim.status}.`,
      );
    }

    const approvedAmount = Number(dto.approvedAmount);
    if (isNaN(approvedAmount) || approvedAmount <= 0) {
      throw ApiError.badRequest('Approved amount must be a positive number.');
    }

    await this.reimbursementRepository.updateDecision(claimId, {
      status: 'Approved',
      approvedAmount: Math.round(approvedAmount * 100) / 100,
      rejectionReason: null,
      adminNotes: dto.adminNotes?.trim() || null,
      decidedBy: viewerId,
    });
  }

  async rejectClaim(
    viewerId: number,
    claimId: number,
    dto: RejectReimbursementDto,
  ): Promise<void> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    if (!viewer.tiers.includes('admin')) {
      throw ApiError.forbidden(
        'Only HR or Admins can reject reimbursements.',
      );
    }

    const claim = await this.reimbursementRepository.findById(claimId);
    if (!claim) {
      throw ApiError.notFound('Reimbursement claim not found.');
    }
    if (claim.status !== 'Pending') {
      throw ApiError.badRequest(
        `Cannot reject a claim that is currently ${claim.status}.`,
      );
    }

    const reason = dto.reason?.trim();
    if (!reason) {
      throw ApiError.badRequest(
        'Please provide a rejection reason for the employee.',
      );
    }

    await this.reimbursementRepository.updateDecision(claimId, {
      status: 'Rejected',
      approvedAmount: 0,
      rejectionReason: reason,
      adminNotes: null,
      decidedBy: viewerId,
    });
  }

  async markPaid(
    viewerId: number,
    claimId: number,
    dto: MarkPaidReimbursementDto,
  ): Promise<void> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    if (!viewer.tiers.includes('admin')) {
      throw ApiError.forbidden(
        'Only HR or Admins can mark reimbursements as paid.',
      );
    }

    const claim = await this.reimbursementRepository.findById(claimId);
    if (!claim) {
      throw ApiError.notFound('Reimbursement claim not found.');
    }
    if (claim.status !== 'Approved') {
      throw ApiError.badRequest(
        `Only Approved claims can be marked as Paid (current: ${claim.status}).`,
      );
    }
    if (!dto.paymentDate) {
      throw ApiError.badRequest('Payment date is required.');
    }

    await this.reimbursementRepository.markPaid(claimId, {
      paymentDate: dto.paymentDate,
      paymentReference: dto.paymentReference?.trim() || null,
    });
  }
}
