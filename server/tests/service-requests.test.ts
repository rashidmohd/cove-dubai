/**
 * Spa and dining requests, end to end over HTTP.
 *
 * A request holds nothing until the team answers, so what matters is that the
 * form cannot promise what the hotel does not offer (a time outside the menu's
 * hours, a slot already gone, a party too big), that the guest and the team
 * hear about every step, and that only the right people can answer or change
 * the menu.
 *
 * Every offering here is created by the test with a `zz-` code, so nothing
 * depends on the seeded menu and cleanup is exact.
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
const { hashPassword } = await import('../src/auth/password.js');
const { addDays } = await import('../src/booking/dates.js');
const { config } = await import('../src/config.js');
const { prisma } = await import('../src/db/prisma.js');
const { dubaiNow } = await import('../src/service-requests/time.js');

const TEST_DOMAIN = 'service-requests-test.invalid';
const ADMIN_EMAIL = `owner@${TEST_DOMAIN}`;
const STAFF_EMAIL = `spa-desk@${TEST_DOMAIN}`;
const GUEST_EMAIL = `guest@${TEST_DOMAIN}`;
const PASSWORD = 'a-sufficiently-long-test-password';

let server: Server;
let baseUrl: string;

interface Session {
  cookie: string;
  csrfToken: string;
}

async function signIn(email: string): Promise<Session> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { csrfToken: string };
  return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, csrfToken: body.csrfToken };
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; session?: Session } = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.session
        ? { cookie: init.session.cookie, 'X-CSRF-Token': init.session.csrfToken }
        : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

/** Emails to an address sent after `since`, waiting briefly — mail goes after the response. */
async function emailsTo(address: string, since: number, count = 1) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = sent.slice(since).filter((message) => message.to === address);
    if (found.length >= count) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Expected ${count} email(s) to ${address}`);
}

const tomorrow = () => addDays(dubaiNow().date, 1);

function requestBody(offeringCode: string, overrides: Record<string, unknown> = {}) {
  return {
    offeringCode,
    preferredDate: tomorrow(),
    preferredTime: '11:00',
    guests: 2,
    firstName: 'Noor',
    lastName: 'Test',
    email: GUEST_EMAIL,
    phone: '+971 50 000 0000',
    notes: 'First visit.',
    locale: 'en',
    ...overrides,
  };
}

async function cleanUp(): Promise<void> {
  const offerings = await prisma.serviceOffering.findMany({
    where: { code: { startsWith: 'zz-' } },
    select: { id: true },
  });
  await prisma.serviceRequest.deleteMany({
    where: { offeringId: { in: offerings.map((o) => o.id) } },
  });
  await prisma.serviceOffering.deleteMany({ where: { code: { startsWith: 'zz-' } } });

  const admins = await prisma.adminUser.findMany({
    where: { email: { endsWith: TEST_DOMAIN } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({ where: { adminUserId: { in: admins.map((a) => a.id) } } });
  await prisma.adminUser.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
}

let admin: Session;

beforeAll(async () => {
  await cleanUp();
  const passwordHash = await hashPassword(PASSWORD);
  await prisma.adminUser.createMany({
    data: [
      { email: ADMIN_EMAIL, passwordHash, name: 'Owner', role: 'ADMIN' },
      { email: STAFF_EMAIL, passwordHash, name: 'Spa desk', role: 'STAFF' },
    ],
  });

  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  admin = await signIn(ADMIN_EMAIL);
  for (const offering of [
    { code: 'zz-massage', name: { en: 'Test massage', ar: 'Test massage' }, durationMinutes: 60, price: 400, firstSlot: '10:00', lastSlot: '18:00', maxGuests: 2 },
    { code: 'zz-hidden', name: { en: 'Hidden', ar: 'Hidden' }, firstSlot: '10:00', lastSlot: '12:00', isActive: false },
  ]) {
    const created = await call('/api/admin/spa/offerings', { method: 'POST', body: offering, session: admin });
    expect(created.status).toBe(201);
  }
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe('the menu', () => {
  it('lists active offerings with their half-hourly times, and hides the rest', async () => {
    const { status, body } = await call('/api/spa/offerings');
    expect(status).toBe(200);
    const codes = body.offerings.map((o: { code: string }) => o.code);
    expect(codes).toContain('zz-massage');
    expect(codes).not.toContain('zz-hidden');

    const massage = body.offerings.find((o: { code: string }) => o.code === 'zz-massage');
    expect(massage).toMatchObject({ price: 400, durationMinutes: 60, maxGuests: 2 });
    expect(massage.slots[0]).toBe('10:00');
    expect(massage.slots.at(-1)).toBe('18:00');
    expect(massage.slots).toHaveLength(17);
    // No row ids cross the boundary.
    expect(JSON.stringify(body)).not.toMatch(/"id"/);
  });

  it('keeps the two menus apart', async () => {
    const { body } = await call('/api/dining/offerings');
    expect(body.offerings.map((o: { code: string }) => o.code)).not.toContain('zz-massage');
  });
});

describe('sending a request', () => {
  it('records it, and tells the guest and the team', async () => {
    const before = sent.length;
    const { status, body } = await call('/api/spa/requests', {
      method: 'POST',
      body: requestBody('zz-massage'),
    });
    expect(status).toBe(201);
    expect(body.request.reference).toMatch(/^SPA-\d{4}-\d{6}$/);
    expect(body.request).toMatchObject({ status: 'new', guests: 2, preferredTime: '11:00' });

    const [toGuest] = await emailsTo(GUEST_EMAIL, before);
    expect(toGuest!.subject).toContain(body.request.reference);
    expect(toGuest!.text).toMatch(/not yet confirmed/i);

    const [toHotel] = await emailsTo(config.emailHotelNotificationAddress, before);
    expect(toHotel!.subject).toMatch(/^Spa request/);
    expect(toHotel!.text).toContain('First visit.');
  });

  it('refuses a time the menu does not offer', async () => {
    const outside = await call('/api/spa/requests', {
      method: 'POST',
      body: requestBody('zz-massage', { preferredTime: '21:00' }),
    });
    expect(outside.status).toBe(400);
    expect(outside.body.error.code).toBe('INVALID_SERVICE_REQUEST');

    const notHalfHour = await call('/api/spa/requests', {
      method: 'POST',
      body: requestBody('zz-massage', { preferredTime: '11:15' }),
    });
    expect(notHalfHour.status).toBe(400);
  });

  it('refuses a day that has already gone', async () => {
    const response = await call('/api/spa/requests', {
      method: 'POST',
      body: requestBody('zz-massage', { preferredDate: addDays(dubaiNow().date, -1) }),
    });
    expect(response.status).toBe(400);
  });

  it('refuses a party bigger than the offering takes', async () => {
    const response = await call('/api/spa/requests', {
      method: 'POST',
      body: requestBody('zz-massage', { guests: 3 }),
    });
    expect(response.status).toBe(400);
    expect(response.body.error.details).toMatchObject({ maxGuests: 2 });
  });

  it('refuses something not on the menu, including a withdrawn item', async () => {
    for (const code of ['zz-nothing', 'zz-hidden']) {
      const response = await call('/api/spa/requests', {
        method: 'POST',
        body: requestBody(code),
      });
      expect(response.status).toBe(404);
    }
    // A spa treatment is not a restaurant.
    const wrongKind = await call('/api/dining/requests', {
      method: 'POST',
      body: requestBody('zz-massage'),
    });
    expect(wrongKind.status).toBe(404);
  });
});

describe('answering a request', () => {
  async function newRequest(): Promise<string> {
    const { body } = await call('/api/spa/requests', {
      method: 'POST',
      body: requestBody('zz-massage'),
    });
    return body.request.reference as string;
  }

  it('lets staff confirm with a different time, and emails the guest', async () => {
    const reference = await newRequest();
    const staff = await signIn(STAFF_EMAIL);

    const listed = await call('/api/admin/spa/requests?status=new', { session: staff });
    expect(listed.status).toBe(200);
    expect(listed.body.requests.map((r: { reference: string }) => r.reference)).toContain(reference);

    const before = sent.length;
    const confirmed = await call(`/api/admin/spa/requests/${reference}`, {
      method: 'PATCH',
      session: staff,
      body: { status: 'confirmed', confirmedTime: '11:45', responseNote: 'Room 2, ground floor.' },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.request).toMatchObject({ status: 'confirmed', confirmedTime: '11:45' });

    const [email] = await emailsTo(GUEST_EMAIL, before);
    expect(email!.subject).toMatch(/^Confirmed/);
    expect(email!.text).toContain('Room 2, ground floor.');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'spa_request.confirmed', entityId: reference },
    });
    expect(audit).not.toBeNull();
  });

  it('will not confirm a request that was declined', async () => {
    const reference = await newRequest();
    const declined = await call(`/api/admin/spa/requests/${reference}`, {
      method: 'PATCH',
      session: admin,
      body: { status: 'declined', responseNote: 'Fully booked that afternoon.' },
    });
    expect(declined.status).toBe(200);

    const confirmed = await call(`/api/admin/spa/requests/${reference}`, {
      method: 'PATCH',
      session: admin,
      body: { status: 'confirmed' },
    });
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.error.code).toBe('INVALID_REQUEST_TRANSITION');
  });

  it('needs a signed-in admin', async () => {
    expect((await call('/api/admin/spa/requests')).status).toBe(401);
  });
});

describe('editing the menu', () => {
  it('is for admins, not staff', async () => {
    const staff = await signIn(STAFF_EMAIL);
    const response = await call('/api/admin/spa/offerings', {
      method: 'POST',
      session: staff,
      body: { code: 'zz-staff', name: { en: 'x', ar: 'x' }, firstSlot: '10:00', lastSlot: '11:00' },
    });
    expect(response.status).toBe(403);
  });

  it('refuses a last time before the first', async () => {
    const response = await call('/api/admin/spa/offerings/zz-massage', {
      method: 'PATCH',
      session: admin,
      body: { lastSlot: '09:00' },
    });
    expect(response.status).toBe(400);
  });

  it('will not delete something guests have asked for, but will deactivate it', async () => {
    const refused = await call('/api/admin/spa/offerings/zz-massage', {
      method: 'DELETE',
      session: admin,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('OFFERING_IN_USE');

    const deactivated = await call('/api/admin/spa/offerings/zz-massage', {
      method: 'PATCH',
      session: admin,
      body: { isActive: false },
    });
    expect(deactivated.status).toBe(200);
    const menu = await call('/api/spa/offerings');
    expect(menu.body.offerings.map((o: { code: string }) => o.code)).not.toContain('zz-massage');
  });

  it('deletes something nobody has asked for', async () => {
    const response = await call('/api/admin/spa/offerings/zz-hidden', {
      method: 'DELETE',
      session: admin,
    });
    expect(response.status).toBe(200);
  });
});
