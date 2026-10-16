import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { PresenceController } from './presence.controller';

/** Header "N online" pill. Every tier may ask; the service narrows the list. */
export const createPresenceRouter = (controller: PresenceController): Router => {
  const router = Router();
  router.use(requireAuth);
  router.get('/online', controller.getOnline);
  return router;
};
