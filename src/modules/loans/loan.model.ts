export type LoanStatus = 'active' | 'closed' | 'cancelled';

export interface LoanRepaymentScheduleItem {
  monthKey: string;
  monthLabel: string;
  emi: number;
  status: 'deducted' | 'upcoming' | 'settled';
}

export interface EmployeeLoan {
  id: number;
  employeeId: number;
  purpose: string;
  principal: number;
  emi: number;
  interestRate: number;
  startMonth: string;
  tenureMonths: number;
  status: LoanStatus;
  closedAt: string | null;
  closedBy: number | null;
  closedReason: string | null;
  createdBy: number | null;
  createdAt: string;
}

export interface AdminLoanItem {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  department: string | null;
  designation: string | null;
  purpose: string;
  principal: number;
  emi: number;
  interestRate: number;
  startMonth: string;
  tenureMonths: number;
  paidMonths: number;
  repaidAmount: number;
  outstandingAmount: number;
  finalMonth: string;
  status: LoanStatus;
  closedAt: string | null;
  closedReason: string | null;
  createdAt: string;
}

export interface AdminLoanSummary {
  activeLoansCount: number;
  totalDisbursed: number;
  monthlyRecovery: number;
  totalOutstanding: number;
}

export interface AdminLoansView {
  summary: AdminLoanSummary;
  loans: AdminLoanItem[];
}

export interface EmployeeLoanScheduleView {
  id: number;
  purpose: string;
  principal: number;
  emi: number;
  interestRate: number;
  startMonth: string;
  tenureMonths: number;
  paidMonths: number;
  repaidAmount: number;
  outstandingAmount: number;
  finalMonth: string;
  status: LoanStatus;
  closedAt: string | null;
  closedReason: string | null;
  schedule: LoanRepaymentScheduleItem[];
}

export interface EmployeeLoansView {
  activeLoan: EmployeeLoanScheduleView | null;
  activeLoans: EmployeeLoanScheduleView[];
  history: EmployeeLoanScheduleView[];
}

export interface AllowedStartMonth {
  monthKey: string;
  label: string;
  isImmediate: boolean;
}

export interface EligibleEmployee {
  id: number;
  name: string;
  employeeCode: string;
  department: string | null;
  activeLoansCount: number;
  hasActiveLoan: boolean;
  activeLoanId?: number;
}

export interface LoanMetaDto {
  employees: EligibleEmployee[];
  allowedStartMonths: AllowedStartMonth[];
  maxTenureMonths: number;
  defaultInterestRate: number;
}

export interface CreateLoanPayload {
  employeeId: number;
  purpose: string;
  principal: number;
  tenureMonths: number;
  startMonth: string;
}

export interface CloseLoanPayload {
  reason?: string;
}
