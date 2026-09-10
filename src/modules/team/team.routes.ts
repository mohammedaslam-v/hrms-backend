import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { TeamController } from './team.controller';

/**
 * Team directory — Manager access.
 *
 * The tier is enforced in the service against the viewer's live tiers, not by a
 * route guard, so an employee with no reports is refused rather than shown an
 * empty list they were never entitled to ask for.
 */
export const createTeamRouter = (controller: TeamController): Router => {
  const router = Router();
  router.use(requireAuth);
  router.get('/', controller.getDirectory);
  return router;
};
