import { Pool, RowDataPacket } from 'mysql2/promise';
import {
  AdminPanelDay,
  LatestPresenceForAdmin,
  LatestPresenceRow,
  PresenceRow,
  UnlinkedPresenceRow,
} from './presence.model';
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

  async findAdminIdMap(employeeIds: number[]): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (employeeIds.length === 0) return map;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, admin_id FROM hrms_employees
        WHERE admin_id IS NOT NULL AND id IN (${employeeIds.map(() => '?').join(', ')})`,
      employeeIds,
    );
    for (const r of rows) map.set(Number(r.id), Number(r.admin_id));
    return map;
  }

  async findDaysForMany(adminIds: number[], from: string, to: string): Promise<Map<number, AdminPanelDay[]>> {
    const byAdmin = new Map<number, AdminPanelDay[]>();
    if (adminIds.length === 0) return byAdmin;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT admin_id,
              DATE_FORMAT(day, '%Y-%m-%d')         AS day,
              DATE_FORMAT(first_seen_at, '%H:%i') AS first_seen,
              DATE_FORMAT(last_seen_at, '%H:%i')  AS last_seen,
              active_seconds, sessions
         FROM admin_panel_presence_day
        WHERE admin_id IN (${adminIds.map(() => '?').join(', ')}) AND day BETWEEN ? AND ?`,
      [...adminIds, from, to],
    );
    for (const r of rows) {
      const id = Number(r.admin_id);
      const list = byAdmin.get(id) ?? [];
      list.push({
        date: String(r.day),
        firstSeen: String(r.first_seen),
        lastSeen: String(r.last_seen),
        activeSeconds: Number(r.active_seconds) || 0,
        sessions: Number(r.sessions) || 0,
      });
      byAdmin.set(id, list);
    }
    return byAdmin;
  }

  async findDays(adminId: number, from: string, to: string): Promise<AdminPanelDay[]> {
    // The admin panel writes this table in India time, so the dates and times
    // are read as they are.
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(day, '%Y-%m-%d')         AS day,
              DATE_FORMAT(first_seen_at, '%H:%i') AS first_seen,
              DATE_FORMAT(last_seen_at, '%H:%i')  AS last_seen,
              active_seconds, sessions
         FROM admin_panel_presence_day
        WHERE admin_id = ? AND day BETWEEN ? AND ?
        ORDER BY day`,
      [adminId, from, to],
    );
    return rows.map((r) => ({
      date: String(r.day),
      firstSeen: String(r.first_seen),
      lastSeen: String(r.last_seen),
      activeSeconds: Number(r.active_seconds) || 0,
      sessions: Number(r.sessions) || 0,
    }));
  }

  async findLatest(adminId: number): Promise<LatestPresenceRow | null> {
    // `last_seen_at` here is stamped with the database's NOW(), whose zone is
    // not known, so India time is rebuilt from the age: UTC now + 5:30 − age.
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT p.last_path,
              TIMESTAMPDIFF(SECOND, p.last_seen_at, NOW())                AS seconds_ago,
              TIMESTAMPDIFF(MINUTE, p.session_started_at, p.last_seen_at) AS session_minutes,
              (p.signed_off_at IS NOT NULL)                               AS signed_off,
              DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 330 MINUTE
                          - INTERVAL TIMESTAMPDIFF(SECOND, p.last_seen_at, NOW()) SECOND,
                          '%Y-%m-%d %H:%i')                               AS last_seen_ist
         FROM admin_panel_presence p
        WHERE p.admin_id = ?`,
      [adminId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      last_path: r.last_path == null ? null : String(r.last_path),
      seconds_ago: Number(r.seconds_ago) || 0,
      session_minutes: Number(r.session_minutes) || 0,
      signed_off: Number(r.signed_off) || 0,
      last_seen_ist: String(r.last_seen_ist),
    };
  }

  /*
   * The latest-presence columns, shared by the board queries. Ages are MySQL's
   * (NOW() against NOW()); India time is rebuilt from the age, as in findLatest.
   */
  private static readonly LATEST_COLUMNS = `p.admin_id, p.last_path,
              TIMESTAMPDIFF(SECOND, p.last_seen_at, NOW())                AS seconds_ago,
              TIMESTAMPDIFF(MINUTE, p.session_started_at, p.last_seen_at) AS session_minutes,
              (p.signed_off_at IS NOT NULL)                               AS signed_off,
              DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 330 MINUTE
                          - INTERVAL TIMESTAMPDIFF(SECOND, p.last_seen_at, NOW()) SECOND,
                          '%Y-%m-%d %H:%i')                               AS last_seen_ist`;

  private static toLatest(r: RowDataPacket): LatestPresenceForAdmin {
    return {
      admin_id: Number(r.admin_id),
      last_path: r.last_path == null ? null : String(r.last_path),
      seconds_ago: Number(r.seconds_ago) || 0,
      session_minutes: Number(r.session_minutes) || 0,
      signed_off: Number(r.signed_off) || 0,
      last_seen_ist: String(r.last_seen_ist),
    };
  }

  async findLatestForMany(adminIds: number[]): Promise<Map<number, LatestPresenceForAdmin>> {
    const map = new Map<number, LatestPresenceForAdmin>();
    if (adminIds.length === 0) return map;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${PresenceRepository.LATEST_COLUMNS}
         FROM admin_panel_presence p
        WHERE p.admin_id IN (${adminIds.map(() => '?').join(', ')})`,
      adminIds,
    );
    for (const r of rows) map.set(Number(r.admin_id), PresenceRepository.toLatest(r));
    return map;
  }

  async findUnlinkedSeen(days: number): Promise<UnlinkedPresenceRow[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${PresenceRepository.LATEST_COLUMNS}, a.name, a.role
         FROM admin_panel_presence p
         JOIN admins a ON a.id = p.admin_id AND a.deleted_at IS NULL
        WHERE p.last_seen_at >= NOW() - INTERVAL ? DAY
          AND NOT EXISTS (SELECT 1 FROM hrms_employees e WHERE e.admin_id = p.admin_id)
        ORDER BY p.last_seen_at DESC
        LIMIT 300`,
      [Math.max(1, Math.floor(days))],
    );
    return rows.map((r) => ({
      ...PresenceRepository.toLatest(r),
      name: String(r.name ?? ''),
      role: String(r.role ?? ''),
    }));
  }

  async countOnline(withinSeconds: number, adminIds: number[] | null): Promise<number> {
    if (adminIds !== null && adminIds.length === 0) return 0;
    const params: number[] = [Math.max(60, Math.floor(withinSeconds))];
    // Everyone (an admin's view) still leaves out accounts whose only HRMS
    // record is someone who has left — the board lists neither, and the pill
    // should not count a person the list cannot show.
    let only = `AND (NOT EXISTS (SELECT 1 FROM hrms_employees e WHERE e.admin_id = p.admin_id)
                  OR EXISTS (SELECT 1 FROM hrms_employees e WHERE e.admin_id = p.admin_id
                               AND (e.date_of_leaving IS NULL OR e.date_of_leaving >= CURDATE())))`;
    if (adminIds !== null) {
      only = `AND p.admin_id IN (${adminIds.map(() => '?').join(', ')})`;
      params.push(...adminIds);
    }
    // Same rule as the list: seen within the window and not logged out.
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n
         FROM admin_panel_presence p
         JOIN admins a ON a.id = p.admin_id AND a.deleted_at IS NULL
        WHERE p.last_seen_at >= NOW() - INTERVAL ? SECOND
          AND p.signed_off_at IS NULL
          ${only}`,
      params,
    );
    return Number(rows[0]?.n) || 0;
  }

  async findAdminRoles(adminIds: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (adminIds.length === 0) return map;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, role FROM admins
        WHERE deleted_at IS NULL AND id IN (${adminIds.map(() => '?').join(', ')})`,
      adminIds,
    );
    for (const r of rows) if (r.role) map.set(Number(r.id), String(r.role));
    return map;
  }
}
