import https from 'https';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { env, isProduction } from '../config/env';

/**
 * Email goes out over HTTPS, never SMTP — the production host blocks outbound
 * port 587. Two providers are wired in and EMAIL_PROVIDER picks one at send time:
 *
 *   ses       Amazon SES (SESv2 SendEmail) — the default since Nov 2026, same AWS
 *             account the faculty and admin backends send from.
 *   postmark  The provider before that. Kept as the emergency switch: if SES has
 *             a problem (bounce rate review, account paused) ops set
 *             EMAIL_PROVIDER=postmark in Cloud Run and every email goes through
 *             Postmark with no code change; set it back to ses afterwards.
 *
 * Both need their own credentials present (SES_AWS_* or POSTMARK_TOKEN); the
 * inactive provider's keys may be left set so the switch works either way.
 */
export type MailProvider = 'ses' | 'postmark';

const POSTMARK_HOST = 'api.postmarkapp.com';
const POSTMARK_PATH = '/email';

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Pure: maps the raw EMAIL_PROVIDER value to a provider. Anything that is not
 * exactly "postmark" (case/space-insensitive) means SES, so an unset variable
 * or a typo never silently routes to the fallback provider.
 */
export const pickMailProvider = (raw: string | undefined): MailProvider =>
  (raw ?? '').trim().toLowerCase() === 'postmark' ? 'postmark' : 'ses';

let warnedAboutProvider = false;

/** Read on every send, not at import, so a Cloud Run env change is all it takes. */
export function mailProvider(): MailProvider {
  const raw = process.env.EMAIL_PROVIDER;
  const provider = pickMailProvider(raw);
  const cleaned = (raw ?? '').trim().toLowerCase();
  if (cleaned && cleaned !== 'ses' && cleaned !== 'postmark' && !warnedAboutProvider) {
    warnedAboutProvider = true;
    console.warn(`[Mail] EMAIL_PROVIDER="${raw}" is not "ses" or "postmark" — sending through SES`);
  }
  return provider;
}

const isSesConfigured = (): boolean =>
  Boolean(env.mail.ses.accessKeyId && env.mail.ses.secretAccessKey && env.mail.from);
const isPostmarkConfigured = (): boolean => Boolean(env.mail.postmarkToken && env.mail.from);

/** True when the provider EMAIL_PROVIDER currently selects has its credentials. */
export const isMailConfigured = (): boolean =>
  mailProvider() === 'postmark' ? isPostmarkConfigured() : isSesConfigured();

/**
 * SES rejects the whole send if a tag value has anything but letters, digits,
 * '_' or '-', so a stray character in EMAIL_SOURCE is cleaned rather than
 * turning every email into a failure.
 */
const emailSourceTag = (): string =>
  env.mail.ses.source.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) || 'hrms';

let sesClient: SESv2Client | null = null;

/** One client per process, built on first use. */
function getSesClient(): SESv2Client {
  if (sesClient) return sesClient;
  sesClient = new SESv2Client({
    region: env.mail.ses.region,
    credentials: {
      accessKeyId: env.mail.ses.accessKeyId,
      secretAccessKey: env.mail.ses.secretAccessKey,
    },
    // The SDK retries throttling / 5xx with backoff; 3 attempts keeps an OTP fast.
    maxAttempts: 3,
    // Fail a stuck call instead of leaving the send hanging on it.
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 10_000 },
  });
  return sesClient;
}

export async function sendMail(opts: MailOptions): Promise<void> {
  const provider = mailProvider();
  if (provider === 'postmark') {
    if (!isPostmarkConfigured()) {
      throw new Error('EMAIL_PROVIDER=postmark but Postmark is not configured (set POSTMARK_TOKEN and MAIL_FROM)');
    }
    return sendViaPostmark(opts);
  }
  if (!isSesConfigured()) {
    throw new Error('SES is not configured (set SES_AWS_ACCESS_KEY_ID, SES_AWS_SECRET_ACCESS_KEY and MAIL_FROM)');
  }
  return sendViaSes(opts);
}

