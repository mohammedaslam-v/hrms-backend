import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { ReimbursementController } from './reimbursement.controller';

export const createReimbursementRouter = (
  controller: ReimbursementController,
): Router => {
  const router = Router();

  router.use(requireAuth);

  // Employee endpoints
  router.get('/mine', controller.getMyReimbursements);
  router.post('/', controller.createReimbursement);
  router.get('/:id/receipt', controller.getReceiptFile);
  router.delete('/:id', controller.cancelClaim);

  // Admin approval endpoints
  router.get('/admin/all', controller.getAllForAdmin);
  router.post('/admin/:id/approve', controller.approveClaim);
  router.post('/admin/:id/reject', controller.rejectClaim);
  router.post('/admin/:id/pay', controller.markPaid);

  return router;
};
