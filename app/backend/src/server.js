import { createApp } from './app.js';
import { config } from './config.js';
import { connectToDatabase, disconnectFromDatabase } from './db.js';
import { logger } from './logger.js';

async function start() {
  await connectToDatabase(config.mongodbUri);

  const server = createApp().listen(config.port, () => {
    logger.info('API listening', { port: config.port, version: config.appVersion, env: config.nodeEnv });
  });

  // Keep idle connections open longer than the reverse proxy does, otherwise the proxy
  // can reuse a socket Node has just closed and return an intermittent 502.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // Graceful shutdown: Docker sends SIGTERM on every redeploy.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    server.close(async () => {
      await disconnectFromDatabase().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error('Failed to start', { error: err.message, stack: err.stack });
  process.exit(1);
});
