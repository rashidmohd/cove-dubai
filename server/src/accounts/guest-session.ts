/**
 * Signed-in guest sessions.
 *
 * **Nothing here is shared with admin sessions** — not the cookie, not the
 * table, not the middleware, and not `req.session`. The admin side runs on
 * `express-session`, which owns `req.session` for the whole app; a second
 * instance would fight it for that property, and a role field on one shared
 * session would mean a guest holding a session the admin checks read. So a
 * guest session is a small thing of its own: a random cookie, its hash in
 * `guest_sessions`, and `req.guest` once it has been checked.
 *
 * Same cookie posture as the admin session (`SameSite`/`Secure` from the
 * environment), for the same cross-origin reason on Railway — and the same
 * answer to it: a synchroniser token on every mutating request.
 */
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../middleware/errors.js';
import { hashSecret, newSecret } from './tokens.js';

export const GUEST_COOKIE = 'cove.guest';

/** What a signed-in guest is, as the routes see it. No row id leaves this file's callers. */
export interface AuthenticatedGuest {
  accountId: string;
  sessionId: string;
  email: string;
  firstName: string;
  lastName: string;
  locale: 'en' | 'ar';
  emailVerified: boolean;
  csrfToken: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      guest?: AuthenticatedGuest;
    }
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function idleMs(): number {
  return config.guestSessionIdleDays * 24 * 60 * 60 * 1000;
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: config.sessionCookieSameSite,
    secure: config.sessionCookieSecure,
    path: '/',
    maxAge: idleMs(),
  };
}

/**
 * Start a session for an account and set its cookie. Returns the CSRF token.
 *
 * Always a brand-new session row, never a reused one, so a cookie planted
 * before sign-in cannot become a signed-in session (session fixation).
 */
export async function startGuestSession(
  res: Response,
  accountId: string,
): Promise<string> {
  const secret = newSecret();
  const csrfToken = newSecret();

  await prisma.guestSession.create({
    data: {
      accountId,
      tokenHash: hashSecret(secret),
      csrfToken,
      expiresAt: new Date(Date.now() + idleMs()),
    },
  });

  res.cookie(GUEST_COOKIE, secret, cookieOptions());
  return csrfToken;
}

/**
 * Delete the session this request carries, if any. Leaves the cookie alone —
 * signing in replaces it, and signing out clears it with `endGuestSession`.
 */
export async function dropGuestSession(req: Request): Promise<void> {
  const secret: unknown = req.cookies?.[GUEST_COOKIE];
  if (typeof secret === 'string' && secret !== '') {
    await prisma.guestSession.deleteMany({ where: { tokenHash: hashSecret(secret) } });
  }
}

/** End the session on this request, if any, and clear the cookie either way. */
export async function endGuestSession(req: Request, res: Response): Promise<void> {
  await dropGuestSession(req);
  const { maxAge: _maxAge, ...clear } = cookieOptions();
  res.clearCookie(GUEST_COOKIE, clear);
}

/** Sign an account out everywhere — after a password reset, say. */
export async function endAllGuestSessions(accountId: string): Promise<void> {
  await prisma.guestSession.deleteMany({ where: { accountId } });
}

/**
 * Attach `req.guest` when the request carries a live guest session.
 *
 * Never rejects: anonymous is a perfectly good state for a guest route, and
 * the `require*` guards below decide what needs a session. The account is
 * re-read on every request, so a deactivated account is out at once.
 */
export function loadGuest(req: Request, res: Response, next: NextFunction): void {
  attachGuest(req, res).then(() => next(), next);
}

async function attachGuest(req: Request, res: Response): Promise<void> {
  const secret: unknown = req.cookies?.[GUEST_COOKIE];
  if (typeof secret !== 'string' || secret === '') return;

  const session = await prisma.guestSession.findUnique({
    where: { tokenHash: hashSecret(secret) },
    include: { account: true },
  });

  const now = Date.now();
  if (!session || session.expiresAt.getTime() <= now || !session.account.isActive) {
    // Dead or unknown — clear it, so the browser stops sending it.
    if (session) await prisma.guestSession.delete({ where: { id: session.id } });
    const { maxAge: _maxAge, ...clear } = cookieOptions();
    res.clearCookie(GUEST_COOKIE, clear);
    return;
  }

  // The idle timeout, rolled forward — but at most once an hour, so reading
  // "my bookings" is not a database write per request.
  if (session.expiresAt.getTime() - now < idleMs() - 60 * 60 * 1000) {
    await prisma.guestSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(now + idleMs()) },
    });
    res.cookie(GUEST_COOKIE, secret, cookieOptions());
  }

  const { account } = session;
  req.guest = {
    accountId: account.id,
    sessionId: session.id,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    locale: account.preferredLocale === 'AR' ? 'ar' : 'en',
    emailVerified: account.emailVerifiedAt !== null,
    csrfToken: session.csrfToken,
  };
}

/** 401 unless signed in. */
export function requireGuest(req: Request, _res: Response, next: NextFunction): void {
  if (!req.guest) {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to your account.'));
    return;
  }
  next();
}

/**
 * 403 unless the account's email is verified.
 *
 * The rule that keeps "my bookings" private: bookings are matched to an
 * account by email, so an unverified address would let anyone register a
 * stranger's email and read their stays.
 */
export function requireVerifiedGuest(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.guest) {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to your account.'));
    return;
  }
  if (!req.guest.emailVerified) {
    next(
      new HttpError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Confirm your email address to see your bookings.',
      ),
    );
    return;
  }
  next();
}

/** The synchroniser-token check, for a signed-in guest's mutating requests. */
export function requireGuestCsrf(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const expected = req.guest?.csrfToken;
  const provided = req.get('x-csrf-token');
  const a = Buffer.from(provided ?? '', 'utf8');
  const b = Buffer.from(expected ?? '', 'utf8');

  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
    next(new HttpError(403, 'CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token.'));
    return;
  }
  next();
}

/** The guest on the request, for handlers behind `requireGuest`. */
export function currentGuest(req: Request): AuthenticatedGuest {
  if (!req.guest) {
    throw new Error('currentGuest() called on a route without requireGuest');
  }
  return req.guest;
}

/** Drop sessions past their expiry. Called on a timer; failure only costs disk. */
export async function sweepExpiredGuestSessions(): Promise<void> {
  try {
    await prisma.guestSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  } catch (error) {
    console.error('[cove-dubai/server] guest session sweep failed:', error);
  }
}
