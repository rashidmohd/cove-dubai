/**
 * Cove Dubai booking API — service entry point.
 *
 * This service is the seam. The Next.js front-end talks to it over HTTP and
 * never touches the database; all reservation work here goes through the
 * `BookingProvider` interface (see the `pms-readiness` skill).
 */
import { createApp } from './app.js';
import { config } from './config.js';
import { disconnectPrisma } from './db/prisma.js';

const server = createApp().listen(config.port, () => {
  console.log(
    `[cove-dubai/server] listening on port ${config.port} (${config.nodeEnv})`,
  );
});

// Let the platform replace the process cleanly on deploy: stop accepting new
// connections, then close the database pool. Skipping the disconnect leaves
// connections held until Postgres times them out, which on a small Railway
// instance can exhaust the connection limit across a few rapid deploys.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[cove-dubai/server] ${signal} received, shutting down`);
    server.close(() => {
      void disconnectPrisma().finally(() => process.exit(0));
    });
  });
}
