export interface SlabBreakupRow {
  from: number;
  to: number | null;
  rate: number;
  amount: number;
  tax: number;
}

export interface SurchargeInfo {
  rate: number;
  amount: number;
  relief: number;
}

export interface TaxComputationView {
  basicAnnual: number;
  hraAnnual: number;
  specialAnnual: number;
  variablePay: number;
  bonus: number;
  grossSalary: number;
  stdDeduction: number;
  npsDeduction: number;
  taxableIncome: number;
  slabTax: number;
  rebate87A: number;
  marginalRelief87A: number;
  surchargeRate: number;
  surchargeAmount: number;
  surchargeRelief: number;
  cessRate: number;
  cessAmount: number;
  totalTax: number;
  monthlyTds: number;
  effectiveTaxRate: number;
}

export interface TdsScheduleView {
  monthsElapsed: number;
  totalMonths: number;
  deductedTillDate: number;
  remainingThisFy: number;
  percentageDeducted: number;
  explanationNote: string;
}

export interface EmployeeTaxMeta {
  id: number;
  code: string;
  name: string;
  title: string;
  department: string;
  pan: string;
  dateOfJoining: string;
  isContractor: boolean;
}

export interface MyTaxResponse {
  employee: EmployeeTaxMeta;
  computation: TaxComputationView;
  slabRows: SlabBreakupRow[];
  schedule: TdsScheduleView;
  company: {
    name: string;
    address: string;
    pan: string;
    tan: string;
    fy: string;
    ay: string;
  };
}

/**
 * One line of the Company TDS register — the basis of the quarterly Form 24Q.
 *
 * Every figure is the same one the employee sees on My tax, produced by the
 * same domain functions. Two places showing a different tax for one person is
 * the failure this page exists to avoid.
 */
export interface TaxRegisterRow {
  employeeId: number;
  code: string;
  name: string;
  department: string;
  pan: string;
  grossSalary: number;
  stdDeduction: number;
  taxableIncome: number;
  slabTax: number;
  rebate87A: number;
  cessAmount: number;
  totalTax: number;
  monthlyTds: number;
  /** Actually deducted so far this financial year, from frozen payslips. */
  deductedTillDate: number;
}

export interface TaxRegisterTotals {
  people: number;
  grossSalary: number;
  taxableIncome: number;
  totalTax: number;
  monthlyTds: number;
  deductedTillDate: number;
}

export interface TaxRegisterResponse {
  rows: TaxRegisterRow[];
  totals: TaxRegisterTotals;
  /** Every department present, for the filter. Sorted, no blanks. */
  departments: string[];
  company: {
    name: string;
    address: string;
    pan: string;
    tan: string;
    fy: string;
    ay: string;
  };
  /**
   * True when no payslip has ever been frozen, so "Deducted YTD" is zero for
   * everybody. Shown as a notice rather than left to look like nobody has paid
   * any tax.
   */
  noPayslipsYet: boolean;
}
