import {
  AdminPanelDay,
  LatestPresenceForAdmin,
  LatestPresenceRow,
  PresenceRow,
  UnlinkedPresenceRow,
} from './presence.model';

/**
 * Reads `admin_panel_presence`, which the new admin panel writes.
 *
 * Read-only on purpose: the admin panel is the one place presence is recorded.
 * HRMS neither pings nor creates the table.
 */
export interface IPresenceRepository {
  /**
   * Everyone seen within the last `withinSeconds`, newest first.
   *
   * `adminIds` null means everyone; an array limits it to those admins (an
   * empty array returns nothing without a query).
   */
  findRecent(withinSeconds: number, adminIds: number[] | null): Promise<PresenceRow[]>;

  /** The admin accounts linked to these HRMS employees. */
  findAdminIdsFor(employeeIds: number[]): Promise<number[]>;

  /** One admin's days on the panel between two India dates, inclusive. */
  findDays(adminId: number, from: string, to: string): Promise<AdminPanelDay[]>;

  /** One admin's latest presence, however long ago. Null if never seen. */
  findLatest(adminId: number): Promise<LatestPresenceRow | null>;

  /** HRMS employee → linked admin account, for those that have one. */
  findAdminIdMap(employeeIds: number[]): Promise<Map<number, number>>;

  /** Several admins' days at once: admin id → their days. */
  findDaysForMany(adminIds: number[], from: string, to: string): Promise<Map<number, AdminPanelDay[]>>;

  /** Latest presence for several admins, however long ago: admin id → row. */
  findLatestForMany(adminIds: number[]): Promise<Map<number, LatestPresenceForAdmin>>;

  /** Admin-panel users with no HRMS record, seen within the last `days`. */
  findUnlinkedSeen(days: number): Promise<UnlinkedPresenceRow[]>;

  /** How many of these admins (null = everyone) are online now. One COUNT. */
  countOnline(withinSeconds: number, adminIds: number[] | null): Promise<number>;

  /** admins.role for these admin accounts (live ones only): admin id → role. */
  findAdminRoles(adminIds: number[]): Promise<Map<number, string>>;
}
