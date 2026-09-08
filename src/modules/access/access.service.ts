import { IAuthService } from '../auth/auth.service.interface';
import { IOrgRepository } from '../org/org.repository.interface';
import { ApiError } from '../../utils/api-error';
import { GrantedAccess, ProfileAccess, resolveProfileAccess } from './access.domain';
import { IAccessService } from './access.service.interface';

/**
 * Resolves what one person may do with another's record.
 *
 * Tiers are read live rather than from the token, so revoking someone's access
 * takes effect on their next request instead of whenever their token happens to
 * expire.
 */
export class AccessService implements IAccessService {
  constructor(
    private readonly authService: IAuthService,
    private readonly orgRepository: IOrgRepository,
  ) {}

  async resolveFor(viewerId: number, subjectId: number): Promise<ProfileAccess> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);

    // Only ask the database about the reporting tree when the answer can still
    // change the outcome — viewing yourself, or holding admin, settles it.
    const needsTreeLookup = viewerId !== subjectId && !viewer.tiers.includes('admin');
    const isReport = needsTreeLookup
      ? await this.orgRepository.isInReportingTree(viewerId, subjectId)
      : false;

    return resolveProfileAccess({ viewerId, subjectId, tiers: viewer.tiers, isReport });
  }

  async require(viewerId: number, subjectId: number): Promise<GrantedAccess> {
    const access = await this.resolveFor(viewerId, subjectId);
    if (access === 'denied') {
      // Deliberately the same message whether the person exists or not: a
      // different reply would let anyone map the company by trying ids.
      throw new ApiError(403, 'You do not have access to this profile.');
    }
    return access;
  }
}
