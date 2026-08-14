/**
 * 12-factor configuration for the front-end.
 *
 * Read once, validated, fail fast. Nothing environment-specific is hardcoded
 * anywhere else in `web/` (see the `deployment` skill).
 *
 * Two rules specific to Next.js:
 *
 * 1. `NEXT_PUBLIC_*` variables are inlined into the browser bundle at BUILD
 *    time, so they must be referenced as complete literal expressions —
 *    `process.env.NEXT_PUBLIC_API_URL`, never `process.env[someVariable]`.
 *    Dynamic lookups silently become `undefined` in the browser.
 * 2. `INTERNAL_API_URL` has no `NEXT_PUBLIC_` prefix, so it is server-only and
 *    must never be imported into a Client Component.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        'See web/.env.example for the full list.',
    );
  }
  return value.trim();
}

/**
 * Values safe to use anywhere, including the browser.
 */
export const publicConfig = {
  /** Public base URL of the Express API, as called from the browser. */
  apiUrl: required('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL),
  /** Public base URL of this site — canonical URLs, hreflang, OG, sitemap. */
  siteUrl: required('NEXT_PUBLIC_SITE_URL', process.env.NEXT_PUBLIC_SITE_URL),
} as const;

/**
 * Server-only configuration.
 *
 * Call this from Server Components, route handlers, and `generateMetadata`.
 * Importing the result into a Client Component would leak server config into
 * the browser bundle, so it is exposed as a function rather than a constant.
 */
export function getServerConfig() {
  return {
    /**
     * API base URL for server-side rendering. Falls back to the public URL,
     * which is correct on a laptop and on Railway; on AWS this is usually a
     * private internal address instead.
     */
    apiUrl: required(
      'INTERNAL_API_URL',
      process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL,
    ),
  } as const;
}
