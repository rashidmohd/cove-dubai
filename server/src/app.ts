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
import { sessionMiddleware } from './auth/session.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { adminRouter } from './routes/admin.routes.js';
import { authRouter } from './routes/auth.routes.js';
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

  // Mounted for the whole app rather than only under /api/admin, because the
  // login and logout routes need it too. It writes nothing for anonymous
  // requests, so guest booking traffic pays only the cookie parse.
  app.use(sessionMiddleware());

  /** Liveness probe for Railway, and later an AWS target group. */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', bookingRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
