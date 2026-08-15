/**
 * Calendar-day helpers.
 *
 * A hotel stay is a range of calendar days, not a range of instants. Dubai is
 * UTC+4 and the server may run anywhere, so anything that converts through a
 * local timezone can shift a date across midnight and book the wrong night.
 *
 * Every date here is therefore handled as a `YYYY-MM-DD` string or as a `Date`
 * pinned to midnight UTC, which is exactly how Postgres `date` columns round
 * trip through Prisma. Nothing in the booking path uses local time.
 */
import type { IsoDate } from './types.js';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = toUtcDate(value);
  // Rejects real-looking but impossible dates such as 2026-02-31, which would
  // otherwise roll silently into March.
  return toIsoDate(parsed) === value;
}

/** `YYYY-MM-DD` -> midnight UTC. */
export function toUtcDate(date: IsoDate): Date {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day));
}

/** A `Date` -> `YYYY-MM-DD`, read in UTC. */
export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Today as `YYYY-MM-DD`, in UTC. */
export function today(): IsoDate {
  return toIsoDate(new Date());
}

/**
 * Every night a stay occupies.
 *
 * Check-in inclusive, check-out exclusive — 12th → 14th yields the 12th and
 * 13th. These are precisely the inventory rows a booking must commit.
 */
export function nightsBetween(checkIn: IsoDate, checkOut: IsoDate): IsoDate[] {
  const nights: IsoDate[] = [];
  let current = checkIn;
  while (current < checkOut) {
    nights.push(current);
    current = addDays(current, 1);
  }
  return nights;
}

export function countNights(checkIn: IsoDate, checkOut: IsoDate): number {
  const ms = toUtcDate(checkOut).getTime() - toUtcDate(checkIn).getTime();
  return Math.round(ms / 86_400_000);
}
