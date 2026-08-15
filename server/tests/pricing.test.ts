/**
 * Pricing rules — Tourism Dirham and VAT.
 *
 * Pure functions, no database. These are the numbers a guest is quoted and
 * emailed, so the arithmetic is worth pinning down precisely: a rounding error
 * here is a wrong figure on a confirmation.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  calculatePrice,
  resolveMinimumStay,
  resolveNightlyRates,
} from '../src/booking/pricing.js';

const settings = {
  currency: 'AED',
  tourismDirhamPerRoomPerNight: new Prisma.Decimal(20),
  vatRatePercent: new Prisma.Decimal(5),
};

const nightly = (dates: string[], rate: number) =>
  dates.map((date) => ({ date, rate: new Prisma.Decimal(rate) }));

describe('calculatePrice', () => {
  it('itemises a two-night stay the way the guest is shown it', () => {
    const price = calculatePrice({
      nightlyRates: nightly(['2026-09-01', '2026-09-02'], 2400),
      roomsCount: 1,
      settings,
    });

    expect(price.roomTotal).toBe(4800);
    expect(price.tourismDirham.total).toBe(40); // 20 x 2 nights x 1 room
    expect(price.vat.total).toBe(240); // 5% of 4800
    expect(price.grandTotal).toBe(5080);
  });

  it('scales the fee and the room total by room count', () => {
    const price = calculatePrice({
      nightlyRates: nightly(['2026-09-01', '2026-09-02'], 1000),
      roomsCount: 3,
      settings,
    });

    expect(price.roomTotal).toBe(6000); // 1000 x 2 nights x 3 rooms
    expect(price.tourismDirham.total).toBe(120); // 20 x 2 x 3
    expect(price.vat.total).toBe(300);
    expect(price.grandTotal).toBe(6420);
  });

  it('excludes the Tourism Dirham from the VAT base', () => {
    // The Dirham is a fixed government fee, not an accommodation charge, so
    // VAT must not be levied on it. Charging VAT on the fee would overstate
    // every total by a small amount that compounds across a long stay.
    const price = calculatePrice({
      nightlyRates: nightly(['2026-09-01'], 1000),
      roomsCount: 1,
      settings,
    });

    expect(price.vat.total).toBe(50); // 5% of 1000, not of 1020
    expect(price.grandTotal).toBe(1070);
  });

  it('keeps the itemised lines summing to the grand total', () => {
    // A rate that does not divide cleanly, to catch rounding drift between the
    // displayed lines and the total the guest is charged.
    const price = calculatePrice({
      nightlyRates: nightly(
        ['2026-09-01', '2026-09-02', '2026-09-03'],
        333.33,
      ),
      roomsCount: 1,
      settings,
    });

    const summed =
      price.roomTotal + price.tourismDirham.total + price.vat.total;
    expect(summed).toBeCloseTo(price.grandTotal, 2);
  });

  it('varies the room total when nightly rates differ', () => {
    const price = calculatePrice({
      nightlyRates: [
        { date: '2026-09-01', rate: new Prisma.Decimal(1000) },
        { date: '2026-09-02', rate: new Prisma.Decimal(1500) },
      ],
      roomsCount: 1,
      settings,
    });

    expect(price.roomTotal).toBe(2500);
    expect(price.nightlyRates).toEqual([
      { date: '2026-09-01', rate: 1000 },
      { date: '2026-09-02', rate: 1500 },
    ]);
  });
});

describe('resolveNightlyRates', () => {
  const base = new Prisma.Decimal(980);

  it('falls back to the base rate when no plan applies', () => {
    const rates = resolveNightlyRates({
      checkIn: '2026-09-01',
      checkOut: '2026-09-03',
      baseRate: base,
      ratePlans: [],
    });

    expect(rates.map((r) => r.rate.toNumber())).toEqual([980, 980]);
  });

  it('prefers a higher-priority seasonal plan over the default', () => {
    const rates = resolveNightlyRates({
      checkIn: '2026-12-30',
      checkOut: '2027-01-01',
      baseRate: base,
      ratePlans: [
        {
          nightlyRateAed: new Prisma.Decimal(1000),
          startDate: null,
          endDate: null,
          priority: 0,
        },
        {
          nightlyRateAed: new Prisma.Decimal(2500),
          startDate: new Date('2026-12-20T00:00:00Z'),
          endDate: new Date('2027-01-05T00:00:00Z'),
          priority: 10,
        },
      ],
    });

    expect(rates.map((r) => r.rate.toNumber())).toEqual([2500, 2500]);
  });

  it('prices each night against the plan covering it', () => {
    // A stay crossing out of a peak window must not be billed at one flat rate.
    const rates = resolveNightlyRates({
      checkIn: '2026-12-31',
      checkOut: '2027-01-02',
      baseRate: base,
      ratePlans: [
        {
          nightlyRateAed: new Prisma.Decimal(3000),
          startDate: new Date('2026-12-28T00:00:00Z'),
          endDate: new Date('2026-12-31T00:00:00Z'),
          priority: 10,
        },
      ],
    });

    expect(rates.map((r) => r.rate.toNumber())).toEqual([3000, 980]);
  });
});

describe('resolveMinimumStay', () => {
  it('defaults to one night', () => {
    expect(
      resolveMinimumStay({
        checkIn: '2026-09-01',
        checkOut: '2026-09-02',
        ratePlans: [],
      }),
    ).toBe(1);
  });

  it('applies the strictest requirement among overlapping plans', () => {
    expect(
      resolveMinimumStay({
        checkIn: '2026-12-30',
        checkOut: '2027-01-01',
        ratePlans: [
          { startDate: null, endDate: null, minimumStayNights: 1 },
          {
            startDate: new Date('2026-12-20T00:00:00Z'),
            endDate: new Date('2027-01-05T00:00:00Z'),
            minimumStayNights: 4,
          },
        ],
      }),
    ).toBe(4);
  });

  it('ignores plans whose window the stay never touches', () => {
    expect(
      resolveMinimumStay({
        checkIn: '2026-06-01',
        checkOut: '2026-06-02',
        ratePlans: [
          {
            startDate: new Date('2026-12-20T00:00:00Z'),
            endDate: new Date('2027-01-05T00:00:00Z'),
            minimumStayNights: 4,
          },
        ],
      }),
    ).toBe(1);
  });
});
