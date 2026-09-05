import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { requireAuth } from '../middlewares/auth.middleware';

/**
 * My page — Individual tier. `/me` is always your own record, scoped by the
 * session. `/:id` serves the same page for someone else and is authorised in the
 * service against the reporting tree, so there is one rule rather than a route
 * guard and a service check that can drift apart.
 */
export const createProfileRouter = (controller: ProfileController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get('/me', controller.getMine);
  router.get('/:id', controller.getOne);

  return router;
};
