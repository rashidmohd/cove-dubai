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

/** Uppercased and trimmed so it matches the stored form regardless of typing. */
const voucherCodeSchema = z.string().trim().toUpperCase().min(3).max(40);

/** Trimmed, length-bounded free text. */
const text = (max: number) => z.string().trim().min(1).max(max);

/** A child's age at check-in. Eighteen and over is an adult, not a child. */
const childAge = z.coerce.number().int().min(0).max(17);

/**
 * One age per child, and the count to match.
 *
 * `children` stays in the contract for callers that do not send ages; when
 * ages are sent it is derived from them, so the two cannot disagree. Both
 * given and disagreeing is refused rather than one silently winning.
 */
function withChildAges<T extends { children?: number | undefined; childAges?: number[] | undefined }>(
  stay: T,
  ctx: z.RefinementCtx,
): T & { children: number; childAges: number[] } {
  const childAges = stay.childAges ?? [];
  if (childAges.length > 0 && stay.children !== undefined && stay.children !== childAges.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['childAges'],
      message: 'Give one age per child.',
    });
  }
  return {
    ...stay,
    childAges,
    children: childAges.length > 0 ? childAges.length : (stay.children ?? 0),
  };
}

export const availabilityQuerySchema = z
  .object({
    checkIn: isoDate,
    checkOut: isoDate,
    adults: z.coerce.number().int().min(1).max(20),
    children: z.coerce.number().int().min(0).max(20).optional(),
    // A query string, so a comma-separated list: `childAges=4,9`.
    childAges: z
      .string()
      .trim()
      .max(60)
      .transform((value) => (value === '' ? [] : value.split(',')))
      .pipe(z.array(childAge).max(20))
      .optional(),
    roomsCount: z.coerce.number().int().min(1).max(10).default(1),
  })
  .transform(withChildAges);

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
  children: z.number().int().min(0).max(20).optional(),
  childAges: z.array(z.number().int().min(0).max(17)).max(20).optional(),
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
  // Optional. Validated and claimed inside the booking transaction, so a code
  // that expires between quote and confirm fails the booking rather than
  // silently charging the guest the undiscounted price.
  voucherCode: voucherCodeSchema.optional(),
}).transform(withChildAges);

/**
 * A discount code as a guest types it.
 *
 * Deliberately permissive about case and surrounding whitespace — these are
 * copied from emails and printed cards — and normalised to the stored form
 * here so no comparison downstream has to think about it.
 */
export const voucherPreviewSchema = z
  .object({
    code: voucherCodeSchema,
    roomTypeCode: text(60),
    checkIn: isoDate,
    checkOut: isoDate,
    roomsCount: z.coerce.number().int().min(1).max(10).default(1),
    // The party, so the preview prices extra guests exactly as the booking
    // will. Optional for a caller that predates them: it is then quoted for
    // the guests the rate includes.
    adults: z.number().int().min(1).max(20).optional(),
    children: z.number().int().min(0).max(20).optional(),
    childAges: z.array(childAge).max(20).optional(),
  })
  .transform(withChildAges);

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
