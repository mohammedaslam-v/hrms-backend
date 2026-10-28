export interface SalarySlipEmployee {
  id: number;
  code: string;
  name: string;
  title: string;
  department: string;
  dateOfJoining: string;
  pan: string;
  uan: string;
  bankAccount: string;
  ifsc: string;
  workState: string;
}

export interface SalarySlipEarnings {
  basic: number;
  hra: number;
  special: number;
  /**
   * Settles months already paid: + arrears (a day given back), − recovery (a
   * day taken back). Included in gross. Zero on most slips.
   */
  arrears: number;
  gross: number;
}

export interface SalarySlipDeductions {
  employeePf: number;
  professionalTax: number;
  tds: number;
  loanEmi: number;
  total: number;
}

export interface SalarySlipEmployer {
  employerPf: number;
  eps: number;
  employerEpf: number;
  pfWage: number;
}

export interface SalarySlipYtd {
  annualCtc: number;
  annualTax: number;
  tdsDeductedTillDate: number;
}

export interface SalarySlip {
  payMonth: string;
  monthLabel: string;
  monthDays: number;
  payableDays: number;
  lopDays: number;
  lopAmount: number;
  /** One day of pay this month — what a LOP day costs, and what arrears are paid at. */
  lopRate: number;
  isContractor: boolean;
  employee: SalarySlipEmployee;
  earnings: SalarySlipEarnings;
  deductions: SalarySlipDeductions;
  netPay: number;
  netPayWords: string;
  employer: SalarySlipEmployer;
  ytd: SalarySlipYtd;
  isFrozen: boolean;
}

export interface AnnualStructureView {
  ctc: number;
  basicAnnual: number;
  basicMonthly: number;
  hraAnnual: number;
  hraMonthly: number;
  specialAnnual: number;
  specialMonthly: number;
  eePfAnnual: number;
  eePfMonthly: number;
  erPfAnnual: number;
  erPfMonthly: number;
  gratuityAnnual: number;
  gratuityMonthly: number;
  grossAnnual: number;
  grossMonthly: number;
  variablePay: number;
  bonus: number;
  annualTax: number;
}

export interface PayslipHistoryItem {
  monthKey: string;
  monthLabel: string;
  netPay: number;
  status: "Paid" | "Generated";
}

export interface EmployeeLoanView {
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
  status: string;
}

export interface CompanyConfig {
  name: string;
  address: string;
  pan: string;
  tan: string;
  fy: string;
  ay: string;
}

export interface MySalaryView {
  slip: SalarySlip | null;
  annualStructure: AnnualStructureView;
  history: PayslipHistoryItem[];
  loan: EmployeeLoanView | null;
  company: CompanyConfig;
}
