import { Router } from 'express';
import { InternalCompensationController } from './internal-compensation.controller';
import { requireInternalKey } from '../../middlewares/internal-key.middleware';

/**
 * Server-to-server salary cost for admin-backend, keyed by admins.id.
 * Never called from a browser — every route needs the internal key.
 */
export const createInternalCompensationRouter = (controller: InternalCompensationController): Router => {
  const router = Router();

  router.use(requireInternalKey);

  router.get('/by-admins', controller.getByAdmins);

  return router;
};
