/**
 * Express application assembly.
 *
 * Kept separate from `index.ts` so tests can exercise the app without binding
 * a port.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { bookingRouter } from './routes/booking.routes.js';

export function createApp() {
  const app = express();

  // Behind Railway's proxy (and later an AWS load balancer), so the client IP
  // arrives in X-Forwarded-For. Without this, rate limiting would see every
  // request as coming from the proxy and throttle all guests as one.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      // Env-driven per environment, never hardcoded — a wrong origin here is
      // the most common first-deploy failure (`deployment` skill).
      origin: config.corsAllowedOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  /** Liveness probe for Railway, and later an AWS target group. */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', bookingRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
