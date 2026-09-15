import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

// Points next-intl at the per-request config. Without this the plugin cannot
// find i18n/request.ts and every Server Component translation call fails at
// build time.
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/**
 * The image optimiser refuses any host not listed here, so the media origin has
 * to be declared at build time. It is derived from the same environment
 * variable the app reads rather than hardcoded, because CLAUDE.md's 12-factor
 * rule means the bucket can move between environments without a code change —
 * and because a hostname literal here would silently diverge from the one in
 * `publicConfig.mediaBaseUrl`.
 *
 * An unset or malformed value yields no patterns at all. That is the correct
 * outcome: no remote image can load, and the marketing pages render the
 * gradients they already fall back to.
 */
function mediaRemotePatterns(): NonNullable<
  NonNullable<NextConfig['images']>['remotePatterns']
> {
  const raw = process.env.NEXT_PUBLIC_MEDIA_BASE_URL?.trim();
  if (!raw) return [];

  try {
    const { protocol, hostname, port } = new URL(raw);
    return [
      {
        protocol: protocol.replace(':', '') as 'http' | 'https',
        hostname,
        ...(port ? { port } : {}),
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: mediaRemotePatterns(),
    // The client supplied JPEGs; the performance baseline in CLAUDE.md asks for
    // WebP. The optimiser re-encodes on the way out, so the source format in
    // the bucket stops mattering.
    formats: ['image/webp'],
  },

  // Surfaces accidental unsound patterns during development rather than in
  // production, at the cost of double-rendering components in dev.
  reactStrictMode: true,

  // The API owns every response it sends; the front-end should not advertise
  // its framework.
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
