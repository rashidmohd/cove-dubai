/**
 * Cove Dubai booking API — service entry point.
 *
 * This service is the seam. The Next.js front-end talks to it over HTTP and
 * never touches the database; all reservation work here goes through the
 * `BookingProvider` interface (see the `pms-readiness` skill).
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { config } from './config.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.corsAllowedOrigins,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

/** Liveness probe — used by Railway (and later an AWS target group). */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const server = app.listen(config.port, () => {
  console.log(
    `[cove-dubai/server] listening on port ${config.port} (${config.nodeEnv})`,
  );
});

// Let the platform replace the container/process cleanly on deploy.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[cove-dubai/server] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}

export { app };
