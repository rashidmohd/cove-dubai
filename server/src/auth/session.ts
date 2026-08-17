/**
 * Admin session middleware.
 *
 * Sessions are server-side and opaque: the cookie carries nothing but an id,
 * and every fact about who is signed in is read from the database row. That
 * means an account can be disabled and its sessions revoked immediately, which
 * a self-contained token in the cookie could not offer.
 *
 * **The cross-origin detail that bites on first deploy.** On Railway `web` and
 * `server` are separate domains, so the session cookie is a third-party cookie
 * and needs `SameSite=None; Secure` or the browser silently drops it — login
 * appears to succeed and every subsequent request is anonymous. On AWS both
 * services sit behind one domain and this tightens to `Lax` with no code
 * change. Both values come from the environment and the pairing is validated
 * at boot in `config.ts` (see the `deployment` skill).
 */
import session from 'express-session';
import type { RequestHandler } from 'express';

import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { PrismaSessionStore } from './session-store.js';

/**
 * What we keep in a session.
 *
 * Role is stored here so that authorising an ordinary request costs no query,
 * but it is deliberately re-read from the database on every request in
 * `requireAdmin` — a role downgrade has to take effect at once, not whenever
 * the admin next signs in.
 */
declare module 'express-session' {
  interface SessionData {
    adminUserId?: string;
    /** Issued at login and required on every mutating request. */
    csrfToken?: string;
  }
}

export const sessionStore = new PrismaSessionStore(prisma);

export function sessionMiddleware(): RequestHandler {
  return session({
    name: 'cove.sid',
    secret: config.sessionSecret,
    store: sessionStore,

    // Do not write a session row for anonymous visitors — only login creates
    // one. Guest booking traffic runs through this same app.
    saveUninitialized: false,
    resave: false,

    // The idle timeout: every response pushes the expiry out again, so a
    // session dies only after a period of genuine inactivity.
    rolling: true,

    // Honour X-Forwarded-Proto so a Secure cookie is still set behind
    // Railway's proxy, which terminates TLS ahead of this process.
    proxy: true,

    cookie: {
      httpOnly: true,
      sameSite: config.sessionCookieSameSite,
      secure: config.sessionCookieSecure,
      maxAge: config.sessionIdleTimeoutMinutes * 60 * 1000,
      path: '/',
    },
  });
}
