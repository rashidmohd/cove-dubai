/**
 * Booking provider wiring.
 *
 * **This is the one line that changes when the hotel moves to a PMS.**
 *
 * Everything above the seam — every route, the HTTP contract, and the entire
 * front-end — resolves its provider through here. Phase 2 means writing one new
 * class implementing `BookingProvider` and returning it below. Nothing else in
 * the codebase needs to know.
 */
import { prisma } from '../db/prisma.js';
import { CustomDbProvider } from './custom-db.provider.js';
import type { BookingProvider } from './provider.js';

let provider: BookingProvider | undefined;

export function getBookingProvider(): BookingProvider {
  provider ??= new CustomDbProvider(prisma);
  return provider;
}

/** Swap the provider in tests. */
export function setBookingProvider(next: BookingProvider): void {
  provider = next;
}

export type { BookingProvider };
