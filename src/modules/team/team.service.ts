import { IAuthService } from '../auth/auth.service.interface';
import { ICompensationService } from '../compensation/compensation.service.interface';
import { IOrgRepository } from '../org/org.repository.interface';
import { ApiError } from '../../utils/api-error';
import { DirectoryMember, DirectoryView } from './team.model';
import { ITeamService } from './team.service.interface';

/**
 * The Team directory.
 *
 * Two jobs: decide whose list this is, and decide whether it carries pay. Both
 * are answered from the viewer's tiers, read live rather than from the token.
 */
export class TeamService implements ITeamService {
  constructor(
    private readonly authService: IAuthService,
    private readonly orgRepository: IOrgRepository,
    private readonly compensationService: ICompensationService,
  ) {}

  async getDirectory(viewerId: number, includeLeavers = false): Promise<DirectoryView> {
    const viewer = await this.authService.getCurrentEmployee(viewerId);
    const isAdmin = viewer.tiers.includes('admin');
    const isManager = viewer.tiers.includes('manager');

    if (!isAdmin && !isManager) {
      throw new ApiError(403, 'The team directory is for managers and admins.');
    }

    // An admin sees the company; a manager sees their own tree. Passing null as
    // the root is what means "everyone", so a manager's id can never widen into
    // the whole company by accident.
    const members: DirectoryMember[] = await this.orgRepository.findRoster({
      rootId: isAdmin ? null : viewerId,
      includeLeavers,
    });

    // Pay is between the employee, HR and the founder. A manager's list is built
    // and returned without ever reading the compensation table — the cheapest
    // way to keep 450 salaries out of a response is not to fetch them.
    if (isAdmin && members.length > 0) {
      const pay = await this.compensationService.getCurrentForMany(members.map((m) => m.id));
      for (const member of members) {
        member.ctc = pay.get(member.id)?.ctc ?? null;
      }
    }

    return {
      canSeePay: isAdmin,
      scope: isAdmin ? 'company' : 'team',
      members,
    };
  }
}
