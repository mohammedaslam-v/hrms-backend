import mysql, { Pool } from 'mysql2/promise';
import { env } from './env';

let pool: Pool | null = null;

export const getPool = (): Pool => {
  if (!pool) {
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.name,
      waitForConnections: true,
      connectionLimit: env.db.connectionLimit,
      // DATE/DATETIME come back as plain strings, avoiding timezone drift in JSON responses
      dateStrings: true,
    });
  }
  return pool;
};

export const closePool = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
