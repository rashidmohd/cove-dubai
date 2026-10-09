/**
 * Guest accounts: register, verify, sign in and out, reset a password, and see
 * your own bookings.
 *
 * Accounts sit **outside** the `BookingProvider` seam, like admin accounts do:
 * a website login is not reservation data and no PMS would own it. The one
 * thing here that *is* reservation data — the list of bookings — is read
 * through the provider.
 *
 * Booking never requires an account. Everything here is an optional extra for
 * a guest who wants to see their stays in one place.
 *
 * Two privacy rules shape the whole file:
 *
 *   - **No route says whether an address has an account.** Register and
 *     password-reset requests answer the same way whatever the address, and
 *     the email that follows is what differs. Otherwise either form is a free
 *     lookup of who has stayed here.
 *   - **Bookings need a verified address.** Bookings are matched to an account
 *     by email, so an unverified one could be anyone's.
 */
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import type { GuestAccount, GuestTokenPurpose } from '@prisma/client';

import {
  currentGuest,
  dropGuestSession,
  endAllGuestSessions,
  endGuestSession,
  loadGuest,
  requireGuest,
  requireGuestCsrf,
  requireVerifiedGuest,
  startGuestSession,
} from '../accounts/guest-session.js';
import { hashSecret, newSecret } from '../accounts/tokens.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { getBookingProvider } from '../booking/index.js';
import { prisma } from '../db/prisma.js';
import {
  sendAccountExistsEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../emails/index.js';
import { asyncRoute, HttpError } from '../middleware/errors.js';
import {
  loginSchema,
  registerSchema,
  requestResetSchema,
  resetPasswordSchema,
  verifySchema,
} from './account.schemas.js';

const HOUR = 60 * 60 * 1000;

/** How long an emailed link works. A reset is short; a verification can wait a weekend. */
const TOKEN_LIFETIME: Record<GuestTokenPurpose, number> = {
  EMAIL_VERIFICATION: 48 * HOUR,
  PASSWORD_RESET: 1 * HOUR,
};

function limiter(
  limit: number,
  message: string,
  options: {
    skipSuccessfulRequests?: boolean;
    keyGenerator?: (req: Request) => string;
  } = {},
) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message } },
    ...options,
  });
}

const TOO_MANY = 'Too many requests. Please try again shortly.';

/**
 * Registration, reset and resend requests send email to an address, so they
 * are limited twice. Per address, tightly: whoever is asking, one inbox gets
 * at most three every quarter of an hour, which is what stops this API being used to
 * mail-bomb a stranger from the hotel's domain. Per IP, more loosely, to bound
 * one source working through many addresses.
 */
const sendsEmailPerIp = limiter(20, TOO_MANY);
const sendsEmailPerAddress = limiter(3, TOO_MANY, {
  keyGenerator: (req) => {
    const body = req.body as { email?: unknown } | undefined;
    const address =
      req.guest?.email ??
      (typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '');
    // No address means validation will refuse the request anyway; key it on
    // the IP so it still counts against something.
    return address ? `address:${address}` : `ip:${req.ip ?? ''}`;
  },
});
const sendsEmail = [sendsEmailPerIp, sendsEmailPerAddress];

const loginLimit = limiter(
  10,
  'Too many sign-in attempts. Please try again shortly.',
  { skipSuccessfulRequests: true },
);
/** Spending a token: generous for a person, useless for guessing 256 bits. */
const tokenLimit = limiter(20, 'Too many attempts. Please try again shortly.');

/** Compared against when no account matches, so timing does not reveal which addresses exist. */
let decoyHash: string | undefined;
async function getDecoyHash(): Promise<string> {
  decoyHash ??= await hashPassword('a-password-that-matches-nothing');
  return decoyHash;
}

/** What the browser is told about the signed-in account. No row id. */
function describeAccount(account: {
  email: string;
  firstName: string;
  lastName: string;
  preferredLocale: 'EN' | 'AR';
  emailVerifiedAt: Date | null;
}) {
  return {
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    locale: account.preferredLocale === 'AR' ? 'ar' : 'en',
    emailVerified: account.emailVerifiedAt !== null,
  } as const;
}

/**
 * Mint a single-use emailed token and return its plaintext.
 *
 * Earlier unused tokens for the same purpose are withdrawn, so only the most
 * recent email's link works — a guest who asks twice is not left with two
 * live reset links in an inbox.
 */
async function issueToken(
  accountId: string,
  purpose: GuestTokenPurpose,
): Promise<string> {
  const secret = newSecret();
  await prisma.$transaction([
    prisma.guestAccountToken.deleteMany({
      where: { accountId, purpose, usedAt: null },
    }),
    prisma.guestAccountToken.create({
      data: {
        accountId,
        purpose,
        tokenHash: hashSecret(secret),
        expiresAt: new Date(Date.now() + TOKEN_LIFETIME[purpose]),
      },
    }),
  ]);
  return secret;
}

/**
 * Spend a token, or throw. The claim is a conditional update, so two requests
 * racing with the same link cannot both succeed.
 */
