import { RequestHandler } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { asyncHandler } from '../../utils/async-handler';
import { ITeamService } from './team.service.interface';

export class TeamController {
  constructor(private readonly teamService: ITeamService) {}

  /**
   * The directory for whoever is signed in.
   *
   * There is no id in the path: you get your own scope or nothing. A manager
   * cannot ask for somebody else's team by changing a number in the URL.
   */
  getDirectory: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;

    // The Active / Exited filter. Absent means active only, so the default is
    // the smaller list rather than the larger one.
    const includeLeavers = req.query.includeLeavers === 'true';

    res.json({
      success: true,
      data: await this.teamService.getDirectory(employeeId, includeLeavers),
    });
  });
}
