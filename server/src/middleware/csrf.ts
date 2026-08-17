/**
 * CSRF protection for admin mutations.
 *
 * A synchroniser token: generated at login, held in the server-side session,
 * and echoed back by the client in `X-CSRF-Token` on every mutating request.
 * A cross-site attacker can make the browser send the session cookie, but
 * cannot read the token to attach it.
 *
 * This matters more here than on a typical app. Admin sessions on Railway are
 * cross-origin, so the cookie is `SameSite=None` — which switches off the
 * browser's own cross-site protection. The token is what replaces it.
 *
 * Safe methods are exempt: they must not change state, and demanding a token
 * on GET would break ordinary navigation.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { HttpError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Mint a token for a session, or return the one it already has. */
export function ensureCsrfToken(req: Request): string {
  req.session.csrfToken ??= randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

/** Compare in constant time, tolerating different lengths. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireCsrfToken(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const expected = req.session?.csrfToken;
  if (!expected) {
    next(
      new HttpError(
        403,
        'CSRF_TOKEN_MISSING',
        'This session has no CSRF token. Sign in again.',
      ),
    );
    return;
  }

  const header = req.get('x-csrf-token');
  if (!header || !tokensMatch(header, expected)) {
    next(
      new HttpError(
        403,
        'CSRF_TOKEN_INVALID',
        'Missing or invalid CSRF token.',
      ),
    );
    return;
  }

  next();
}
