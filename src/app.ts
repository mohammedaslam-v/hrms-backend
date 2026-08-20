import cors from 'cors';
import express, { Application } from 'express';
import helmet from 'helmet';
import { createContainer } from './container';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { createApiRouter } from './routes';

export const createApp = (): Application => {
  const app = express();
  const container = createContainer();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api/v1', createApiRouter(container));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
