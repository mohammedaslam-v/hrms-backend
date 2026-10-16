import { Pool, RowDataPacket } from 'mysql2/promise';
import { PresenceRow } from './presence.model';
import { IPresenceRepository } from './presence.repository.interface';

/**
 * The same statement the admin backend runs (presence.repository.ts recent()).
 *
 * Every age is computed by MySQL against NOW(), never from a returned DATETIME:
 * the API and the database do not share a timezone, and the admin panel stamps
 * `last_seen_at` with the database's NOW().
 */
export class PresenceRepository implements IPresenceRepository {
  constructor(private readonly pool: Pool) {}

  async findRecent(withinSeconds: number, adminIds: number[] | null): Promise<PresenceRow[]> {
    if (adminIds !== null && adminIds.length === 0) return [];

    const params: number[] = [Math.max(60, Math.floor(withinSeconds))];
    let only = '';
    if (adminIds !== null) {
      only = `AND p.admin_id IN (${adminIds.map(() => '?').join(', ')})`;
      params.push(...adminIds);
    }

    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT p.admin_id, a.name, a.role, p.last_path,
              TIMESTAMPDIFF(SECOND, p.last_seen_at, NOW())                AS seconds_ago,
              TIMESTAMPDIFF(MINUTE, p.session_started_at, p.last_seen_at) AS session_minutes,
              (p.signed_off_at IS NOT NULL)                               AS signed_off
         FROM admin_panel_presence p
         JOIN admins a ON a.id = p.admin_id AND a.deleted_at IS NULL
        WHERE p.last_seen_at >= NOW() - INTERVAL ? SECOND
          ${only}
        ORDER BY p.last_seen_at DESC
        LIMIT 300`,
      params,
    );

    return rows.map((r) => ({
      admin_id: Number(r.admin_id),
      name: String(r.name ?? ''),
      role: String(r.role ?? ''),
      last_path: r.last_path == null ? null : String(r.last_path),
      seconds_ago: Number(r.seconds_ago) || 0,
      session_minutes: Number(r.session_minutes) || 0,
      signed_off: Number(r.signed_off) || 0,
    }));
  }

  async findAdminIdsFor(employeeIds: number[]): Promise<number[]> {
    if (employeeIds.length === 0) return [];
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT DISTINCT admin_id
         FROM hrms_employees
        WHERE admin_id IS NOT NULL
          AND id IN (${employeeIds.map(() => '?').join(', ')})`,
      employeeIds,
    );
    return rows.map((r) => Number(r.admin_id)).filter((id) => Number.isInteger(id) && id > 0);
  }
}
