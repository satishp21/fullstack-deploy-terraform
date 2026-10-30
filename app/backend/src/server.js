import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import authRoutes from './routes/authRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import deviceRoutes from './routes/deviceRoutes.js';
import rateRoutes from './routes/rateRoutes.js';
import sessionRoutes from './routes/sessionRoutes.js';
import userRoutes from './routes/userRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import contactRoutes from './routes/contactRoutes.js';

dotenv.config();

const app = express();
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 2);
}

// Middleware
// configure CORS.  We prefer an explicit front‑end URL so the Access-Control-
// Allow-Origin header matches exactly what the browser sends; using `true` will
// echo the incoming origin.  It's important that the origin value contains **no
// trailing slash** because browsers compare strings literally and will reject a
// mismatch.  Users often accidentally include a slash in the CLIENT_URL env var
// (see the Vercel screenshot) which caused a permanent CORS failure in prod.
//
// Strip any trailing slash from the environment variable as a safeguard.
let clientUrl = process.env.CLIENT_URL || '';
if (clientUrl.endsWith('/')) {
  clientUrl = clientUrl.slice(0, -1);
}
const corsOptions = {
  origin: clientUrl || true, // `true` echoes back request origin when no URL
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

// Basic health check
app.get('/api/health', (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  res
    .status(databaseConnected ? 200 : 503)
    .json({ status: databaseConnected ? 'ok' : 'degraded' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/rates', rateRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/contact', contactRoutes);

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ message: err.message || 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 5000;
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const startServer = async () => {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected');
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});

export default app;
