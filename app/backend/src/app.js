import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { requestLogger } from './logger.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.routes.js';
import { taskRouter } from './routes/task.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);

  // Every route lives under /api: CloudFront sends /api/* to this server and
  // everything else to the React build in S3.
  app.use('/api/health', healthRouter);
  app.use('/api/tasks', taskRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
