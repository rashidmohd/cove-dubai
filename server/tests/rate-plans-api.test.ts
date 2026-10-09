/**
 * The rate-plan admin surface.
 *
 * Rate plans are what `checkAvailability` and `getRate` price against, so the
 * thing worth proving is that an edit in the panel changes what a guest is
 * quoted — and that the rules which would otherwise misprice silently (a
 * one-sided window, no weekdays) are refused rather than stored.
 *
 * Every plan here is dated in 2031, so a test plan cannot reprice a stay
 * anyone is booking on the shared database while the file runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { prisma } from '../src/db/prisma.js';

const TEST_DOMAIN = 'rate-plan-api-test.invalid';
const ADMIN_EMAIL = `owner@${TEST_DOMAIN}`;
const STAFF_EMAIL = `desk@${TEST_DOMAIN}`;
const PASSWORD = 'a-sufficiently-long-test-password';

/** Every plan this file creates starts with this, so cleanup is exact. */
const PREFIX = 'zzrp';

/** A Monday-to-Wednesday stay inside the test window: two nights, Mon and Tue. */
const CHECK_IN = '2031-03-10';
const CHECK_OUT = '2031-03-12';

let server: Server;
let baseUrl: string;
let roomTypeCode: string;
let baseRate: number;

interface Session {
  cookie: string;
  csrfToken: string;
}

interface RatePlanPayload {
  roomTypeCode: string;
  code: string;
  nightlyRate: number;
  validFrom: string | null;
  validTo: string | null;
  daysOfWeek: number[];
  isPublicOffer: boolean;
}

async function signIn(email: string): Promise<Session> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { csrfToken: string };
  return {
    cookie: response.headers.get('set-cookie')!.split(';')[0]!,
    csrfToken: body.csrfToken,
  };
}

function authed(session: Session, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      cookie: session.cookie,
      'X-CSRF-Token': session.csrfToken,
      ...(init.headers ?? {}),
    },
  };
}

function plansUrl(planCode?: string): string {
  return (
    `${baseUrl}/api/admin/room-types/${roomTypeCode}/rate-plans` +
    (planCode ? `/${planCode}` : '')
  );
}

function planBody(overrides: Record<string, unknown> = {}) {
  return {
    code: `${PREFIX}-base`,
    name: { en: 'Test plan', ar: 'Test plan' },
    nightlyRate: baseRate + 111,
    validFrom: '2031-03-01',
    validTo: '2031-03-31',
    priority: 500,
    ...overrides,
  };
}

/** The per-night rates a guest is quoted for the test stay. */
async function quotedRates(): Promise<number[]> {
  const response = await fetch(
    `${baseUrl}/api/rates?roomTypeCode=${roomTypeCode}&checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}`,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    price: { nightlyRates: Array<{ rate: number }> };
  };
  return body.price.nightlyRates.map((night) => night.rate);
}

async function cleanUp(): Promise<void> {
  await prisma.ratePlan.deleteMany({ where: { code: { startsWith: PREFIX } } });

  const admins = await prisma.adminUser.findMany({
    where: { email: { endsWith: TEST_DOMAIN } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { adminUserId: { in: admins.map((a) => a.id) } },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { endsWith: TEST_DOMAIN } },
  });
}

