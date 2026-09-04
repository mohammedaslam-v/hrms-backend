import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Application } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { createContainer } from './container';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { createApiRouter } from './routes';

export const createApp = (): Application => {
  const app = express();
  const container = createContainer();

  // Behind the Vite dev proxy (and any real proxy) req.ip must reflect the caller,
  // since it is written to the session and audit rows.
  app.set('trust proxy', 1);

  app.use(helmet());
  // credentials:true is required for the httpOnly refresh cookie to travel.
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api/v1', createApiRouter(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
