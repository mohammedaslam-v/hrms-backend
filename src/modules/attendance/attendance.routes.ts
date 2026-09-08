import { Router } from 'express';
import { AttendanceController } from './attendance.controller';
import { requireAuth } from '../../middlewares/auth.middleware';

/**
 * Attendance — Individual tier. Scoped by the session on every route, so there
 * is no id in any path and nobody can punch on another person's behalf.
 */
export const createAttendanceRouter = (controller: AttendanceController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get('/me/today', controller.getToday);
  router.get('/me/week', controller.getWeek);
  router.get('/me/days', controller.getDays);
  router.post('/me/check-in', controller.checkIn);
  router.post('/me/check-out', controller.checkOut);

  return router;
};
