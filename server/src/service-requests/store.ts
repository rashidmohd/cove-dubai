/**
 * Spa and dining requests — the one place their data is read or written.
 *
 * Routes call these functions and never reach into Prisma themselves, for the
 * same reason room bookings go through `BookingProvider`: if the hotel moves
 * spa bookings to spa software, or tables to a booking service, this file is
 * what gets replaced, and the routes, the HTTP contract and the pages stay.
 *
 * Kept apart from the room engine on purpose. A request holds nothing — no
 * inventory, no price snapshot — until a person confirms it.
 */
import { Prisma } from '@prisma/client';
import type {
  ServiceKind,
  ServiceOffering as PrismaOffering,
  ServiceRequest as PrismaRequest,
  ServiceRequestStatus as PrismaStatus,
} from '@prisma/client';
import { randomInt } from 'node:crypto';

import { addDays, toIsoDate, toUtcDate } from '../booking/dates.js';
import { prisma } from '../db/prisma.js';
import { isInPast, slotsBetween, dubaiNow } from './time.js';
import {
  ServiceRequestError,
  type AdminOffering,
  type Offering,
  type OfferingChanges,
  type OfferingDraft,
  type ServiceKindName,
  type ServiceRequestDraft,
  type ServiceRequestFilter,
  type ServiceRequestRecord,
  type ServiceRequestStatusName,
} from './types.js';

/** How far ahead a request may be for. A spa or a table a year out is plenty. */
const MAX_DAYS_AHEAD = 365;

const REFERENCE_ATTEMPTS = 5;

const KIND_TO_DB: Record<ServiceKindName, ServiceKind> = { spa: 'SPA', dining: 'DINING' };
const KIND_FROM_DB: Record<ServiceKind, ServiceKindName> = { SPA: 'spa', DINING: 'dining' };

const STATUS_FROM_DB: Record<PrismaStatus, ServiceRequestStatusName> = {
  NEW: 'new',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
};
const STATUS_TO_DB: Record<ServiceRequestStatusName, PrismaStatus> = {
  new: 'NEW',
  confirmed: 'CONFIRMED',
  declined: 'DECLINED',
  cancelled: 'CANCELLED',
};

/** `SPA-2026-482913` / `DIN-2026-118204`. A candidate; the unique index decides. */
function candidateReference(kind: ServiceKindName): string {
  const prefix = kind === 'spa' ? 'SPA' : 'DIN';
  return `${prefix}-${new Date().getUTCFullYear()}-${randomInt(100_000, 1_000_000)}`;
}

export const SERVICE_REFERENCE_PATTERN = /^(SPA|DIN)-\d{4}-\d{6}$/;

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

/** What a guest can ask for, in the hotel's order. Inactive ones are hidden. */
export async function listOfferings(kind: ServiceKindName): Promise<Offering[]> {
  const rows = await prisma.serviceOffering.findMany({
    where: { kind: KIND_TO_DB[kind], isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
  });
  return rows.map(toOffering);
}

export async function listAdminOfferings(kind: ServiceKindName): Promise<AdminOffering[]> {
  const rows = await prisma.serviceOffering.findMany({
    where: { kind: KIND_TO_DB[kind] },
    orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    include: { _count: { select: { requests: true } } },
  });
  return rows.map((row) => toAdminOffering(row, row._count.requests));
}

export async function createOffering(
  kind: ServiceKindName,
  draft: OfferingDraft,
): Promise<AdminOffering> {
  assertSlotOrder(draft.firstSlot, draft.lastSlot);
  try {
    const row = await prisma.serviceOffering.create({
      data: {
        kind: KIND_TO_DB[kind],
        code: draft.code,
        nameEn: draft.name.en,
        nameAr: draft.name.ar,
        descriptionEn: draft.description?.en ?? null,
        descriptionAr: draft.description?.ar ?? null,
        durationMinutes: draft.durationMinutes ?? null,
        priceAed:
          draft.price === undefined || draft.price === null
            ? null
            : new Prisma.Decimal(draft.price),
        firstSlot: draft.firstSlot,
        lastSlot: draft.lastSlot,
        maxGuests: draft.maxGuests ?? 4,
        sortOrder: draft.sortOrder ?? 0,
        isActive: draft.isActive ?? true,
      },
    });
    return toAdminOffering(row, 0);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ServiceRequestError(
        'OFFERING_CODE_IN_USE',
        `There is already one with the code "${draft.code}".`,
      );
    }
    throw error;
  }
}

