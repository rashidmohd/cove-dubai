/**
 * Admin authentication endpoints.
 *
 * Three routes and no more: sign in, sign out, and "who am I". Everything
 * else about the admin panel lives behind `requireAdmin` in `admin.routes.ts`.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { hashPassword, verifyPassword } from '../auth/password.js';
import { recordAudit } from '../auth/audit.js';
import { prisma } from '../db/prisma.js';
import { asyncRoute, HttpError } from '../middleware/errors.js';
import { currentAdmin, requireAdmin } from '../middleware/auth.js';
import { ensureCsrfToken } from '../middleware/csrf.js';
import { loginSchema } from './admin.schemas.js';

/**
 * A deliberately tight limit on login attempts.
 *
 * Keyed on IP, which is honest about what it can do: it slows credential
 * stuffing from one source, and does not pretend to stop a distributed
 * attack. The real defence against a guessed password is scrypt plus a strong
 * seeded secret.
 */
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Failed attempts are what we are limiting; a successful login should not
  // consume a colleague's allowance on the same office IP.
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many sign-in attempts. Please try again shortly.',
    },
  },
});

/**
 * Compared against when no account matches, so a wrong email and a wrong
 * password take the same time to reject. Without this, response timing tells
 * an attacker which addresses are real ones.
 */
let decoyHash: string | undefined;
async function getDecoyHash(): Promise<string> {
  decoyHash ??= await hashPassword('a-password-that-matches-nothing');
  return decoyHash;
}

/** Promise wrapper for express-session's callback API. */
function regenerateSession(req: Parameters<typeof requireAdmin>[0]) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(req: Parameters<typeof requireAdmin>[0]) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

export const authRouter = Router();

authRouter.post(
  '/login',
  loginRateLimit,
  asyncRoute(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const admin = await prisma.adminUser.findUnique({ where: { email } });

    // Always run a verification, even with no account, so the work done is the
    // same either way.
    const ok = await verifyPassword(
      password,
      admin?.passwordHash ?? (await getDecoyHash()),
    );

    if (!admin || !admin.isActive || !ok) {
      await recordAudit({
        adminUserId: admin?.id ?? null,
        action: 'admin.login_failed',
        entityType: 'admin_user',
        entityId: email,
        details: {
          reason: !admin
            ? 'no such account'
            : !admin.isActive
              ? 'account disabled'
              : 'wrong password',
        },
        ipAddress: req.ip ?? null,
      });

      // One message for every failure. Telling the caller which part was wrong
      // hands them half the credential.
      throw new HttpError(
        401,
        'INVALID_CREDENTIALS',
        'Incorrect email or password.',
      );
    }

    // Issue a brand-new session id. Without this, a session fixed by an
    // attacker before login would still be valid after it.
    await regenerateSession(req);

    req.session.adminUserId = admin.id;
    const csrfToken = ensureCsrfToken(req);

    // Persist before responding, so the very next request — which the browser
    // may send immediately — finds the session already written.
    await saveSession(req);

    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    await recordAudit({
      adminUserId: admin.id,
      action: 'admin.login',
      entityType: 'admin_user',
      entityId: admin.email,
      ipAddress: req.ip ?? null,
    });

    res.json({
      admin: {
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
      csrfToken,
    });
  }),
);

/**
 * The front-end's session probe, called on every admin page load.
 *
 * Doubles as the way the client gets its CSRF token after a page refresh —
 * the token lives in the session, not in a cookie the page could read.
 */
authRouter.get(
  '/session',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const admin = currentAdmin(req);

    res.json({
      // Same shape as the login response, and equally without `admin.id` —
      // no internal row id crosses the HTTP boundary.
      admin: { email: admin.email, name: admin.name, role: admin.role },
      csrfToken: ensureCsrfToken(req),
    });
  }),
);

/**
 * Sign out.
 *
 * Deliberately not behind `requireAdmin`: signing out must work even when the
 * session has already lapsed, so the browser is always left without a stale
 * cookie. It also asks for no CSRF token — being logged out against your will
 * is a nuisance, not a compromise, and refusing to end a session is worse.
 */
authRouter.post(
  '/logout',
  asyncRoute(async (req, res) => {
    // Read from the session rather than `req.admin`, which only exists on
    // routes that ran `requireAdmin`.
    const adminUserId = req.session?.adminUserId;
    const admin = adminUserId
      ? await prisma.adminUser.findUnique({ where: { id: adminUserId } })
      : null;

    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => (error ? reject(error) : resolve()));
    });

    res.clearCookie('cove.sid', { path: '/' });

    if (adminUserId) {
      await recordAudit({
        adminUserId,
        action: 'admin.logout',
        entityType: 'admin_user',
        entityId: admin?.email ?? adminUserId,
        ipAddress: req.ip ?? null,
      });
    }

    res.json({ ok: true });
  }),
);
