/**
 * Locale-aware formatting for dates, money and counts.
 *
 * Centralised so both languages format identically everywhere, and so the
 * numeral decision is made in exactly one place.
 */
import type { Locale } from '@/lib/api/types';

/**
 * Numerals.
 *
 * Arabic can be written with Western (1234) or Arabic-Indic (١٢٣٤) digits. The
 * `arabic-rtl` skill asks that this be settled with the client and then applied
 * consistently; Western is the working default until they decide, so every
 * formatter here pins `latn` rather than inheriting the locale's own numbering
 * system. Changing this one constant switches the whole site.
 */
const NUMBERING_SYSTEM = 'latn';

function intlLocale(locale: Locale): string {
  // Region-qualified so dates and numbers follow UAE conventions rather than,
  // say, Egyptian or Moroccan Arabic defaults.
  return locale === 'ar' ? 'ar-AE' : 'en-AE';
}

/** `12 Sep 2026` — the compact form the mockups use for stay dates. */
export function formatStayDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
    numberingSystem: NUMBERING_SYSTEM,
  }).format(new Date(`${date}T00:00:00Z`));
}

/** `September 2026` — the calendar header. */
export function formatMonthYear(year: number, month: number, locale: Locale) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
    numberingSystem: NUMBERING_SYSTEM,
  }).format(new Date(Date.UTC(year, month, 1)));
}

/**
 * Short weekday names, Sunday first.
 *
 * Sunday-first matches the mockup calendar and the working week in the UAE.
 * Generated from the locale rather than hardcoded, so Arabic gets real Arabic
 * weekday names instead of transliterated English ones.
 */
export function weekdayNames(locale: Locale): string[] {
  const formatter = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'short',
    timeZone: 'UTC',
  });
  // 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2024, 0, 7 + index))),
  );
}

/**
 * `AED 2,400` — a price.
 *
 * Rendered as currency code plus amount rather than a symbol, matching the
 * mockups and avoiding the ambiguity of a bare د.إ next to Western digits.
 */
export function formatMoney(
  amount: number,
  currency: string,
  locale: Locale,
): string {
  const formatted = new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
    numberingSystem: NUMBERING_SYSTEM,
  }).format(amount);

  return `${currency} ${formatted}`;
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    numberingSystem: NUMBERING_SYSTEM,
  }).format(value);
}

/** Nights between two `YYYY-MM-DD` dates. Check-out is exclusive. */
export function countNights(checkIn: string, checkOut: string): number {
  const ms =
    new Date(`${checkOut}T00:00:00Z`).getTime() -
    new Date(`${checkIn}T00:00:00Z`).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}
