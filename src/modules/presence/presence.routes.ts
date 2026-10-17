import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { PresenceController } from './presence.controller';

/**
 * Header "N online" pill and My Page's admin-panel time. Every tier may ask;
 * the service narrows or refuses.
 */
export const createPresenceRouter = (controller: PresenceController): Router => {
  const router = Router();
  router.use(requireAuth);
  router.get('/online', controller.getOnline);
  router.get('/days', controller.getAdminActivity);
  return router;
};
