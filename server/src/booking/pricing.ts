/**
 * Pricing — room total, Tourism Dirham, VAT.
 *
 * All of it lives here in the API, never in the front-end, so a future PMS can
 * take ownership of pricing without the booking flow changing (`pms-readiness`).
 *
 * Two rules from the `booking-engine` skill shape this file:
 *
 *   1. **Fees are shown, not charged.** The launch model is pay-at-check-in, so
 *      nothing here takes money. The guest must still see exactly what they will
 *      owe, itemised, before they confirm.
 *   2. **Fee amounts are configuration, not constants.** The Tourism Dirham
 *      depends on the property's DET classification and VAT is set by the
 *      government; both are read from the settings table so the hotel can change
 *      them without a deploy.
 *
 * Arithmetic uses Decimal throughout and rounds only at the end. Money is never
 * accumulated in a float — 0.1 + 0.2 problems compound across a long stay and
 * would leave the displayed breakdown not summing to the total.
 */
import { Prisma } from '@prisma/client';

import { nightsBetween } from './dates.js';
import type { IsoDate, PriceBreakdown } from './types.js';

/** Fee configuration, read from the settings table. */
export interface PricingSettings {
  currency: string;
  tourismDirhamPerRoomPerNight: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
}

export interface NightlyRate {
  date: IsoDate;
  rate: Prisma.Decimal;
}

/** Round half-up to 2 decimal places and return a plain number for JSON. */
function toMoney(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

/** A discount to apply to the accommodation charge. */
export interface DiscountInput {
  code: string;
  name: { en: string; ar: string };
  type: 'percentage' | 'fixed';
  /** A percentage (0–100), or an amount in AED. */
  value: Prisma.Decimal;
}

/**
 * Build the full breakdown for a stay.
 *
 * The order of operations here is the whole point, and getting it wrong
 * mis-taxes every discounted booking:
 *
 *   1. **The discount comes off the accommodation charge**, and nothing else.
 *   2. **VAT is charged on the discounted accommodation charge.** The guest is
 *      taxed on what they actually pay for the room, not on the list price.
 *   3. **The Tourism Dirham is never discounted, and is never in the VAT base.**
 *      It is a fixed per-room-per-night government fee set by the DET, not an
 *      accommodation charge the hotel is free to reduce. A voucher that
 *      appeared to discount it would be the hotel absorbing someone else's levy.
 *
 * A discount is also clamped so it can never exceed the room total — a fixed
 * AED 500 code against a AED 300 stay makes the accommodation free, not
 * negative.
 */
export function calculatePrice(args: {
  nightlyRates: NightlyRate[];
  roomsCount: number;
  settings: PricingSettings;
  discount?: DiscountInput | undefined;
}): PriceBreakdown {
  const { nightlyRates, roomsCount, settings, discount } = args;

  const rooms = new Prisma.Decimal(roomsCount);
  const nights = nightlyRates.length;

  const roomTotal = nightlyRates
    .reduce((sum, night) => sum.plus(night.rate), new Prisma.Decimal(0))
    .times(rooms);

  const discountAmount = resolveDiscountAmount(roomTotal, discount);
  const discountedRoomTotal = roomTotal.minus(discountAmount);

  const tourismDirhamTotal = settings.tourismDirhamPerRoomPerNight
    .times(nights)
    .times(rooms);

  // The discounted total is the VAT base — see rule 2 above.
  const vatTotal = discountedRoomTotal
    .times(settings.vatRatePercent)
    .dividedBy(100);

  const grandTotal = discountedRoomTotal
    .plus(vatTotal)
    .plus(tourismDirhamTotal);

  return {
    currency: settings.currency,
    nights,
    roomsCount,
    nightlyRates: nightlyRates.map((night) => ({
      date: night.date,
      rate: toMoney(night.rate),
    })),
    roomTotal: toMoney(roomTotal),
    ...(discount
      ? {
          discount: {
            code: discount.code,
            name: discount.name,
            amount: toMoney(discountAmount),
          },
        }
      : {}),
    tourismDirham: {
      perRoomPerNight: toMoney(settings.tourismDirhamPerRoomPerNight),
      total: toMoney(tourismDirhamTotal),
    },
    vat: {
      ratePercent: settings.vatRatePercent.toNumber(),
      total: toMoney(vatTotal),
    },
    grandTotal: toMoney(grandTotal),
  };
}

/** The AED a discount takes off, never more than the room total itself. */
function resolveDiscountAmount(
  roomTotal: Prisma.Decimal,
  discount: DiscountInput | undefined,
): Prisma.Decimal {
  if (!discount) return new Prisma.Decimal(0);

  const raw =
    discount.type === 'percentage'
      ? roomTotal.times(discount.value).dividedBy(100)
      : discount.value;

  // Clamped at both ends: a negative discount would raise the price, and one
  // larger than the stay would make the accommodation charge negative and
  // hand the guest money back through the VAT line.
  if (raw.lessThan(0)) return new Prisma.Decimal(0);
  return raw.greaterThan(roomTotal) ? roomTotal : raw;
}

/**
 * Pick the applicable nightly rate for each night of a stay.
 *
 * The winner for a night is the highest-priority active plan whose date window
 * covers it; a plan with no window is the always-applicable default. If no plan
 * matches at all, the room type's base rate is used, so a stay can always be
 * priced even when the hotel has not configured plans for a far-future date.
 */
export function resolveNightlyRates(args: {
  checkIn: IsoDate;
  checkOut: IsoDate;
  baseRate: Prisma.Decimal;
  ratePlans: Array<{
    nightlyRateAed: Prisma.Decimal;
    startDate: Date | null;
    endDate: Date | null;
    priority: number;
  }>;
}): NightlyRate[] {
  const { checkIn, checkOut, baseRate, ratePlans } = args;

  // Highest priority first, so the first match for a night wins.
  const plans = [...ratePlans].sort((a, b) => b.priority - a.priority);

  return nightsBetween(checkIn, checkOut).map((date) => {
    const match = plans.find((plan) => {
      if (!plan.startDate || !plan.endDate) return true;
      const from = plan.startDate.toISOString().slice(0, 10);
      const to = plan.endDate.toISOString().slice(0, 10);
      return date >= from && date <= to;
    });

    return { date, rate: match?.nightlyRateAed ?? baseRate };
  });
}

/** The strictest minimum-stay requirement among the plans covering a stay. */
export function resolveMinimumStay(args: {
  checkIn: IsoDate;
  checkOut: IsoDate;
  ratePlans: Array<{
    startDate: Date | null;
    endDate: Date | null;
    minimumStayNights: number;
  }>;
}): number {
  const nights = nightsBetween(args.checkIn, args.checkOut);

  const applicable = args.ratePlans.filter((plan) => {
    if (!plan.startDate || !plan.endDate) return true;
    const from = plan.startDate.toISOString().slice(0, 10);
    const to = plan.endDate.toISOString().slice(0, 10);
    return nights.some((date) => date >= from && date <= to);
  });

  return applicable.reduce(
    (max, plan) => Math.max(max, plan.minimumStayNights),
    1,
  );
}
