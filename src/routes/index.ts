import { Router } from 'express';
import { Container } from '../container';
import { createAuthRouter } from './auth.routes';
import { createEmployeeRouter } from './employee.routes';
import { createLeaveRouter } from './leave.routes';
import { createProfileRouter } from './profile.routes';

export const createApiRouter = (container: Container): Router => {
  const router = Router();

  router.use('/auth', createAuthRouter(container.authController));
  router.use('/leave', createLeaveRouter(container.leaveController));
  router.use('/employees', createEmployeeRouter(container.employeeController));
  router.use('/profile', createProfileRouter(container.profileController));

  return router;
};
