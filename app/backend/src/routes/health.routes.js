import { Router } from 'express';
import { config } from '../config.js';
import { isDatabaseReady } from '../db.js';

export const healthRouter = Router();

// Used by Docker (container healthcheck), the deploy script (smoke test) and the
// CloudWatch "AppHealthy" metric. Returns 503 when MongoDB is unreachable.
healthRouter.get('/', (_req, res) => {
  const databaseUp = isDatabaseReady();
  res
    .status(databaseUp ? 200 : 503)
    .set('Cache-Control', 'no-store')
    .json({
      status: databaseUp ? 'ok' : 'degraded',
      database: databaseUp ? 'up' : 'down',
      version: config.appVersion,
      environment: config.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
});
