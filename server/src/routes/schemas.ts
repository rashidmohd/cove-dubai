/**
 * Request validation schemas.
 *
 * All input is validated and sanitised server-side, in the API — the
 * non-negotiable baseline in CLAUDE.md. The front-end validates too, but only
 * for the guest's benefit; nothing here trusts it.
 */
import { z } from 'zod';

import { isValidIsoDate } from '../booking/dates.js';
import { BOOKING_REFERENCE_PATTERN } from '../booking/reference.js';

/** A calendar day. Rejects impossible dates like 2026-02-31. */
const isoDate = z
  .string()
  .refine(isValidIsoDate, 'Must be a valid date in YYYY-MM-DD format.');

const localeSchema = z.enum(['en', 'ar']);

/** Trimmed, length-bounded free text. */
const text = (max: number) => z.string().trim().min(1).max(max);

export const availabilityQuerySchema = z.object({
  checkIn: isoDate,
  checkOut: isoDate,
  adults: z.coerce.number().int().min(1).max(20),
  children: z.coerce.number().int().min(0).max(20).default(0),
  roomsCount: z.coerce.number().int().min(1).max(10).default(1),
});

export const rateQuerySchema = z.object({
  roomTypeCode: text(60),
  checkIn: isoDate,
  checkOut: isoDate,
  roomsCount: z.coerce.number().int().min(1).max(10).default(1),
});

export const createReservationSchema = z.object({
  roomTypeCode: text(60),
  checkIn: isoDate,
  checkOut: isoDate,
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20).default(0),
  roomsCount: z.number().int().min(1).max(10).default(1),
  guest: z.object({
    firstName: text(80),
    lastName: text(80),
    email: z.string().trim().toLowerCase().email().max(160),
    // Deliberately permissive: guests come from everywhere and an
    // over-strict pattern rejects legitimate international numbers.
    phone: z
      .string()
      .trim()
      .min(6)
      .max(30)
      .regex(/^[+()\d\s-]+$/, 'Phone number contains invalid characters.'),
    locale: localeSchema.default('en'),
  }),
  specialRequests: z.string().trim().max(2000).optional(),
});

export const bookingReferenceSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(BOOKING_REFERENCE_PATTERN, 'Not a valid booking reference.');

export const cancelReservationSchema = z.object({
  /** Proves the requester holds the emailed cancellation link. */
  token: z.string().trim().min(1).max(200),
});

export const reservationFilterSchema = z.object({
  status: z
    .enum(['held', 'confirmed', 'cancelled', 'checked-in', 'checked-out'])
    .optional(),
  roomTypeCode: text(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const dateRangeSchema = z.object({
  from: isoDate,
  to: isoDate,
});
