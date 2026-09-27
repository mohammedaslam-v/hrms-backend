import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { ReportsController } from './reports.controller';

export const createReportsRouter = (controller: ReportsController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get('/catalog', controller.getCatalog);
  router.get('/data', controller.getReportData);
  router.get('/export', controller.exportReport);

  return router;
};
