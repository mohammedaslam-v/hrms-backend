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
  corsOrigin: required('CORS_ORIGIN', 'http://localhost:5173'),
} as const;

export const isProduction = env.nodeEnv === 'production';
