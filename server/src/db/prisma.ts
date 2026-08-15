/**
 * The Prisma client.
 *
 * This module is the only place the database connection is created, and only
 * code below the BookingProvider seam may import it. If anything in
 * `src/routes/` imports this, the seam has been breached — routes talk to the
 * provider interface, never to Prisma (`pms-readiness`).
 */
import { PrismaClient } from '@prisma/client';

import { config } from '../config.js';

export const prisma = new PrismaClient({
  datasources: { db: { url: config.databaseUrl } },
  log:
    config.nodeEnv === 'development'
      ? ['warn', 'error']
      : ['error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
