/**
 * Per-request i18n configuration for Server Components.
 *
 * Loads the message file for the active locale. An unknown locale falls back to
 * the default rather than throwing, so a stray URL renders English instead of a
 * 500.
 */
import { getRequestConfig } from 'next-intl/server';

import { defaultLocale, isLocale } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Dubai. Fixed rather than taken from the server, so a booking date renders
    // identically whether it is server-rendered on Railway, on AWS, or on a
    // laptop — a hotel date must not shift with the host's timezone.
    timeZone: 'Asia/Dubai',
  };
});
