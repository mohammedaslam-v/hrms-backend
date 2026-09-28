import { Router } from 'express';
import { DashboardController } from './dashboard.controller';
import { requireAuth } from '../../middlewares/auth.middleware';

export const createDashboardRouter = (controller: DashboardController): Router => {
  const router = Router();
  router.use(requireAuth);

  // Who may see what is decided in the service against the org tree, so there
  // is one route rather than a manager one and an admin one.
  router.get('/', controller.getDashboard);

  return router;
};
