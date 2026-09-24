import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { LoanController } from './loan.controller';

export const createLoanRouter = (controller: LoanController): Router => {
  const router = Router();

  router.use(requireAuth);

  // Employee & manager/admin by employeeId route
  router.get('/mine', controller.getMyLoans);
  router.get('/employee/:id', controller.getEmployeeLoans);

  // Admin routes
  router.get('/admin/meta', controller.getAdminMeta);
  router.get('/admin', controller.getAdminLoans);
  router.post('/admin', controller.createLoan);
  router.post('/admin/:id/close', controller.closeLoan);

  return router;
};
