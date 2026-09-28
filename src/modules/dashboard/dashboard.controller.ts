import { RequestHandler } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { asyncHandler } from '../../utils/async-handler';
import { IDashboardService } from './dashboard.service.interface';

export class DashboardController {
  constructor(private readonly dashboardService: IDashboardService) {}

  /**
   * The dashboard for whoever is signed in.
   *
   * No id in the path and no scope parameter: you get the scope your access
   * entitles you to, decided server-side. There is nothing in the URL to change.
   */
  getDashboard: RequestHandler = asyncHandler(async (req, res) => {
    const { employeeId } = req as AuthenticatedRequest;
    const view = await this.dashboardService.getDashboard(employeeId);
    res.json({ success: true, data: view });
  });
}
