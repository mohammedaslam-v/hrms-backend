import { Pool, RowDataPacket } from 'mysql2/promise';

interface EmployeeByAdminRow extends RowDataPacket {
  id: number;
  admin_id: number;
  employee_code: string | null;
  full_name: string | null;
}

export interface EmployeeByAdmin {
  employeeId: number;
  adminId: number;
  employeeCode: string | null;
  fullName: string | null;
}

/**
 * Maps admin panel accounts to their HRMS employee rows for the salary cost API.
 *
 * Deliberately no filter on leaving date or deletion: Sales Pulse shows past
 * months, and someone who has left still cost what they cost in the months they
 * worked. When one admin has several employee rows, the earliest wins — the
 * same choice the internal attendance lookup makes.
 */
export class InternalCompensationRepository {
  constructor(private readonly pool: Pool) {}

  async findEmployeesByAdminIds(adminIds: number[]): Promise<EmployeeByAdmin[]> {
    if (adminIds.length === 0) return [];
    const placeholders = adminIds.map(() => '?').join(',');
    const [rows] = await this.pool.query<EmployeeByAdminRow[]>(
      `SELECT e.id, e.admin_id, e.employee_code, e.full_name
         FROM hrms_employees e
        WHERE e.admin_id IN (${placeholders})
        ORDER BY e.admin_id, e.id`,
      adminIds,
    );

    const byAdmin = new Map<number, EmployeeByAdmin>();
    for (const row of rows) {
      if (byAdmin.has(row.admin_id)) continue;
      byAdmin.set(row.admin_id, {
        employeeId: row.id,
        adminId: row.admin_id,
        employeeCode: row.employee_code,
        fullName: row.full_name,
      });
    }
    return [...byAdmin.values()];
  }
}
