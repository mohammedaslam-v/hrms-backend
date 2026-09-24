import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { EmployeeController } from './employee.controller';

export const createEmployeeRouter = (controller: EmployeeController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get('/meta', controller.getMeta);
  router.get('/', controller.getAll);
  router.get('/:id', controller.getById);
  router.post('/', controller.create);
  router.put('/:id', controller.update);
  router.delete('/:id', controller.delete);

  return router;
};
