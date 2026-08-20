import { Router } from 'express';
import { Container } from '../container';
import { createEmployeeRouter } from './employee.routes';

export const createApiRouter = (container: Container): Router => {
  const router = Router();

  router.use('/employees', createEmployeeRouter(container.employeeController));

  return router;
};
