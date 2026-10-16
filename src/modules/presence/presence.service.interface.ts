import { PresenceSummary } from './presence.model';

export interface IPresenceService {
  /**
   * Who is on the new admin panel, as far as the viewer may see.
   *
   * An admin sees everyone the admin panel shows; a manager sees themselves and
   * their reporting tree, skip-level included; anyone else sees only themselves.
   */
  getOnline(viewerId: number): Promise<PresenceSummary>;
}