async function consumeToken(
  secret: string,
  purpose: GuestTokenPurpose,
): Promise<GuestAccount> {
  const tokenHash = hashSecret(secret);
  const { count } = await prisma.guestAccountToken.updateMany({
    where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  const token =
    count === 1
      ? await prisma.guestAccountToken.findUnique({
          where: { tokenHash },
          include: { account: true },
        })
      : null;

  // One message for unknown, used and expired alike: which of the three it was
  // is no use to the guest, and is a little use to someone guessing.
  if (!token || !token.account.isActive) {
    throw new HttpError(
      400,
      'INVALID_TOKEN',
      'This link has expired or has already been used.',
    );
  }
  return token.account;
}

export const accountRouter = Router();

accountRouter.use(loadGuest);

// ---------------------------------------------------------------------------
// Registration and verification
// ---------------------------------------------------------------------------

accountRouter.post(
  '/register',
  ...sendsEmail,
  asyncRoute(async (req, res) => {
    const input = registerSchema.parse(req.body);

    // Hashed whatever happens next, so the three outcomes below take the same
    // time and the response cannot be used to tell them apart.
    const passwordHash = await hashPassword(input.password);
    const existing = await prisma.guestAccount.findUnique({
      where: { email: input.email },
    });

    let send: () => Promise<void>;

    if (!existing) {
      const account = await prisma.guestAccount.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          preferredLocale: input.locale === 'ar' ? 'AR' : 'EN',
        },
      });
      const token = await issueToken(account.id, 'EMAIL_VERIFICATION');
      send = () => sendVerificationEmail(account, token);
    } else if (!existing.emailVerifiedAt) {
      // Not overwritten: whoever registered first may be the real owner, and
      // the password is only theirs once the inbox has confirmed it. A fresh
      // link to the same inbox is all a second attempt gets.
      const token = await issueToken(existing.id, 'EMAIL_VERIFICATION');
      send = () => sendVerificationEmail(existing, token);
    } else {
      // The owner already has an account. Tell *them*, by email, with a way
      // back in — never the person at the form.
      const token = await issueToken(existing.id, 'PASSWORD_RESET');
      send = () => sendAccountExistsEmail(existing, token);
    }

    res.status(202).json({ ok: true });
    // After the response, so a slow mail provider is not a timing signal.
    void send();
  }),
);

accountRouter.post(
  '/verify',
  tokenLimit,
  asyncRoute(async (req, res) => {
    const { token } = verifySchema.parse(req.body);
    const account = await consumeToken(token, 'EMAIL_VERIFICATION');

    const verified = await prisma.guestAccount.update({
      where: { id: account.id },
      data: { emailVerifiedAt: account.emailVerifiedAt ?? new Date() },
    });

    res.json({ account: describeAccount(verified) });
  }),
);

/** Send the verification email again, for a signed-in guest who lost it. */
accountRouter.post(
  '/verification',
  requireGuest,
  ...sendsEmail,
  requireGuestCsrf,
  asyncRoute(async (req, res) => {
    const guest = currentGuest(req);
    if (guest.emailVerified) {
      res.json({ ok: true, alreadyVerified: true });
      return;
    }

    const account = await prisma.guestAccount.findUniqueOrThrow({
      where: { id: guest.accountId },
    });
    const token = await issueToken(account.id, 'EMAIL_VERIFICATION');

    res.status(202).json({ ok: true });
    void sendVerificationEmail(account, token);
  }),
);

// ---------------------------------------------------------------------------
// Signing in and out
// ---------------------------------------------------------------------------

accountRouter.post(
  '/login',
  loginLimit,
  asyncRoute(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const account = await prisma.guestAccount.findUnique({ where: { email } });

    // Always verify something, so a wrong address and a wrong password cost
    // the same time.
    const ok = await verifyPassword(
      password,
      account?.passwordHash ?? (await getDecoyHash()),
    );

    if (!account || !account.isActive || !ok) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    }

    // Replace any session this browser already had, then start a new one.
    await dropGuestSession(req);
    const csrfToken = await startGuestSession(res, account.id);

    const signedIn = await prisma.guestAccount.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });

    res.json({ account: describeAccount(signedIn), csrfToken });
  }),
);

/**
 * Who is signed in — and the CSRF token, which the page cannot read from a
 * cookie and so collects here after a reload.
 */
accountRouter.get(
  '/session',
  requireGuest,
  asyncRoute(async (req, res) => {
    const guest = currentGuest(req);
    const account = await prisma.guestAccount.findUniqueOrThrow({
      where: { id: guest.accountId },
    });
    res.json({ account: describeAccount(account), csrfToken: guest.csrfToken });
  }),
);

/**
 * Sign out. No CSRF token and no session required, like the admin logout:
 * being signed out against your will is a nuisance, and refusing to end a
 * session is worse.
 */
accountRouter.post(
  '/logout',
  asyncRoute(async (req, res) => {
    await endGuestSession(req, res);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

accountRouter.post(
  '/password-reset/request',
  ...sendsEmail,
  asyncRoute(async (req, res) => {
    const { email } = requestResetSchema.parse(req.body);
    const account = await prisma.guestAccount.findUnique({ where: { email } });

    // The same answer whether or not the address has an account.
    res.status(202).json({ ok: true });

    if (account?.isActive) {
      const token = await issueToken(account.id, 'PASSWORD_RESET');
      void sendPasswordResetEmail(account, token);
    }
  }),
);

accountRouter.post(
  '/password-reset',
  tokenLimit,
  asyncRoute(async (req, res) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    const account = await consumeToken(token, 'PASSWORD_RESET');

    await prisma.guestAccount.update({
      where: { id: account.id },
      data: {
        passwordHash: await hashPassword(password),
        // The link arrived in this inbox, which is exactly what verifying an
        // address proves.
        emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
      },
    });

    // Every existing session goes: a reset is often the response to someone
    // else having got in.
    await endAllGuestSessions(account.id);
    await prisma.guestAccountToken.deleteMany({
      where: { accountId: account.id, purpose: 'PASSWORD_RESET', usedAt: null },
    });

    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// My bookings
// ---------------------------------------------------------------------------

accountRouter.get(
  '/reservations',
  requireVerifiedGuest,
  asyncRoute(async (req, res) => {
    const guest = currentGuest(req);
    const reservations =
      await getBookingProvider().listReservationsForGuestEmail(guest.email);
    res.json({ reservations });
  }),
);
