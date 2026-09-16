import { Router } from 'express';
import { ProfileController } from './profile.controller';
import { requireAuth } from '../../middlewares/auth.middleware';

/**
 * My page — Individual tier. `/me` is always your own record, scoped by the
 * session. `/:id` serves the same page for someone else and is authorised in the
 * service against the reporting tree.
 */
export const createProfileRouter = (controller: ProfileController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get('/me', controller.getMine);
  router.post('/me/documents', controller.saveDocument);
  router.get('/me/documents/:key/file', controller.downloadDocument);

  router.get('/:id', controller.getOne);
  router.post('/:id/documents', controller.saveDocument);
  router.get('/:id/documents/:key/file', controller.downloadDocument);

  return router;
};