async function sendViaSes(opts: MailOptions): Promise<void> {
  const configurationSet = env.mail.ses.configurationSet;
  const command = new SendEmailCommand({
    FromEmailAddress: `${env.mail.fromName} <${env.mail.from}>`,
    Destination: { ToAddresses: [opts.to] },
    Content: {
      Simple: {
        Subject: { Data: opts.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: opts.html, Charset: 'UTF-8' },
          Text: { Data: opts.text, Charset: 'UTF-8' },
        },
      },
    },
    // Lets a bounce/complaint event (and the SES console) say which backend sent it.
    EmailTags: [{ Name: 'source', Value: emailSourceTag() }],
    ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
  });

  try {
    await getSesClient().send(command);
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    // A wrong or deleted SES_CONFIGURATION_SET would otherwise fail EVERY OTP.
    // Send without it and shout in the log: losing bounce tracking for a while is
    // far better than nobody being able to sign in.
    if (configurationSet && e?.name === 'NotFoundException') {
      console.error(
        `[Mail] SES configuration set "${configurationSet}" not found — sending without it; ` +
          'bounce tracking is OFF until SES_CONFIGURATION_SET is fixed',
      );
      command.input.ConfigurationSetName = undefined;
      await getSesClient().send(command);
      return;
    }
    // e.g. MessageRejected, AccountSuspendedException, SendingPausedException,
    // TooManyRequestsException, BadRequestException, TimeoutError.
    throw new Error(`SES ${e?.name ?? 'error'}${e?.$metadata?.httpStatusCode ? ` (${e.$metadata.httpStatusCode})` : ''}: ${e?.message ?? ''}`);
  }
}

async function sendViaPostmark(opts: MailOptions): Promise<void> {
  const payload = JSON.stringify({
    From: `${env.mail.fromName} <${env.mail.from}>`,
    To: opts.to,
    Subject: opts.subject,
    HtmlBody: opts.html,
    TextBody: opts.text,
    MessageStream: 'outbound',
  });

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        host: POSTMARK_HOST,
        path: POSTMARK_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Postmark-Server-Token': env.mail.postmarkToken,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
            return;
          }
          reject(new Error(`Postmark responded ${status}: ${Buffer.concat(chunks).toString()}`));
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Development fallback. With no email credentials the code is printed to the
 * server console so local sign-in still works. Refuses to do this in production,
 * where a silent console-only OTP would look like a working email system.
 */
export function deliverOtpFallback(to: string, code: string, purpose: string): void {
  if (isProduction) {
    console.error(`[OTP] Cannot deliver ${purpose} code to ${to} — email provider "${mailProvider()}" is not configured.`);
    return;
  }
  console.log(
    `\n  ┌─ DEV OTP ─────────────────────────────────\n` +
      `  │  ${purpose}  →  ${to}\n` +
      `  │  code: ${code}\n` +
      `  └───────────────────────────────────────────\n`,
  );
}

export function buildOtpEmail(
  code: string,
  purpose: 'login' | 'forgot_password' | 'step_up',
  ttlMinutes: number,
): { subject: string; html: string; text: string } {
  const isReset = purpose === 'forgot_password';
  const isStepUp = purpose === 'step_up';
  // One source of truth for the product name: MAIL_NAME ("Bambinos Bconnect").
  // The header drops the company prefix so it reads "bambinos. Bconnect".
  const brand = env.mail.fromName;
  const product = brand.replace(/^bambinos\.?\s*/i, '') || brand;

  const subject = isReset
    ? `${code} is your ${brand} password reset code`
    : isStepUp
      ? `${code} is your Bambinos authorization code for payout approval`
      : `${code} is your ${brand} verification code`;

  const intro = isReset
    ? `Use the code below to reset your ${brand} password.`
    : isStepUp
      ? 'Use the authorization code below to approve and release company funds via RazorpayX.'
      : `Use the code below to finish signing in to ${brand}.`;

  const text =
    `Your ${brand} verification code is ${code}. ` +
    `It expires in ${ttlMinutes} minutes. ` +
    `If you didn't request this, you can ignore this email.`;

  const html = `
  <div style="background:#F1ECE5; padding:24px 12px; font-family:Inter,Arial,Helvetica,sans-serif;">
    <table role="presentation" align="center" width="460" cellpadding="0" cellspacing="0" border="0"
           style="width:100%; max-width:460px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #EDE7DE;">
      <tr>
        <td style="background:#2563EB; padding:22px; text-align:center;">
          <span style="color:#ffffff; font-size:20px; font-weight:800;">bambinos. ${product}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px;">
          <h2 style="margin:0 0 12px; font-size:18px; color:#0F1729;">Verification code</h2>
          <p style="margin:0 0 20px; font-size:14px; line-height:1.5; color:#344054;">${intro}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background:#EAF0FE; border:1px solid #C7D8FB; border-radius:12px; padding:16px; text-align:center;">
                <span style="font-size:30px; font-weight:800; letter-spacing:10px; color:#2563EB; padding-left:10px;">${code}</span>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 10px; font-size:13px; color:#344054;">This code expires in <strong>${ttlMinutes} minutes</strong>.</p>
          <p style="margin:0; font-size:13px; color:#8A8578;">If you didn't request this, you can safely ignore this email.</p>
        </td>
      </tr>
      <tr>
        <td style="border-top:1px solid #F4EFE8; padding:16px; text-align:center;">
          <span style="font-size:12px; color:#8A8578;">&copy; Bambinos Learning Private Limited</span>
        </td>
      </tr>
    </table>
  </div>`;

  return { subject, html, text };
}
