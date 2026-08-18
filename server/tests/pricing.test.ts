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

  /**
   * Day-of-week pricing.
   *
   * 2026-08-13 is a Thursday, so the run below is Thu, Fri, Sat, Sun. Asserted
   * here rather than assumed, because every case in this block is meaningless
   * if the calendar is not what the test author thought it was.
   */
  it('the fixture dates are the weekdays these tests assume', () => {
    const days = ['2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'].map(
      (date) => new Date(`${date}T00:00:00Z`).getUTCDay(),
    );

    // 4 = Thursday, 5 = Friday, 6 = Saturday, 0 = Sunday.
    expect(days).toEqual([4, 5, 6, 0]);
  });

  it('charges the weekend rate only on the nights it covers', () => {
    // Thu → Sun: three nights, of which Thu and Fri carry the surcharge and
    // Sat does not, because the plan prices Thursday and Friday nights.
    const rates = resolveNightlyRates({
      checkIn: '2026-08-13',
      checkOut: '2026-08-16',
      baseRate: base,
      ratePlans: [
        {
          nightlyRateAed: new Prisma.Decimal(1400),
          startDate: null,
          endDate: null,
          daysOfWeek: [4, 5],
          priority: 10,
        },
      ],
    });

    expect(rates.map((r) => r.rate.toNumber())).toEqual([1400, 1400, 980]);
  });

  it('combines a season and a day restriction rather than choosing one', () => {
    // The peak plan is weekends-only *inside* its window. A Thursday night in
    // the window gets it; a Sunday night in the window falls back.
    const peak = {
      nightlyRateAed: new Prisma.Decimal(2600),
      startDate: new Date('2026-08-01T00:00:00Z'),
      endDate: new Date('2026-08-31T00:00:00Z'),
      daysOfWeek: [4, 5, 6],
      priority: 10,
    };

    const inWindow = resolveNightlyRates({
      checkIn: '2026-08-13',
      checkOut: '2026-08-17',
      baseRate: base,
      ratePlans: [peak],
    });

    // Thu, Fri, Sat surcharged; Sun is not one of the plan's days.
    expect(inWindow.map((r) => r.rate.toNumber())).toEqual([
      2600, 2600, 2600, 980,
    ]);

    // The same Thursday outside the window gets nothing.
    const outOfWindow = resolveNightlyRates({
      checkIn: '2026-09-03',
      checkOut: '2026-09-04',
      baseRate: base,
      ratePlans: [peak],
    });

    expect(outOfWindow.map((r) => r.rate.toNumber())).toEqual([980]);
  });

  it('falls through to a lower-priority plan on a night the top one skips', () => {
    // The real shape of a rate card: a season-wide plan with a weekend
    // surcharge layered over it. Midweek must land on the season, not the base.
    const rates = resolveNightlyRates({
      checkIn: '2026-08-16',
      checkOut: '2026-08-19',
      baseRate: base,
      ratePlans: [
        {
          nightlyRateAed: new Prisma.Decimal(1800),
          startDate: null,
          endDate: null,
          daysOfWeek: [4, 5, 6],
          priority: 10,
        },
        {
          nightlyRateAed: new Prisma.Decimal(1200),
          startDate: new Date('2026-08-01T00:00:00Z'),
          endDate: new Date('2026-08-31T00:00:00Z'),
          priority: 5,
        },
      ],
    });

    // Sun, Mon, Tue — none are weekend nights, so all three take the season.
    expect(rates.map((r) => r.rate.toNumber())).toEqual([1200, 1200, 1200]);
  });

  it('treats a plan with no day restriction as applying to every night', () => {
    // The backward-compatibility guarantee: rows written before the column
    // existed price exactly as they always did.
    const rates = resolveNightlyRates({
      checkIn: '2026-08-13',
      checkOut: '2026-08-16',
      baseRate: base,
      ratePlans: [
        {
          nightlyRateAed: new Prisma.Decimal(1100),
          startDate: null,
          endDate: null,
          priority: 10,
        },
      ],
    });

    expect(rates.map((r) => r.rate.toNumber())).toEqual([1100, 1100, 1100]);
  });

  it('resolves a night by the day it is slept on, not the checkout day', () => {
    // A single Saturday night, checking out on Sunday. If the resolver looked
    // at the checkout date this would miss the Saturday plan entirely.
    const rates = resolveNightlyRates({
      checkIn: '2026-08-15',
      checkOut: '2026-08-16',
      baseRate: base,
      ratePlans: [
        {
          nightlyRateAed: new Prisma.Decimal(1900),
          startDate: null,
          endDate: null,
          daysOfWeek: [6],
          priority: 10,
        },
      ],
    });

    expect(rates.map((r) => r.rate.toNumber())).toEqual([1900]);
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

  it('ignores a weekend minimum when the stay is entirely midweek', () => {
    // 2026-08-16 is a Sunday, so this is Sun and Mon — neither is a night the
    // weekend plan prices, so its two-night minimum must not apply.
    expect(
      resolveMinimumStay({
        checkIn: '2026-08-16',
        checkOut: '2026-08-18',
        ratePlans: [
          { startDate: null, endDate: null, daysOfWeek: [4, 5], minimumStayNights: 2 },
        ],
      }),
    ).toBe(1);
  });

  it('applies a weekend minimum as soon as the stay touches one of its nights', () => {
    // Fri → Sun. The Friday night is the plan's, so the minimum bites.
    expect(
      resolveMinimumStay({
        checkIn: '2026-08-14',
        checkOut: '2026-08-16',
        ratePlans: [
          { startDate: null, endDate: null, daysOfWeek: [4, 5], minimumStayNights: 2 },
        ],
      }),
    ).toBe(2);
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
