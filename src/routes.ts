import { Router } from 'express';
import { Container } from './container';
import { createAttendanceRouter } from './modules/attendance/attendance.routes';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createEmployeeRouter } from './modules/employees/employee.routes';
import { createLeaveRouter } from './modules/leave/leave.routes';
import { createProfileRouter } from './modules/profile/profile.routes';

export const createApiRouter = (container: Container): Router => {
  const router = Router();

  router.use('/auth', createAuthRouter(container.authController));
  router.use('/leave', createLeaveRouter(container.leaveController));
  router.use('/employees', createEmployeeRouter(container.employeeController));
  router.use('/profile', createProfileRouter(container.profileController));
  router.use('/attendance', createAttendanceRouter(container.attendanceController));

  return router;
};
