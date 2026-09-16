import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { GoalsController } from './goals.controller';

export const createGoalsRouter = (controller: GoalsController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get('/me', controller.getMine);
  router.get('/team', controller.getTeam);
  router.post('/', controller.create);
  router.patch('/:id/metric', controller.updateMetric);
  router.patch('/:id/milestones/:milestoneId', controller.toggleMilestone);
  router.delete('/:id', controller.delete);

  return router;
};
