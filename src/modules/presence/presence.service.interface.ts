import { AdminPanelActivity, PresenceSummary } from './presence.model';

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
}
