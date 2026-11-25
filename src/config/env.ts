import dotenv from 'dotenv';

dotenv.config();

const required = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const env = {
  nodeEnv: required('NODE_ENV', 'development'),
  port: Number.parseInt(required('PORT', '3000'), 10),
  db: {
    host: required('DB_HOST', 'localhost'),
    port: Number.parseInt(required('DB_PORT', '3306'), 10),
    user: required('DB_USER'),
    password: required('DB_PASSWORD', ''),
    name: required('DB_NAME'),
    connectionLimit: Number.parseInt(required('DB_CONNECTION_LIMIT', '10'), 10),
  },
  auth: {
    // HRMS signs its own tokens. A compromise of admin-backend must not mint HRMS sessions.
    jwtSecret: required('JWT_SECRET'),
    accessTokenTtlMinutes: Number.parseInt(required('ACCESS_TOKEN_TTL_MINUTES', '15'), 10),
    refreshTokenTtlDays: Number.parseInt(required('REFRESH_TOKEN_TTL_DAYS', '7'), 10),
  },
  otp: {
    ttlMinutes: Number.parseInt(required('OTP_TTL_MINUTES', '5'), 10),
    maxAttempts: Number.parseInt(required('OTP_MAX_ATTEMPTS', '5'), 10),
    resendCooldownSeconds: Number.parseInt(required('OTP_RESEND_COOLDOWN_SECONDS', '60'), 10),
  },
  mail: {
    /**
     * Two providers, both over HTTPS (the production host blocks outbound SMTP):
     * Amazon SES (the default since Nov 2026, same AWS account as faculty/admin)
     * and Postmark, kept as the emergency switch. EMAIL_PROVIDER picks one; it is
     * read by utils/mailer at send time, not here, so a Cloud Run env change is
     * enough to flip it — no code change, no new image.
     *
     * Both spellings of the from/token keys are accepted so the same values the
     * faculty backend uses (MAIL_FROM, POSTMARK_API_TOKEN) work here unchanged.
     */
    from: process.env.MAIL_FROM ?? process.env.EMAIL_FROM ?? '',
    // Product name as employees see it (the app is Bconnect at bconnect.bambinos.live).
    // Also used inside the OTP email subject/body, so the rename lives here only.
    fromName: process.env.MAIL_NAME ?? 'Bambinos Bconnect',
    postmarkToken: process.env.POSTMARK_TOKEN ?? process.env.POSTMARK_API_TOKEN ?? '',
    ses: {
      // Dedicated SES_* names, never the generic AWS_* ones, so no other AWS
      // client in this process (GCS is Google, but still) picks them up by accident.
      region: process.env.SES_AWS_REGION ?? 'ap-southeast-2',
      accessKeyId: process.env.SES_AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.SES_AWS_SECRET_ACCESS_KEY ?? '',
      // Optional: the configuration set whose event destination reports bounces.
      configurationSet: process.env.SES_CONFIGURATION_SET ?? '',
      // "source" tag on every email so a bounce says which backend sent it.
      source: process.env.EMAIL_SOURCE ?? 'hrms',
    },
  },
  whatsapp: {
    // Second OTP channel. Email stays the guaranteed one, so a stale or missing
    // mobile can never lock anyone out — and vice versa.
    apiKey: process.env.HELTAR_API_KEY ?? '',
    enabled: (process.env.HELTAR_ENABLED ?? 'true') !== 'false',
  },
  razorpay: {
    key: process.env.RAZORPAY_KEY ?? '',
    secret: process.env.RAZORPAY_SECRET ?? '',
    account: process.env.RAZORPAY_ACCOUNT ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
    mode: (process.env.RAZORPAY_MODE ?? 'mock') as 'live' | 'test' | 'mock',
  },
  gcs: {
    /**
     * Unset means "write to ./uploads", which is what local development wants —
     * no service-account credentials needed to run the app. Set it in Cloud Run,
     * where the container filesystem does not survive a restart.
     *
     * Credentials come from Application Default Credentials, so there is no key
     * to put here: on Cloud Run that is the service account the revision runs as.
     */
    bucket: process.env.GCS_BUCKET ?? '',
    projectId: process.env.GCS_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? '',
  },
  /**
   * Directories to search for documents the old Laravel portal wrote, as a
   * comma-separated list. These used to be two absolute paths hardcoded into
   * profile.service — a developer's own machine, which matched nothing on the
   * server and made every legacy document download fail.
   *
   * Empty by default: no match is the honest answer when the files are not there.
   */
  legacyFileRoots: (process.env.LEGACY_FILE_ROOTS ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean),
  corsOrigin: required('CORS_ORIGIN', 'http://localhost:5173'),
  /**
   * The key salary figures are encrypted with: 32 random bytes, base64.
   * Required, with no fallback — without it no salary can be read or saved, so
   * the server refuses to start rather than fail on the first payslip.
   * Each environment has its own key; losing the live one loses every salary,
   * so a copy is kept outside the server. Never commit it.
   */
  compensationEncKey: required('COMPENSATION_ENC_KEY'),
  /**
   * Shared secret for server-to-server calls (admin-backend punching the signed-in
   * admin's own attendance from the admin panel header). Sent in `x-internal-key`.
   * Empty means the internal routes are switched off — they fail closed.
   */
  internalApiKey: process.env.INTERNAL_API_KEY ?? '',
  /**
   * The attendance geofence: WFO punch at the office or their home location,
   * WFH at their home location. The office defaults are Hustlehub Tech Park,
   * HSR Layout; each home point is per employee, in hrms_employees.
   * OFFICE_GEOFENCE_ENABLED=false switches every fence off without a code change.
   */
  geofence: {
    enabled: (process.env.OFFICE_GEOFENCE_ENABLED ?? 'true') !== 'false',
    lat: Number.parseFloat(process.env.OFFICE_LAT ?? '12.900510'),
    lng: Number.parseFloat(process.env.OFFICE_LNG ?? '77.650850'),
    // The radius people are told: the screens say "within 350 m".
    // Tightened from 500 on 19 Nov 2026: 500 + 300 let a café down the road pass.
    radiusM: Number.parseFloat(process.env.OFFICE_RADIUS_M ?? '350'),
    homeRadiusM: Number.parseFloat(process.env.HOME_RADIUS_M ?? '500'),
    // Hidden margin for GPS drift, added to the radius but never shown.
    // Home and second places: 500 + 300 = 800 m.
    graceM: Number.parseFloat(process.env.GEOFENCE_GRACE_M ?? '300'),
    // The office has its own, smaller margin: 350 + 150 = 500 m.
    officeGraceM: Number.parseFloat(process.env.OFFICE_GRACE_M ?? '150'),
    // A reading vaguer than ±this is "not precise enough". 200 lets ordinary
    // indoor phone and laptop Wi-Fi readings through; IP-only guesses (±1 km+) still fail.
    maxAccuracyM: Number.parseFloat(process.env.OFFICE_MAX_ACCURACY_M ?? '200'),
  },
} as const;

export const isProduction = env.nodeEnv === 'production';
