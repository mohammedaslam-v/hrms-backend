import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { rateLimit } from '../middlewares/rate-limit.middleware';

export const createAuthRouter = (controller: AuthController): Router => {
  const router = Router();

  // Password guessing and OTP guessing are the two paths worth throttling.
  // The per-code attempt limit lives in the OTP service; this caps the rate.
  const loginLimit = rateLimit({ key: 'login', windowSeconds: 300, max: 10 });
  const otpLimit = rateLimit({ key: 'otp', windowSeconds: 300, max: 20 });
  const resetLimit = rateLimit({ key: 'reset', windowSeconds: 900, max: 5 });

  router.post('/login', loginLimit, controller.login);
  router.post('/verify-otp', otpLimit, controller.verifyOtp);
  router.post('/resend-otp', otpLimit, controller.resendOtp);

  router.post('/forgot-password', resetLimit, controller.forgotPassword);
  router.post('/verify-reset-otp', otpLimit, controller.verifyResetOtp);
  router.post('/reset-password', resetLimit, controller.resetPassword);
  router.post('/change-password', requireAuth, controller.changePassword);

  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', requireAuth, controller.me);

  return router;
};
