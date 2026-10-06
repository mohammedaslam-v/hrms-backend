
export interface RawEmployeeRow {
  id: number;
  employee_code: string;
  full_name: string;
  work_email: string;
  phone: string | null;
  designation: string | null;
  department: string | null;
  date_of_joining: string;
  date_of_leaving: string | null;
  gender?: string | null;
  confirmation_date?: string | null;
  total_experience?: string | null;
  employment_type?: string | null;
  /** WFO, WFH or Hybrid. */
  work_mode?: string | null;
  work_state?: string | null;
  pan?: string | null;
  uan?: string | null;
  pf_number?: string | null;
  date_of_birth?: string | null;
  bank_name?: string | null;
  account_no?: string | null;
  ifsc_code?: string | null;
  manager_id?: number | null;
  manager_code?: string | null;
  manager_name?: string | null;
  is_notice_serving?: number | null;
  last_working_day?: string | null;
  resignation_date?: string | null;
  resignation_reason?: string | null;
  status?: string | null;
}

export interface RawLoanRow {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  department: string | null;
  work_state: string | null;
  date_of_joining: string;
  principal: number;
  emi: number;
  tenure_months: number;
  start_month: string;
  status: string;
  purpose: string;
  disbursed_at: string | null;
}

export interface RawCompensationRevision {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  date_of_joining: string;
  effective_from: string;
  ctc: number;
  variable_pay: number;
  bonus: number;
  revision_note: string | null;
  created_at: string;
}

export interface IReportsRepository {
  findActiveEmployees(department?: string): Promise<RawEmployeeRow[]>;
  findAllEmployees(): Promise<RawEmployeeRow[]>;
  findLoans(): Promise<RawLoanRow[]>;
  findRecentJoinees(from: string, to: string, department?: string): Promise<RawEmployeeRow[]>;
  findRecentResignees(from: string, to: string, department?: string): Promise<RawEmployeeRow[]>;
  findCompensationHistory(): Promise<RawCompensationRevision[]>;
  hasColumn(tableName: string, columnName: string): Promise<boolean>;
}
