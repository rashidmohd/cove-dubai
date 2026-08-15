/**
 * CustomDbProvider — the Phase 1 implementation of the seam.
 *
 * The hotel runs on this at launch. It is the only BookingProvider that exists;
 * there is no PMS adapter, because no PMS has been chosen.
 *
 * This is the only layer permitted to touch Prisma. Everything above it speaks
 * the domain types in `./types.ts`, so replacing this class later changes
 * nothing above it.
 */
import { Prisma } from '@prisma/client';
import type {
  Guest as PrismaGuest,
  PrismaClient,
  RatePlan as PrismaRatePlan,
  Reservation as PrismaReservation,
  ReservationStatus as PrismaReservationStatus,
  RoomType as PrismaRoomType,
} from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import { countNights, isValidIsoDate, nightsBetween, toIsoDate, toUtcDate } from './dates.js';
import {
  calculatePrice,
  resolveMinimumStay,
  resolveNightlyRates,
  type PricingSettings,
} from './pricing.js';
import type { BookingProvider } from './provider.js';
import { generateBookingReference } from './reference.js';
import {
  BookingError,
  type AvailabilityQuery,
  type AvailableRoomType,
  type IsoDate,
  type Locale,
  type OccupancyReport,
  type PriceBreakdown,
  type Reservation,
  type ReservationChanges,
  type ReservationDraft,
  type ReservationFilter,
  type ReservationStatus,
  type RoomType,
  type Stay,
} from './types.js';

/** How many times to retry a booking whose generated reference collided. */
const REFERENCE_COLLISION_RETRIES = 5;

/** Statuses that hold inventory. Cancelled bookings release theirs. */
const INVENTORY_HOLDING_STATUSES: PrismaReservationStatus[] = [
  'HELD',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
];

type Tx = Prisma.TransactionClient;

type RoomTypeWithPlans = PrismaRoomType & { ratePlans: PrismaRatePlan[] };

type ReservationWithRelations = PrismaReservation & {
  guest: PrismaGuest;
  roomType: PrismaRoomType;
};

