/**
 * The double-booking test — the gate for the whole booking layer.
 *
 * "Two guests must never book the last room" is the one rule in CLAUDE.md that
 * cannot be verified by reading the code, because the failure only appears
 * under genuine concurrency. So this fires real simultaneous bookings at the
 * real database and checks that exactly one wins.
 *
 * It runs against the hosted Railway database. Every test picks dates far in
 * the future and cleans up after itself, so it cannot collide with real
 * bookings or with a developer working in the same database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { CustomDbProvider } from '../src/booking/custom-db.provider.js';
import { addDays, toUtcDate } from '../src/booking/dates.js';
import { BookingError, type ReservationDraft } from '../src/booking/types.js';
import { prisma } from '../src/db/prisma.js';

const provider = new CustomDbProvider(prisma);

/** Far enough out that no real booking or seeded change will overlap. */
const CHECK_IN = addDays(new Date().toISOString().slice(0, 10), 400);
const CHECK_OUT = addDays(CHECK_IN, 2);

const ROOM_TYPE_CODE = 'cove-suite';

/** Marks guests created by this file so cleanup can find them. */
const TEST_EMAIL_DOMAIN = 'concurrency-test.invalid';

let roomTypeId: string;

function draft(overrides: Partial<ReservationDraft> = {}): ReservationDraft {
  return {
    roomTypeCode: ROOM_TYPE_CODE,
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    adults: 2,
    children: 0,
    roomsCount: 1,
    guest: {
      firstName: 'Test',
      lastName: 'Guest',
      email: `guest-${Math.random().toString(36).slice(2)}@${TEST_EMAIL_DOMAIN}`,
      phone: '+971500000000',
      locale: 'en',
    },
    ...overrides,
  };
}

/** Force the stay's nights to exactly `rooms` sellable rooms. */
async function setAvailableRooms(rooms: number): Promise<void> {
  await prisma.roomTypeInventory.updateMany({
    where: {
      roomTypeId,
      date: { gte: toUtcDate(CHECK_IN), lt: toUtcDate(CHECK_OUT) },
    },
    data: { totalRooms: rooms, bookedRooms: 0, isClosed: false },
  });
}

async function remainingRooms(): Promise<number> {
  const rows = await prisma.roomTypeInventory.findMany({
    where: {
      roomTypeId,
      date: { gte: toUtcDate(CHECK_IN), lt: toUtcDate(CHECK_OUT) },
    },
  });
  return Math.min(...rows.map((row) => row.totalRooms - row.bookedRooms));
}

async function cleanUp(): Promise<void> {
  await prisma.reservation.deleteMany({
    where: { guest: { email: { endsWith: TEST_EMAIL_DOMAIN } } },
  });
  await prisma.guest.deleteMany({
    where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
  });
}

beforeAll(async () => {
  const roomType = await prisma.roomType.findUnique({
    where: { code: ROOM_TYPE_CODE },
  });
  if (!roomType) {
    throw new Error(
      `Seed data missing: no room type "${ROOM_TYPE_CODE}". Run: npm run seed`,
    );
  }
  roomTypeId = roomType.id;
  await cleanUp();
});

afterEach(async () => {
  await cleanUp();
});

afterAll(async () => {
  // Hand the dates back with their real inventory so the test leaves no trace.
  const roomType = await prisma.roomType.findUnique({ where: { id: roomTypeId } });
  await prisma.roomTypeInventory.updateMany({
    where: {
      roomTypeId,
      date: { gte: toUtcDate(CHECK_IN), lt: toUtcDate(CHECK_OUT) },
    },
    data: { totalRooms: roomType?.totalRooms ?? 8, bookedRooms: 0 },
  });
  await prisma.$disconnect();
});

describe('createReservation under concurrency', () => {
  it('lets exactly one of ten simultaneous guests take the last room', async () => {
    await setAvailableRooms(1);

    const attempts = 10;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => provider.createReservation(draft())),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(attempts - 1);

    // The losers must be told the room is gone — not handed a database error.
    for (const failure of failed) {
      const reason = (failure as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(BookingError);
      expect((reason as BookingError).code).toBe('NO_AVAILABILITY');
    }

    // And the ledger must show the room sold exactly once, not ten times.
    expect(await remainingRooms()).toBe(0);
  });

  it('sells exactly the rooms that exist when demand exceeds supply', async () => {
    await setAvailableRooms(3);

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => provider.createReservation(draft())),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(await remainingRooms()).toBe(0);
  });

  it('counts a multi-room booking against inventory in full', async () => {
    await setAvailableRooms(4);

    // Two bookings of 3 rooms each cannot both fit into 4.
    const results = await Promise.allSettled([
      provider.createReservation(draft({ roomsCount: 3 })),
      provider.createReservation(draft({ roomsCount: 3 })),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await remainingRooms()).toBe(1);
  });

  it('never leaves a partial write when a booking loses the race', async () => {
    await setAvailableRooms(1);

    await Promise.allSettled(
      Array.from({ length: 6 }, () => provider.createReservation(draft())),
    );

    // Exactly one reservation row, and one guest — a losing transaction must
    // roll back its guest insert too, not leave an orphan behind.
    const reservations = await prisma.reservation.count({
      where: { guest: { email: { endsWith: TEST_EMAIL_DOMAIN } } },
    });
    const guests = await prisma.guest.count({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });

    expect(reservations).toBe(1);
    expect(guests).toBe(1);
  });

  it('releases inventory when a booking is cancelled', async () => {
    await setAvailableRooms(1);

    const reservation = await provider.createReservation(draft());
    expect(await remainingRooms()).toBe(0);

    await provider.cancelReservation(reservation.reference);
    expect(await remainingRooms()).toBe(1);

    // And the freed room is genuinely sellable again.
    const next = await provider.createReservation(draft());
    expect(next.reference).not.toBe(reservation.reference);
    expect(await remainingRooms()).toBe(0);
  });

  it('rolls back entirely when only part of a stay is available', async () => {
    await setAvailableRooms(1);

    // Sell out the second night only, via a one-night booking.
    const secondNight = addDays(CHECK_IN, 1);
    await provider.createReservation(
      draft({ checkIn: secondNight, checkOut: CHECK_OUT }),
    );

    // A two-night stay now overlaps a full night and must fail outright,
    // leaving the first night untouched rather than half-committed.
    await expect(provider.createReservation(draft())).rejects.toThrow(
      BookingError,
    );

    const firstNight = await prisma.roomTypeInventory.findFirst({
      where: { roomTypeId, date: toUtcDate(CHECK_IN) },
    });
    expect(firstNight?.bookedRooms).toBe(0);
  });
});
