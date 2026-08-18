/**
 * Request validation for the admin surface.
 *
 * Kept apart from the guest schemas so the two audiences' contracts never get
 * accidentally shared — an admin field leaking into a guest-facing schema is
 * how a write ends up reachable without authentication.
 */
import { z } from 'zod';

import { isValidIsoDate } from '../booking/dates.js';

const isoDate = z
  .string()
  .refine(isValidIsoDate, 'Must be a valid date in YYYY-MM-DD format.');

const text = (max: number) => z.string().trim().min(1).max(max);

/** Both languages, always — neither can silently go missing (`arabic-rtl`). */
const localizedText = (max: number) =>
  z.object({ en: text(max), ar: text(max) });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  // Bounded, but not pattern-checked: complexity rules belong at the point a
  // password is *set*, and rejecting a login for format leaks what the rules are.
  password: z.string().min(1).max(200),
});

export const reservationFilterSchema = z.object({
  status: z
    .enum(['held', 'confirmed', 'cancelled', 'checked-in', 'checked-out'])
    .optional(),
  roomTypeCode: text(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const dateRangeSchema = z.object({
  from: isoDate,
  to: isoDate,
});

export const dateSchema = z.object({ date: isoDate });

export const cancelReservationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const modifyReservationSchema = z
  .object({
    checkIn: isoDate.optional(),
    checkOut: isoDate.optional(),
    roomTypeCode: text(60).optional(),
    adults: z.number().int().min(1).max(20).optional(),
    children: z.number().int().min(0).max(20).optional(),
    roomsCount: z.number().int().min(1).max(10).optional(),
    specialRequests: z.string().trim().max(2000).optional(),
  })
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    'Provide at least one field to change.',
  );

export const updateRoomTypeSchema = z
  .object({
    name: localizedText(120).optional(),
    category: localizedText(120).optional(),
    description: localizedText(2000).optional(),
    maxOccupancy: z.number().int().min(1).max(20).optional(),
    baseRate: z.number().min(0).max(1_000_000).optional(),
    imageKey: text(120).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    'Provide at least one field to change.',
  );

/**
 * A bulk inventory edit across a date range.
 *
 * Ranged rather than per-day because that is how the work actually arrives —
 * "close this room type for the refurbishment fortnight" is one action, and
 * splitting it into fourteen requests would put fourteen rows in the audit log
 * for one decision.
 */
export const updateInventorySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    totalRooms: z.number().int().min(0).max(1000).optional(),
    isClosed: z.boolean().optional(),
  })
  .refine(
    (body) => body.totalRooms !== undefined || body.isClosed !== undefined,
    'Provide totalRooms, isClosed, or both.',
  );

export const updateSettingSchema = z.object({
  value: z.string().trim().min(1).max(500),
});

const amenityCategorySchema = z.enum([
  'bathroom',
  'comfort',
  'technology',
  'services',
  'accessibility',
]);

/** A slug: lowercase, digits, hyphens. It appears in URLs and in the API. */
const amenityCode = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Use lowercase letters, numbers and hyphens (for example "air-conditioning").',
  );

/**
 * OpenTravel RMA code. Nullable rather than optional, because clearing a
 * wrongly-assigned code is a real edit and must be distinguishable from
 * "leave it alone".
 */
const otaCode = z.number().int().positive().max(100_000).nullable();

