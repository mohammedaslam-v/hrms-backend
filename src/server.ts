import http from 'http';
import { createApp } from './app';
import { closePool, getPool } from './config/database';
import { env } from './config/env';

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

server.listen(env.port, () => {
  console.log(`HRMS API listening on http://localhost:${env.port}`);
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
