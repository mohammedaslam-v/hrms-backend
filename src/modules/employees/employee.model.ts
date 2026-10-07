import type { SalaryComponents } from '../salary/salary.domain';
export type EmployeeStatus = 'active' | 'inactive';
export type WorkMode = 'WFH' | 'WFO' | 'Hybrid';
export type HrmsRole = 'employee' | 'admin';

export interface Employee {
  id: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  department: string | null;
  designation: string | null;
  dateOfJoining: string;
  status: EmployeeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeeDto {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  department: string | null;
  designation: string | null;
  dateOfJoining: string;
  status: EmployeeStatus;
}

export interface UpdateEmployeeDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  department?: string | null;
  designation?: string | null;
  dateOfJoining?: string;
  status?: EmployeeStatus;
}

export interface CreateEmployeeRequestDto {
  fullName: string;
  employeeCode?: string;
  title?: string;
  department?: string;
  managerId?: number | null;
  dateOfJoining: string;
  dateOfLeaving?: string | null;
  dateOfBirth?: string | null;
  workEmail: string;
  phone?: string | null;
  pan?: string | null;
  uan?: string | null;
  workState?: string;
  openingLeave?: number;
  employmentType?: string;
  hrmsRole?: HrmsRole;

  ctc: number;
  variablePay?: number;
  bonus?: number;
  esopUnits?: number;
  esopVesting?: string;
  /**
   * Monthly components as shown on the form, when HR has them saved with the
   * employee. Absent means payroll derives them from the CTC.
   */
  components?: SalaryComponents;

  workMode?: WorkMode;
  shiftStart?: string;
  shiftEnd?: string;
  weeklyOff?: string[];
}

export interface CreateEmployeeResult {
  employeeId: number;
  adminId: number;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  /** Null when an existing portal login was linked — no new password issued. */
  temporaryPassword: string | null;
  /**
   * True when the person already had a live `admins` account (typically made
   * in the old admin portal) and only the HRMS record was created for it.
   */
  linkedExistingAccount: boolean;
}

export interface ManagerOption {
  id: number;
  name: string;
  employeeCode: string;
  department: string | null;
  designation: string | null;
}

export interface EmployeeMetaDto {
  departments: string[];
  managers: ManagerOption[];
  workStates: string[];
  workModes: string[];
  esopVestingOptions: string[];
}
