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
  Amenity as PrismaAmenity,
  AmenityCategory as PrismaAmenityCategory,
  Guest as PrismaGuest,
  MediaAsset as PrismaMediaAsset,
  PrismaClient,
  RatePlan as PrismaRatePlan,
  Reservation as PrismaReservation,
  ReservationStatus as PrismaReservationStatus,
  RoomType as PrismaRoomType,
  Setting as PrismaSetting,
  Voucher as PrismaVoucher,
} from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  addDays,
  countNights,
  isValidIsoDate,
  nightsBetween,
  toIsoDate,
  toUtcDate,
} from './dates.js';
import {
  calculatePrice,
  resolveMinimumStay,
  resolveNightlyRates,
  type DiscountInput,
  type PricingSettings,
} from './pricing.js';
import type { BookingProvider } from './provider.js';
import { generateBookingReference } from './reference.js';
import { deleteObject, publicUrlFor } from '../media/storage.js';
import {
  BookingError,
  type AdminAmenity,
  type AdminRoomType,
  type AdminVoucher,
  type Amenity,
  type AmenityCategory,
  type AmenityChanges,
  type AmenityDraft,
  type AvailabilityQuery,
  type AvailableRoomType,
  type InventoryCalendar,
  type InventoryChanges,
  type IsoDate,
  type Locale,
  type OccupancyReport,
  type Offer,
  type OperationalSetting,
  type PriceBreakdown,
  type Reservation,
  type ReservationChanges,
  type ReservationDraft,
  type ReservationFilter,
  type ReservationStatus,
  type RoomImage,
  type RoomImageDraft,
  type RoomType,
  type RoomTypeChanges,
  type Stay,
  type VoucherChanges,
  type VoucherDraft,
  type VoucherPreview,
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

/**
 * Load a room type's amenities, ordered for display.
 *
 * Used wherever a room type is presented as something to *choose* — the rooms
 * page, availability, the admin list. Deliberately **not** applied when a room
 * type comes back attached to a reservation: the guest has already chosen, and
 * joining the amenity tables onto every reservation read would be work nobody
 * asked for. `toDomainRoomType` maps the relation to `[]` when it is absent.
 */
const WITH_AMENITIES = {
  amenities: {
    where: { amenity: { isActive: true } },
    include: { amenity: true },
    orderBy: [
      { amenity: { category: 'asc' } },
      { amenity: { sortOrder: 'asc' } },
    ],
  },
  /**
   * Photographs, primary first.
   *
   * Ordered here rather than by the caller so every surface agrees on which
   * image is the primary one — the rooms page, the booking flow and the admin
   * gallery must not each pick a different hero shot.
   */
  images: {
    include: { asset: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.RoomTypeInclude;

type RoomTypeWithPlans = PrismaRoomType & { ratePlans: PrismaRatePlan[] };

/** A room type whose amenity and image relations may or may not be loaded. */
type RoomTypeMaybeAmenities = PrismaRoomType & {
  amenities?: Array<{ amenity: PrismaAmenity }>;
  images?: Array<{ asset: PrismaMediaAsset }>;
};

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
      include: WITH_AMENITIES,
    });
    return roomTypes.map(toDomainRoomType);
  }

  async getRoomType(code: string): Promise<RoomType | null> {
    const roomType = await this.prisma.roomType.findUnique({
      where: { code },
      include: WITH_AMENITIES,
    });
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
        include: { ratePlans: { where: { isActive: true } }, ...WITH_AMENITIES },
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

  /** See the note on the interface: for the email layer only, never over HTTP. */
  async getCancellationToken(reference: string): Promise<string | null> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { bookingReference: reference },
      select: { cancellationToken: true },
    });
    return reservation?.cancellationToken ?? null;
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
            // Waiting for another booking's locks is normal under contention,
            // and a discount code makes it markedly worse: every booking
            // quoting the same code queues on that one row, so they serialise
            // rather than overlap. Measured against the hosted database, five
            // concurrent bookings on one code take well past 15s end to end.
            //
            // A booking that waits is better than a booking that fails, so the
            // budget is generous. It is not unbounded — `maxWait` still gives
            // up rather than letting a request hang indefinitely.
            timeout: 30_000,
            maxWait: 15_000,
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

    // Validated here but **claimed at the very end** of the transaction.
    //
    // Claiming takes a row lock on the voucher, and locks are held until
    // commit. Every booking quoting the same code wants that one row, so
    // claiming early serialises the whole remainder of each transaction behind
    // it — with enough concurrency that exceeds the transaction timeout and
    // bookings fail with a database error instead of a clear answer. Measured:
    // five concurrent bookings on one code, two of them lost to P2028.
    //
    // So this read is optimistic and takes no lock, and the claim below is the
    // authoritative gate. If the code is exhausted between the two, the claim
    // updates no rows and the whole transaction — reservation included — rolls
    // back.
    const voucher = draft.voucherCode
      ? await this.validateVoucher(tx, {
          code: draft.voucherCode,
          roomTypeId: roomType.id,
          nights: nights.length,
        })
      : null;

    const price = this.priceStay(
      roomType,
      draft.checkIn,
      draft.checkOut,
      draft.roomsCount,
      settings,
      voucher?.discount,
    );

    // The minimum-spend rule is checked against the priced stay, which is only
    // known after pricing — so it cannot be part of `claimVoucher` above.
    if (voucher?.minimumSpend && price.roomTotal < voucher.minimumSpend) {
      throw new BookingError(
        'VOUCHER_NOT_APPLICABLE',
        `This code applies to stays of ${voucher.minimumSpend} ${price.currency} or more.`,
        { minimumSpend: voucher.minimumSpend, roomTotal: price.roomTotal },
      );
    }

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

    // The claim, deliberately last. See the note where the voucher is
    // validated: this is the authoritative gate, and holding its row lock for
    // only the final moments of the transaction is what keeps concurrent
    // bookings on one code from timing out.
    if (voucher && price.discount) {
      await this.claimVoucher(tx, voucher);

      await tx.voucherRedemption.create({
        data: {
          voucherId: voucher.id,
          reservationId: reservation.id,
          discountAed: new Prisma.Decimal(price.discount.amount),
        },
      });
    }

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

  /**
   * Check that a voucher exists and applies to this stay.
   *
   * A plain read — it takes no lock and claims nothing, so several bookings can
   * be validating the same code at once without queueing. Whether a use is
   * actually available is settled by `claimVoucher` at the end of the
   * transaction.
   *
   * Every rejection is a distinct message the guest can act on, rather than a
   * generic "invalid code" that leaves them retyping something that will never
   * work.
   */
  private async validateVoucher(
    tx: Tx,
    args: { code: string; roomTypeId: string; nights: number },
  ): Promise<{
    id: string;
    maxRedemptions: number | null;
    discount: DiscountInput;
    minimumSpend: number | null;
  }> {
    // Matched case-insensitively: these are typed off printed cards and emails.
    const code = args.code.trim().toUpperCase();

    const voucher = await tx.voucher.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
      include: { roomTypes: true },
    });

    if (!voucher || !voucher.isActive) {
      throw new BookingError(
        'VOUCHER_NOT_FOUND',
        'That code is not recognised.',
        { code },
      );
    }

    // Compared as calendar days in UTC, like every other date in the engine —
    // a code valid "until the 31st" is valid all of the 31st.
    const today = toUtcDate(toIsoDate(new Date()));
    if (voucher.validFrom && today < voucher.validFrom) {
      throw new BookingError(
        'VOUCHER_NOT_APPLICABLE',
        'That code is not valid yet.',
        { validFrom: toIsoDate(voucher.validFrom) },
      );
    }
    if (voucher.validTo && today > voucher.validTo) {
      throw new BookingError('VOUCHER_EXPIRED', 'That code has expired.', {
        validTo: toIsoDate(voucher.validTo),
      });
    }

    if (args.nights < voucher.minimumNights) {
      throw new BookingError(
        'VOUCHER_NOT_APPLICABLE',
        `This code applies to stays of ${voucher.minimumNights} nights or more.`,
        { minimumNights: voucher.minimumNights },
      );
    }

    // No rows means no restriction.
    if (
      voucher.roomTypes.length > 0 &&
      !voucher.roomTypes.some((link) => link.roomTypeId === args.roomTypeId)
    ) {
      throw new BookingError(
        'VOUCHER_NOT_APPLICABLE',
        'This code does not apply to the room you have chosen.',
      );
    }

    // A code already spent when we looked is worth rejecting now, before the
    // rest of the booking work. It is only advisory — `claimVoucher` is what
    // actually decides — but it saves doing the work to then throw it away.
    if (
      voucher.maxRedemptions !== null &&
      voucher.redemptionCount >= voucher.maxRedemptions
    ) {
      throw new BookingError(
        'VOUCHER_EXHAUSTED',
        'That code has already been fully redeemed.',
      );
    }

    return {
      id: voucher.id,
      maxRedemptions: voucher.maxRedemptions,
      minimumSpend: voucher.minimumSpend?.toNumber() ?? null,
      discount: {
        code: voucher.code,
        name: { en: voucher.nameEn, ar: voucher.nameAr },
        type: voucher.discountType === 'PERCENTAGE' ? 'percentage' : 'fixed',
        value: voucher.discountValue,
      },
    };
  }

  /**
   * Claim one use of a voucher. **Atomic, and the authoritative gate.**
   *
   * The cap lives in the WHERE clause, so an exhausted code updates zero rows
   * rather than throwing — which lets the guest be told plainly that the code
   * has gone. The CHECK constraint stays as the backstop if a code path ever
   * reaches the counter without coming through here.
   *
   * Called as the last act of the booking transaction. Everything written
   * before it, the reservation included, rolls back if this refuses.
   */
  private async claimVoucher(
    tx: Tx,
    voucher: { id: string; maxRedemptions: number | null },
  ): Promise<void> {
    const claimed = await tx.voucher.updateMany({
      where: {
        id: voucher.id,
        OR: [
          { maxRedemptions: null },
          { redemptionCount: { lt: voucher.maxRedemptions ?? 0 } },
        ],
      },
      data: { redemptionCount: { increment: 1 } },
    });

    if (claimed.count === 0) {
      throw new BookingError(
        'VOUCHER_EXHAUSTED',
        'That code has already been fully redeemed.',
      );
    }
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
    discount?: DiscountInput | undefined,
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
      ...(discount ? { discount } : {}),
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

  // -------------------------------------------------------------------------
  // Admin writes
  // -------------------------------------------------------------------------

  async listRoomTypes(): Promise<AdminRoomType[]> {
    const roomTypes = await this.prisma.roomType.findMany({
      orderBy: { sortOrder: 'asc' },
      include: WITH_AMENITIES,
    });
    return roomTypes.map(toAdminRoomType);
  }

  async updateRoomType(
    code: string,
    changes: RoomTypeChanges,
  ): Promise<AdminRoomType> {
    const existing = await this.prisma.roomType.findUnique({ where: { code } });
    if (!existing) {
      throw new BookingError(
        'ROOM_TYPE_NOT_FOUND',
        `No room type with code "${code}".`,
      );
    }

    // Build the update explicitly rather than spreading the input: this is the
    // boundary between a domain shape and a table, and an unmapped key here
    // would be a silent way to write a column the caller should not reach.
    const data: Prisma.RoomTypeUpdateInput = {};

    if (changes.name) {
      data.nameEn = changes.name.en;
      data.nameAr = changes.name.ar;
    }
    if (changes.category) {
      data.categoryEn = changes.category.en;
      data.categoryAr = changes.category.ar;
    }
    if (changes.description) {
      data.descriptionEn = changes.description.en;
      data.descriptionAr = changes.description.ar;
    }
    if (changes.maxOccupancy !== undefined) {
      data.maxOccupancy = changes.maxOccupancy;
    }
    if (changes.baseRate !== undefined) {
      data.baseRateAed = new Prisma.Decimal(changes.baseRate);
    }
    if (changes.imageKey !== undefined) data.imageKey = changes.imageKey;
    if (changes.isActive !== undefined) data.isActive = changes.isActive;

    const updated = await this.prisma.roomType.update({
      where: { code },
      data,
      include: WITH_AMENITIES,
    });

    // Deliberately does not reprice existing reservations: each one carries
    // its own price snapshot, so a rate change never rewrites a total a guest
    // has already been quoted.
    return toAdminRoomType(updated);
  }

  // -------------------------------------------------------------------------
  // Amenities
  // -------------------------------------------------------------------------

  async listAmenities(): Promise<AdminAmenity[]> {
    const amenities = await this.prisma.amenity.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      include: { _count: { select: { roomTypes: true } } },
    });

    return amenities.map((amenity) => ({
      ...toDomainAmenity(amenity),
      isActive: amenity.isActive,
      sortOrder: amenity.sortOrder,
      roomTypeCount: amenity._count.roomTypes,
    }));
  }

  async createAmenity(draft: AmenityDraft): Promise<AdminAmenity> {
    const existing = await this.prisma.amenity.findUnique({
      where: { code: draft.code },
    });

    if (existing) {
      throw new BookingError(
        'AMENITY_CODE_IN_USE',
        `An amenity with the code "${draft.code}" already exists.`,
      );
    }

    const amenity = await this.prisma.amenity.create({
      data: {
        code: draft.code,
        otaCode: draft.otaCode ?? null,
        nameEn: draft.name.en,
        nameAr: draft.name.ar,
        category: toPrismaAmenityCategory(draft.category),
        iconKey: draft.iconKey ?? null,
        sortOrder: draft.sortOrder ?? 0,
      },
    });

    return {
      ...toDomainAmenity(amenity),
      isActive: amenity.isActive,
      sortOrder: amenity.sortOrder,
      roomTypeCount: 0,
    };
  }

  async updateAmenity(
    code: string,
    changes: AmenityChanges,
  ): Promise<AdminAmenity> {
    await this.requireAmenity(code);

    const data: Prisma.AmenityUpdateInput = {};

    if (changes.name) {
      data.nameEn = changes.name.en;
      data.nameAr = changes.name.ar;
    }
    // `null` is meaningful here — it clears a wrongly-assigned OTA code — so
    // this tests for `undefined` rather than falsiness.
    if (changes.otaCode !== undefined) data.otaCode = changes.otaCode;
    if (changes.category !== undefined) {
      data.category = toPrismaAmenityCategory(changes.category);
    }
    if (changes.iconKey !== undefined) data.iconKey = changes.iconKey;
    if (changes.sortOrder !== undefined) data.sortOrder = changes.sortOrder;
    if (changes.isActive !== undefined) data.isActive = changes.isActive;

    const amenity = await this.prisma.amenity.update({
      where: { code },
      data,
      include: { _count: { select: { roomTypes: true } } },
    });

    return {
      ...toDomainAmenity(amenity),
      isActive: amenity.isActive,
      sortOrder: amenity.sortOrder,
      roomTypeCount: amenity._count.roomTypes,
    };
  }

  async deleteAmenity(code: string): Promise<void> {
    const amenity = await this.prisma.amenity.findUnique({
      where: { code },
      include: { _count: { select: { roomTypes: true } } },
    });

    if (!amenity) {
      throw new BookingError(
        'AMENITY_NOT_FOUND',
        `No amenity with the code "${code}".`,
      );
    }

    // The cascade would happily strip this from every room type listing it,
    // rewriting published room descriptions as a side effect of a delete.
    // Refuse, and point at the reversible alternative.
    if (amenity._count.roomTypes > 0) {
      throw new BookingError(
        'AMENITY_CODE_IN_USE',
        'This amenity is still listed on room types. Remove it from them first, or withdraw it instead of deleting it.',
        { roomTypeCount: amenity._count.roomTypes },
      );
    }

    await this.prisma.amenity.delete({ where: { code } });
  }

  async setRoomTypeAmenities(
    roomTypeCode: string,
    amenityCodes: string[],
  ): Promise<AdminRoomType> {
    const roomType = await this.requireRoomType(roomTypeCode);
    const wanted = [...new Set(amenityCodes)];

    const amenities = await this.prisma.amenity.findMany({
      where: { code: { in: wanted } },
    });

    // Report an unknown code rather than quietly saving a shorter list than
    // the admin selected.
    if (amenities.length !== wanted.length) {
      const found = new Set(amenities.map((amenity) => amenity.code));
      throw new BookingError(
        'AMENITY_NOT_FOUND',
        'Some of those amenities do not exist.',
        { unknown: wanted.filter((code) => !found.has(code)) },
      );
    }

    // Replaced inside one transaction: a failure part-way through must not
    // leave the room type holding some of its old amenities and some new ones.
    await this.prisma.$transaction([
      this.prisma.roomTypeAmenity.deleteMany({
        where: { roomTypeId: roomType.id },
      }),
      this.prisma.roomTypeAmenity.createMany({
        data: amenities.map((amenity) => ({
          roomTypeId: roomType.id,
          amenityId: amenity.id,
        })),
      }),
    ]);

    const updated = await this.prisma.roomType.findUniqueOrThrow({
      where: { id: roomType.id },
      include: WITH_AMENITIES,
    });

    return toAdminRoomType(updated);
  }

  // --- Room type photography ------------------------------------------------

  async addRoomTypeImage(
    code: string,
    draft: RoomImageDraft,
  ): Promise<AdminRoomType> {
    const roomType = await this.requireRoomType(code);

    // New photographs land at the end of the gallery. Uploading one must never
    // silently change which image is the hero shot on the public site.
    const last = await this.prisma.roomTypeImage.findFirst({
      where: { roomTypeId: roomType.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    await this.prisma.$transaction(async (tx) => {
      // Upsert on the key, because the object already exists in the bucket by
      // the time this is called. A retried confirmation after a flaky response
      // must not fail on the unique index and strand bytes nothing points at.
      const asset = await tx.mediaAsset.upsert({
        where: { storageKey: draft.storageKey },
        create: {
          storageKey: draft.storageKey,
          contentType: draft.contentType,
          byteSize: draft.byteSize,
          width: draft.width,
          height: draft.height,
          altEn: draft.alt.en,
          altAr: draft.alt.ar,
        },
        update: {
          altEn: draft.alt.en,
          altAr: draft.alt.ar,
        },
      });

      await tx.roomTypeImage.upsert({
        where: {
          roomTypeId_assetId: { roomTypeId: roomType.id, assetId: asset.id },
        },
        create: {
          roomTypeId: roomType.id,
          assetId: asset.id,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        update: {},
      });
    });

    return this.readAdminRoomType(roomType.id);
  }

  async removeRoomTypeImage(
    code: string,
    storageKey: string,
  ): Promise<AdminRoomType> {
    const roomType = await this.requireRoomType(code);

    const asset = await this.prisma.mediaAsset.findUnique({
      where: { storageKey },
      include: { roomTypes: { select: { roomTypeId: true } } },
    });

    if (!asset) {
      throw new BookingError('MEDIA_NOT_FOUND', 'No such image.');
    }

    const link = asset.roomTypes.find((l) => l.roomTypeId === roomType.id);
    if (!link) {
      throw new BookingError(
        'MEDIA_NOT_FOUND',
        'That image is not on this room type.',
      );
    }

    // The same photograph can legitimately sit on more than one room type, so
    // the bytes only go when the last reference does.
    const isLastReference = asset.roomTypes.length === 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.roomTypeImage.deleteMany({
        where: { roomTypeId: roomType.id, assetId: asset.id },
      });
      if (isLastReference) {
        await tx.mediaAsset.delete({ where: { id: asset.id } });
      }
    });

    if (isLastReference) {
      // Deliberately after the transaction and deliberately not awaited into
      // failure. The row is the record; an object left behind costs a fraction
      // of a cent, whereas failing here would roll nothing back and leave the
      // admin looking at an image they were told was deleted.
      try {
        await deleteObject(storageKey);
      } catch (error) {
        console.error(
          `[media] orphaned object ${storageKey} — delete failed`,
          error,
        );
      }
    }

    return this.readAdminRoomType(roomType.id);
  }

  async reorderRoomTypeImages(
    code: string,
    storageKeys: string[],
  ): Promise<AdminRoomType> {
    const roomType = await this.requireRoomType(code);

    const current = await this.prisma.roomTypeImage.findMany({
      where: { roomTypeId: roomType.id },
      include: { asset: { select: { storageKey: true } } },
    });

    const wanted = [...new Set(storageKeys)];
    const byKey = new Map(current.map((l) => [l.asset.storageKey, l.id]));

    // Insist on the complete set. A partial list would leave the unmentioned
    // images with stale positions, silently interleaved through the new order.
    if (wanted.length !== current.length || wanted.some((k) => !byKey.has(k))) {
      throw new BookingError(
        'MEDIA_ORDER_MISMATCH',
        'The order must list exactly the images currently on this room type.',
      );
    }

    await this.prisma.$transaction(
      wanted.map((key, index) =>
        this.prisma.roomTypeImage.update({
          where: { id: byKey.get(key)! },
          data: { sortOrder: index },
        }),
      ),
    );

    return this.readAdminRoomType(roomType.id);
  }

  /** Re-read a room type with everything the admin screens display. */
  private async readAdminRoomType(id: string): Promise<AdminRoomType> {
    return toAdminRoomType(
      await this.prisma.roomType.findUniqueOrThrow({
        where: { id },
        include: WITH_AMENITIES,
      }),
    );
  }

  private async requireAmenity(code: string): Promise<PrismaAmenity> {
    const amenity = await this.prisma.amenity.findUnique({ where: { code } });
    if (!amenity) {
      throw new BookingError(
        'AMENITY_NOT_FOUND',
        `No amenity with the code "${code}".`,
      );
    }
    return amenity;
  }

  async getInventoryCalendar(args: {
    roomTypeCode: string;
    from: IsoDate;
    to: IsoDate;
  }): Promise<InventoryCalendar> {
    const roomType = await this.requireRoomType(args.roomTypeCode);
    this.assertValidCalendarRange(args.from, args.to);

    const rows = await this.prisma.roomTypeInventory.findMany({
      where: {
        roomTypeId: roomType.id,
        // `to` is inclusive for a calendar, so reach one day past it.
        date: { gte: toUtcDate(args.from), lte: toUtcDate(args.to) },
      },
      orderBy: { date: 'asc' },
    });

    return {
      roomTypeCode: roomType.code,
      from: args.from,
      to: args.to,
      days: rows.map((row) => ({
        date: toIsoDate(row.date),
        totalRooms: row.totalRooms,
        bookedRooms: row.bookedRooms,
        isClosed: row.isClosed,
      })),
    };
  }

  /**
   * Set inventory across a range of days.
   *
   * The whole range moves inside one transaction, with the affected rows locked
   * first. Two things make that necessary rather than tidy: a booking landing
   * mid-edit could otherwise slip between the check and the write, and a
   * partially-applied range would leave the calendar in a state no one asked
   * for.
   *
   * Rows are created where the calendar has not been opened that far out, so an
   * admin can extend the booking horizon from this screen rather than needing a
   * seed run.
   */
  async updateInventory(args: {
    roomTypeCode: string;
    from: IsoDate;
    to: IsoDate;
    changes: InventoryChanges;
  }): Promise<InventoryCalendar> {
    const roomType = await this.requireRoomType(args.roomTypeCode);
    this.assertValidCalendarRange(args.from, args.to);

    const days = nightsBetween(args.from, addDays(args.to, 1));

    try {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          Array<{ date: Date; bookedRooms: number }>
        >`
          SELECT date, "bookedRooms"
          FROM room_type_inventory
          WHERE "roomTypeId" = ${roomType.id}
            AND date >= ${toUtcDate(args.from)}::date
            AND date <= ${toUtcDate(args.to)}::date
          ORDER BY date
          FOR UPDATE
        `;

        if (args.changes.totalRooms !== undefined) {
          const requested = args.changes.totalRooms;

          // Refuse the whole range rather than clamping. Cutting inventory
          // below what is already sold would oversell those nights, and
          // silently applying a smaller number than asked for hides the
          // conflict from whoever made the edit.
          const conflicts = locked
            .filter((row) => row.bookedRooms > requested)
            .map((row) => ({
              date: toIsoDate(row.date),
              bookedRooms: row.bookedRooms,
            }));

          if (conflicts.length > 0) {
            throw new BookingError(
              'INVENTORY_BELOW_BOOKED',
              'Some nights already have more rooms booked than that.',
              { requestedTotalRooms: requested, conflicts },
            );
          }
        }

        const existing = new Set(locked.map((row) => toIsoDate(row.date)));

        const update: Prisma.RoomTypeInventoryUpdateManyMutationInput = {};
        if (args.changes.totalRooms !== undefined) {
          update.totalRooms = args.changes.totalRooms;
        }
        if (args.changes.isClosed !== undefined) {
          update.isClosed = args.changes.isClosed;
        }

        await tx.roomTypeInventory.updateMany({
          where: {
            roomTypeId: roomType.id,
            date: { gte: toUtcDate(args.from), lte: toUtcDate(args.to) },
          },
          data: update,
        });

        const missing = days.filter((day) => !existing.has(day));
        if (missing.length > 0) {
          await tx.roomTypeInventory.createMany({
            data: missing.map((day) => ({
              roomTypeId: roomType.id,
              date: toUtcDate(day),
              // A new row defaults to the room type's own count, so opening
              // the calendar further out does not require stating it again.
              totalRooms: args.changes.totalRooms ?? roomType.totalRooms,
              bookedRooms: 0,
              isClosed: args.changes.isClosed ?? false,
            })),
            skipDuplicates: true,
          });
        }
      });
    } catch (error) {
      throw this.translateDatabaseError(error);
    }

    return this.getInventoryCalendar(args);
  }

  /**
   * Move a booking through check-in and check-out.
   *
   * Inventory is untouched: a stay that is checked in or out still occupies
   * its nights, and only cancellation releases them.
   */
  async setReservationStatus(
    reference: string,
    status: 'checked-in' | 'checked-out',
  ): Promise<Reservation> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { bookingReference: reference },
    });

    if (!reservation) {
      throw new BookingError(
        'RESERVATION_NOT_FOUND',
        `No reservation with reference "${reference}".`,
      );
    }

    const current = toDomainStatus(reservation.status);

    // A guest can only check in from a live booking, and only check out having
    // checked in. Anything else is a mis-click at the front desk.
    const permitted: Record<typeof status, ReservationStatus[]> = {
      'checked-in': ['confirmed', 'held'],
      'checked-out': ['checked-in'],
    };

    if (!permitted[status].includes(current)) {
      throw new BookingError(
        'INVALID_STATUS_TRANSITION',
        `A reservation that is ${current} cannot be marked ${status}.`,
        { currentStatus: current, requestedStatus: status },
      );
    }

    const updated = await this.prisma.reservation.update({
      where: { bookingReference: reference },
      data: {
        status: toPrismaStatus(status),
        ...(status === 'checked-in'
          ? { checkedInAt: new Date() }
          : { checkedOutAt: new Date() }),
      },
      include: { guest: true, roomType: true },
    });

    return toDomainReservation(updated);
  }

  // -------------------------------------------------------------------------
  // Operational settings
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Offers
  // -------------------------------------------------------------------------

  async listPublicOffers(): Promise<Offer[]> {
    // Compared as a calendar day: an offer valid "until the 31st" is still on
    // during the 31st, in the hotel's terms rather than the server's clock.
    const today = toUtcDate(toIsoDate(new Date()));

    const plans = await this.prisma.ratePlan.findMany({
      where: {
        isActive: true,
        isPublicOffer: true,
        roomType: { isActive: true },
        // An expired offer stops advertising itself. Relying on someone
        // deactivating it by hand is how a hotel ends up promoting last
        // summer's rate.
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      orderBy: [{ priority: 'desc' }, { nightlyRateAed: 'asc' }],
      include: { roomType: { include: WITH_AMENITIES } },
    });

    return plans.map((plan) => {
      const nightlyRate = plan.nightlyRateAed.toNumber();
      const standardRate = plan.roomType.baseRateAed.toNumber();

      return {
        roomTypeCode: plan.roomType.code,
        roomTypeName: {
          en: plan.roomType.nameEn,
          ar: plan.roomType.nameAr,
        },
        imageKey: plan.roomType.imageKey,
        images: toDomainImages(plan.roomType.images),
        name: { en: plan.nameEn, ar: plan.nameAr },
        description:
          plan.descriptionEn && plan.descriptionAr
            ? { en: plan.descriptionEn, ar: plan.descriptionAr }
            : null,
        nightlyRate,
        // Only when the offer genuinely undercuts the standard rate. A plan
        // can legitimately be a *higher* peak rate, and claiming a saving on
        // one of those would be false.
        standardRate: standardRate > nightlyRate ? standardRate : null,
        validFrom: plan.startDate ? toIsoDate(plan.startDate) : null,
        validTo: plan.endDate ? toIsoDate(plan.endDate) : null,
        minimumStayNights: plan.minimumStayNights,
        daysOfWeek: plan.daysOfWeek,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Vouchers
  // -------------------------------------------------------------------------

  async listVouchers(): Promise<AdminVoucher[]> {
    const vouchers = await this.prisma.voucher.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { roomTypes: { include: { roomType: true } } },
    });
    return vouchers.map(toAdminVoucher);
  }

  async createVoucher(draft: VoucherDraft): Promise<AdminVoucher> {
    const code = draft.code.trim().toUpperCase();

    const existing = await this.prisma.voucher.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
    });
    if (existing) {
      throw new BookingError(
        'VOUCHER_CODE_IN_USE',
        `A voucher with the code "${code}" already exists.`,
      );
    }

    const roomTypeIds = await this.resolveVoucherRoomTypes(draft.roomTypeCodes);

    const voucher = await this.prisma.voucher.create({
      data: {
        code,
        nameEn: draft.name.en,
        nameAr: draft.name.ar,
        discountType:
          draft.discountType === 'percentage' ? 'PERCENTAGE' : 'FIXED_AMOUNT',
        discountValue: new Prisma.Decimal(draft.discountValue),
        validFrom: draft.validFrom ? toUtcDate(draft.validFrom) : null,
        validTo: draft.validTo ? toUtcDate(draft.validTo) : null,
        maxRedemptions: draft.maxRedemptions ?? null,
        minimumNights: draft.minimumNights ?? 1,
        minimumSpend:
          draft.minimumSpend === undefined || draft.minimumSpend === null
            ? null
            : new Prisma.Decimal(draft.minimumSpend),
        roomTypes: { create: roomTypeIds.map((roomTypeId) => ({ roomTypeId })) },
      },
      include: { roomTypes: { include: { roomType: true } } },
    });

    return toAdminVoucher(voucher);
  }

  async updateVoucher(
    code: string,
    changes: VoucherChanges,
  ): Promise<AdminVoucher> {
    const voucher = await this.requireVoucher(code);

    const data: Prisma.VoucherUpdateInput = {};

    if (changes.name) {
      data.nameEn = changes.name.en;
      data.nameAr = changes.name.ar;
    }
    if (changes.discountType !== undefined) {
      data.discountType =
        changes.discountType === 'percentage' ? 'PERCENTAGE' : 'FIXED_AMOUNT';
    }
    if (changes.discountValue !== undefined) {
      data.discountValue = new Prisma.Decimal(changes.discountValue);
    }
    // `null` is meaningful on the date and cap fields — it clears a limit —
    // so these test for `undefined` rather than falsiness.
    if (changes.validFrom !== undefined) {
      data.validFrom = changes.validFrom ? toUtcDate(changes.validFrom) : null;
    }
    if (changes.validTo !== undefined) {
      data.validTo = changes.validTo ? toUtcDate(changes.validTo) : null;
    }
    if (changes.maxRedemptions !== undefined) {
      // Lowering the cap below what has already gone would put the row in
      // breach of its own CHECK constraint, so it is refused with an
      // explanation rather than a database error.
      if (
        changes.maxRedemptions !== null &&
        changes.maxRedemptions < voucher.redemptionCount
      ) {
        throw new BookingError(
          'VOUCHER_NOT_APPLICABLE',
          `This code has already been redeemed ${voucher.redemptionCount} times; the limit cannot be set below that.`,
          { redemptionCount: voucher.redemptionCount },
        );
      }
      data.maxRedemptions = changes.maxRedemptions;
    }
    if (changes.minimumNights !== undefined) {
      data.minimumNights = changes.minimumNights;
    }
    if (changes.minimumSpend !== undefined) {
      data.minimumSpend =
        changes.minimumSpend === null
          ? null
          : new Prisma.Decimal(changes.minimumSpend);
    }
    if (changes.isActive !== undefined) data.isActive = changes.isActive;

    // Room-type restrictions are replaced wholesale, like a room type's
    // amenities, so a failure cannot leave half the old set and half the new.
    if (changes.roomTypeCodes !== undefined) {
      const roomTypeIds = await this.resolveVoucherRoomTypes(
        changes.roomTypeCodes,
      );
      data.roomTypes = {
        deleteMany: {},
        create: roomTypeIds.map((roomTypeId) => ({ roomTypeId })),
      };
    }

    const updated = await this.prisma.voucher.update({
      where: { id: voucher.id },
      data,
      include: { roomTypes: { include: { roomType: true } } },
    });

    // Existing reservations keep the discount they were quoted: each carries
    // its own price snapshot and is never repriced.
    return toAdminVoucher(updated);
  }

  async deleteVoucher(code: string): Promise<void> {
    const voucher = await this.prisma.voucher.findFirst({
      where: { code: { equals: code.trim().toUpperCase(), mode: 'insensitive' } },
      include: { _count: { select: { redemptions: true } } },
    });

    if (!voucher) {
      throw new BookingError(
        'VOUCHER_NOT_FOUND',
        `No voucher with the code "${code}".`,
      );
    }

    // The redemptions are what a campaign cost. Deleting the voucher would
    // cascade them away and take the financial record with it.
    if (voucher._count.redemptions > 0) {
      throw new BookingError(
        'VOUCHER_CODE_IN_USE',
        'This code has been redeemed and cannot be deleted. Deactivate it instead.',
        { redemptionCount: voucher._count.redemptions },
      );
    }

    await this.prisma.voucher.delete({ where: { id: voucher.id } });
  }

  /**
   * Price a stay with a code applied, claiming nothing.
   *
   * Reuses `validateVoucher` so the reserve flow cannot be shown a discount the
   * booking would then refuse — the same rules, in the same place. Runs in a
   * short read-only transaction purely because `validateVoucher` takes a
   * transaction client.
   */
  async previewVoucher(args: {
    code: string;
    roomTypeCode: string;
    checkIn: IsoDate;
    checkOut: IsoDate;
    roomsCount?: number;
  }): Promise<VoucherPreview> {
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

    const nights = nightsBetween(args.checkIn, args.checkOut);

    const voucher = await this.prisma.$transaction((tx) =>
      this.validateVoucher(tx, {
        code: args.code,
        roomTypeId: roomType.id,
        nights: nights.length,
      }),
    );

    const settings = await this.loadPricingSettings();
    const price = this.priceStay(
      roomType,
      args.checkIn,
      args.checkOut,
      roomsCount,
      settings,
      voucher.discount,
    );

    // The minimum-spend rule needs the priced stay, so it is checked here as
    // well as in the booking transaction.
    if (voucher.minimumSpend && price.roomTotal < voucher.minimumSpend) {
      throw new BookingError(
        'VOUCHER_NOT_APPLICABLE',
        `This code applies to stays of ${voucher.minimumSpend} ${price.currency} or more.`,
        { minimumSpend: voucher.minimumSpend, roomTotal: price.roomTotal },
      );
    }

    return {
      code: voucher.discount.code,
      name: voucher.discount.name,
      price,
    };
  }

  private async requireVoucher(code: string) {
    const voucher = await this.prisma.voucher.findFirst({
      where: { code: { equals: code.trim().toUpperCase(), mode: 'insensitive' } },
    });
    if (!voucher) {
      throw new BookingError(
        'VOUCHER_NOT_FOUND',
        `No voucher with the code "${code}".`,
      );
    }
    return voucher;
  }

  /** Map room-type codes to ids, reporting any that do not exist. */
  private async resolveVoucherRoomTypes(
    codes: string[] | undefined,
  ): Promise<string[]> {
    if (!codes || codes.length === 0) return [];

    const wanted = [...new Set(codes)];
    const roomTypes = await this.prisma.roomType.findMany({
      where: { code: { in: wanted } },
    });

    if (roomTypes.length !== wanted.length) {
      const found = new Set(roomTypes.map((roomType) => roomType.code));
      throw new BookingError(
        'ROOM_TYPE_NOT_FOUND',
        'Some of those room types do not exist.',
        { unknown: wanted.filter((code) => !found.has(code)) },
      );
    }

    return roomTypes.map((roomType) => roomType.id);
  }

  async listSettings(): Promise<OperationalSetting[]> {
    const rows = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return rows.map(toDomainSetting);
  }

  async updateSetting(key: string, value: string): Promise<OperationalSetting> {
    const existing = await this.prisma.setting.findUnique({ where: { key } });

    // Update only — never create. Settings are seeded with the description
    // that explains them, and letting a typo'd key create a new orphan row
    // would mean the real setting silently keeps its old value.
    if (!existing) {
      throw new BookingError('SETTING_NOT_FOUND', `No setting named "${key}".`);
    }

    // The pricing settings are read fresh on every quote, so this takes effect
    // on the next request with no deploy and no restart.
    const updated = await this.prisma.setting.update({
      where: { key },
      data: { value },
    });

    return toDomainSetting(updated);
  }

  /** Look a room type up by code, or raise the domain error for a bad code. */
  private async requireRoomType(code: string): Promise<PrismaRoomType> {
    const roomType = await this.prisma.roomType.findUnique({ where: { code } });
    if (!roomType) {
      throw new BookingError(
        'ROOM_TYPE_NOT_FOUND',
        `No room type with code "${code}".`,
      );
    }
    return roomType;
  }

  /** A calendar range, where both ends are inclusive and a single day is fine. */
  private assertValidCalendarRange(from: IsoDate, to: IsoDate): void {
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
      throw new BookingError('INVALID_STAY', 'Dates must be valid YYYY-MM-DD.');
    }
    if (from > to) {
      throw new BookingError(
        'INVALID_STAY',
        'The end of the range must not be before its start.',
      );
    }
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

function toDomainRoomType(roomType: RoomTypeMaybeAmenities): RoomType {
  return {
    code: roomType.code,
    name: { en: roomType.nameEn, ar: roomType.nameAr },
    category: { en: roomType.categoryEn, ar: roomType.categoryAr },
    description: { en: roomType.descriptionEn, ar: roomType.descriptionAr },
    maxOccupancy: roomType.maxOccupancy,
    baseRate: roomType.baseRateAed.toNumber(),
    imageKey: roomType.imageKey,
    // Empty rather than undefined when the relation was not loaded, so callers
    // never have to distinguish "no amenities" from "not asked for". See
    // WITH_AMENITIES for where it is loaded and why not everywhere.
    amenities: (roomType.amenities ?? []).map((link) =>
      toDomainAmenity(link.amenity),
    ),
    images: toDomainImages(roomType.images),
  };
}

/**
 * Turn stored objects into renderable images.
 *
 * Keys become URLs here, in the API, so the front-end never learns that a
 * bucket exists. `publicUrlFor` returns null when no public origin is
 * configured, and those are dropped rather than thrown on: a missing
 * MEDIA_PUBLIC_BASE_URL should degrade a room type to its gradient fallback,
 * not fail every read of the rooms page.
 */
function toDomainImages(
  images: Array<{ asset: PrismaMediaAsset }> | undefined,
): RoomImage[] {
  return (images ?? []).flatMap((link) => {
    const url = publicUrlFor(link.asset.storageKey);
    if (!url) return [];

    return [
      {
        url,
        storageKey: link.asset.storageKey,
        alt: { en: link.asset.altEn, ar: link.asset.altAr },
        width: link.asset.width,
        height: link.asset.height,
      },
    ];
  });
}

function toDomainAmenity(amenity: PrismaAmenity): Amenity {
  return {
    code: amenity.code,
    otaCode: amenity.otaCode,
    name: { en: amenity.nameEn, ar: amenity.nameAr },
    category: toDomainAmenityCategory(amenity.category),
    iconKey: amenity.iconKey,
  };
}

/** `BATHROOM` -> `bathroom`. Storage enums are shouty; the domain is not. */
function toDomainAmenityCategory(
  category: PrismaAmenityCategory,
): AmenityCategory {
  return category.toLowerCase() as AmenityCategory;
}

function toPrismaAmenityCategory(
  category: AmenityCategory,
): PrismaAmenityCategory {
  return category.toUpperCase() as PrismaAmenityCategory;
}

/** The admin view: the guest fields plus what is not on sale and how many. */
function toAdminRoomType(roomType: RoomTypeMaybeAmenities): AdminRoomType {
  return {
    ...toDomainRoomType(roomType),
    isActive: roomType.isActive,
    totalRooms: roomType.totalRooms,
  };
}

/**
 * A voucher as the admin screen sees it.
 *
 * Room-type restrictions come back as **codes**, never row ids — the same rule
 * every other shape crossing this line obeys.
 */
function toAdminVoucher(
  voucher: PrismaVoucher & {
    roomTypes: Array<{ roomType: PrismaRoomType }>;
  },
): AdminVoucher {
  return {
    code: voucher.code,
    name: { en: voucher.nameEn, ar: voucher.nameAr },
    discountType:
      voucher.discountType === 'PERCENTAGE' ? 'percentage' : 'fixed',
    discountValue: voucher.discountValue.toNumber(),
    validFrom: voucher.validFrom ? toIsoDate(voucher.validFrom) : null,
    validTo: voucher.validTo ? toIsoDate(voucher.validTo) : null,
    maxRedemptions: voucher.maxRedemptions,
    redemptionCount: voucher.redemptionCount,
    minimumNights: voucher.minimumNights,
    minimumSpend: voucher.minimumSpend?.toNumber() ?? null,
    roomTypeCodes: voucher.roomTypes.map((link) => link.roomType.code),
    isActive: voucher.isActive,
    createdAt: voucher.createdAt.toISOString(),
  };
}

function toDomainSetting(setting: PrismaSetting): OperationalSetting {
  return {
    key: setting.key,
    value: setting.value,
    description: setting.description,
    updatedAt: setting.updatedAt.toISOString(),
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