export async function updateOffering(
  kind: ServiceKindName,
  code: string,
  changes: OfferingChanges,
): Promise<AdminOffering> {
  const existing = await requireOffering(kind, code);
  assertSlotOrder(
    changes.firstSlot ?? existing.firstSlot,
    changes.lastSlot ?? existing.lastSlot,
  );

  // Explicit, like the room engine's updates: an unmapped key must not reach
  // a column by accident.
  const data: Prisma.ServiceOfferingUpdateInput = {};
  if (changes.name) {
    data.nameEn = changes.name.en;
    data.nameAr = changes.name.ar;
  }
  if (changes.description !== undefined) {
    data.descriptionEn = changes.description?.en ?? null;
    data.descriptionAr = changes.description?.ar ?? null;
  }
  if (changes.durationMinutes !== undefined) data.durationMinutes = changes.durationMinutes;
  if (changes.price !== undefined) {
    data.priceAed = changes.price === null ? null : new Prisma.Decimal(changes.price);
  }
  if (changes.firstSlot !== undefined) data.firstSlot = changes.firstSlot;
  if (changes.lastSlot !== undefined) data.lastSlot = changes.lastSlot;
  if (changes.maxGuests !== undefined) data.maxGuests = changes.maxGuests;
  if (changes.sortOrder !== undefined) data.sortOrder = changes.sortOrder;
  if (changes.isActive !== undefined) data.isActive = changes.isActive;

  const row = await prisma.serviceOffering.update({
    where: { id: existing.id },
    data,
    include: { _count: { select: { requests: true } } },
  });
  return toAdminOffering(row, row._count.requests);
}

/**
 * Remove an offering nobody has asked for. One with requests is refused —
 * they are the record of who asked for what — and is deactivated instead.
 */
