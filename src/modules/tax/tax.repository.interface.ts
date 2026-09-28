import { EmployeeTaxMeta } from "./tax.model";

export interface ITaxRepository {
  findEmployeeMeta(employeeId: number): Promise<EmployeeTaxMeta | null>;
  findYtdTdsDeducted(employeeId: number, fyStartMonth: string, fyEndMonth: string): Promise<number>;

  /**
   * The same two reads for a whole company at once.
   *
   * The register covers every employee; calling the single-employee versions in
   * a loop would be two queries per person. Anyone missing from a map simply
   * has no row — never an error.
   */
  findAllEmployeeMeta(): Promise<EmployeeTaxMeta[]>;
  findYtdTdsDeductedFor(
    employeeIds: number[],
    fyStartMonth: string,
    fyEndMonth: string,
  ): Promise<Map<number, number>>;
}
