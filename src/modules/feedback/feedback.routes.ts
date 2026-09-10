import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { FeedbackController } from './feedback.controller';

export const createFeedbackRouter = (controller: FeedbackController): Router => {
  const router = Router();
  router.use(requireAuth);
  router.post('/:employeeId', controller.add);
  return router;
};
