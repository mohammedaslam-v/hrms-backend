import { Request, Response, NextFunction } from 'express';
import { IPayrollService } from './payroll.service.interface';

export class PayrollController {
  constructor(private readonly payrollService: IPayrollService) {}

  getPayrollView = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const adminId = (req as any).user?.id || (req as any).user?.employeeId;
      const rawMonth = (req.query.month as string) || undefined;
      const monthKey = rawMonth?.includes('-') ? rawMonth.slice(0, 7) : undefined;

      const result = await this.payrollService.getPayrollMonthView(
        adminId,
        monthKey
      );

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };

  calculatePayroll = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const adminId = (req as any).user?.id || (req as any).user?.employeeId;
      const rawMonth = (req.body?.month as string) || undefined;
      const monthKey = rawMonth?.includes('-') ? rawMonth.slice(0, 7) : undefined;

      const result = await this.payrollService.getPayrollMonthView(
        adminId,
        monthKey
      );

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };
}
