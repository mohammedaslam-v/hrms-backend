export interface PayrollEmployeeDbRow {
  id: number;
  employeeCode: string;
  fullName: string;
  designation: string;
  department: string;
  employmentType: string;
  workState: string;
  dateOfJoining: string;
  dateOfLeaving: string | null;
  bankName: string | null;
  accountNo: string | null;
  ifscCode: string | null;
}

export interface PayrollPayoutDbInfo {
  id: number;
  razorpayPayoutId: string | null;
  status: string;
  utr: string | null;
  failureReason: string | null;
}

export interface IPayrollRepository {
  findActiveEmployeesForMonth(
    startDate: string,
    endDate: string,
  ): Promise<PayrollEmployeeDbRow[]>;
  findPayoutsMapForMonth(
    monthDate: string,
  ): Promise<Map<number, PayrollPayoutDbInfo>>;
}
