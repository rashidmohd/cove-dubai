/**
 * Locale routing.
 *
 * Every route lives under a locale segment — `/en/...` and `/ar/...` — so both
 * languages are real, indexable URLs rather than one language with a runtime
 * switch. Arabic is a first-class layout here, not a bolt-on (`arabic-rtl`).
 */
import { defineRouting } from 'next-intl/routing';

export const locales = ['en', 'ar'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** Text direction per locale, used to set `<html dir>`. */
export const localeDirections: Record<Locale, 'ltr' | 'rtl'> = {
  en: 'ltr',
  ar: 'rtl',
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Always prefix, including the default. `/en/rooms` and `/ar/rooms` are then
  // symmetrical, which keeps hreflang alternates and the language toggle
  // simple, and avoids one language quietly being "the real one".
  localePrefix: 'always',
});

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
