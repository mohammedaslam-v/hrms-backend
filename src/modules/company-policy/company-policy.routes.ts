import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { CompanyPolicyController } from './company-policy.controller';

export const createCompanyPolicyRouter = (controller: CompanyPolicyController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get('/', controller.getAll);
  router.get('/:id', controller.getById);
  router.post('/', controller.create);
  router.put('/:id', controller.update);
  router.delete('/:id', controller.delete);

  return router;
};
