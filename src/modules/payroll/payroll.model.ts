import { PayoutStatus } from '../payout/payout.model';

export interface PayrollEmployeeItem {
  employeeId: number;
  employeeCode: string;
  fullName: string;
  designation: string;
  department: string;
  employmentType: string;
  workState: string;
  dateOfJoining: string;
  bankName: string | null;
  accountNo: string | null;
  ifscCode: string | null;
  basic: number;
  hra: number;
  special: number;
  gross: number;
  lopDays: number;
  lopAmount: number;
  employeePf: number;
  professionalTax: number;
  tds: number;
  loanEmi: number;
  totalDeductions: number;
  netPay: number;
  employerPf: number;
  payoutId?: number;
  razorpayPayoutId?: string | null;
  payoutStatus: PayoutStatus | 'not_pushed';
  utr?: string | null;
  failureReason?: string | null;
}

export interface PayrollKpis {
  onPayroll: number;
  grossPayout: number;
  netDisbursement: number;
  disbursedAmount: number;
  pendingDisbursement: number;
  pfRemittance: number;
  tdsDeposit: number;
}

export interface PayrollMonthView {
  month: string; // YYYY-MM-01
  monthKey: string; // YYYY-MM
  monthLabel: string;
  lastCalculatedAt: string;
  kpis: PayrollKpis;
  employees: PayrollEmployeeItem[];
  availableMonths: { monthKey: string; monthDate: string; label: string }[];
}
