import { Pool, RowDataPacket } from 'mysql2/promise';

interface EmployeeIdRow extends RowDataPacket {
  id: number;
}

/**
 * Maps an admin panel account to the HRMS employee it belongs to.
 *
 * Only someone who could sign in to HRMS counts: a live admin row, a live
 * employee row, login not disabled and not past their last working day. Anyone
 * else has no attendance to punch, so the admin panel hides the buttons.
 */
export class InternalAttendanceRepository {
  constructor(private readonly pool: Pool) {}

  async findActiveEmployeeIdByAdminId(adminId: number): Promise<number | null> {
    const [rows] = await this.pool.execute<EmployeeIdRow[]>(
      `SELECT e.id
         FROM hrms_employees e
         JOIN admins a ON a.id = e.admin_id AND a.deleted_at IS NULL
        WHERE e.admin_id = ?
          AND e.deleted_at IS NULL
          AND COALESCE(e.is_login_disabled, 0) = 0
          AND (e.date_of_leaving IS NULL OR e.date_of_leaving >= CURDATE())
        ORDER BY e.id
        LIMIT 1`,
      [adminId],
    );
    return rows[0]?.id ?? null;
  }
}
