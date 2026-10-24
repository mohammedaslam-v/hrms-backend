import { Router } from 'express';
import { InternalPresenceController } from './internal-presence.controller';
import { requireInternalKey } from '../../middlewares/internal-key.middleware';

/**
 * Server-to-server presence for admin-backend, keyed by admins.id.
 * Never called from a browser — every route needs the internal key.
 */
export const createInternalPresenceRouter = (controller: InternalPresenceController): Router => {
  const router = Router();

  router.use(requireInternalKey);

  router.get('/by-admin/:adminId/board', controller.getBoard);

  return router;
};
