import { Router } from 'express';
import { EmployeeController } from '../controllers/employee.controller';

export const createEmployeeRouter = (controller: EmployeeController): Router => {
  const router = Router();

  router.get('/', controller.getAll);
  router.get('/:id', controller.getById);
  router.post('/', controller.create);
  router.put('/:id', controller.update);
  router.delete('/:id', controller.delete);

  return router;
};