export const createAmenitySchema = z.object({
  code: amenityCode,
  otaCode: otaCode.optional(),
  name: localizedText(120),
  category: amenityCategorySchema,
  iconKey: z.string().trim().max(60).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const updateAmenitySchema = z
  .object({
    otaCode: otaCode.optional(),
    name: localizedText(120).optional(),
    category: amenityCategorySchema.optional(),
    iconKey: z.string().trim().max(60).nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    'Provide at least one field to change.',
  );

export const setRoomTypeAmenitiesSchema = z.object({
  // An empty array is legitimate — it clears the list.
  amenityCodes: z.array(amenityCode).max(100),
});

export const auditLogFilterSchema = z.object({
  entityType: text(60).optional(),
  entityId: text(120).optional(),
  action: text(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Asking for a presigned upload URL.
 *
 * The browser measures the file and reports it; the server signs for exactly
 * those values, so the URL cannot then be used for a different or larger file.
 * The content type is checked against the allowlist in the storage module
 * rather than duplicated here — one list, one place to change it.
 */
export const mediaUploadRequestSchema = z.object({
  contentType: z.string().min(1).max(100),
  byteSize: z.number().int().positive(),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
});

/**
 * Confirming an upload finished, and attaching it to a room type.
 *
 * Alt text is required in both languages — WCAG 2.1 AA, and Arabic is a
 * first-class surface. An empty string is allowed because that is the correct
 * alt for a purely decorative image; what is not allowed is omitting it, which
 * would mean nobody decided.
 */
export const addRoomTypeImageSchema = z.object({
  storageKey: z.string().min(1).max(300),
  contentType: z.string().min(1).max(100),
  byteSize: z.number().int().positive(),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  alt: z.object({
    en: z.string().trim().max(300),
    ar: z.string().trim().max(300),
  }),
});

/** The complete gallery, in the order it should display. First is primary. */
export const reorderRoomTypeImagesSchema = z.object({
  storageKeys: z.array(z.string().min(1).max(300)).max(50),
});

// --- Vouchers ----------------------------------------------------------------

const discountTypeSchema = z.enum(['percentage', 'fixed']);

/**
 * A voucher code as typed by staff.
 *
 * Uppercased here so the stored value and anything a guest types converge on
 * one form, and restricted to characters that survive being read aloud, printed
 * on a card, and retyped — no lookalike-heavy punctuation.
 */
const voucherCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(40)
  .regex(
    /^[A-Z0-9][A-Z0-9-]*$/,
    'Use letters, numbers and hyphens (for example "SPRING25").',
  );

/** Nullable rather than optional: null clears a limit, absent leaves it alone. */
const nullableIsoDate = isoDate.nullable();
const nullablePositiveInt = z.number().int().min(1).max(1_000_000).nullable();
const nullableMoney = z.number().min(0).max(1_000_000).nullable();

export const createVoucherSchema = z
  .object({
    code: voucherCodeSchema,
    name: localizedText(120),
    discountType: discountTypeSchema,
    discountValue: z.number().min(0).max(1_000_000),
    validFrom: nullableIsoDate.optional(),
    validTo: nullableIsoDate.optional(),
    maxRedemptions: nullablePositiveInt.optional(),
    minimumNights: z.number().int().min(1).max(365).optional(),
    minimumSpend: nullableMoney.optional(),
    roomTypeCodes: z.array(text(60)).max(50).optional(),
  })
  .refine(
    (v) => v.discountType !== 'percentage' || v.discountValue <= 100,
    'A percentage discount cannot exceed 100.',
  )
  .refine(
    (v) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom,
    'The end of the validity window must not be before its start.',
  );

export const updateVoucherSchema = z
  .object({
    name: localizedText(120).optional(),
    discountType: discountTypeSchema.optional(),
    discountValue: z.number().min(0).max(1_000_000).optional(),
    validFrom: nullableIsoDate.optional(),
    validTo: nullableIsoDate.optional(),
    maxRedemptions: nullablePositiveInt.optional(),
    minimumNights: z.number().int().min(1).max(365).optional(),
    minimumSpend: nullableMoney.optional(),
    roomTypeCodes: z.array(text(60)).max(50).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    'Provide at least one field to change.',
  )
  .refine(
    (v) =>
      v.discountType !== 'percentage' ||
      v.discountValue === undefined ||
      v.discountValue <= 100,
    'A percentage discount cannot exceed 100.',
  );
