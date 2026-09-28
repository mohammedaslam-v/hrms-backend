import { Pool, RowDataPacket } from "mysql2/promise";
import { EmployeeTaxMeta } from "./tax.model";
import { ITaxRepository } from "./tax.repository.interface";

interface EmpRow extends RowDataPacket {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  pan: string | null;
  date_of_joining: string;
  employment_type: string | null;
}

interface TdsSumRow extends RowDataPacket {
  total_tds: number | string;
}

export class TaxRepository implements ITaxRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * How a row becomes an EmployeeTaxMeta.
   *
   * Extracted so the single read and the company-wide read cannot disagree
   * about who counts as a contractor — which decides whether their CTC is
   * split into basic/HRA/special or taxed whole.
   */
  private static toMeta(r: EmpRow): EmployeeTaxMeta {
    const isContractor =
      (r.employment_type || "").toLowerCase().includes("contract") ||
      (r.designation || "").toLowerCase().includes("contract") ||
      (r.department || "").toLowerCase().includes("contract");

    return {
      id: r.id,
      code: r.employee_code,
      name: r.full_name,
      title: r.designation || "Associate",
      department: r.department || "General",
      pan: r.pan || "PENDING",
      dateOfJoining: r.date_of_joining,
      isContractor,
    };
  }

  async findEmployeeMeta(employeeId: number): Promise<EmployeeTaxMeta | null> {
    const [rows] = await this.pool.execute<EmpRow[]>(
      `SELECT id, employee_code, full_name, designation, department,
              pan, date_of_joining, employment_type
         FROM hrms_employees
        WHERE id = ?`,
      [employeeId],
    );
    const r = rows[0];
    return r ? TaxRepository.toMeta(r) : null;
  }

  /**
   * Everyone the register covers: on the payroll today, still with us.
   *
   * Leavers are excluded — their TDS belongs to the quarter they left in, not
   * to a register of who is currently employed.
   */
  async findAllEmployeeMeta(): Promise<EmployeeTaxMeta[]> {
    const [rows] = await this.pool.query<EmpRow[]>(
      `SELECT id, employee_code, full_name, designation, department,
              pan, date_of_joining, employment_type
         FROM hrms_employees
        WHERE date_of_leaving IS NULL OR date_of_leaving >= CURDATE()
        ORDER BY full_name ASC`,
    );
    return rows.map(TaxRepository.toMeta);
  }

  async findYtdTdsDeductedFor(
    employeeIds: number[],
    fyStartMonth: string,
    fyEndMonth: string,
  ): Promise<Map<number, number>> {
    const byEmployee = new Map<number, number>();
    if (employeeIds.length === 0) return byEmployee;

    // The ids come from findAllEmployeeMeta — database integers, never user
    // input — and each is coerced before it reaches the string. `?` cannot bind
    // a list in mysql2.
    const ids = employeeIds.map((id) => Number(id)).filter(Number.isInteger).join(",");

    const [rows] = await this.pool.query<(TdsSumRow & { employee_id: number })[]>(
      `SELECT employee_id, COALESCE(SUM(tds), 0) AS total_tds
         FROM hrms_payslips
        WHERE pay_month >= ? AND pay_month <= ?
          AND employee_id IN (${ids})
        GROUP BY employee_id`,
      [fyStartMonth, fyEndMonth],
    );

    for (const row of rows) byEmployee.set(row.employee_id, Number(row.total_tds));
    return byEmployee;
  }

  async findYtdTdsDeducted(
    employeeId: number,
    fyStartMonth: string,
    fyEndMonth: string,
  ): Promise<number> {
    const [rows] = await this.pool.execute<TdsSumRow[]>(
      `SELECT COALESCE(SUM(tds), 0) AS total_tds
         FROM hrms_payslips
        WHERE employee_id = ?
          AND pay_month >= ?
          AND pay_month <= ?`,
      [employeeId, fyStartMonth, fyEndMonth],
    );
    return rows[0] ? Number(rows[0].total_tds) : 0;
  }
}