export class CustomDbProvider implements BookingProvider {
  constructor(private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getRoomTypes(): Promise<RoomType[]> {
    const roomTypes = await this.prisma.roomType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return roomTypes.map(toDomainRoomType);
  }

  async getRoomType(code: string): Promise<RoomType | null> {
    const roomType = await this.prisma.roomType.findUnique({ where: { code } });
    return roomType ? toDomainRoomType(roomType) : null;
  }

  async checkAvailability(
    query: AvailabilityQuery,
  ): Promise<AvailableRoomType[]> {
    const roomsCount = query.roomsCount ?? 1;
    this.assertValidStay({ ...query, roomsCount });

    const guests = query.adults + query.children;
    const nights = nightsBetween(query.checkIn, query.checkOut);

    const [roomTypes, settings] = await Promise.all([
      this.prisma.roomType.findMany({
        where: { isActive: true, maxOccupancy: { gte: guests } },
        orderBy: { sortOrder: 'asc' },
        include: { ratePlans: { where: { isActive: true } } },
      }),
      this.loadPricingSettings(),
    ]);

    const available: AvailableRoomType[] = [];

    for (const roomType of roomTypes) {
      const inventory = await this.prisma.roomTypeInventory.findMany({
        where: {
          roomTypeId: roomType.id,
          date: { gte: toUtcDate(query.checkIn), lt: toUtcDate(query.checkOut) },
        },
      });

      // Every night of the stay must have an open inventory row. A missing row
      // means the calendar is not open that far out, which is unavailable
      // rather than unlimited.
      if (inventory.length !== nights.length) continue;
      if (inventory.some((night) => night.isClosed)) continue;

      // The binding constraint is the tightest night in the stay.
      const roomsAvailable = Math.min(
        ...inventory.map((night) => night.totalRooms - night.bookedRooms),
      );
      if (roomsAvailable < roomsCount) continue;

      const minimumStay = resolveMinimumStay({
        checkIn: query.checkIn,
        checkOut: query.checkOut,
        ratePlans: roomType.ratePlans,
      });
      if (nights.length < minimumStay) continue;

      available.push({
        ...toDomainRoomType(roomType),
        roomsAvailable,
        price: this.priceStay(roomType, query.checkIn, query.checkOut, roomsCount, settings),
      });
    }

    return available;
  }

  async getRate(args: {
    roomTypeCode: string;
    checkIn: IsoDate;
    checkOut: IsoDate;
    roomsCount?: number;
  }): Promise<PriceBreakdown> {
    const roomsCount = args.roomsCount ?? 1;
    this.assertValidStay({
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      adults: 1,
      children: 0,
      roomsCount,
    });

    const roomType = await this.prisma.roomType.findUnique({
      where: { code: args.roomTypeCode },
      include: { ratePlans: { where: { isActive: true } } },
    });
    if (!roomType) {
      throw new BookingError(
        'ROOM_TYPE_NOT_FOUND',
        `No room type with code "${args.roomTypeCode}".`,
      );
    }

    const settings = await this.loadPricingSettings();
    return this.priceStay(roomType, args.checkIn, args.checkOut, roomsCount, settings);
  }

  async getReservation(reference: string): Promise<Reservation | null> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { bookingReference: reference },
      include: { guest: true, roomType: true },
    });
    return reservation ? toDomainReservation(reservation) : null;
  }

  async listReservations(
    filter: ReservationFilter,
  ): Promise<{ reservations: Reservation[]; total: number }> {
    const where: Prisma.ReservationWhereInput = {};

    if (filter.status) where.status = toPrismaStatus(filter.status);
    if (filter.roomTypeCode) where.roomType = { code: filter.roomTypeCode };

    // Overlap, not containment: a stay spanning the window's edges is still in
    // it. Check-out is exclusive, so a booking departing on `from` does not
    // overlap.
    if (filter.from) where.checkOut = { gt: toUtcDate(filter.from) };
    if (filter.to) where.checkIn = { lte: toUtcDate(filter.to) };

    if (filter.search) {
      const search = filter.search.trim();
      where.OR = [
        { bookingReference: { contains: search, mode: 'insensitive' } },
        { guest: { firstName: { contains: search, mode: 'insensitive' } } },
        { guest: { lastName: { contains: search, mode: 'insensitive' } } },
        { guest: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [reservations, total] = await Promise.all([
      this.prisma.reservation.findMany({
        where,
        include: { guest: true, roomType: true },
        orderBy: { checkIn: 'asc' },
        take: filter.limit ?? 50,
        skip: filter.offset ?? 0,
      }),
      this.prisma.reservation.count({ where }),
    ]);

    return { reservations: reservations.map(toDomainReservation), total };
  }

  // -------------------------------------------------------------------------
  // Create — the atomic path
  // -------------------------------------------------------------------------

  /**
   * Create a reservation atomically.
   *
   * The whole operation runs in one transaction. Within it:
   *
   *   1. Inventory rows for every night are locked with `SELECT ... FOR UPDATE`,
   *      **ordered by date**. Consistent lock ordering is what stops two
   *      overlapping bookings from deadlocking against each other.
   *   2. Capacity is re-checked while those locks are held. Any earlier
   *      availability check the guest saw is advisory and may be stale; this is
   *      the one that decides.
   *   3. Inventory is incremented, the guest upserted, and the reservation
   *      written.
   *
   * A concurrent booking for the same nights blocks at step 1 until this
   * transaction commits, then re-reads the updated counts and correctly finds
   * the room gone.
   *
   * The guarantee, though, lives in the database rather than in this sequence:
   * the increment is atomic and the ledger's CHECK constraint refuses any
   * result that exceeds inventory. A code path that forgot to lock would still
   * be unable to oversell. See `commitInventory`.
   */
  async createReservation(draft: ReservationDraft): Promise<Reservation> {
    this.assertValidStay(draft);

    for (let attempt = 0; attempt < REFERENCE_COLLISION_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => this.createReservationInTransaction(tx, draft),
          {
            // Waiting for another booking's locks is normal under contention;
            // allow for it before giving up.
            timeout: 15_000,
            maxWait: 10_000,
          },
        );
      } catch (error) {
        // A reference collision is expected occasionally and is not the guest's
        // problem — generate another and retry. Anything else propagates.
        if (
          isUniqueConstraintError(error, 'bookingReference') &&
          attempt < REFERENCE_COLLISION_RETRIES - 1
        ) {
          continue;
        }
        throw this.translateDatabaseError(error);
      }
    }

    throw new BookingError(
      'NO_AVAILABILITY',
      'Could not allocate a unique booking reference. Please try again.',
    );
  }

  private async createReservationInTransaction(
    tx: Tx,
    draft: ReservationDraft,
  ): Promise<Reservation> {
    const roomType = await tx.roomType.findUnique({
      where: { code: draft.roomTypeCode },
      include: { ratePlans: { where: { isActive: true } } },
    });
    if (!roomType || !roomType.isActive) {
      throw new BookingError(
        'ROOM_TYPE_NOT_FOUND',
        `No room type with code "${draft.roomTypeCode}".`,
      );
    }

    const guests = draft.adults + draft.children;
    if (guests > roomType.maxOccupancy * draft.roomsCount) {
      throw new BookingError(
        'OCCUPANCY_EXCEEDED',
        `This room type sleeps ${roomType.maxOccupancy}.`,
        { maxOccupancy: roomType.maxOccupancy },
      );
    }

    const nights = nightsBetween(draft.checkIn, draft.checkOut);

    const minimumStay = resolveMinimumStay({
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      ratePlans: roomType.ratePlans,
    });
    if (nights.length < minimumStay) {
      throw new BookingError(
        'MINIMUM_STAY_NOT_MET',
        `This stay requires a minimum of ${minimumStay} nights.`,
        { minimumStayNights: minimumStay },
      );
    }

    await this.commitInventory(tx, {
      roomTypeId: roomType.id,
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      roomsCount: draft.roomsCount,
    });

    const settings = await this.loadPricingSettings(tx);
    const price = this.priceStay(
      roomType,
      draft.checkIn,
      draft.checkOut,
      draft.roomsCount,
      settings,
    );

    const guest = await this.upsertGuest(tx, draft);

    const reservation = await tx.reservation.create({
      data: {
        bookingReference: generateBookingReference(),
        guestId: guest.id,
        roomTypeId: roomType.id,
        checkIn: toUtcDate(draft.checkIn),
        checkOut: toUtcDate(draft.checkOut),
        adults: draft.adults,
        children: draft.children,
        roomsCount: draft.roomsCount,
        status: 'CONFIRMED',
        specialRequests: draft.specialRequests ?? null,
        // Snapshotted, never recomputed: a later rate change must not rewrite
        // a total the guest has already been quoted and emailed.
        priceBreakdown: price as unknown as Prisma.InputJsonValue,
        totalAmountAed: new Prisma.Decimal(price.grandTotal),
        currency: price.currency,
        // Secret behind the guest's cancellation link, so the link is keyed to
        // this rather than to anything guessable.
        cancellationToken: randomBytes(32).toString('base64url'),
      },
      include: { guest: true, roomType: true },
    });

    return toDomainReservation(reservation);
  }

  /**
   * Lock and commit inventory for every night of a stay.
   *
   * What actually prevents overselling is the final statement: an atomic
   * `UPDATE ... SET bookedRooms = bookedRooms + n` (Postgres serialises
   * conflicting row updates) combined with the CHECK constraint that rejects
   * the result if it exceeds `totalRooms`. That pairing is sufficient on its
   * own — verified by removing the lock below and confirming the suite still
   * passes, with losing bookings rejected by the constraint.
   *
   * The `SELECT ... FOR UPDATE` is kept for two narrower reasons:
   *
   *   - It reports **which** nights are unavailable, so the booking flow can
   *     tell the guest something useful. The constraint can only say "no".
   *   - It keeps the common case off `translateDatabaseError`, which recognises
   *     a violation by matching the constraint name in an error string — fine
   *     as a backstop, fragile as a primary path.
   *
   * `ORDER BY date` matters: every booking takes its row locks in the same
   * order, so two overlapping stays queue rather than deadlock.
   */
  private async commitInventory(
    tx: Tx,
    args: {
      roomTypeId: string;
      checkIn: IsoDate;
      checkOut: IsoDate;
      roomsCount: number;
    },
  ): Promise<void> {
    const nights = nightsBetween(args.checkIn, args.checkOut);

    const locked = await tx.$queryRaw<
      Array<{ date: Date; totalRooms: number; bookedRooms: number; isClosed: boolean }>
    >`
      SELECT date, "totalRooms", "bookedRooms", "isClosed"
      FROM room_type_inventory
      WHERE "roomTypeId" = ${args.roomTypeId}
        AND date >= ${toUtcDate(args.checkIn)}::date
        AND date <  ${toUtcDate(args.checkOut)}::date
      ORDER BY date
      FOR UPDATE
    `;

    if (locked.length !== nights.length) {
      const open = new Set(locked.map((row) => toIsoDate(row.date)));
      throw new BookingError(
        'NO_AVAILABILITY',
        'The hotel calendar is not open for all of these dates.',
        { unavailableNights: nights.filter((night) => !open.has(night)) },
      );
    }

    const unavailable = locked
      .filter(
        (row) =>
          row.isClosed || row.totalRooms - row.bookedRooms < args.roomsCount,
      )
      .map((row) => toIsoDate(row.date));

    if (unavailable.length > 0) {
      throw new BookingError(
        'NO_AVAILABILITY',
        'Those dates are no longer available in this room type.',
        { unavailableNights: unavailable },
      );
    }

    await tx.roomTypeInventory.updateMany({
      where: {
        roomTypeId: args.roomTypeId,
        date: { gte: toUtcDate(args.checkIn), lt: toUtcDate(args.checkOut) },
      },
      data: { bookedRooms: { increment: args.roomsCount } },
    });
  }

  /** Give inventory back, e.g. on cancellation. */
  private async releaseInventory(
    tx: Tx,
    args: {
      roomTypeId: string;
      checkIn: Date;
      checkOut: Date;
      roomsCount: number;
    },
  ): Promise<void> {
    await tx.roomTypeInventory.updateMany({
      where: {
        roomTypeId: args.roomTypeId,
        date: { gte: args.checkIn, lt: args.checkOut },
      },
      data: { bookedRooms: { decrement: args.roomsCount } },
    });
  }

  private async upsertGuest(
    tx: Tx,
    draft: ReservationDraft,
  ): Promise<PrismaGuest> {
    const email = draft.guest.email.trim().toLowerCase();

    // Email is not unique in the schema — a hotel legitimately has several
    // guests sharing a family address — so this matches the most recent profile
    // rather than upserting blindly.
    const existing = await tx.guest.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });

    const data = {
      firstName: draft.guest.firstName.trim(),
      lastName: draft.guest.lastName.trim(),
      email,
      phone: draft.guest.phone.trim(),
      preferredLocale: draft.guest.locale === 'ar' ? ('AR' as const) : ('EN' as const),
    };

    if (existing) {
      return tx.guest.update({ where: { id: existing.id }, data });
    }
    return tx.guest.create({ data });
  }

  // -------------------------------------------------------------------------
  // Cancel and modify
  // -------------------------------------------------------------------------

  async cancelReservation(
    reference: string,
    context?: { guestToken?: string; reason?: string },
  ): Promise<Reservation> {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { bookingReference: reference },
        include: { guest: true, roomType: true },
      });
      if (!reservation) {
        throw new BookingError(
          'RESERVATION_NOT_FOUND',
          `No reservation with reference "${reference}".`,
        );
      }

      // A guest-initiated cancellation must prove it holds the emailed link.
      // Without this, knowing a booking reference — which appears in inboxes,
      // on printouts, and in the confirmation URL — would be enough to cancel
      // someone else's stay.
      if (context?.guestToken !== undefined) {
        if (
          !reservation.cancellationToken ||
          !timingSafeEqualString(context.guestToken, reservation.cancellationToken)
        ) {
          throw new BookingError(
            'INVALID_CANCELLATION_TOKEN',
            'This cancellation link is not valid for that booking.',
          );
        }
      }

      if (reservation.status === 'CANCELLED') {
        throw new BookingError(
          'ALREADY_CANCELLED',
          'This reservation has already been cancelled.',
        );
      }
      if (reservation.status === 'CHECKED_OUT') {
        throw new BookingError(
          'CANCELLATION_NOT_PERMITTED',
          'This stay has already been completed.',
        );
      }

      await this.releaseInventory(tx, {
        roomTypeId: reservation.roomTypeId,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        roomsCount: reservation.roomsCount,
      });

      const cancelled = await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          // Burn the cancellation link so it cannot be replayed.
          cancellationToken: null,
        },
        include: { guest: true, roomType: true },
      });

      return toDomainReservation(cancelled);
    });
  }

  /**
   * Modify a reservation.
   *
   * A modification is a booking: it releases the old inventory and commits the
   * new inside one transaction, so it obeys exactly the same availability and
   * atomicity rules as creating one. If the new dates are unavailable the whole
   * thing rolls back and the guest keeps their original booking — never left
   * holding neither.
   */
  async modifyReservation(
    reference: string,
    changes: ReservationChanges,
  ): Promise<Reservation> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.reservation.findUnique({
            where: { bookingReference: reference },
            include: { guest: true, roomType: true },
          });
          if (!existing) {
            throw new BookingError(
              'RESERVATION_NOT_FOUND',
              `No reservation with reference "${reference}".`,
            );
          }
          if (existing.status === 'CANCELLED') {
            throw new BookingError(
              'ALREADY_CANCELLED',
              'A cancelled reservation cannot be modified.',
            );
          }

          const checkIn = changes.checkIn ?? toIsoDate(existing.checkIn);
          const checkOut = changes.checkOut ?? toIsoDate(existing.checkOut);
          const roomsCount = changes.roomsCount ?? existing.roomsCount;
          const adults = changes.adults ?? existing.adults;
          const children = changes.children ?? existing.children;

          const roomTypeCode = changes.roomTypeCode ?? existing.roomType.code;
          const roomType = await tx.roomType.findUnique({
            where: { code: roomTypeCode },
            include: { ratePlans: { where: { isActive: true } } },
          });
          if (!roomType) {
            throw new BookingError(
              'ROOM_TYPE_NOT_FOUND',
              `No room type with code "${roomTypeCode}".`,
            );
          }

          this.assertValidStay({
            checkIn,
            checkOut,
            adults,
            children,
            roomsCount,
          });

          // Release first so a stay that merely shifts by a night does not
          // contend with itself for the nights it already holds.
          await this.releaseInventory(tx, {
            roomTypeId: existing.roomTypeId,
            checkIn: existing.checkIn,
            checkOut: existing.checkOut,
            roomsCount: existing.roomsCount,
          });

          await this.commitInventory(tx, {
            roomTypeId: roomType.id,
            checkIn,
            checkOut,
            roomsCount,
          });

          const settings = await this.loadPricingSettings(tx);
          const price = this.priceStay(roomType, checkIn, checkOut, roomsCount, settings);

          const updated = await tx.reservation.update({
            where: { id: existing.id },
            data: {
              roomTypeId: roomType.id,
              checkIn: toUtcDate(checkIn),
              checkOut: toUtcDate(checkOut),
              adults,
              children,
              roomsCount,
              ...(changes.specialRequests !== undefined
                ? { specialRequests: changes.specialRequests }
                : {}),
              // Re-priced deliberately: the guest agreed to a different stay,
              // so a fresh quote is correct here. Untouched stays keep their
              // original snapshot.
              priceBreakdown: price as unknown as Prisma.InputJsonValue,
              totalAmountAed: new Prisma.Decimal(price.grandTotal),
            },
            include: { guest: true, roomType: true },
          });

          return toDomainReservation(updated);
        },
        { timeout: 15_000, maxWait: 10_000 },
      );
    } catch (error) {
      throw this.translateDatabaseError(error);
    }
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  async getOccupancyReport(args: {
    from: IsoDate;
    to: IsoDate;
  }): Promise<OccupancyReport> {
    if (!isValidIsoDate(args.from) || !isValidIsoDate(args.to)) {
      throw new BookingError('INVALID_STAY', 'Dates must be YYYY-MM-DD.');
    }

    const inventory = await this.prisma.roomTypeInventory.findMany({
      where: { date: { gte: toUtcDate(args.from), lte: toUtcDate(args.to) } },
      orderBy: { date: 'asc' },
    });

    const byDate = new Map<IsoDate, { total: number; booked: number }>();
    for (const row of inventory) {
      const date = toIsoDate(row.date);
      const entry = byDate.get(date) ?? { total: 0, booked: 0 };
      entry.total += row.totalRooms;
      entry.booked += row.bookedRooms;
      byDate.set(date, entry);
    }

    const revenue = await this.prisma.reservation.aggregate({
      _sum: { totalAmountAed: true },
      where: {
        status: { in: INVENTORY_HOLDING_STATUSES },
        checkOut: { gt: toUtcDate(args.from) },
        checkIn: { lte: toUtcDate(args.to) },
      },
    });

    const settings = await this.loadPricingSettings();

    return {
      from: args.from,
      to: args.to,
      days: [...byDate.entries()].map(([date, entry]) => ({
        date,
        roomsAvailable: entry.total - entry.booked,
        roomsBooked: entry.booked,
        occupancyPercent:
          entry.total === 0
            ? 0
            : Math.round((entry.booked / entry.total) * 1000) / 10,
      })),
      revenueTotal: revenue._sum.totalAmountAed?.toNumber() ?? 0,
      currency: settings.currency,
    };
  }

  async getArrivalsAndDepartures(date: IsoDate): Promise<{
    arrivals: Reservation[];
    departures: Reservation[];
  }> {
    const day = toUtcDate(date);
    const [arrivals, departures] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { checkIn: day, status: { in: ['CONFIRMED', 'CHECKED_IN'] } },
        include: { guest: true, roomType: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.reservation.findMany({
        where: { checkOut: day, status: { in: ['CHECKED_IN', 'CONFIRMED'] } },
        include: { guest: true, roomType: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      arrivals: arrivals.map(toDomainReservation),
      departures: departures.map(toDomainReservation),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private priceStay(
    roomType: RoomTypeWithPlans,
    checkIn: IsoDate,
    checkOut: IsoDate,
    roomsCount: number,
    settings: PricingSettings,
  ): PriceBreakdown {
    return calculatePrice({
      nightlyRates: resolveNightlyRates({
        checkIn,
        checkOut,
        baseRate: roomType.baseRateAed,
        ratePlans: roomType.ratePlans,
      }),
      roomsCount,
      settings,
    });
  }

  /** Read fee configuration from the settings table — never hardcoded. */
  private async loadPricingSettings(
    client: Tx | PrismaClient = this.prisma,
  ): Promise<PricingSettings> {
    const rows = await client.setting.findMany({
      where: {
        key: {
          in: [
            'tourism_dirham_per_room_per_night_aed',
            'vat_rate_percent',
            'currency',
          ],
        },
      },
    });

    const value = (key: string): string | undefined =>
      rows.find((row) => row.key === key)?.value;

    const tourismDirham = value('tourism_dirham_per_room_per_night_aed');
    const vatRate = value('vat_rate_percent');

    // Missing fee configuration must not silently price a stay at zero tax.
    if (tourismDirham === undefined || vatRate === undefined) {
      throw new Error(
        'Pricing settings are missing from the database. ' +
          'Run the seed to populate tourism_dirham_per_room_per_night_aed and vat_rate_percent.',
      );
    }

    return {
      currency: value('currency') ?? 'AED',
      tourismDirhamPerRoomPerNight: new Prisma.Decimal(tourismDirham),
      vatRatePercent: new Prisma.Decimal(vatRate),
    };
  }

  private assertValidStay(stay: Stay): void {
    if (!isValidIsoDate(stay.checkIn) || !isValidIsoDate(stay.checkOut)) {
      throw new BookingError('INVALID_STAY', 'Dates must be valid YYYY-MM-DD.');
    }
    if (countNights(stay.checkIn, stay.checkOut) < 1) {
      throw new BookingError(
        'INVALID_STAY',
        'Check-out must be at least one night after check-in.',
      );
    }
    if (stay.adults < 1) {
      throw new BookingError('INVALID_STAY', 'A booking needs at least one adult.');
    }
    if (stay.children < 0 || stay.roomsCount < 1) {
      throw new BookingError('INVALID_STAY', 'Invalid guest or room count.');
    }
  }

  /**
   * Convert a database-level rejection into a domain error.
   *
   * The CHECK constraint is the backstop against overselling. If it ever fires,
   * a code path reached the ledger without locking properly — but the guest
   * should still see "no longer available" rather than a 500.
   */
  private translateDatabaseError(error: unknown): unknown {
    if (error instanceof BookingError) return error;

    const message =
      error instanceof Error ? error.message : String(error);

    if (message.includes('room_type_inventory_booked_within_total')) {
      return new BookingError(
        'NO_AVAILABILITY',
        'Those dates were taken while your booking was being confirmed.',
      );
    }
    if (message.includes('reservations_checkout_after_checkin')) {
      return new BookingError(
        'INVALID_STAY',
        'Check-out must be after check-in.',
      );
    }
    return error;
  }
}

// ---------------------------------------------------------------------------
// Mapping: storage shapes -> domain shapes
//
// The single place table columns become domain concepts. Nothing above the
// provider sees a Prisma model, and no internal id crosses this line.
// ---------------------------------------------------------------------------

function toDomainRoomType(roomType: PrismaRoomType): RoomType {
  return {
    code: roomType.code,
    name: { en: roomType.nameEn, ar: roomType.nameAr },
    category: { en: roomType.categoryEn, ar: roomType.categoryAr },
    description: { en: roomType.descriptionEn, ar: roomType.descriptionAr },
    maxOccupancy: roomType.maxOccupancy,
    baseRate: roomType.baseRateAed.toNumber(),
    imageKey: roomType.imageKey,
  };
}

function toDomainReservation(
  reservation: ReservationWithRelations,
): Reservation {
  const locale: Locale = reservation.guest.preferredLocale === 'AR' ? 'ar' : 'en';

  return {
    reference: reservation.bookingReference,
    status: toDomainStatus(reservation.status),
    roomType: toDomainRoomType(reservation.roomType),
    stay: {
      checkIn: toIsoDate(reservation.checkIn),
      checkOut: toIsoDate(reservation.checkOut),
      adults: reservation.adults,
      children: reservation.children,
      roomsCount: reservation.roomsCount,
    },
    guest: {
      firstName: reservation.guest.firstName,
      lastName: reservation.guest.lastName,
      email: reservation.guest.email,
      phone: reservation.guest.phone,
      locale,
    },
    ...(reservation.specialRequests
      ? { specialRequests: reservation.specialRequests }
      : {}),
    price: reservation.priceBreakdown as unknown as PriceBreakdown,
    createdAt: reservation.createdAt.toISOString(),
    ...(reservation.cancelledAt
      ? { cancelledAt: reservation.cancelledAt.toISOString() }
      : {}),
    ...(reservation.checkedInAt
      ? { checkedInAt: reservation.checkedInAt.toISOString() }
      : {}),
    ...(reservation.checkedOutAt
      ? { checkedOutAt: reservation.checkedOutAt.toISOString() }
      : {}),
  };
}

const STATUS_TO_DOMAIN: Record<PrismaReservationStatus, ReservationStatus> = {
  HELD: 'held',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  CHECKED_IN: 'checked-in',
  CHECKED_OUT: 'checked-out',
};

const STATUS_TO_PRISMA: Record<ReservationStatus, PrismaReservationStatus> = {
  held: 'HELD',
  confirmed: 'CONFIRMED',
  cancelled: 'CANCELLED',
  'checked-in': 'CHECKED_IN',
  'checked-out': 'CHECKED_OUT',
};

function toDomainStatus(status: PrismaReservationStatus): ReservationStatus {
  return STATUS_TO_DOMAIN[status];
}

function toPrismaStatus(status: ReservationStatus): PrismaReservationStatus {
  return STATUS_TO_PRISMA[status];
}

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * A plain `===` on a token returns faster the earlier it finds a difference,
 * which is enough to recover a token byte by byte over many attempts. Lengths
 * are compared first because `timingSafeEqual` throws on a mismatch — that
 * check is not itself sensitive, since token length is fixed and public.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isUniqueConstraintError(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  const target = error.meta?.['target'];
  return Array.isArray(target) ? target.includes(field) : target === field;
}
