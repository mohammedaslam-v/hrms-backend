import { RequestHandler } from 'express';
import { ILoanService } from './loan.service.interface';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';

export class LoanController {
  constructor(private readonly loanService: ILoanService) {}

  getAdminMeta: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const meta = await this.loanService.getAdminMeta(employeeId);
    res.json({ success: true, data: meta });
  });

  getAdminLoans: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const data = await this.loanService.getAdminLoans(employeeId, status);
    res.json({ success: true, data });
  });

  createLoan: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const loan = await this.loanService.createLoan(employeeId, req.body);
    res.status(201).json({
      success: true,
      data: loan,
      message: `Loan of ₹${loan.principal.toLocaleString('en-IN')} successfully disbursed.`,
    });
  });

  closeLoan: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const loanId = Number(req.params.id);
    if (isNaN(loanId) || loanId <= 0) {
      throw ApiError.badRequest('Invalid loan ID.');
    }
    await this.loanService.closeLoan(employeeId, loanId, req.body);
    res.json({ success: true, message: 'Loan marked as closed successfully.' });
  });

  getEmployeeLoans: RequestHandler = asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    if (isNaN(targetId) || targetId <= 0) {
      throw ApiError.badRequest('Invalid employee ID.');
    }
    const { employeeId, adminId } = req as AuthenticatedRequest;
    const isSelf = employeeId === targetId;
    const isAdmin = Boolean(adminId);

    if (!isSelf && !isAdmin) {
      // Non-admin can only access own record
      throw ApiError.forbidden('You are not authorized to view this employee’s loans.');
    }

    const data = await this.loanService.getEmployeeLoans(targetId);
    res.json({ success: true, data });
  });

  getMyLoans: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const data = await this.loanService.getMyLoans(employeeId);
    res.json({ success: true, data });
  });
}
