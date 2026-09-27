import { ILoanRepository } from './loan.repository.interface';
import { ILoanService } from './loan.service.interface';
import {
  AdminLoansView,
  AllowedStartMonth,
  CloseLoanPayload,
  CreateLoanPayload,
  EmployeeLoan,
  EmployeeLoanScheduleView,
  EmployeeLoansView,
  LoanMetaDto,
  LoanRepaymentScheduleItem,
} from './loan.model';
import { IAuthService } from '../auth/auth.service.interface';
import { ApiError } from '../../utils/api-error';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const FULL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatMonthShort(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return monthKey;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function calculateNextMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

function addMonths(startMonthKey: string, monthsToAdd: number): string {
  const [y, m] = startMonthKey.split('-').map(Number);
  const totalM = m + monthsToAdd;
  const resYear = y + Math.floor((totalM - 1) / 12);
  const resMonth = ((totalM - 1) % 12) + 1;
  return `${resYear}-${String(resMonth).padStart(2, '0')}`;
}

export class LoanService implements ILoanService {
  constructor(
    private readonly loanRepository: ILoanRepository,
    private readonly authService: IAuthService,
  ) {}

  private async assertAdmin(viewerId: number): Promise<void> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    if (!viewer.tiers.includes('admin')) {
      throw ApiError.forbidden('Only administrators can manage company loans.');
    }
  }

  async getAdminMeta(viewerId: number): Promise<LoanMetaDto> {
    await this.assertAdmin(viewerId);

    const employees = await this.loanRepository.findActiveEmployeesWithLoanStatus();

    const now = new Date();
    const currYear = now.getFullYear();
    const currMonth = now.getMonth() + 1;
    const currentMonthKey = `${currYear}-${String(currMonth).padStart(2, '0')}`;
    const nextMonthKey = calculateNextMonthKey(currentMonthKey);

    const nextMonthPayout = calculateNextMonthKey(currentMonthKey);
    const [, nextPoutM] = nextMonthPayout.split('-').map(Number);
    const payoutMonth1Name = MONTH_NAMES[nextPoutM - 1];

    const graceMonthPayout = calculateNextMonthKey(nextMonthKey);
    const [, gracePoutM] = graceMonthPayout.split('-').map(Number);
    const payoutMonth2Name = MONTH_NAMES[gracePoutM - 1];

    const allowedStartMonths: AllowedStartMonth[] = [
      {
        monthKey: currentMonthKey,
        label: `${FULL_MONTH_NAMES[currMonth - 1]} ${currYear} (Deducted in ${payoutMonth1Name} payout — Immediate)`,
        isImmediate: true,
      },
      {
        monthKey: nextMonthKey,
        label: `${formatMonthShort(nextMonthKey)} (Deducted in ${payoutMonth2Name} payout — 1 Month Grace)`,
        isImmediate: false,
      },
    ];

    return {
      employees,
      allowedStartMonths,
      maxTenureMonths: 6,
      defaultInterestRate: 0.0,
    };
  }

  async getAdminLoans(viewerId: number, statusFilter?: string): Promise<AdminLoansView> {
    await this.assertAdmin(viewerId);

    const loans = await this.loanRepository.findAdminLoans(statusFilter);

    const activeLoans = loans.filter((l) => l.status === 'active');
    const summary = {
      activeLoansCount: activeLoans.length,
      totalDisbursed: activeLoans.reduce((acc, l) => acc + l.principal, 0),
      monthlyRecovery: activeLoans.reduce((acc, l) => acc + l.emi, 0),
      totalOutstanding: activeLoans.reduce((acc, l) => acc + l.outstandingAmount, 0),
    };

    return {
      summary,
      loans,
    };
  }

  async createLoan(adminId: number, payload: CreateLoanPayload): Promise<EmployeeLoan> {
    await this.assertAdmin(adminId);

    if (!payload.employeeId || payload.employeeId <= 0) {
      throw ApiError.badRequest('A valid employee must be selected.');
    }

    const principal = Math.round(Number(payload.principal));
    if (isNaN(principal) || principal <= 0) {
      throw ApiError.badRequest('Loan amount (principal) must be a positive integer.');
    }

    const tenure = Math.round(Number(payload.tenureMonths));
    if (isNaN(tenure) || tenure < 1 || tenure > 6) {
      throw ApiError.badRequest('Loan repayment tenure must be between 1 and 6 months.');
    }

    if (!payload.startMonth || !/^\d{4}-\d{2}$/.test(payload.startMonth)) {
      throw ApiError.badRequest('Valid start EMI month (YYYY-MM) is required.');
    }

    // Verify start month is either current month or max 1 month future
    const now = new Date();
    const currYear = now.getFullYear();
    const currMonth = now.getMonth() + 1;
    const currentMonthKey = `${currYear}-${String(currMonth).padStart(2, '0')}`;
    const nextMonthKey = calculateNextMonthKey(currentMonthKey);

    if (payload.startMonth !== currentMonthKey && payload.startMonth !== nextMonthKey) {
      throw ApiError.badRequest(
        `Start EMI date must be either the current month (${currentMonthKey}) or next month (${nextMonthKey}). Maximum allowed future deferral is 1 month.`,
      );
    }

    // Note: Multiple concurrent loans are allowed per employee

    // Flat 0% interest EMI calculation
    const emi = Math.ceil(principal / tenure);

    const purpose = payload.purpose && payload.purpose.trim().length > 0
      ? payload.purpose.trim()
      : 'Company salary advance';

    return this.loanRepository.createLoan(
      {
        employeeId: payload.employeeId,
        purpose,
        principal,
        tenureMonths: tenure,
        startMonth: payload.startMonth,
      },
      adminId,
      emi,
    );
  }

  async closeLoan(adminId: number, loanId: number, payload: CloseLoanPayload): Promise<void> {
    await this.assertAdmin(adminId);

    const loan = await this.loanRepository.findById(loanId);
    if (!loan) {
      throw ApiError.notFound(`Loan with id ${loanId} not found.`);
    }

    if (loan.status === 'closed') {
      throw ApiError.badRequest('Loan is already closed.');
    }

    const reason = payload.reason && payload.reason.trim().length > 0
      ? payload.reason.trim()
      : 'Manually marked as closed by administrator';

    await this.loanRepository.closeLoan(loanId, adminId, reason);
  }

  async getEmployeeLoans(employeeId: number): Promise<EmployeeLoansView> {
    await this.loanRepository.autoCloseCompletedLoans();
    const allLoans = await this.loanRepository.findByEmployeeId(employeeId);

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const generateRepaymentSchedule = (loan: EmployeeLoan): LoanRepaymentScheduleItem[] => {
      const schedule: LoanRepaymentScheduleItem[] = [];
      const closedMonthKey = loan.closedAt ? loan.closedAt.slice(0, 7) : null;

      for (let i = 0; i < loan.tenureMonths; i++) {
        const monthKey = addMonths(loan.startMonth, i);
        let status: 'deducted' | 'upcoming' | 'settled' = 'upcoming';

        if (loan.status === 'closed') {
          if (closedMonthKey && monthKey > closedMonthKey) {
            status = 'settled';
          } else {
            status = 'deducted';
          }
        } else if (monthKey <= currentMonthKey) {
          status = 'deducted';
        } else {
          status = 'upcoming';
        }

        schedule.push({
          monthKey,
          monthLabel: formatMonthShort(monthKey),
          emi: loan.emi,
          status,
        });
      }
      return schedule;
    };

    const mapScheduleView = (loan: EmployeeLoan): EmployeeLoanScheduleView => {
      const schedule = generateRepaymentSchedule(loan);
      const paidMonths = schedule.filter((s: LoanRepaymentScheduleItem) => s.status === 'deducted').length;
      const repaidAmount = Math.min(loan.principal, paidMonths * loan.emi);
      const outstandingAmount = loan.status === 'closed' ? 0 : Math.max(0, loan.principal - repaidAmount);
      const finalMonthKey = addMonths(loan.startMonth, loan.tenureMonths - 1);

      return {
        id: loan.id,
        purpose: loan.purpose,
        principal: loan.principal,
        emi: loan.emi,
        interestRate: loan.interestRate,
        startMonth: loan.startMonth,
        tenureMonths: loan.tenureMonths,
        paidMonths,
        repaidAmount,
        outstandingAmount,
        finalMonth: formatMonthShort(finalMonthKey),
        status: loan.status,
        closedAt: loan.closedAt,
        closedReason: loan.closedReason,
        schedule,
      };
    };

    const activeDbLoans = allLoans.filter((l) => l.status === 'active');
    const closedDbLoans = allLoans.filter((l) => l.status !== 'active');

    return {
      activeLoan: activeDbLoans[0] ? mapScheduleView(activeDbLoans[0]) : null,
      activeLoans: activeDbLoans.map(mapScheduleView),
      history: closedDbLoans.map(mapScheduleView),
    };
  }

  async getMyLoans(employeeId: number): Promise<EmployeeLoansView> {
    return this.getEmployeeLoans(employeeId);
  }
}
