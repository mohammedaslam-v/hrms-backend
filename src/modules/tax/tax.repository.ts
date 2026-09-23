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

  async findEmployeeMeta(employeeId: number): Promise<EmployeeTaxMeta | null> {
    const [rows] = await this.pool.execute<EmpRow[]>(
      `SELECT id, employee_code, full_name, designation, department,
              pan, date_of_joining, employment_type
         FROM hrms_employees
        WHERE id = ?`,
      [employeeId],
    );
    const r = rows[0];
    if (!r) return null;

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
