import { Router } from 'express';
import { InternalAttendanceController } from './internal-attendance.controller';
import { requireInternalKey } from '../../middlewares/internal-key.middleware';

/**
 * Server-to-server attendance for admin-backend, keyed by admins.id.
 * Never called from a browser — every route needs the internal key.
 */
export const createInternalAttendanceRouter = (controller: InternalAttendanceController): Router => {
  const router = Router();

  router.use(requireInternalKey);

  router.get('/by-admin/:adminId/today', controller.getToday);
  router.post('/by-admin/:adminId/check-in', controller.checkIn);
  router.post('/by-admin/:adminId/check-out', controller.checkOut);

  return router;
};
