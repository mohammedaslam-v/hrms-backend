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
  temporaryPassword: string;
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
