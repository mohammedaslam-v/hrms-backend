import {
  AdminLoanItem,
  CreateLoanPayload,
  EligibleEmployee,
  EmployeeLoan,
} from './loan.model';

export interface ILoanRepository {
  findAdminLoans(statusFilter?: string): Promise<AdminLoanItem[]>;
  findActiveEmployeesWithLoanStatus(): Promise<EligibleEmployee[]>;
  findActiveByEmployeeId(employeeId: number): Promise<EmployeeLoan | null>;
  findById(id: number): Promise<EmployeeLoan | null>;
  findByEmployeeId(employeeId: number): Promise<EmployeeLoan[]>;
  createLoan(
    dto: CreateLoanPayload,
    createdBy: number,
    emi: number,
  ): Promise<EmployeeLoan>;
  closeLoan(id: number, closedBy: number, reason: string): Promise<void>;
  autoCloseCompletedLoans(): Promise<number>;
}
