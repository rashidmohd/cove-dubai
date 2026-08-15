/**
 * robots.txt.
 *
 * The admin panel and the booking API are disallowed: neither is useful in
 * search results, and the reserve flow's URLs carry no content worth indexing.
 */
import type { MetadataRoute } from 'next';

import { publicConfig } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  const base = publicConfig.siteUrl.replace(/\/$/, '');

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/en/admin', '/ar/admin', '/en/reserve', '/ar/reserve'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
