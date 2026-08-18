/**
 * The voucher admin surface and the guest-facing preview.
 *
 * The engine's correctness is covered by `discount-pricing.test.ts` and
 * `voucher-concurrency.test.ts`. What this file guards is the surface around
 * it: who may create a code, what happens to one that has been redeemed, and
 * whether the preview a guest is shown matches what they will actually be
 * charged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { addDays } from '../src/booking/dates.js';
import { prisma } from '../src/db/prisma.js';

const TEST_DOMAIN = 'voucher-api-test.invalid';
const ADMIN_EMAIL = `owner@${TEST_DOMAIN}`;
const STAFF_EMAIL = `desk@${TEST_DOMAIN}`;
const PASSWORD = 'a-sufficiently-long-test-password';

/** Every code this file creates starts with this, so cleanup is exact. */
const PREFIX = 'ZZAPI';

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

async function cleanUp(): Promise<void> {
  const vouchers = await prisma.voucher.findMany({
    where: { code: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = vouchers.map((v) => v.id);

  await prisma.voucherRedemption.deleteMany({ where: { voucherId: { in: ids } } });
  await prisma.voucherRoomType.deleteMany({ where: { voucherId: { in: ids } } });
  await prisma.voucher.deleteMany({ where: { id: { in: ids } } });

  const admins = await prisma.adminUser.findMany({
    where: { email: { endsWith: TEST_DOMAIN } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { adminUserId: { in: admins.map((a) => a.id) } },
  });
  await prisma.auditLog.deleteMany({ where: { entityId: { startsWith: PREFIX } } });
  await prisma.adminUser.deleteMany({
    where: { email: { endsWith: TEST_DOMAIN } },
  });
}

beforeAll(async () => {
  await cleanUp();
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

function voucherBody(overrides: Record<string, unknown> = {}) {
  return {
    code: `${PREFIX}-BASE`,
    name: { en: 'Test code', ar: 'Test code' },
    discountType: 'percentage',
    discountValue: 15,
    ...overrides,
  };
}

describe('managing codes', () => {
  it('creates, edits, and deletes an unredeemed code', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${PREFIX}-ROUNDTRIP`;

    const created = await fetch(
      `${baseUrl}/api/admin/vouchers`,
      authed(session, { method: 'POST', body: JSON.stringify(voucherBody({ code })) }),
    );
    expect(created.status).toBe(201);

    const patched = await fetch(
      `${baseUrl}/api/admin/vouchers/${code}`,
      authed(session, {
        method: 'PATCH',
        body: JSON.stringify({ discountValue: 25 }),
      }),
    );
    expect(patched.status).toBe(200);
    expect(
      ((await patched.json()) as { voucher: { discountValue: number } }).voucher
        .discountValue,
    ).toBe(25);

    const deleted = await fetch(
      `${baseUrl}/api/admin/vouchers/${code}`,
      authed(session, { method: 'DELETE' }),
    );
    expect(deleted.status).toBe(200);
  });

  it('stores and matches the code uppercase', async () => {
    const session = await signIn(ADMIN_EMAIL);

    const response = await fetch(
      `${baseUrl}/api/admin/vouchers`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify(voucherBody({ code: `${PREFIX}-lower` })),
      }),
    );

    expect(response.status).toBe(201);
    expect(
      ((await response.json()) as { voucher: { code: string } }).voucher.code,
    ).toBe(`${PREFIX}-LOWER`);
  });

  it('refuses a duplicate code regardless of case', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${PREFIX}-DUPE`;

    await fetch(
      `${baseUrl}/api/admin/vouchers`,
      authed(session, { method: 'POST', body: JSON.stringify(voucherBody({ code })) }),
    );

    const second = await fetch(
      `${baseUrl}/api/admin/vouchers`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify(voucherBody({ code: code.toLowerCase() })),
      }),
    );

    expect(second.status).toBe(409);
  });

  it('refuses a percentage discount above 100', async () => {
    const session = await signIn(ADMIN_EMAIL);

    const response = await fetch(
      `${baseUrl}/api/admin/vouchers`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify(
          voucherBody({ code: `${PREFIX}-OVER`, discountValue: 150 }),
        ),
      }),
    );

    // Rejected by the schema before it can reach the CHECK constraint.
    expect(response.status).toBe(400);
  });

  it('refuses a validity window that ends before it starts', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const today = new Date().toISOString().slice(0, 10);

    const response = await fetch(
      `${baseUrl}/api/admin/vouchers`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify(
          voucherBody({
            code: `${PREFIX}-BACKWARDS`,
            validFrom: today,
            validTo: addDays(today, -5),
          }),
        ),
      }),
    );

    expect(response.status).toBe(400);
  });

  it('lets STAFF read codes but not create them', async () => {
    const session = await signIn(STAFF_EMAIL);

    // The front desk answers "is my code still valid" on the phone.
    const read = await fetch(`${baseUrl}/api/admin/vouchers`, authed(session));
    expect(read.status).toBe(200);

    const write = await fetch(
      `${baseUrl}/api/admin/vouchers`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify(voucherBody({ code: `${PREFIX}-STAFF` })),
      }),
    );
    expect(write.status).toBe(403);
  });

  it('records who changed a discount, with the old and new value', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${PREFIX}-AUDIT`;

    await fetch(
      `${baseUrl}/api/admin/vouchers`,
      authed(session, { method: 'POST', body: JSON.stringify(voucherBody({ code })) }),
    );
    await fetch(
      `${baseUrl}/api/admin/vouchers/${code}`,
      authed(session, {
        method: 'PATCH',
        body: JSON.stringify({ discountValue: 40 }),
      }),
    );

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'voucher.update', entityId: code },
      orderBy: { createdAt: 'desc' },
      include: { adminUser: { select: { email: true } } },
    });

    expect(entry?.adminUser?.email).toBe(ADMIN_EMAIL);
    expect(entry?.details).toMatchObject({ discountFrom: 15, discountTo: 40 });
  });

  it('refuses to delete a code that has been redeemed', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${PREFIX}-SPENT`;

    await fetch(
      `${baseUrl}/api/admin/vouchers`,
      authed(session, { method: 'POST', body: JSON.stringify(voucherBody({ code })) }),
    );

    // Stand in for a real redemption: what matters is that a redemption row
    // exists, not how it got there.
    const voucher = await prisma.voucher.findFirstOrThrow({ where: { code } });
    const reservation = await prisma.reservation.findFirst();
    if (reservation) {
      await prisma.voucherRedemption.create({
        data: {
          voucherId: voucher.id,
          reservationId: reservation.id,
          discountAed: '10',
        },
      });

      const response = await fetch(
        `${baseUrl}/api/admin/vouchers/${code}`,
        authed(session, { method: 'DELETE' }),
      );

      // The redemptions are the campaign's financial record; the cascade would
      // take them with it.
      expect(response.status).toBe(409);
      expect(
        await prisma.voucher.findFirst({ where: { code } }),
      ).not.toBeNull();

      await prisma.voucherRedemption.deleteMany({ where: { voucherId: voucher.id } });
    }
  });

  it('will not lower the cap below what has already been redeemed', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${PREFIX}-CAP`;

    await fetch(
      `${baseUrl}/api/admin/vouchers`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify(voucherBody({ code, maxRedemptions: 10 })),
      }),
    );
    await prisma.voucher.updateMany({
      where: { code },
      data: { redemptionCount: 4 },
    });

    const response = await fetch(
      `${baseUrl}/api/admin/vouchers/${code}`,
      authed(session, {
        method: 'PATCH',
        body: JSON.stringify({ maxRedemptions: 2 }),
      }),
    );

    // Would put the row in breach of its own CHECK constraint. Explained
    // rather than surfaced as a database error.
    expect(response.status).toBe(409);
  });
});

describe('the guest-facing preview', () => {
  const code = `${PREFIX}-PREVIEW`;
  const checkIn = addDays(new Date().toISOString().slice(0, 10), 500);
  const checkOut = addDays(checkIn, 2);

  beforeAll(async () => {
    await prisma.voucher.create({
      data: {
        code,
        nameEn: 'Preview code',
        nameAr: 'Preview code',
        discountType: 'PERCENTAGE',
        discountValue: '10',
      },
    });
  });

  function preview(body: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/vouchers/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('prices the stay with the discount and reconciles', async () => {
    const response = await preview({
      code,
      roomTypeCode: 'studio-room',
      checkIn,
      checkOut,
    });

    expect(response.status).toBe(200);
    const { preview: result } = (await response.json()) as {
      preview: { code: string; price: Record<string, never> };
    };

    const price = result.price as unknown as {
      roomTotal: number;
      discount: { amount: number };
      vat: { total: number };
      tourismDirham: { total: number };
      grandTotal: number;
    };

    expect(result.code).toBe(code);
    expect(price.discount.amount).toBeGreaterThan(0);
    // What the guest is shown must be what they are charged.
    expect(
      price.roomTotal - price.discount.amount + price.vat.total +
        price.tourismDirham.total,
    ).toBeCloseTo(price.grandTotal, 2);
  });

  it('does not consume a redemption', async () => {
    await preview({ code, roomTypeCode: 'studio-room', checkIn, checkOut });
    await preview({ code, roomTypeCode: 'studio-room', checkIn, checkOut });

    const voucher = await prisma.voucher.findFirstOrThrow({ where: { code } });
    expect(voucher.redemptionCount).toBe(0);
  });

  it('reports an unknown code as not found', async () => {
    const response = await preview({
      code: `${PREFIX}-NOPE`,
      roomTypeCode: 'studio-room',
      checkIn,
      checkOut,
    });

    expect(response.status).toBe(404);
  });

  it('needs no authentication', async () => {
    // It is a guest-facing endpoint on the public booking flow.
    const response = await preview({
      code,
      roomTypeCode: 'studio-room',
      checkIn,
      checkOut,
    });
    expect(response.status).toBe(200);
  });
});
