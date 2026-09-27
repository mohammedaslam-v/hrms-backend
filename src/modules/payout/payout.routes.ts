import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { PayoutController } from './payout.controller';

export const createPayoutRouter = (controller: PayoutController): Router => {
  const router = Router();

  // Webhook is public (verified via payload/signature if configured)
  router.post('/webhook', controller.handleWebhook);

  // Authenticated Admin routes
  router.use(requireAuth);
  router.post('/push-salary', controller.pushSalaryPayouts);
  router.post('/push-single', controller.pushSingleSalary);
  router.post('/push-loan', controller.pushLoanDisbursement);
  router.post('/import-csv', controller.importCsv);
  router.post('/bank-details', controller.updateBankDetails);

  return router;
};