export async function deleteOffering(kind: ServiceKindName, code: string): Promise<void> {
  const existing = await requireOffering(kind, code);
  const requests = await prisma.serviceRequest.count({ where: { offeringId: existing.id } });
  if (requests > 0) {
    throw new ServiceRequestError(
      'OFFERING_IN_USE',
      'Guests have asked for this one, so it cannot be deleted. Deactivate it instead.',
      { requestCount: requests },
    );
  }
  await prisma.serviceOffering.delete({ where: { id: existing.id } });
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * Record a guest's request. Checks everything the form promised: the offering
 * is on the menu, the time is one of its slots and not already past in Dubai,
 * and the party fits.
 */
export async function createRequest(
  kind: ServiceKindName,
  draft: ServiceRequestDraft,
): Promise<ServiceRequestRecord> {
  const offering = await prisma.serviceOffering.findUnique({
    where: { kind_code: { kind: KIND_TO_DB[kind], code: draft.offeringCode } },
  });
  if (!offering || !offering.isActive) {
    throw new ServiceRequestError(
      'OFFERING_NOT_FOUND',
      'That is not on the menu. Please choose again.',
    );
  }

  if (!slotsBetween(offering.firstSlot, offering.lastSlot).includes(draft.preferredTime)) {
    throw new ServiceRequestError(
      'INVALID_SERVICE_REQUEST',
      'That time is not available for this booking. Please choose another.',
      { field: 'preferredTime' },
    );
  }
  if (isInPast(draft.preferredDate, draft.preferredTime)) {
    throw new ServiceRequestError(
      'INVALID_SERVICE_REQUEST',
      'That time has already passed. Please choose a later one.',
      { field: 'preferredTime' },
    );
  }
  if (draft.preferredDate > addDays(dubaiNow().date, MAX_DAYS_AHEAD)) {
    throw new ServiceRequestError(
      'INVALID_SERVICE_REQUEST',
      'Requests can be made up to a year ahead.',
      { field: 'preferredDate' },
    );
  }
  if (draft.guests > offering.maxGuests) {
    throw new ServiceRequestError(
      'INVALID_SERVICE_REQUEST',
      `Up to ${offering.maxGuests} guests per request.`,
      { field: 'guests', maxGuests: offering.maxGuests },
    );
  }

  for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
    try {
      const row = await prisma.serviceRequest.create({
        data: {
          reference: candidateReference(kind),
          kind: KIND_TO_DB[kind],
          offeringId: offering.id,
          preferredDate: toUtcDate(draft.preferredDate),
          preferredTime: draft.preferredTime,
          guests: draft.guests,
          firstName: draft.firstName,
          lastName: draft.lastName,
          email: draft.email,
          phone: draft.phone,
          notes: draft.notes?.trim() || null,
          locale: draft.locale === 'ar' ? 'AR' : 'EN',
        },
        include: { offering: true },
      });
      return toRecord(row);
    } catch (error) {
      // A reference collision: draw another. Anything else is a real failure.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('Could not allocate a request reference after several attempts.');
}

export async function listRequests(
  kind: ServiceKindName,
  filter: ServiceRequestFilter,
): Promise<{ requests: ServiceRequestRecord[]; total: number }> {
  const where: Prisma.ServiceRequestWhereInput = { kind: KIND_TO_DB[kind] };
  if (filter.status) where.status = STATUS_TO_DB[filter.status];
  if (filter.from || filter.to) {
    where.preferredDate = {
      ...(filter.from ? { gte: toUtcDate(filter.from) } : {}),
      ...(filter.to ? { lte: toUtcDate(filter.to) } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.serviceRequest.findMany({
      where,
      include: { offering: true },
      // Unanswered first, then soonest — the order the team works in.
      orderBy: [{ status: 'asc' }, { preferredDate: 'asc' }, { preferredTime: 'asc' }],
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    }),
    prisma.serviceRequest.count({ where }),
  ]);
  return { requests: rows.map(toRecord), total };
}

export async function getRequest(reference: string): Promise<ServiceRequestRecord | null> {
  const row = await prisma.serviceRequest.findUnique({
    where: { reference },
    include: { offering: true },
  });
  return row ? toRecord(row) : null;
}

/** Which answers each status may move to. */
const TRANSITIONS: Record<ServiceRequestStatusName, ServiceRequestStatusName[]> = {
  new: ['confirmed', 'declined'],
  // A confirmed time can be moved (confirmed again) or called off.
  confirmed: ['confirmed', 'cancelled'],
  declined: [],
  cancelled: [],
};

/**
 * The team's answer. Confirming needs a time — the one asked for, or another
 * they can offer. The note travels to the guest in the email.
 */
export async function respondToRequest(
  reference: string,
  answer: {
    status: 'confirmed' | 'declined' | 'cancelled';
    confirmedTime?: string | undefined;
    responseNote?: string | undefined;
  },
): Promise<ServiceRequestRecord> {
  const existing = await prisma.serviceRequest.findUnique({ where: { reference } });
  if (!existing) {
    throw new ServiceRequestError('SERVICE_REQUEST_NOT_FOUND', 'No request with that reference.');
  }

  const from = STATUS_FROM_DB[existing.status];
  if (!TRANSITIONS[from].includes(answer.status)) {
    throw new ServiceRequestError(
      'INVALID_REQUEST_TRANSITION',
      `A ${from} request cannot be marked ${answer.status}.`,
      { from, to: answer.status },
    );
  }

  const row = await prisma.serviceRequest.update({
    where: { id: existing.id },
    data: {
      status: STATUS_TO_DB[answer.status],
      confirmedTime:
        answer.status === 'confirmed'
          ? (answer.confirmedTime ?? existing.preferredTime)
          : existing.confirmedTime,
      responseNote: answer.responseNote?.trim() || null,
      respondedAt: new Date(),
    },
    include: { offering: true },
  });
  return toRecord(row);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

async function requireOffering(kind: ServiceKindName, code: string) {
  const row = await prisma.serviceOffering.findUnique({
    where: { kind_code: { kind: KIND_TO_DB[kind], code } },
  });
  if (!row) {
    throw new ServiceRequestError('OFFERING_NOT_FOUND', `Nothing with the code "${code}".`);
  }
  return row;
}

function assertSlotOrder(first: string, last: string): void {
  if (last < first) {
    throw new ServiceRequestError(
      'INVALID_SERVICE_REQUEST',
      'The last time cannot be before the first.',
      { field: 'lastSlot' },
    );
  }
}

function toOffering(row: PrismaOffering): Offering {
  return {
    kind: KIND_FROM_DB[row.kind],
    code: row.code,
    name: { en: row.nameEn, ar: row.nameAr },
    description:
      row.descriptionEn && row.descriptionAr
        ? { en: row.descriptionEn, ar: row.descriptionAr }
        : null,
    durationMinutes: row.durationMinutes,
    price: row.priceAed?.toNumber() ?? null,
    currency: 'AED',
    slots: slotsBetween(row.firstSlot, row.lastSlot),
    maxGuests: row.maxGuests,
  };
}

function toAdminOffering(row: PrismaOffering, requestCount: number): AdminOffering {
  return {
    ...toOffering(row),
    firstSlot: row.firstSlot,
    lastSlot: row.lastSlot,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    requestCount,
  };
}

function toRecord(row: PrismaRequest & { offering: PrismaOffering }): ServiceRequestRecord {
  return {
    reference: row.reference,
    kind: KIND_FROM_DB[row.kind],
    offering: {
      code: row.offering.code,
      name: { en: row.offering.nameEn, ar: row.offering.nameAr },
    },
    preferredDate: toIsoDate(row.preferredDate),
    preferredTime: row.preferredTime,
    guests: row.guests,
    guest: {
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
    },
    notes: row.notes,
    locale: row.locale === 'AR' ? 'ar' : 'en',
    status: STATUS_FROM_DB[row.status],
    confirmedTime: row.confirmedTime,
    responseNote: row.responseNote,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
