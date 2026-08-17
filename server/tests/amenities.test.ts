/**
 * Room amenities, over real HTTP against the real database.
 *
 * Two things are worth proving here beyond "the CRUD works":
 *
 *   - **Deleting an amenity that rooms still list is refused.** The foreign key
 *     cascades, so without the guard a delete would silently rewrite the
 *     published description of every room type that had it.
 *   - **Replacing a room type's list is atomic.** It is implemented as
 *     delete-then-insert, which is exactly the shape that leaves a room with
 *     nothing if it half-fails.
 *
 * Creates its own admin accounts under a marker domain and its own amenities
 * under a marker code prefix, and removes both afterwards, so it cannot disturb
 * the hotel's real vocabulary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { prisma } from '../src/db/prisma.js';

const TEST_DOMAIN = 'amenity-test.invalid';
const ADMIN_EMAIL = `owner@${TEST_DOMAIN}`;
const STAFF_EMAIL = `desk@${TEST_DOMAIN}`;
const PASSWORD = 'a-sufficiently-long-test-password';

/** Every amenity this file creates starts with this, so cleanup is exact. */
const TEST_PREFIX = 'zz-test-';

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
  await prisma.roomTypeAmenity.deleteMany({
    where: { amenity: { code: { startsWith: TEST_PREFIX } } },
  });
  await prisma.amenity.deleteMany({
    where: { code: { startsWith: TEST_PREFIX } },
  });

  const admins = await prisma.adminUser.findMany({
    where: { email: { endsWith: TEST_DOMAIN } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { adminUserId: { in: admins.map((a) => a.id) } },
  });
  await prisma.auditLog.deleteMany({
    where: { entityId: { startsWith: TEST_PREFIX } },
  });
  await prisma.adminUser.deleteMany({
    where: { email: { endsWith: TEST_DOMAIN } },
  });
}

