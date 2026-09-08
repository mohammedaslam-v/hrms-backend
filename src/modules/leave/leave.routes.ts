import { Router } from 'express';
import { LeaveController } from './leave.controller';
import { requireAuth } from '../../middlewares/auth.middleware';

/**
 * My leave — Individual tier, so every signed-in person reaches their own record
 * and only their own. Scoping is by the employee id on the session, never a
 * parameter the client supplies.
 */
export const createLeaveRouter = (controller: LeaveController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get('/me', controller.getMine);
  router.get('/me/preview', controller.preview);
  router.post('/me/requests', controller.apply);
  router.post('/me/requests/:id/cancel', controller.cancel);

  // Manager tier. Scoping is enforced in the service against the reporting tree,
  // so an employee with no reports simply sees an empty queue.
  router.get('/approvals', controller.getApprovals);
  router.post('/approvals/:id/decide', controller.decide);

  return router;
};
