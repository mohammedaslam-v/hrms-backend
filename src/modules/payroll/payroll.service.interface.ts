import { PayrollMonthView } from './payroll.model';

export interface IPayrollService {
  getPayrollMonthView(
    adminId: number,
    monthKey?: string,
  ): Promise<PayrollMonthView>;
}
