import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { ProductivityController } from './productivity.controller';

export const createProductivityRouter = (controller: ProductivityController): Router => {
  const router = Router();
  router.use(requireAuth);
  router.post('/settle', controller.settle);
  return router;
};