beforeAll(async () => {
  await cleanUp();

  const roomType = await prisma.roomType.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  roomTypeCode = roomType.code;
  baseRate = roomType.baseRateAed.toNumber();

  const passwordHash = await hashPassword(PASSWORD);
  await prisma.adminUser.createMany({
    data: [
      { email: ADMIN_EMAIL, passwordHash, name: 'Owner', role: 'ADMIN' },
      { email: STAFF_EMAIL, passwordHash, name: 'Desk', role: 'STAFF' },
    ],
  });

  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe('editing a plan changes what a guest is quoted', () => {
  it('creates, reprices, and deletes a plan', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${PREFIX}-roundtrip`;

    // No plan of ours yet: the base rate applies.
    expect(await quotedRates()).toEqual([baseRate, baseRate]);

    const created = await fetch(
      plansUrl(),
      authed(session, {
        method: 'POST',
        body: JSON.stringify(planBody({ code })),
      }),
    );
    expect(created.status).toBe(201);
    const { ratePlan } = (await created.json()) as { ratePlan: RatePlanPayload };
    expect(ratePlan).toMatchObject({
      roomTypeCode,
      code,
      nightlyRate: baseRate + 111,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      isPublicOffer: false,
    });

    expect(await quotedRates()).toEqual([baseRate + 111, baseRate + 111]);

    const updated = await fetch(
      plansUrl(code),
      authed(session, {
        method: 'PATCH',
        body: JSON.stringify({ nightlyRate: baseRate + 222 }),
      }),
    );
    expect(updated.status).toBe(200);
    expect(await quotedRates()).toEqual([baseRate + 222, baseRate + 222]);

    // The rate change is audited with what it was and what it became.
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'rate_plan.update', entityId: `${roomTypeCode}/${code}` },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.details).toMatchObject({
      rateFrom: baseRate + 111,
      rateTo: baseRate + 222,
    });

    const deleted = await fetch(
      plansUrl(code),
      authed(session, { method: 'DELETE' }),
    );
    expect(deleted.status).toBe(200);
    expect(await quotedRates()).toEqual([baseRate, baseRate]);
  });

  it('prices only the nights of the week a plan names', async () => {
    const session = await signIn(ADMIN_EMAIL);

    // Tuesday only. The stay is a Monday night and a Tuesday night.
    const created = await fetch(
      plansUrl(),
      authed(session, {
        method: 'POST',
        body: JSON.stringify(
          planBody({ code: `${PREFIX}-tuesday`, daysOfWeek: [2, 2] }),
        ),
      }),
    );
    expect(created.status).toBe(201);
    const { ratePlan } = (await created.json()) as { ratePlan: RatePlanPayload };
    expect(ratePlan.daysOfWeek).toEqual([2]);

    expect(await quotedRates()).toEqual([baseRate, baseRate + 111]);
  });

  it('advertises a plan once it is flagged as an offer', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${PREFIX}-offer`;

    await fetch(
      plansUrl(),
      authed(session, {
        method: 'POST',
        body: JSON.stringify(
          planBody({ code, nightlyRate: Math.max(0, baseRate - 100), priority: -1 }),
        ),
      }),
    );

    const offerNames = async () => {
      const response = await fetch(`${baseUrl}/api/offers`);
      const body = (await response.json()) as {
        offers: Array<{ name: { en: string } }>;
      };
      return body.offers.map((offer) => offer.name.en);
    };

    expect(await offerNames()).not.toContain('Spring offer');

    const flagged = await fetch(
      plansUrl(code),
      authed(session, {
        method: 'PATCH',
        body: JSON.stringify({
          isPublicOffer: true,
          name: { en: 'Spring offer', ar: 'Spring offer' },
          description: { en: 'Two nights in spring.', ar: 'Two nights in spring.' },
        }),
      }),
    );
    expect(flagged.status).toBe(200);
    expect(await offerNames()).toContain('Spring offer');
  });
});

describe('rules that would otherwise misprice silently', () => {
  it('refuses a one-sided date window on create', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const response = await fetch(
      plansUrl(),
      authed(session, {
        method: 'POST',
        body: JSON.stringify(
          planBody({ code: `${PREFIX}-onesided`, validTo: null }),
        ),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('refuses clearing one end of an existing window', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${PREFIX}-window`;
    await fetch(
      plansUrl(),
      authed(session, { method: 'POST', body: JSON.stringify(planBody({ code })) }),
    );

    const response = await fetch(
      plansUrl(code),
      authed(session, { method: 'PATCH', body: JSON.stringify({ validFrom: null }) }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_RATE_PLAN');
  });

  it('refuses a plan with no nights of the week', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const response = await fetch(
      plansUrl(),
      authed(session, {
        method: 'POST',
        body: JSON.stringify(planBody({ code: `${PREFIX}-nodays`, daysOfWeek: [] })),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('refuses a second plan with the same code on the room type', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const body = JSON.stringify(planBody({ code: `${PREFIX}-twice` }));

    const first = await fetch(plansUrl(), authed(session, { method: 'POST', body }));
    expect(first.status).toBe(201);

    const second = await fetch(plansUrl(), authed(session, { method: 'POST', body }));
    expect(second.status).toBe(409);
    const payload = (await second.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('RATE_PLAN_CODE_IN_USE');
  });

  it('reports an unknown plan as not found', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const response = await fetch(
      plansUrl(`${PREFIX}-nothing`),
      authed(session, { method: 'PATCH', body: JSON.stringify({ priority: 1 }) }),
    );
    expect(response.status).toBe(404);
  });
});

describe('who may do what', () => {
  it('lets staff read plans but not change them', async () => {
    const session = await signIn(STAFF_EMAIL);

    const list = await fetch(`${baseUrl}/api/admin/rate-plans`, authed(session));
    expect(list.status).toBe(200);

    const create = await fetch(
      plansUrl(),
      authed(session, {
        method: 'POST',
        body: JSON.stringify(planBody({ code: `${PREFIX}-staff` })),
      }),
    );
    expect(create.status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    const response = await fetch(`${baseUrl}/api/admin/rate-plans`);
    expect(response.status).toBe(401);
  });
});
