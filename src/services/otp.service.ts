import crypto from 'crypto';
import { env } from '../config/env';
import { IAuthRepository } from '../interfaces/repositories/auth.repository.interface';
import { IOtpService } from '../interfaces/services/otp.service.interface';
import { maskEmail, OtpChallenge, OtpPurpose } from '../models/auth.model';
import { ApiError } from '../utils/api-error';
import { buildOtpEmail, deliverOtpFallback, isMailConfigured, sendMail } from '../utils/mailer';
import {
  isPlausibleMobile,
  isWhatsappConfigured,
  sendOtpWhatsapp,
  toWhatsappNumber,
} from '../utils/whatsapp';

const OTP_LENGTH = 6;

/**
 * Codes are stored as SHA-256 digests, never in the clear — a database read must
 * not hand someone a working second factor.
 *
 * Note: admin-backend accepts a static MASTER_OTP ('313313' by default) for any
 * account. That is deliberately not reproduced here; HRMS holds salary and PAN
 * data, and a shared bypass code would make the second factor decorative.
 */
const hashCode = (code: string): string =>
  crypto.createHash('sha256').update(code).digest('hex');

const generateCode = (): string =>
  crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');

export class OtpService implements IOtpService {
  constructor(private readonly authRepository: IAuthRepository) {}

  async issue(
    employeeId: number,
    deliverTo: string,
    purpose: OtpPurpose,
    ipAddress: string | null,
  ): Promise<OtpChallenge> {
    // Only one live code per employee per purpose — a new request supersedes the old.
    await this.authRepository.consumeOpenOtps(employeeId, purpose);

    const code = generateCode();
    const challengeId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + env.otp.ttlMinutes * 60 * 1000);
    const masked = maskEmail(deliverTo);

    await this.authRepository.createOtp({
      challengeToken: challengeId,
      employeeId,
      purpose,
      codeHash: hashCode(code),
      maxAttempts: env.otp.maxAttempts,
      sentTo: masked,
      expiresAt,
      ipAddress,
    });

    await this.deliver(employeeId, deliverTo, code, purpose);

    return {
      challengeId,
      sentTo: masked,
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: new Date(
        Date.now() + env.otp.resendCooldownSeconds * 1000,
      ).toISOString(),
    };
  }

  async resend(challengeId: string, ipAddress: string | null): Promise<OtpChallenge> {
    const existing = await this.authRepository.findOtpByChallenge(challengeId);
    if (!existing) {
      throw new ApiError(400, 'That request has expired. Start again.');
    }

    const secondsSinceLast = await this.authRepository.secondsSinceLastOtp(
      existing.employeeId,
      existing.purpose,
    );
    const remaining = env.otp.resendCooldownSeconds - secondsSinceLast;
    if (remaining > 0) {
      // 429 so the client can show a countdown rather than a generic failure.
      throw new ApiError(429, `Wait ${remaining} more second${remaining === 1 ? '' : 's'} before asking for a new code.`);
    }

    const targets = await this.authRepository.findDeliveryTargets(existing.employeeId);
    if (!targets?.email) {
      throw new ApiError(422, 'There is no email address on file to send a code to. Contact HR.');
    }

    return this.issue(existing.employeeId, targets.email, existing.purpose, ipAddress);
  }

  async verify(
    challengeId: string,
    code: string,
    purpose: OtpPurpose,
    options: { consume?: boolean } = {},
  ): Promise<number> {
    const consume = options.consume ?? true;
    const stored = await this.authRepository.findOtpByChallenge(challengeId);

    // One message for every failure mode: unknown challenge, wrong purpose,
    // already used, expired, or simply the wrong digits.
    const invalid = new ApiError(401, 'That code is not valid or has expired.');

    if (!stored || stored.purpose !== purpose || stored.consumed) throw invalid;

    if (stored.expired) {
      await this.authRepository.consumeOtp(stored.id);
      throw invalid;
    }

    if (stored.attempts >= stored.maxAttempts) {
      await this.authRepository.consumeOtp(stored.id);
      throw new ApiError(429, 'Too many incorrect attempts. Ask for a new code.');
    }

    if (!crypto.timingSafeEqual(Buffer.from(hashCode(code.trim())), Buffer.from(stored.codeHash))) {
      const attempts = await this.authRepository.incrementOtpAttempts(stored.id);
      if (attempts >= stored.maxAttempts) {
        await this.authRepository.consumeOtp(stored.id);
        throw new ApiError(429, 'Too many incorrect attempts. Ask for a new code.');
      }
      throw invalid;
    }

    // A non-consuming check lets the reset UI gate the new-password screen on a
    // correct code. The code stays single-use overall — reset-password consumes it.
    if (consume) {
      await this.authRepository.consumeOtp(stored.id);
    }
    return stored.employeeId;
  }

  /**
   * Both channels are attempted independently, so one failing does not stop the
   * other. A suppressed email address or a stale mobile number should never be
   * enough on its own to lock someone out.
   */
  private async deliver(
    employeeId: number,
    to: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    const targets = await this.authRepository.findDeliveryTargets(employeeId);
    const mobile = targets?.mobile ?? null;

    if (!isMailConfigured() && !isWhatsappConfigured()) {
      deliverOtpFallback(to, code, purpose);
      return;
    }

    // Fire-and-forget on both: the code is already stored, so the HTTP response
    // should not wait on either provider. Failures are logged; the user can resend.
    if (isMailConfigured()) {
      const mailPurpose = purpose === 'forgot_password' ? 'forgot_password' : 'login';
      const { subject, html, text } = buildOtpEmail(code, mailPurpose, env.otp.ttlMinutes);
      void sendMail({ to, subject, html, text })
        .then(() => console.log(`[OTP] ${purpose} code emailed to ${maskEmail(to)}`))
        .catch((err: Error) => console.error(`[OTP] Email failed for ${maskEmail(to)}:`, err.message));
    }

    if (isWhatsappConfigured() && isPlausibleMobile(mobile)) {
      const number = toWhatsappNumber(mobile);
      void sendOtpWhatsapp(number, code)
        .then(() => console.log(`[OTP] ${purpose} code sent on WhatsApp to ${number.slice(-4).padStart(number.length, '•')}`))
        .catch((err: Error) => console.error('[OTP] WhatsApp failed:', err.message));
    } else if (isWhatsappConfigured()) {
      console.warn(`[OTP] No usable mobile on file for employee ${employeeId} — email only.`);
    }
  }
}
