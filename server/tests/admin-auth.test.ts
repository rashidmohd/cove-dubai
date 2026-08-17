/**
 * Admin authentication and authorisation, exercised over real HTTP.
 *
 * These go through the assembled Express app rather than calling the
 * middleware directly, because the things most likely to break are the
 * wiring: a route mounted outside `requireAdmin`, a CSRF check that never
 * runs, a session cookie the browser would reject. None of that is visible
 * from a unit test of a handler.
 *
 * Runs against the hosted Railway database like the rest of the suite. It
 * creates its own admin accounts under a marker domain and removes them
 * afterwards, so it cannot collide with the hotel's real account.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { prisma } from '../src/db/prisma.js';

/** Marks accounts created by this file so cleanup can find them. */
const TEST_DOMAIN = 'admin-test.invalid';

const ADMIN_EMAIL = `owner@${TEST_DOMAIN}`;
const STAFF_EMAIL = `desk@${TEST_DOMAIN}`;
const PASSWORD = 'a-sufficiently-long-test-password';

let server: Server;
let baseUrl: string;

/** A logged-in browser: the session cookie plus the CSRF token that pairs with it. */
interface Session {
  cookie: string;
  csrfToken: string;
}

async function login(email: string, password: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function signIn(email: string): Promise<Session> {
  const response = await login(email, PASSWORD);
  expect(response.status).toBe(200);

  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();

  const body = (await response.json()) as { csrfToken: string };

  return {
    // Just the name=value pair; the attributes are for the browser, not us.
    cookie: setCookie!.split(';')[0]!,
    csrfToken: body.csrfToken,
  };
}

function authed(
  session: Session,
  init: RequestInit & { csrf?: boolean } = {},
): RequestInit {
  const { csrf = true, ...rest } = init;
  return {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      cookie: session.cookie,
      ...(csrf ? { 'X-CSRF-Token': session.csrfToken } : {}),
      ...(rest.headers ?? {}),
    },
  };
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);

  // Left over from an interrupted run, if any.
  await prisma.auditLog.deleteMany({
    where: { entityId: { endsWith: TEST_DOMAIN } },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { endsWith: TEST_DOMAIN } },
  });

  await prisma.adminUser.createMany({
    data: [
      {
        email: ADMIN_EMAIL,
        passwordHash,
        name: 'Test Owner',
        role: 'ADMIN',
        isActive: true,
      },
      {
        email: STAFF_EMAIL,
        passwordHash,
        name: 'Test Front Desk',
        role: 'STAFF',
        isActive: true,
      },
    ],
  });

  // Port 0: let the OS pick, so the suite never fights the dev server for 4000.
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  const admins = await prisma.adminUser.findMany({
    where: { email: { endsWith: TEST_DOMAIN } },
    select: { id: true },
  });

  // Audit rows reference the accounts, so they go first.
  await prisma.auditLog.deleteMany({
    where: { adminUserId: { in: admins.map((a) => a.id) } },
  });
  await prisma.auditLog.deleteMany({
    where: { entityId: { endsWith: TEST_DOMAIN } },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { endsWith: TEST_DOMAIN } },
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe('signing in', () => {
  it('rejects a wrong password and a missing account identically', async () => {
    const wrongPassword = await login(ADMIN_EMAIL, 'not-the-password');
    const noSuchAccount = await login(`ghost@${TEST_DOMAIN}`, PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(noSuchAccount.status).toBe(401);

    // Identical bodies: anything that distinguishes them tells an attacker
    // which addresses are real.
    expect(await wrongPassword.json()).toEqual(await noSuchAccount.json());
  });

  it('issues a session cookie the browser will actually keep', async () => {
    const response = await login(ADMIN_EMAIL, PASSWORD);
    const cookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(cookie).toContain('cove.sid=');
    // Without HttpOnly, any script on the page could read the session.
    expect(cookie.toLowerCase()).toContain('httponly');
  });

  it('does not sign in a disabled account', async () => {
    await prisma.adminUser.update({
      where: { email: STAFF_EMAIL },
      data: { isActive: false },
    });

    const response = await login(STAFF_EMAIL, PASSWORD);
    expect(response.status).toBe(401);

    await prisma.adminUser.update({
      where: { email: STAFF_EMAIL },
      data: { isActive: true },
    });
  });

  it('records both successes and failures in the audit log', async () => {
    await login(ADMIN_EMAIL, 'wrong-on-purpose');
    await login(ADMIN_EMAIL, PASSWORD);

    const entries = await prisma.auditLog.findMany({
      where: { entityId: ADMIN_EMAIL },
      select: { action: true },
    });

    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('admin.login');
    expect(actions).toContain('admin.login_failed');
  });
});

describe('protecting the admin routes', () => {
  it('refuses every admin route without a session', async () => {
    const routes = [
      '/api/admin/dashboard',
      '/api/admin/reservations',
      '/api/admin/room-types',
      '/api/admin/settings',
      '/api/admin/audit-log',
      '/api/admin/reports/occupancy?from=2026-09-01&to=2026-09-02',
    ];

    const statuses = await Promise.all(
      routes.map(async (route) => (await fetch(`${baseUrl}${route}`)).status),
    );

    expect(statuses).toEqual(routes.map(() => 401));
  });

  it('allows a signed-in admin to read', async () => {
    const session = await signIn(ADMIN_EMAIL);

    const response = await fetch(
      `${baseUrl}/api/admin/dashboard`,
      authed(session),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      admin: Record<string, unknown>;
    };
    expect(body.admin.email).toBe(ADMIN_EMAIL);
    // No internal row id crosses the HTTP boundary.
    expect(body.admin).not.toHaveProperty('id');
  });

  it('stops serving a session whose account is disabled mid-session', async () => {
    const session = await signIn(STAFF_EMAIL);

    const before = await fetch(`${baseUrl}/api/admin/dashboard`, authed(session));
    expect(before.status).toBe(200);

    await prisma.adminUser.update({
      where: { email: STAFF_EMAIL },
      data: { isActive: false },
    });

    // The cookie is unchanged and still unexpired — the role is re-read from
    // the database on every request, so revocation is immediate.
    const after = await fetch(`${baseUrl}/api/admin/dashboard`, authed(session));
    expect(after.status).toBe(401);

    await prisma.adminUser.update({
      where: { email: STAFF_EMAIL },
      data: { isActive: true },
    });
  });
});

describe('CSRF', () => {
  it('rejects a mutating request with no token', async () => {
    const session = await signIn(ADMIN_EMAIL);

    const response = await fetch(
      `${baseUrl}/api/admin/settings/vat_rate_percent`,
      authed(session, {
        method: 'PATCH',
        csrf: false,
        body: JSON.stringify({ value: '5' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code)
      .toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects a token belonging to a different session', async () => {
    const mine = await signIn(ADMIN_EMAIL);
    const theirs = await signIn(ADMIN_EMAIL);

    const response = await fetch(
      `${baseUrl}/api/admin/settings/vat_rate_percent`,
      authed(
        { cookie: mine.cookie, csrfToken: theirs.csrfToken },
        { method: 'PATCH', body: JSON.stringify({ value: '5' }) },
      ),
    );

    expect(response.status).toBe(403);
  });

  it('does not ask for a token on reads', async () => {
    const session = await signIn(ADMIN_EMAIL);

    const response = await fetch(
      `${baseUrl}/api/admin/settings`,
      authed(session, { csrf: false }),
    );

    expect(response.status).toBe(200);
  });
});

describe('roles', () => {
  it('lets STAFF read reservations but not change pricing', async () => {
    const session = await signIn(STAFF_EMAIL);

    const read = await fetch(
      `${baseUrl}/api/admin/reservations?limit=1`,
      authed(session),
    );
    expect(read.status).toBe(200);

    const write = await fetch(
      `${baseUrl}/api/admin/settings/vat_rate_percent`,
      authed(session, { method: 'PATCH', body: JSON.stringify({ value: '5' }) }),
    );
    expect(write.status).toBe(403);
    expect(((await write.json()) as { error: { code: string } }).error.code).toBe(
      'FORBIDDEN',
    );
  });

  it('keeps the audit log itself away from STAFF', async () => {
    const session = await signIn(STAFF_EMAIL);

    const response = await fetch(
      `${baseUrl}/api/admin/audit-log`,
      authed(session),
    );

    expect(response.status).toBe(403);
  });

  it('lets ADMIN change a setting, and records what changed', async () => {
    const session = await signIn(ADMIN_EMAIL);

    // VAT rather than the Tourism Dirham, and set to its existing value, so a
    // failure here cannot leave the hotel quoting the wrong price.
    const response = await fetch(
      `${baseUrl}/api/admin/settings/vat_rate_percent`,
      authed(session, { method: 'PATCH', body: JSON.stringify({ value: '5' }) }),
    );

    expect(response.status).toBe(200);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'setting.update', entityId: 'vat_rate_percent' },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry).not.toBeNull();
    expect(entry?.details).toMatchObject({ to: '5' });
  });
});

describe('signing out', () => {
  it('ends the session for good', async () => {
    const session = await signIn(ADMIN_EMAIL);

    const loggedOut = await fetch(
      `${baseUrl}/api/auth/logout`,
      authed(session, { method: 'POST' }),
    );
    expect(loggedOut.status).toBe(200);

    // Replaying the same cookie must not work — the row is gone, not just the
    // browser's copy of it.
    const replayed = await fetch(
      `${baseUrl}/api/auth/session`,
      authed(session, { csrf: false }),
    );
    expect(replayed.status).toBe(401);
  });
});
