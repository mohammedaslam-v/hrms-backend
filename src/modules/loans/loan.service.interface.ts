import {
  AdminLoansView,
  CloseLoanPayload,
  CreateLoanPayload,
  EmployeeLoan,
  EmployeeLoansView,
  LoanMetaDto,
} from './loan.model';

export interface ILoanService {
  getAdminMeta(viewerId: number): Promise<LoanMetaDto>;
  getAdminLoans(viewerId: number, statusFilter?: string): Promise<AdminLoansView>;
  createLoan(adminId: number, payload: CreateLoanPayload): Promise<EmployeeLoan>;
  closeLoan(adminId: number, loanId: number, payload: CloseLoanPayload): Promise<void>;
  getMyLoans(employeeId: number): Promise<EmployeeLoansView>;
  getEmployeeLoans(employeeId: number): Promise<EmployeeLoansView>;
}
