import { IPayrollService } from './payroll.service.interface';
import { IPayrollRepository } from './payroll.repository.interface';
import { ISalaryService } from '../salary/salary.service.interface';
import {
  PayrollMonthView,
  PayrollEmployeeItem,
  PayrollKpis,
} from './payroll.model';
import { PayoutStatus } from '../payout/payout.model';

export class PayrollService implements IPayrollService {
  constructor(
    private readonly payrollRepository: IPayrollRepository,
    private readonly salaryService: ISalaryService,
  ) {}

  async getPayrollMonthView(
    adminId: number,
    monthKey?: string,
  ): Promise<PayrollMonthView> {
    // 1. Determine target month (default: previous calendar month)
    let targetMonth = monthKey;
    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const y = prev.getFullYear();
      const m = String(prev.getMonth() + 1).padStart(2, '0');
      targetMonth = `${y}-${m}`;
    }

    const [yearNum, monthNum] = targetMonth.split('-').map(Number);
    const lastDayNum = new Date(yearNum, monthNum, 0).getDate();
    const startDate = `${targetMonth}-01`;
    const endDate = `${targetMonth}-${String(lastDayNum).padStart(2, '0')}`;
    const monthDate = startDate;

    const monthLabel = new Date(yearNum, monthNum - 1, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    // 2. Fetch active employees & payout records map
    const activeEmployees = await this.payrollRepository.findActiveEmployeesForMonth(
      startDate,
      endDate,
    );
    const payoutsMap = await this.payrollRepository.findPayoutsMapForMonth(monthDate);

    // 3. Process each employee through salary engine
    const employees: PayrollEmployeeItem[] = [];
    let grossPayout = 0;
    let netDisbursement = 0;
    let disbursedAmount = 0;
    let pfRemittance = 0;
    let tdsDeposit = 0;

    for (const emp of activeEmployees) {
      try {
        const salaryView = await this.salaryService.getMySalary(
          adminId,
          emp.id,
          targetMonth,
        );

        if (!salaryView || !salaryView.slip) continue;

        const slip = salaryView.slip;
        const payoutInfo = payoutsMap.get(emp.id);

        let payoutStatus: PayoutStatus | 'not_pushed' = 'not_pushed';
        if (payoutInfo) {
          payoutStatus = payoutInfo.status as PayoutStatus;
        }

        const item: PayrollEmployeeItem = {
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          fullName: emp.fullName,
          designation: emp.designation,
          department: emp.department,
          employmentType: emp.employmentType,
          workState: emp.workState,
          dateOfJoining: emp.dateOfJoining,
          bankName: emp.bankName,
          accountNo: emp.accountNo,
          ifscCode: emp.ifscCode,
          basic: slip.earnings.basic,
          hra: slip.earnings.hra,
          special: slip.earnings.special,
          gross: slip.earnings.gross,
          lopDays: slip.lopDays,
          lopAmount: slip.lopAmount,
          employeePf: slip.deductions.employeePf,
          professionalTax: slip.deductions.professionalTax,
          tds: slip.deductions.tds,
          loanEmi: slip.deductions.loanEmi,
          totalDeductions: slip.deductions.total,
          netPay: slip.netPay,
          employerPf: slip.employer.employerPf,
          payoutId: payoutInfo?.id,
          razorpayPayoutId: payoutInfo?.razorpayPayoutId,
          payoutStatus,
          utr: payoutInfo?.utr,
          failureReason: payoutInfo?.failureReason,
        };

        employees.push(item);

        grossPayout += slip.earnings.gross;
        netDisbursement += slip.netPay;
        if (payoutStatus === 'processed') {
          disbursedAmount += slip.netPay;
        }
        pfRemittance += slip.deductions.employeePf + slip.employer.employerPf;
        tdsDeposit += slip.deductions.tds;
      } catch {
        // Skip individual errors so overall payroll view doesn't crash
      }
    }

    const pendingDisbursement = Math.max(0, netDisbursement - disbursedAmount);

    const kpis: PayrollKpis = {
      onPayroll: employees.length,
      grossPayout: Math.round(grossPayout),
      netDisbursement: Math.round(netDisbursement),
      disbursedAmount: Math.round(disbursedAmount),
      pendingDisbursement: Math.round(pendingDisbursement),
      pfRemittance: Math.round(pfRemittance),
      tdsDeposit: Math.round(tdsDeposit),
    };

    // 4. Build available months list (past 12 months)
    const availableMonths: { monthKey: string; monthDate: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yStr = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, '0');
      const key = `${yStr}-${mStr}`;
      const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      availableMonths.push({
        monthKey: key,
        monthDate: `${key}-01`,
        label,
      });
    }

    return {
      month: monthDate,
      monthKey: targetMonth,
      monthLabel,
      lastCalculatedAt: new Date().toISOString(),
      kpis,
      employees,
      availableMonths,
    };
  }
}
