/**
 * Sitemap.
 *
 * Both locales are listed, and each entry declares its `alternates` so search
 * engines treat `/en/rooms` and `/ar/rooms` as translations of one page rather
 * than as duplicates competing with each other (`arabic-rtl`).
 *
 * The reserve flow and the coming-soon placeholder are excluded: one is a form
 * and the other is a stub standing in for three unbuilt pages, so neither is
 * worth a searcher's click.
 */
import type { MetadataRoute } from 'next';

import { locales } from '@/i18n/routing';
import { bookingApi } from '@/lib/api/client';
import { publicConfig } from '@/lib/config';

/** Indexable marketing routes, relative to the locale segment. */
const ROUTES = ['', '/about', '/rooms', '/offers', '/dining'] as const;

/**
 * Room pages, which are the listing's children rather than fixed routes.
 *
 * Read from the API so a room added in the admin panel is listed without an
 * edit here — the same reason the Rooms page has no hardcoded room list. A
 * failure yields the fixed routes alone: an incomplete sitemap costs some
 * crawl depth, while throwing would serve none at all.
 */
async function roomRoutes(): Promise<string[]> {
  try {
    const roomTypes = await bookingApi.getRoomTypes();
    return roomTypes.map((room) => `/rooms/${room.code}`);
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicConfig.siteUrl.replace(/\/$/, '');
  const routes = [...ROUTES, ...(await roomRoutes())];

  return routes.flatMap((route) =>
    locales.map((locale) => ({
      url: `${base}/${locale}${route}`,
      changeFrequency: 'monthly' as const,
      priority: route === '' ? 1 : 0.8,
      alternates: {
        languages: Object.fromEntries(
          locales.map((alt) => [alt, `${base}/${alt}${route}`]),
        ),
      },
    })),
  );
}
