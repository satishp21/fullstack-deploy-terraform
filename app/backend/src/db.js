import mongoose from 'mongoose';
import { logger } from './logger.js';

const MAX_ATTEMPTS = 10;

export async function connectToDatabase(uri) {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error', { error: err.message }));

  // Retry the first connection so the API tolerates starting before the database is reachable.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000, maxPoolSize: 10 });
      return;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      const delayMs = Math.min(1_000 * 2 ** attempt, 15_000);
      logger.warn('MongoDB connection failed, retrying', { attempt, delayMs, error: err.message });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectFromDatabase() {
  await mongoose.disconnect();
}
