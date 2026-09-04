import http from 'http';
import { createApp } from './app';
import { closePool, getPool } from './config/database';
import { env, isProduction } from './config/env';
import { isMailConfigured } from './utils/mailer';
import { isWhatsappConfigured } from './utils/whatsapp';

const app = createApp();
const server = http.createServer(app);

const checkDatabaseConnection = async (): Promise<void> => {
  try {
    const connection = await getPool().getConnection();
    await connection.ping();
    connection.release();
    console.log(`Database connected: ${env.db.user}@${env.db.host}:${env.db.port}/${env.db.name}`);
  } catch (err) {
    console.error('Database connection failed:', err instanceof Error ? err.message : err);
  }
};

/**
 * Delivery config is reported at boot. Without this, a missing credential looks
 * identical to a working setup until someone fails to receive a code — the
 * fallback quietly prints to the console instead.
 */
const reportDeliveryChannels = (): void => {
  const email = isMailConfigured();
  const whatsapp = isWhatsappConfigured();

  console.log(`OTP delivery — email: ${email ? `on (${env.mail.from})` : 'OFF'}` +
    ` · whatsapp: ${whatsapp ? 'on' : 'OFF'}`);

  if (!email && !whatsapp) {
    console.warn(
      isProduction
        ? '  !! No delivery channel configured. Nobody can sign in.'
        : '  Codes will be printed to this console (development fallback).',
    );
  }
};

server.listen(env.port, () => {
  console.log(`HRMS API listening on http://localhost:${env.port}`);
  reportDeliveryChannels();
  void checkDatabaseConnection();
});

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    closePool()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('Error closing database pool', err);
        process.exit(1);
      });
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
