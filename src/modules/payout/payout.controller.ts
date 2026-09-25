import { Request, Response, NextFunction } from 'express';
import { IPayoutService } from './payout.service.interface';
import { ApiError } from '../../utils/api-error';

export class PayoutController {
  constructor(private readonly payoutService: IPayoutService) {}

  pushSalaryPayouts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const adminId = (req as any).user?.id || (req as any).user?.employeeId;
      const { month, employeeIds, mode } = req.body;

      if (!month || !Array.isArray(employeeIds) || employeeIds.length === 0) {
        throw ApiError.badRequest('month (YYYY-MM-01) and non-empty employeeIds array are required.');
      }

      const result = await this.payoutService.pushSalaryPayouts(
        { month, employeeIds, mode },
        adminId
      );

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  pushSingleSalary = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const adminId = (req as any).user?.id || (req as any).user?.employeeId;
      const { employeeId, month, mode } = req.body;

      if (!employeeId || !month) {
        throw ApiError.badRequest('employeeId and month (YYYY-MM-01) are required.');
      }

      const result = await this.payoutService.pushSingleSalaryPayout(
        Number(employeeId),
        String(month),
        adminId,
        mode
      );

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  pushLoanDisbursement = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const adminId = (req as any).user?.id || (req as any).user?.employeeId;
      const { loanId, mode } = req.body;

      if (!loanId) {
        throw ApiError.badRequest('loanId is required.');
      }

      const result = await this.payoutService.pushLoanDisbursement(
        Number(loanId),
        adminId,
        mode
      );

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  importCsv = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { csvContent } = req.body;
      if (!csvContent || typeof csvContent !== 'string') {
        throw ApiError.badRequest('csvContent string is required.');
      }

      const result = await this.payoutService.reconcileFromCsv(csvContent);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  handleWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const event = req.body?.event || 'payout.updated';
      const payload = req.body?.payload || req.body;

      const result = await this.payoutService.processWebhook(event, payload);
      res.status(200).json({ success: true, result });
    } catch (err) {
      next(err);
    }
  };

  updateBankDetails = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { employeeId, bankName, accountNo, ifscCode } = req.body;
      if (!employeeId || !bankName || !accountNo || !ifscCode) {
        throw ApiError.badRequest('employeeId, bankName, accountNo, and ifscCode are required.');
      }

      await this.payoutService.updateEmployeeBankDetails(
        Number(employeeId),
        String(bankName),
        String(accountNo),
        String(ifscCode)
      );

      res.status(200).json({ success: true, message: 'Bank details updated successfully.' });
    } catch (err) {
      next(err);
    }
  };
}
