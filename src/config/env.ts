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
    // Postmark over HTTPS, matching admin-backend — the production host blocks
    // outbound SMTP, so port 587 is not an option.
    postmarkToken: process.env.POSTMARK_TOKEN ?? '',
    from: process.env.EMAIL_FROM ?? '',
    fromName: process.env.MAIL_NAME ?? 'Bambinos HRMS',
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
    radiusM: Number.parseFloat(process.env.OFFICE_RADIUS_M ?? '100'),
    homeRadiusM: Number.parseFloat(process.env.HOME_RADIUS_M ?? '100'),
    // Hidden margin for GPS drift, added to both radii but never shown: the
    // screens say "within 100 m" while the check allows 100 + 100 = 200 m.
    graceM: Number.parseFloat(process.env.GEOFENCE_GRACE_M ?? '100'),
    // A reading vaguer than ±this is "not precise enough". 150 lets ordinary
    // indoor phone and laptop readings through; IP-only guesses (±1 km+) still fail.
    maxAccuracyM: Number.parseFloat(process.env.OFFICE_MAX_ACCURACY_M ?? '150'),
  },
} as const;

export const isProduction = env.nodeEnv === 'production';
