import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

// Points next-intl at the per-request config. Without this the plugin cannot
// find i18n/request.ts and every Server Component translation call fails at
// build time.
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  // Surfaces accidental unsound patterns during development rather than in
  // production, at the cost of double-rendering components in dev.
  reactStrictMode: true,

  // The API owns every response it sends; the front-end should not advertise
  // its framework.
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
