/**
 * The single-use voucher race.
 *
 * The counterpart of `concurrency.test.ts`, and it exists for the same reason:
 * "two guests cannot both redeem the last use of a code" is a claim that
 * cannot be verified by reading the code, because the failure only appears
 * under genuine concurrency.
 *
 * Runs real simultaneous bookings against the real database, both quoting the
 * same single-use code, and checks that exactly one of them gets the discount.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { CustomDbProvider } from '../src/booking/custom-db.provider.js';
import { addDays, toUtcDate } from '../src/booking/dates.js';
import { BookingError, type ReservationDraft } from '../src/booking/types.js';
import { prisma } from '../src/db/prisma.js';

const provider = new CustomDbProvider(prisma);

/** Far enough out that nothing real overlaps. */
const CHECK_IN = addDays(new Date().toISOString().slice(0, 10), 420);
const CHECK_OUT = addDays(CHECK_IN, 2);

const ROOM_TYPE_CODE = 'cove-suite';
const TEST_EMAIL_DOMAIN = 'voucher-test.invalid';
const CODE = 'ZZONCEONLY';

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
      firstName: 'Voucher',
      lastName: 'Test',
      email: `g-${Math.random().toString(36).slice(2)}@${TEST_EMAIL_DOMAIN}`,
      phone: '+971500000000',
      locale: 'en',
    },
    ...overrides,
  };
}

async function openInventory(rooms: number): Promise<void> {
  await prisma.roomTypeInventory.updateMany({
    where: {
      roomTypeId,
      date: { gte: toUtcDate(CHECK_IN), lt: toUtcDate(CHECK_OUT) },
    },
    data: { totalRooms: rooms, bookedRooms: 0, isClosed: false },
  });
}

async function makeVoucher(maxRedemptions: number | null): Promise<void> {
  await prisma.voucher.deleteMany({ where: { code: CODE } });
  await prisma.voucher.create({
    data: {
      code: CODE,
      nameEn: 'Single use',
      nameAr: 'Single use',
      discountType: 'PERCENTAGE',
      discountValue: '20',
      maxRedemptions,
    },
  });
}

async function cleanUp(): Promise<void> {
  const guests = await prisma.guest.findMany({
    where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    select: { id: true },
  });
  const ids = guests.map((g) => g.id);

  await prisma.voucherRedemption.deleteMany({
    where: { reservation: { guestId: { in: ids } } },
  });
  await prisma.reservation.deleteMany({ where: { guestId: { in: ids } } });
  await prisma.guest.deleteMany({ where: { id: { in: ids } } });
  await prisma.voucher.deleteMany({ where: { code: { startsWith: 'ZZ' } } });
}

beforeAll(async () => {
  const roomType = await prisma.roomType.findUniqueOrThrow({
    where: { code: ROOM_TYPE_CODE },
  });
  roomTypeId = roomType.id;
  await cleanUp();
}, 60_000);

afterEach(async () => {
  await cleanUp();
});

afterAll(async () => {
  await openInventory(28);
  await prisma.$disconnect();
});

