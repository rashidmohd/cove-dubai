/**
 * Booking reference generation.
 *
 * The reference is the booking's public identity — it appears in URLs, emails,
 * and on the phone when a guest calls the front desk. Internal database ids are
 * never exposed anywhere (`pms-readiness`), so this is the only handle the
 * outside world has on a reservation.
 *
 * Requirements from the `booking-engine` skill: unique, human-friendly, and
 * non-sequential. Non-sequential matters for more than neatness — a guessable
 * reference would let anyone enumerate other guests' bookings through the
 * lookup and cancellation endpoints.
 *
 * Format: `CV-2026-482137`.
 *
 * The skill's example shows four digits. This uses six deliberately: four gives
 * only 10,000 references per year, and at the booking volume a 106-room hotel
 * expects, collisions would become common enough to matter. Six gives a million
 * per year and keeps the reference just as easy to read aloud.
 */
import { randomInt } from 'node:crypto';

const DIGITS = 6;
const MIN = 10 ** (DIGITS - 1);
const MAX = 10 ** DIGITS;

/**
 * Generate a candidate reference.
 *
 * Uses `crypto.randomInt` rather than `Math.random`, which is not
 * cryptographically random and would make references predictable.
 *
 * This is only a *candidate*: uniqueness is guaranteed by the unique constraint
 * on the column, never by this function. The caller inserts and retries on a
 * conflict — checking for existence first would be a race.
 */
export function generateBookingReference(date = new Date()): string {
  const year = date.getUTCFullYear();
  return `CV-${year}-${randomInt(MIN, MAX)}`;
}

/** Matches the format above. Used to reject junk before hitting the database. */
export const BOOKING_REFERENCE_PATTERN = /^CV-\d{4}-\d{6}$/;

export function isValidBookingReference(value: string): boolean {
  return BOOKING_REFERENCE_PATTERN.test(value);
}
