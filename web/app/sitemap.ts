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
import { publicConfig } from '@/lib/config';

/** Indexable marketing routes, relative to the locale segment. */
const ROUTES = ['', '/about', '/rooms', '/offers', '/dining'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicConfig.siteUrl.replace(/\/$/, '');

  return ROUTES.flatMap((route) =>
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
