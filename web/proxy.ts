/**
 * Locale routing proxy.
 *
 * Redirects `/rooms` to `/en/rooms` or `/ar/rooms` based on the visitor's
 * `Accept-Language`, and keeps every route under a locale segment.
 *
 * Note the filename: Next.js 16 renamed the `middleware` convention to
 * `proxy`. A file called `middleware.ts` is silently ignored.
 */
import createIntlMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

export default createIntlMiddleware(routing);

export const config = {
  // Skip Next internals, the API, and anything with a file extension —
  // matching static assets here would redirect them into a locale path and
  // break them.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
