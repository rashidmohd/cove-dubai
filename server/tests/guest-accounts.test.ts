/**
 * Guest accounts, end to end over HTTP.
 *
 * What matters here is privacy, more than plumbing:
 *
 *   - nothing tells a caller whether an address has an account;
 *   - bookings appear only once the address is proved, by a link that works
 *     once and only for that account;
 *   - a guest session opens nothing on the admin side.
 *
 * Outgoing email is captured rather than sent, so the tests follow the real
 * links a guest would click.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const sent = vi.hoisted(() => [] as Array<{ to: string; subject: string; text: string }>);

vi.mock('../src/emails/transport.js', () => ({
  sendEmail: async (message: { to: string; subject: string; text: string }) => {
    sent.push({ to: message.to, subject: message.subject, text: message.text });
    return { sent: true };
  },
}));

const { createApp } = await import('../src/app.js');
const { prisma } = await import('../src/db/prisma.js');

const DOMAIN = 'guest-accounts-test.invalid';
const PASSWORD = 'a-long-enough-guest-password';

let server: Server;
let baseUrl: string;

/** A cookie jar of one: the guest cookie, as a browser would keep it. */
interface Browser {
  cookie: string | null;
  csrfToken: string | null;
}

function newBrowser(): Browser {
  return { cookie: null, csrfToken: null };
}

