/**
 * The public booking lookup behind the cancellation page.
 *
 * It returns a guest's name, email and phone, so a booking reference alone —
 * six random digits a year, printed on every confirmation — must not be
 * enough. The token from the emailed link is required, and a missing or wrong
 * one must look exactly like a reference that does not exist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

const EMAIL = 'lookup@reservation-lookup-test.invalid';
const REFERENCE = 'CV-2031-515151';
const TOKEN = 'a-test-cancellation-token-that-is-long-enough';

let server: Server;
let baseUrl: string;

async function cleanUp(): Promise<void> {
  await prisma.reservation.deleteMany({ where: { bookingReference: REFERENCE } });
  await prisma.guest.deleteMany({ where: { email: EMAIL } });
}

async function lookup(query: string) {
  const response = await fetch(`${baseUrl}/api/reservations/${REFERENCE}${query}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await cleanUp();
  const roomType = await prisma.roomType.findFirstOrThrow({ where: { isActive: true } });
  const guest = await prisma.guest.create({
    data: { firstName: 'Lookup', lastName: 'Test', email: EMAIL, phone: '+971500000000' },
  });
  await prisma.reservation.create({
    data: {
      bookingReference: REFERENCE,
      guestId: guest.id,
      roomTypeId: roomType.id,
      checkIn: new Date('2031-07-01'),
      checkOut: new Date('2031-07-02'),
      priceBreakdown: {},
      totalAmountAed: '0',
      cancellationToken: TOKEN,
    },
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

describe('looking a booking up by reference', () => {
  it('returns it with the token from the emailed link', async () => {
    const { status, body } = await lookup(`?token=${TOKEN}`);
    expect(status).toBe(200);
    expect(body.reservation).toMatchObject({ reference: REFERENCE });
  });

  it('refuses the reference alone, without saying the booking exists', async () => {
    const missing = await lookup('');
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).not.toContain(EMAIL);

    const wrong = await lookup('?token=not-the-right-token');
    const unknown = await fetch(
      `${baseUrl}/api/reservations/CV-2031-000001?token=not-the-right-token`,
    );
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(wrong.body).toEqual(await unknown.json());
  });
});
