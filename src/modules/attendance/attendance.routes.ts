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

  // Declared AFTER the /me routes so the literal wins — otherwise ':employeeId'
  // would swallow 'me' and every self request would fail on a bad id.
  //
  // Read only: a manager can see what their report's day looked like, and there
  // is deliberately no route here that punches on someone else's behalf.
  router.get('/:employeeId/today', controller.getTodayForEmployee);
  router.get('/:employeeId/week', controller.getWeekForEmployee);

  return router;
};
