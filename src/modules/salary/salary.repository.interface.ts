
export interface FrozenPayslipRow {
  id: number;
  payroll_run_id: number;
  employee_id: number;
  pay_month: string;
  month_days: number;
  payable_days: string | number;
  lop_days: string | number;
  basic: number;
  hra: number;
  special_allowance: number;
  gross: number;
  pf_wage: number;
  employee_pf: number;
  employer_pf: number;
  eps: number;
  employer_epf: number;
  professional_tax: number;
  tds: number;
  loan_emi: number;
  total_deductions: number;
  net_pay: number;
  computation: string;
}

export interface LoanRow {
  id: number;
  employee_id: number;
  purpose: string;
  principal: number;
  emi: number;
  interest_rate: string | number;
  start_month: string;
  tenure_months: number;
  status: string;
}

export interface EmployeeSalaryMeta {
  id: number;
  code: string;
  name: string;
  title: string;
  department: string;
  dateOfJoining: string;
  dateOfLeaving: string | null;
  pan: string;
  uan: string;
  bankAccount: string;
  workState: string;
  isContractor: boolean;
}

export interface ISalaryRepository {
  findEmployeeMeta(employeeId: number): Promise<EmployeeSalaryMeta | null>;
  findFrozenPayslip(employeeId: number, payMonth: string): Promise<FrozenPayslipRow | null>;
  findFrozenHistory(employeeId: number): Promise<FrozenPayslipRow[]>;
  findActiveLoan(employeeId: number): Promise<LoanRow | null>;
  findActiveLoans(employeeId: number): Promise<LoanRow[]>;
  findApprovedLopDays(employeeId: number, payMonth: string): Promise<number>;
}