describe('a single-use code under contention', () => {
  it('is redeemed exactly once when ten bookings race for it', async () => {
    await openInventory(20); // plenty of rooms — the code is the scarce thing
    await makeVoucher(1);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        provider.createReservation(draft({ voucherCode: CODE })),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one wins. The other nine are refused rather than quietly booked
    // at full price: the guest entered a code and was shown a discounted
    // figure, so charging them more than they were quoted would be worse than
    // telling them the code has gone.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);

    for (const failure of rejected) {
      const reason = (failure as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(BookingError);
      expect((reason as BookingError).code).toBe('VOUCHER_EXHAUSTED');
    }
  });

  it('leaves the counter and the redemption records agreeing', async () => {
    await openInventory(20);
    await makeVoucher(1);

    await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        provider.createReservation(draft({ voucherCode: CODE })),
      ),
    );

    const voucher = await prisma.voucher.findUniqueOrThrow({
      where: { code: CODE },
      include: { redemptions: true },
    });

    // The counter is what the CHECK constraint guards; the rows are what a
    // campaign report would count. A divergence would mean the increment and
    // the record are not in the same transaction after all.
    expect(voucher.redemptionCount).toBe(1);
    expect(voucher.redemptions).toHaveLength(1);
  });

  it('applies the discount to the one booking that won', async () => {
    await openInventory(20);
    await makeVoucher(1);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        provider.createReservation(draft({ voucherCode: CODE })),
      ),
    );

    const winner = results.find((r) => r.status === 'fulfilled');
    expect(winner).toBeDefined();

    const reservation = (winner as PromiseFulfilledResult<
      Awaited<ReturnType<typeof provider.createReservation>>
    >).value;

    expect(reservation.price.discount?.code).toBe(CODE);
    expect(reservation.price.discount?.amount).toBeGreaterThan(0);

    // And the snapshot still reconciles with the discount in it.
    const { roomTotal, discount, vat, tourismDirham, grandTotal } =
      reservation.price;
    expect(
      roomTotal - (discount?.amount ?? 0) + vat.total + tourismDirham.total,
    ).toBeCloseTo(grandTotal, 2);
  });
});

describe('an unlimited code', () => {
  it('lets every booking redeem it', async () => {
    await openInventory(20);
    await makeVoucher(null);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        provider.createReservation(draft({ voucherCode: CODE })),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);

    const voucher = await prisma.voucher.findUniqueOrThrow({
      where: { code: CODE },
    });
    expect(voucher.redemptionCount).toBe(5);
  });
});

describe('a code that does not apply', () => {
  it('is rejected by name rather than silently ignored', async () => {
    await openInventory(20);

    await expect(
      provider.createReservation(draft({ voucherCode: 'NO-SUCH-CODE' })),
    ).rejects.toMatchObject({ code: 'VOUCHER_NOT_FOUND' });
  });

  it('is matched case-insensitively', async () => {
    await openInventory(20);
    await makeVoucher(null);

    // Guests type these off printed cards; the case is never reliable.
    const reservation = await provider.createReservation(
      draft({ voucherCode: CODE.toLowerCase() }),
    );

    expect(reservation.price.discount?.code).toBe(CODE);
  });

  it('refuses a stay shorter than the code allows', async () => {
    await openInventory(20);
    await prisma.voucher.deleteMany({ where: { code: CODE } });
    await prisma.voucher.create({
      data: {
        code: CODE,
        nameEn: 'Long stays',
        nameAr: 'Long stays',
        discountType: 'PERCENTAGE',
        discountValue: '20',
        minimumNights: 5,
      },
    });

    await expect(
      provider.createReservation(draft({ voucherCode: CODE })),
    ).rejects.toMatchObject({ code: 'VOUCHER_NOT_APPLICABLE' });
  });

  it('refuses an expired code', async () => {
    await openInventory(20);
    await prisma.voucher.deleteMany({ where: { code: CODE } });
    await prisma.voucher.create({
      data: {
        code: CODE,
        nameEn: 'Gone',
        nameAr: 'Gone',
        discountType: 'PERCENTAGE',
        discountValue: '20',
        validTo: toUtcDate(addDays(new Date().toISOString().slice(0, 10), -1)),
      },
    });

    await expect(
      provider.createReservation(draft({ voucherCode: CODE })),
    ).rejects.toMatchObject({ code: 'VOUCHER_EXPIRED' });
  });

  it('does not consume a use when it is refused', async () => {
    await openInventory(20);
    await makeVoucher(3);

    await expect(
      provider.createReservation(
        draft({ voucherCode: CODE, checkOut: addDays(CHECK_IN, 1) }),
      ),
    ).resolves.toBeDefined();

    // A booking that fails for an unrelated reason must roll the claim back
    // with everything else — the whole point of claiming inside the transaction.
    await expect(
      provider.createReservation(
        draft({ voucherCode: CODE, adults: 99 }),
      ),
    ).rejects.toBeInstanceOf(BookingError);

    const voucher = await prisma.voucher.findUniqueOrThrow({
      where: { code: CODE },
    });
    expect(voucher.redemptionCount).toBe(1);
  });
});
