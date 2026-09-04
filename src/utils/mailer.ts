import https from 'https';
import { env, isProduction } from '../config/env';

/**
 * Email goes out over the Postmark HTTP API, not SMTP — the production host
 * blocks outbound port 587, which is why admin-backend made the same choice.
 */
const POSTMARK_HOST = 'api.postmarkapp.com';
const POSTMARK_PATH = '/email';

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export const isMailConfigured = (): boolean => Boolean(env.mail.postmarkToken && env.mail.from);

export async function sendMail(opts: MailOptions): Promise<void> {
  if (!isMailConfigured()) {
    throw new Error('Postmark is not configured (set POSTMARK_TOKEN and EMAIL_FROM)');
  }

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
 * Development fallback. With no Postmark credentials the code is printed to the
 * server console so local sign-in still works. Refuses to do this in production,
 * where a silent console-only OTP would look like a working email system.
 */
export function deliverOtpFallback(to: string, code: string, purpose: string): void {
  if (isProduction) {
    console.error(`[OTP] Cannot deliver ${purpose} code to ${to} — Postmark is not configured.`);
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
  purpose: 'login' | 'forgot_password',
  ttlMinutes: number,
): { subject: string; html: string; text: string } {
  const isReset = purpose === 'forgot_password';

  const subject = isReset
    ? `${code} is your Bambinos HRMS password reset code`
    : `${code} is your Bambinos HRMS verification code`;
  const intro = isReset
    ? 'Use the code below to reset your Bambinos HRMS password.'
    : 'Use the code below to finish signing in to Bambinos HRMS.';

  const text =
    `Your Bambinos HRMS verification code is ${code}. ` +
    `It expires in ${ttlMinutes} minutes. ` +
    `If you didn't request this, you can ignore this email.`;

  const html = `
  <div style="background:#F1ECE5; padding:24px 12px; font-family:Inter,Arial,Helvetica,sans-serif;">
    <table role="presentation" align="center" width="460" cellpadding="0" cellspacing="0" border="0"
           style="width:100%; max-width:460px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #EDE7DE;">
      <tr>
        <td style="background:#2563EB; padding:22px; text-align:center;">
          <span style="color:#ffffff; font-size:20px; font-weight:800;">bambinos. HRMS</span>
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
