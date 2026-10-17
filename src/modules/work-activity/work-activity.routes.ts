import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { WorkActivityController } from './work-activity.controller';

/** Activities recorded from the Today card; shown in the week chart's hover box. */
export const createWorkActivityRouter = (controller: WorkActivityController): Router => {
  const router = Router();
  router.use(requireAuth);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.delete('/:id', controller.remove);
  return router;
};
