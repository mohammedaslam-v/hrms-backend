import {
  AdminPanelActivity,
  AdminPanelDay,
  PresenceBoard,
  PresenceCount,
  PresenceSummary,
} from './presence.model';

export interface IPresenceService {
  /**
   * Who is on the new admin panel, as far as the viewer may see.
   *
   * An admin sees everyone the admin panel shows; a manager sees themselves and
   * their reporting tree, skip-level included; anyone else sees only themselves.
   */
  getOnline(viewerId: number): Promise<PresenceSummary>;

  /**
   * `subjectId`'s time on the admin panel per day, and where they are now —
   * for whoever may open their My Page (self, their manager, an admin).
   */
  getAdminActivity(
    viewerId: number,
    subjectId: number,
    from: string,
    to: string,
  ): Promise<AdminPanelActivity>;

  /**
   * Admin-panel days for many employees, for a report: employee id → date →
   * day. The caller decides who may run the report.
   */
  adminPanelForReport(
    employeeIds: number[],
    from: string,
    to: string,
  ): Promise<Map<number, Map<string, AdminPanelDay>>>;

  /** How many people in the viewer's scope are online now — the closed pill. */
  getCount(viewerId: number): Promise<PresenceCount>;

  /**
   * Everyone in the viewer's scope, grouped by shift, with leave today and
   * admin-panel status — the open dropdown. Admins also get a group of
   * admin-panel users with no HRMS record.
   */
  getBoard(viewerId: number): Promise<PresenceBoard>;
}
