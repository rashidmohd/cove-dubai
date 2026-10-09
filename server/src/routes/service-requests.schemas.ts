/**
 * Request validation for spa and dining requests — the guest's form and the
 * admin's answers and menu edits.
 */
import { z } from 'zod';

import { isValidIsoDate } from '../booking/dates.js';
import { SLOT_PATTERN, TIME_PATTERN } from '../service-requests/time.js';

export const serviceKindSchema = z.enum(['spa', 'dining']);

const isoDate = z.string().refine(isValidIsoDate, 'Must be a valid date in YYYY-MM-DD format.');
const slot = z.string().regex(SLOT_PATTERN, 'Use a half-hour time such as 19:30.');
const text = (max: number) => z.string().trim().min(1).max(max);
const localizedText = (max: number) => z.object({ en: text(max), ar: text(max) });

const offeringCode = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Use lowercase letters, numbers and hyphens (for example "signature-massage").',
  );

/** The guest's form. The store checks it against the offering's slots and limits. */
export const createServiceRequestSchema = z.object({
  offeringCode,
  preferredDate: isoDate,
  preferredTime: slot,
  guests: z.number().int().min(1).max(50),
  firstName: text(80),
  lastName: text(80),
  email: z.string().trim().toLowerCase().email().max(160),
  // Permissive on purpose, like the room booking form: guests come from
  // everywhere, and a strict pattern rejects real international numbers.
  phone: z.string().trim().regex(/^[+()\d\s-]{6,30}$/, 'Enter a valid phone number.'),
  notes: z.string().trim().max(1000).optional(),
  locale: z.enum(['en', 'ar']).default('en'),
});

export const serviceRequestFilterSchema = z.object({
  status: z.enum(['new', 'confirmed', 'declined', 'cancelled']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const serviceReferenceSchema = z
  .string()
  .regex(/^(SPA|DIN)-\d{4}-\d{6}$/, 'Not a request reference.');

/** The team's answer. Confirming may name a different time from the one asked. */
export const respondToRequestSchema = z.object({
  status: z.enum(['confirmed', 'declined', 'cancelled']),
  confirmedTime: z.string().regex(TIME_PATTERN, 'Use a time such as 19:45.').optional(),
  responseNote: z.string().trim().max(1000).optional(),
});

const nullableDescription = localizedText(2000).nullable();

export const createOfferingSchema = z.object({
  code: offeringCode,
  name: localizedText(120),
  description: nullableDescription.optional(),
  durationMinutes: z.number().int().min(5).max(600).nullable().optional(),
  price: z.number().min(0).max(1_000_000).nullable().optional(),
  firstSlot: slot,
  lastSlot: slot,
  maxGuests: z.number().int().min(1).max(50).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const updateOfferingSchema = z
  .object({
    name: localizedText(120).optional(),
    description: nullableDescription.optional(),
    durationMinutes: z.number().int().min(5).max(600).nullable().optional(),
    price: z.number().min(0).max(1_000_000).nullable().optional(),
    firstSlot: slot.optional(),
    lastSlot: slot.optional(),
    maxGuests: z.number().int().min(1).max(50).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    'Provide at least one field to change.',
  );
