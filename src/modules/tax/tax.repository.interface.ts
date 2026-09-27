import { EmployeeTaxMeta } from "./tax.model";

export interface ITaxRepository {
  findEmployeeMeta(employeeId: number): Promise<EmployeeTaxMeta | null>;
  findYtdTdsDeducted(employeeId: number, fyStartMonth: string, fyEndMonth: string): Promise<number>;
}
