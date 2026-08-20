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
} as const;
