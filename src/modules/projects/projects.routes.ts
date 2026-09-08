import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { ProjectsController } from './projects.controller';

/**
 * Reading projects happens through the profile. Only the write lives here, and
 * it is authorised in the service against the reporting tree.
 */
export const createProjectsRouter = (controller: ProjectsController): Router => {
  const router = Router();
  router.use(requireAuth);
  router.post('/:employeeId', controller.add);
  return router;
};
