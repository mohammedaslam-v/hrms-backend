import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { PayrollController } from './payroll.controller';

export const createPayrollRouter = (controller: PayrollController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get('/', controller.getPayrollView);
  router.post('/calculate', controller.calculatePayroll);

  return router;
};
