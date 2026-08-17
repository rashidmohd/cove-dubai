/**
 * Discount arithmetic.
 *
 * The rule that matters and is easy to get wrong: **VAT is charged on the
 * discounted accommodation total, and the Tourism Dirham is never discounted.**
 * Getting either backwards mis-taxes every promotional booking, and it would
 * not be visible without doing the sums by hand — which is what this file does.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { calculatePrice, type PricingSettings } from '../src/booking/pricing.js';

const settings: PricingSettings = {
  currency: 'AED',
  tourismDirhamPerRoomPerNight: new Prisma.Decimal(20),
  vatRatePercent: new Prisma.Decimal(5),
};

/** Two nights at 1,000, one room: a round number to reason about. */
const nightlyRates = [
  { date: '2027-03-10', rate: new Prisma.Decimal(1000) },
  { date: '2027-03-11', rate: new Prisma.Decimal(1000) },
];

function price(discount?: Parameters<typeof calculatePrice>[0]['discount']) {
  return calculatePrice({
    nightlyRates,
    roomsCount: 1,
    settings,
    ...(discount ? { discount } : {}),
  });
}

const tenPercent = {
  code: 'SAVE10',
  name: { en: 'Ten per cent', ar: 'Ten per cent' },
  type: 'percentage' as const,
  value: new Prisma.Decimal(10),
};

describe('without a discount', () => {
  it('is unchanged by the new code path', () => {
    const result = price();

    expect(result.roomTotal).toBe(2000);
    expect(result.tourismDirham.total).toBe(40); // 20 × 2 nights × 1 room
    expect(result.vat.total).toBe(100); // 5% of 2,000
    expect(result.grandTotal).toBe(2140);
    expect(result.discount).toBeUndefined();
  });
});

describe('a percentage discount', () => {
  it('charges VAT on the discounted total, not the list price', () => {
    const result = price(tenPercent);

    expect(result.roomTotal).toBe(2000);
    expect(result.discount?.amount).toBe(200);

    // 5% of 1,800 — NOT 5% of 2,000, which would be 100.
    expect(result.vat.total).toBe(90);
  });

  it('does not discount the Tourism Dirham', () => {
    // It is a government levy per room per night, not an accommodation charge
    // the hotel can reduce.
    expect(price(tenPercent).tourismDirham.total).toBe(40);
    expect(price().tourismDirham.total).toBe(40);
  });

  it('produces a total that reconciles line by line', () => {
    const r = price(tenPercent);
    const discounted = r.roomTotal - (r.discount?.amount ?? 0);

    expect(discounted + r.vat.total + r.tourismDirham.total).toBe(r.grandTotal);
    expect(r.grandTotal).toBe(1930); // 1,800 + 90 + 40
  });
});

describe('a fixed discount', () => {
  const fixed = (value: number) => ({
    code: 'FLAT',
    name: { en: 'Flat', ar: 'Flat' },
    type: 'fixed' as const,
    value: new Prisma.Decimal(value),
  });

  it('takes the stated amount off the accommodation charge', () => {
    const r = price(fixed(300));

    expect(r.discount?.amount).toBe(300);
    expect(r.vat.total).toBe(85); // 5% of 1,700
    expect(r.grandTotal).toBe(1825); // 1,700 + 85 + 40
  });

  it('never exceeds the room total', () => {
    // A 5,000 code against a 2,000 stay makes the room free — not negative,
    // and certainly not a negative VAT line handing money back.
    const r = price(fixed(5000));

    expect(r.discount?.amount).toBe(2000);
    expect(r.vat.total).toBe(0);
    // The guest still owes the Tourism Dirham. It was never discountable.
    expect(r.grandTotal).toBe(40);
  });

  it('never raises the price', () => {
    const r = price(fixed(-100));
    expect(r.discount?.amount).toBe(0);
    expect(r.grandTotal).toBe(2140);
  });
});

describe('a 100% discount', () => {
  it('leaves only the government fee', () => {
    const r = price({
      code: 'FREE',
      name: { en: 'Free', ar: 'Free' },
      type: 'percentage',
      value: new Prisma.Decimal(100),
    });

    expect(r.discount?.amount).toBe(2000);
    expect(r.vat.total).toBe(0);
    expect(r.grandTotal).toBe(40);
  });
});

describe('rounding', () => {
  it('rounds once, at the end, so the lines still sum to the total', () => {
    // 33.33% of 2,000 is 666.60, and VAT on the remainder is 66.667 — the kind
    // of figure that stops reconciling if each line is rounded as it is made.
    const r = price({
      code: 'ODD',
      name: { en: 'Odd', ar: 'Odd' },
      type: 'percentage',
      value: new Prisma.Decimal('33.33'),
    });

    const discounted = r.roomTotal - (r.discount?.amount ?? 0);
    expect(
      Math.round((discounted + r.vat.total + r.tourismDirham.total) * 100) / 100,
    ).toBe(r.grandTotal);
  });
});
