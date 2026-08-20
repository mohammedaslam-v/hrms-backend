export type EmployeeStatus = 'active' | 'inactive';

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
