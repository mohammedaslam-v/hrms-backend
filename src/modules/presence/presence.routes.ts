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
  // Kept while an older frontend may still be deployed; the current header
  // uses /count (closed) and /board (open).
  router.get('/online', controller.getOnline);
  router.get('/count', controller.getCount);
  router.get('/board', controller.getBoard);
  router.get('/days', controller.getAdminActivity);
  return router;
};
