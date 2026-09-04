import { env } from '../config/env';

/**
 * WhatsApp delivery through Heltar, mirroring admin-backend's utils/whatsapp.ts
 * so both portals send the OTP through the same provider and the same approved
 * `otp` template.
 */
const HELTAR_BASE_URL = 'https://api.heltar.com/v1';

interface TemplateComponent {
  type: string;
  sub_type?: string;
  index?: number;
  parameters: Array<{ type: string; text: string }>;
}

export const isWhatsappConfigured = (): boolean =>
  env.whatsapp.enabled && Boolean(env.whatsapp.apiKey);

/**
 * Normalise a stored mobile into the digits-only form Heltar expects.
 * Bare 10-digit numbers get India's country code, matching the Laravel app.
 */
export function toWhatsappNumber(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return digits.length > 10 ? digits : `91${digits}`;
}

/** Numbers like `1` exist in `admins.mobile` — never worth a send attempt. */
export function isPlausibleMobile(mobile: string | null): mobile is string {
  if (!mobile) return false;
  const digits = mobile.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

async function sendTemplate(
  mobile: string,
  templateName: string,
  variables: TemplateComponent[],
  languageCode = 'en',
): Promise<void> {
  const response = await fetch(`${HELTAR_BASE_URL}/messages/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.whatsapp.apiKey}`,
    },
    body: JSON.stringify({
      messages: [
        { clientWaNumber: mobile, templateName, languageCode, variables, messageType: 'template' },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Heltar send failed (${response.status}): ${detail.slice(0, 300)}`);
  }
}

/**
 * The `otp` template carries the code in both the message body and the URL
 * button, which is how the admin portal's template is approved.
 */
export async function sendOtpWhatsapp(mobile: string, code: string): Promise<void> {
  await sendTemplate(mobile, 'otp', [
    { type: 'body', parameters: [{ type: 'text', text: code }] },
    { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: code }] },
  ]);
}
