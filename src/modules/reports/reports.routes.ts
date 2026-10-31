import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { ReportsController } from './reports.controller';

export const createReportsRouter = (controller: ReportsController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get('/catalog', controller.getCatalog);
  router.get('/data', controller.getReportData);
  router.get('/export', controller.exportReport);
  // Attendance & activity → Active time (managers and admins; scoped in the service).
  router.get('/active-time', controller.getActiveTime);

  return router;
};