async function call(
  browser: Browser,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(browser.cookie ? { cookie: browser.cookie } : {}),
      ...(browser.csrfToken ? { 'X-CSRF-Token': browser.csrfToken } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  // The last guest cookie the response set wins, as in a browser.
  const setCookie = response.headers
    .getSetCookie()
    .filter((header) => header.startsWith('cove.guest='))
    .at(-1);
  if (setCookie) {
    const value = setCookie.split(';')[0]!;
    browser.cookie = value === 'cove.guest=' ? null : value;
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.csrfToken === 'string') browser.csrfToken = body.csrfToken;
  return { status: response.status, body };
}

/**
 * The newest email to an address sent after `since` (an index into `sent`),
 * waiting briefly — mail goes out after the response.
 */
async function lastEmailTo(
  address: string,
  since = 0,
): Promise<{ subject: string; text: string }> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = sent.slice(since).filter((message) => message.to === address).at(-1);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No email was sent to ${address}`);
}

function tokenIn(text: string, path: 'verify' | 'reset'): string {
  const match = text.match(new RegExp(`/account/${path}\\?token=([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`No ${path} link in:\n${text}`);
  return match[1]!;
}

async function register(email: string, overrides: Record<string, unknown> = {}) {
  return call(newBrowser(), '/api/account/register', {
    method: 'POST',
    body: { email, password: PASSWORD, firstName: 'Amal', lastName: 'Test', ...overrides },
  });
}

/** A booking made under an address, without going through the booking flow. */
async function bookingFor(email: string): Promise<string> {
  const roomType = await prisma.roomType.findFirstOrThrow({ where: { isActive: true } });
  const guest = await prisma.guest.create({
    data: { firstName: 'Amal', lastName: 'Test', email, phone: '+971500000000' },
  });
  const reference = `CV-2031-${String(Math.floor(100000 + Math.random() * 899999))}`;
  await prisma.reservation.create({
    data: {
      bookingReference: reference,
      guestId: guest.id,
      roomTypeId: roomType.id,
      checkIn: new Date('2031-05-01'),
      checkOut: new Date('2031-05-03'),
      priceBreakdown: {
        currency: 'AED',
        nights: 2,
        roomsCount: 1,
        nightlyRates: [],
        roomTotal: 0,
        tourismDirham: { perRoomPerNight: 0, total: 0 },
        vat: { ratePercent: 5, total: 0 },
        grandTotal: 0,
      },
      totalAmountAed: '0',
    },
  });
  return reference;
}

async function cleanUp(): Promise<void> {
  // Account rows cascade to their tokens and sessions.
  await prisma.guestAccount.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  const guests = await prisma.guest.findMany({
    where: { email: { endsWith: DOMAIN, mode: 'insensitive' } },
    select: { id: true },
  });
  await prisma.reservation.deleteMany({
    where: { guestId: { in: guests.map((guest) => guest.id) } },
  });
  await prisma.guest.deleteMany({
    where: { id: { in: guests.map((guest) => guest.id) } },
  });
}

beforeAll(async () => {
  await cleanUp();
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe('registering and confirming', () => {
  it('verifies an address by its emailed link, once', async () => {
    const email = `new@${DOMAIN}`;
    const registered = await register(email);
    expect(registered.status).toBe(202);

    const message = await lastEmailTo(email);
    const token = tokenIn(message.text, 'verify');

    const browser = newBrowser();
    const verified = await call(browser, '/api/account/verify', {
      method: 'POST',
      body: { token },
    });
    expect(verified.status).toBe(200);
    expect(verified.body.account).toMatchObject({ email, emailVerified: true });

    // The link is spent.
    const again = await call(browser, '/api/account/verify', {
      method: 'POST',
      body: { token },
    });
    expect(again.status).toBe(400);
    expect((again.body.error as { code: string }).code).toBe('INVALID_TOKEN');

    // Only a hash is stored.
    const stored = await prisma.guestAccountToken.findFirst({
      where: { account: { email } },
    });
    expect(stored?.tokenHash).not.toBe(token);
  });

  it('answers the same whether or not the address already has an account', async () => {
    const email = `taken@${DOMAIN}`;
    await register(email);
    await call(newBrowser(), '/api/account/verify', {
      method: 'POST',
      body: { token: tokenIn((await lastEmailTo(email)).text, 'verify') },
    });

    const before = sent.length;
    const second = await register(email, { password: 'a-different-password-entirely' });
    expect(second.status).toBe(202);
    expect(second.body).toEqual({ ok: true });

    // The owner hears about it, and the password did not change.
    const notice = await lastEmailTo(email, before);
    expect(notice.subject).toMatch(/already have an account/i);
    const browser = newBrowser();
    expect(
      (await call(browser, '/api/account/login', {
        method: 'POST',
        body: { email, password: PASSWORD },
      })).status,
    ).toBe(200);
  });

  it('refuses a short password', async () => {
    const response = await register(`short@${DOMAIN}`, { password: 'short' });
    expect(response.status).toBe(400);
  });
});

describe('my bookings', () => {
  it('shows bookings made with the address only once it is confirmed', async () => {
    const email = `booker@${DOMAIN}`;
    // Booked before the account existed, and with different capitals.
    const reference = await bookingFor(email.toUpperCase());

    await register(email);
    const browser = newBrowser();
    const signedIn = await call(browser, '/api/account/login', {
      method: 'POST',
      body: { email, password: PASSWORD },
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.account).toMatchObject({ emailVerified: false });

    const hidden = await call(browser, '/api/account/reservations');
    expect(hidden.status).toBe(403);
    expect((hidden.body.error as { code: string }).code).toBe('EMAIL_NOT_VERIFIED');

    await call(newBrowser(), '/api/account/verify', {
      method: 'POST',
      body: { token: tokenIn((await lastEmailTo(email)).text, 'verify') },
    });

    const shown = await call(browser, '/api/account/reservations');
    expect(shown.status).toBe(200);
    const references = (shown.body.reservations as Array<{ reference: string }>).map(
      (reservation) => reservation.reference,
    );
    expect(references).toEqual([reference]);
  });

  it('needs a signed-in guest', async () => {
    const response = await call(newBrowser(), '/api/account/reservations');
    expect(response.status).toBe(401);
  });
});

describe('signing in and out', () => {
  it('rejects a wrong password with the same answer as an unknown address', async () => {
    const email = `signin@${DOMAIN}`;
    await register(email);

    const wrong = await call(newBrowser(), '/api/account/login', {
      method: 'POST',
      body: { email, password: 'not-the-password-at-all' },
    });
    const unknown = await call(newBrowser(), '/api/account/login', {
      method: 'POST',
      body: { email: `nobody@${DOMAIN}`, password: PASSWORD },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('ends the session on sign-out', async () => {
    const email = `signout@${DOMAIN}`;
    await register(email);
    const browser = newBrowser();
    await call(browser, '/api/account/login', {
      method: 'POST',
      body: { email, password: PASSWORD },
    });
    const cookie = browser.cookie;
    expect((await call(browser, '/api/account/session')).status).toBe(200);

    await call(browser, '/api/account/logout', { method: 'POST' });

    // Replaying the old cookie gets nowhere: the row is gone, not just the cookie.
    const replay = { cookie, csrfToken: null };
    expect((await call(replay, '/api/account/session')).status).toBe(401);
  });

  it('asks for the CSRF token on a signed-in write', async () => {
    const email = `csrf@${DOMAIN}`;
    await register(email);
    const browser = newBrowser();
    await call(browser, '/api/account/login', {
      method: 'POST',
      body: { email, password: PASSWORD },
    });

    const forged = await call(
      { cookie: browser.cookie, csrfToken: null },
      '/api/account/verification',
      { method: 'POST' },
    );
    expect(forged.status).toBe(403);
  });

  it('opens nothing on the admin side', async () => {
    const email = `not-admin@${DOMAIN}`;
    await register(email);
    const browser = newBrowser();
    await call(browser, '/api/account/login', {
      method: 'POST',
      body: { email, password: PASSWORD },
    });

    expect((await call(browser, '/api/admin/reservations')).status).toBe(401);
    expect((await call(browser, '/api/auth/session')).status).toBe(401);
  });
});

describe('resetting a password', () => {
  it('sets a new password, confirms the address, and signs out everywhere', async () => {
    const email = `reset@${DOMAIN}`;
    await register(email);

    const signedIn = newBrowser();
    await call(signedIn, '/api/account/login', {
      method: 'POST',
      body: { email, password: PASSWORD },
    });

    const before = sent.length;
    const requested = await call(newBrowser(), '/api/account/password-reset/request', {
      method: 'POST',
      body: { email },
    });
    expect(requested.status).toBe(202);
    const token = tokenIn((await lastEmailTo(email, before)).text, 'reset');

    const newPassword = 'a-brand-new-long-password';
    const reset = await call(newBrowser(), '/api/account/password-reset', {
      method: 'POST',
      body: { token, password: newPassword },
    });
    expect(reset.status).toBe(200);

    // The old session is gone.
    expect((await call(signedIn, '/api/account/session')).status).toBe(401);

    const withOld = await call(newBrowser(), '/api/account/login', {
      method: 'POST',
      body: { email, password: PASSWORD },
    });
    expect(withOld.status).toBe(401);

    const withNew = await call(newBrowser(), '/api/account/login', {
      method: 'POST',
      body: { email, password: newPassword },
    });
    expect(withNew.status).toBe(200);
    // The link came to this inbox, which is what confirming an address proves.
    expect(withNew.body.account).toMatchObject({ emailVerified: true });
  });

  it('answers the same for an address with no account, and sends nothing', async () => {
    const email = `ghost@${DOMAIN}`;
    const before = sent.length;
    const response = await call(newBrowser(), '/api/account/password-reset/request', {
      method: 'POST',
      body: { email },
    });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent.slice(before).some((message) => message.to === email)).toBe(false);
  });
});
