import { IAuthService } from '../auth/auth.service.interface';
import { IOrgRepository } from '../org/org.repository.interface';
import { ApiError } from '../../utils/api-error';
import { PRESENCE_PILOT_ADMIN_IDS, RECENT_WINDOW_SECONDS, summarise } from './presence.domain';
import { PresenceSummary } from './presence.model';
import { IPresenceRepository } from './presence.repository.interface';
import { IPresenceService } from './presence.service.interface';

/**
 * The admin panel's who-is-online list, narrowed to what the viewer may see.
 *
 * The scope is decided from live tiers, as everywhere else. Presence is keyed
 * by admin account, so the HRMS scope is turned into admin ids first: the
 * reporting tree gives employees, `hrms_employees.admin_id` gives their admins.
 */
export class PresenceService implements IPresenceService {
  constructor(
    private readonly repository: IPresenceRepository,
    private readonly authService: IAuthService,
    private readonly orgRepository: IOrgRepository,
  ) {}

  async getOnline(viewerId: number): Promise<PresenceSummary> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);

    // Null means everyone — including admin-panel users with no HRMS record,
    // so an admin sees exactly what the admin panel's header shows.
    const myAdminIds = await this.repository.findAdminIdsFor([viewerId]);
    if (!myAdminIds.some((id) => PRESENCE_PILOT_ADMIN_IDS.includes(id))) {
      throw new ApiError(403, 'Who is online is not available on your account yet.');
    }

    let adminIds: number[] | null = null;
    if (!viewer.tiers.includes('admin')) {
      adminIds = [...myAdminIds];
      if (viewer.tiers.includes('manager')) {
        const team = await this.orgRepository.findReportingTree(viewerId);
        for (const id of await this.repository.findAdminIdsFor(team.map((m) => m.id))) {
          if (!adminIds.includes(id)) adminIds.push(id);
        }
      }
    }

    // The admin panel marks "(you)" from its own session; HRMS signs in by
    // employee, so it says which admin accounts are the viewer's.
    return {
      ...summarise(await this.repository.findRecent(RECENT_WINDOW_SECONDS, adminIds)),
      viewer_admin_ids: myAdminIds,
    };
  }
}