beforeAll(async () => {
  await cleanUp();

  const passwordHash = await hashPassword(PASSWORD);
  await prisma.adminUser.createMany({
    data: [
      { email: ADMIN_EMAIL, passwordHash, name: 'Test Owner', role: 'ADMIN' },
      { email: STAFF_EMAIL, passwordHash, name: 'Test Desk', role: 'STAFF' },
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

describe('the guest-facing API', () => {
  it('returns amenities with every room type', async () => {
    const response = await fetch(`${baseUrl}/api/room-types`);
    expect(response.status).toBe(200);

    const { roomTypes } = (await response.json()) as {
      roomTypes: Array<{ code: string; amenities: unknown[] }>;
    };

    expect(roomTypes.length).toBeGreaterThan(0);
    for (const roomType of roomTypes) {
      expect(Array.isArray(roomType.amenities)).toBe(true);
      expect(roomType.amenities.length).toBeGreaterThan(0);
    }
  });

  it('carries the OpenTravel code so a future PMS can map them', async () => {
    const response = await fetch(`${baseUrl}/api/room-types`);
    const { roomTypes } = (await response.json()) as {
      roomTypes: Array<{
        amenities: Array<{ code: string; otaCode: number | null }>;
      }>;
    };

    const all = roomTypes.flatMap((roomType) => roomType.amenities);
    const airConditioning = all.find((a) => a.code === 'air-conditioning');

    // RMA 2 is the OpenTravel code for air conditioning. If this drifts, the
    // seed has been edited in a way a channel-manager export would notice.
    expect(airConditioning?.otaCode).toBe(2);
  });

  it('hides a withdrawn amenity from guests', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${TEST_PREFIX}withdrawn`;

    await fetch(
      `${baseUrl}/api/admin/amenities`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify({
          code,
          name: { en: 'Withdrawn', ar: 'Withdrawn' },
          category: 'comfort',
        }),
      }),
    );

    const roomTypeCode = 'studio-room';
    const before = await currentAmenityCodes(roomTypeCode);

    await fetch(
      `${baseUrl}/api/admin/room-types/${roomTypeCode}/amenities`,
      authed(session, {
        method: 'PUT',
        body: JSON.stringify({ amenityCodes: [...before, code] }),
      }),
    );

    // Visible while active...
    expect(await guestAmenityCodes(roomTypeCode)).toContain(code);

    await fetch(
      `${baseUrl}/api/admin/amenities/${code}`,
      authed(session, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
      }),
    );

    // ...and gone once withdrawn, without the link being deleted.
    expect(await guestAmenityCodes(roomTypeCode)).not.toContain(code);

    // Put the room type back as it was.
    await fetch(
      `${baseUrl}/api/admin/room-types/${roomTypeCode}/amenities`,
      authed(session, {
        method: 'PUT',
        body: JSON.stringify({ amenityCodes: before }),
      }),
    );
  });
});

async function guestAmenityCodes(roomTypeCode: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/room-types`);
  const { roomTypes } = (await response.json()) as {
    roomTypes: Array<{ code: string; amenities: Array<{ code: string }> }>;
  };
  const roomType = roomTypes.find((r) => r.code === roomTypeCode);
  return (roomType?.amenities ?? []).map((a) => a.code);
}

async function currentAmenityCodes(roomTypeCode: string): Promise<string[]> {
  const roomType = await prisma.roomType.findUniqueOrThrow({
    where: { code: roomTypeCode },
    include: { amenities: { include: { amenity: true } } },
  });
  return roomType.amenities.map((link) => link.amenity.code);
}

describe('managing the vocabulary', () => {
  it('creates, edits, and deletes an amenity', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${TEST_PREFIX}roundtrip`;

    const created = await fetch(
      `${baseUrl}/api/admin/amenities`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify({
          code,
          otaCode: 9999,
          name: { en: 'Round Trip', ar: 'Round Trip' },
          category: 'technology',
          sortOrder: 5,
        }),
      }),
    );
    expect(created.status).toBe(201);

    const patched = await fetch(
      `${baseUrl}/api/admin/amenities/${code}`,
      authed(session, {
        method: 'PATCH',
        body: JSON.stringify({ name: { en: 'Renamed', ar: 'Renamed' } }),
      }),
    );
    expect(patched.status).toBe(200);
    expect(
      ((await patched.json()) as { amenity: { name: { en: string } } }).amenity
        .name.en,
    ).toBe('Renamed');

    const deleted = await fetch(
      `${baseUrl}/api/admin/amenities/${code}`,
      authed(session, { method: 'DELETE' }),
    );
    expect(deleted.status).toBe(200);

    expect(await prisma.amenity.findUnique({ where: { code } })).toBeNull();
  });

  it('clears an OTA code when explicitly sent null', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${TEST_PREFIX}ota`;

    await fetch(
      `${baseUrl}/api/admin/amenities`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify({
          code,
          otaCode: 251,
          name: { en: 'Has code', ar: 'Has code' },
          category: 'technology',
        }),
      }),
    );

    const response = await fetch(
      `${baseUrl}/api/admin/amenities/${code}`,
      authed(session, {
        method: 'PATCH',
        body: JSON.stringify({ otaCode: null }),
      }),
    );

    expect(response.status).toBe(200);
    // Distinct from "not supplied", which must leave the value alone.
    expect(
      ((await response.json()) as { amenity: { otaCode: number | null } })
        .amenity.otaCode,
    ).toBeNull();
  });

  it('refuses a duplicate code', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const code = `${TEST_PREFIX}dupe`;
    const body = JSON.stringify({
      code,
      name: { en: 'Dupe', ar: 'Dupe' },
      category: 'comfort',
    });

    const first = await fetch(
      `${baseUrl}/api/admin/amenities`,
      authed(session, { method: 'POST', body }),
    );
    expect(first.status).toBe(201);

    const second = await fetch(
      `${baseUrl}/api/admin/amenities`,
      authed(session, { method: 'POST', body }),
    );
    expect(second.status).toBe(409);
  });

  it('rejects a code that is not a slug', async () => {
    const session = await signIn(ADMIN_EMAIL);

    const response = await fetch(
      `${baseUrl}/api/admin/amenities`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify({
          code: 'Not A Slug!',
          name: { en: 'Bad', ar: 'Bad' },
          category: 'comfort',
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it('will not delete an amenity that room types still list', async () => {
    const session = await signIn(ADMIN_EMAIL);

    // `minibar` is seeded onto every room type.
    const response = await fetch(
      `${baseUrl}/api/admin/amenities/minibar`,
      authed(session, { method: 'DELETE' }),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AMENITY_CODE_IN_USE');

    // And it is genuinely still there — the guard ran before the delete, not
    // after it.
    expect(
      await prisma.amenity.findUnique({ where: { code: 'minibar' } }),
    ).not.toBeNull();
  });

  it('is closed to STAFF', async () => {
    const session = await signIn(STAFF_EMAIL);

    // Reading is fine — the front desk answers guest questions about rooms.
    const read = await fetch(`${baseUrl}/api/admin/amenities`, authed(session));
    expect(read.status).toBe(200);

    const write = await fetch(
      `${baseUrl}/api/admin/amenities`,
      authed(session, {
        method: 'POST',
        body: JSON.stringify({
          code: `${TEST_PREFIX}staff`,
          name: { en: 'Nope', ar: 'Nope' },
          category: 'comfort',
        }),
      }),
    );
    expect(write.status).toBe(403);
  });
});

describe('assigning amenities to a room type', () => {
  it('replaces the list wholesale', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const roomTypeCode = 'studio-room';
    const before = await currentAmenityCodes(roomTypeCode);

    const response = await fetch(
      `${baseUrl}/api/admin/room-types/${roomTypeCode}/amenities`,
      authed(session, {
        method: 'PUT',
        body: JSON.stringify({ amenityCodes: ['safe', 'wifi'] }),
      }),
    );

    expect(response.status).toBe(200);
    expect((await currentAmenityCodes(roomTypeCode)).sort()).toEqual([
      'safe',
      'wifi',
    ]);

    // Restore, and confirm the restore itself round-trips.
    await fetch(
      `${baseUrl}/api/admin/room-types/${roomTypeCode}/amenities`,
      authed(session, {
        method: 'PUT',
        body: JSON.stringify({ amenityCodes: before }),
      }),
    );
    expect((await currentAmenityCodes(roomTypeCode)).sort()).toEqual(
      [...before].sort(),
    );
  });

  it('rejects an unknown code without changing anything', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const roomTypeCode = 'terrace-room';
    const before = await currentAmenityCodes(roomTypeCode);

    const response = await fetch(
      `${baseUrl}/api/admin/room-types/${roomTypeCode}/amenities`,
      authed(session, {
        method: 'PUT',
        body: JSON.stringify({ amenityCodes: ['safe', 'no-such-amenity'] }),
      }),
    );

    expect(response.status).toBe(404);

    // The whole request is refused — not "everything except the bad one".
    expect((await currentAmenityCodes(roomTypeCode)).sort()).toEqual(
      [...before].sort(),
    );
  });

  it('records who changed a room type’s amenities', async () => {
    const session = await signIn(ADMIN_EMAIL);
    const roomTypeCode = 'studio-room';
    const before = await currentAmenityCodes(roomTypeCode);

    await fetch(
      `${baseUrl}/api/admin/room-types/${roomTypeCode}/amenities`,
      authed(session, {
        method: 'PUT',
        body: JSON.stringify({ amenityCodes: before }),
      }),
    );

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'room_type.set_amenities', entityId: roomTypeCode },
      orderBy: { createdAt: 'desc' },
      include: { adminUser: { select: { email: true } } },
    });

    expect(entry?.adminUser?.email).toBe(ADMIN_EMAIL);
  });
});
