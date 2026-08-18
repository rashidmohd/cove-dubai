/**
 * The public offers endpoint.
 *
 * An offer is a rate plan flagged for display, which means the price on the
 * offers page is the row the booking prices against. What needs guarding is
 * everything around that: which plans are advertised, which have stopped being
 * advertised, and whether a claimed saving is real.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/app.js';
import { addDays } from '../src/booking/dates.js';
import { prisma } from '../src/db/prisma.js';

/** Every plan this file creates starts with this, so cleanup is exact. */
const PREFIX = 'ZZOFFER';

let server: Server;
let baseUrl: string;
let roomTypeId: string;
let baseRate: number;

const today = new Date().toISOString().slice(0, 10);

interface OfferPayload {
  roomTypeCode: string;
  name: { en: string; ar: string };
  nightlyRate: number;
  standardRate: number | null;
  validTo: string | null;
  minimumStayNights: number;
  daysOfWeek: number[];
}

async function offers(): Promise<OfferPayload[]> {
  const response = await fetch(`${baseUrl}/api/offers`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { offers: OfferPayload[] };
  return body.offers;
}

async function makePlan(
  name: string,
  data: Record<string, unknown>,
): Promise<void> {
  await prisma.ratePlan.create({
    data: {
      roomTypeId,
      nameEn: `${PREFIX} ${name}`,
      nameAr: `${PREFIX} ${name}`,
      nightlyRateAed: '900.00',
      isPublicOffer: true,
      ...data,
    },
  });
}

async function cleanUp(): Promise<void> {
  await prisma.ratePlan.deleteMany({ where: { nameEn: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  const roomType = await prisma.roomType.findUniqueOrThrow({
    where: { code: 'studio-room' },
  });
  roomTypeId = roomType.id;
  baseRate = roomType.baseRateAed.toNumber();

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

describe('which plans are advertised', () => {
  it('includes a plan flagged as a public offer', async () => {
    await makePlan('LIVE', {});

    const names = (await offers()).map((offer) => offer.name.en);
    expect(names).toContain(`${PREFIX} LIVE`);
  });

  it('excludes an ordinary rate plan', async () => {
    // Seasonal pricing is not an offer. Advertising every rate plan would put
    // the hotel's internal pricing structure on a marketing page.
    await makePlan('SEASONAL', { isPublicOffer: false });

    const names = (await offers()).map((offer) => offer.name.en);
    expect(names).not.toContain(`${PREFIX} SEASONAL`);
  });

  it('excludes a deactivated plan', async () => {
    await makePlan('OFF', { isActive: false });

    const names = (await offers()).map((offer) => offer.name.en);
    expect(names).not.toContain(`${PREFIX} OFF`);
  });

  it('stops advertising an offer whose window has passed', async () => {
    // The important one: an expired offer must remove itself rather than wait
    // for someone to remember to deactivate it.
    await makePlan('EXPIRED', {
      startDate: new Date(`${addDays(today, -30)}T00:00:00Z`),
      endDate: new Date(`${addDays(today, -1)}T00:00:00Z`),
    });

    const names = (await offers()).map((offer) => offer.name.en);
    expect(names).not.toContain(`${PREFIX} EXPIRED`);
  });

  it('still advertises an offer that ends today', async () => {
    // "Valid until the 31st" includes the 31st, in the hotel's terms rather
    // than the server's clock.
    // Both dates, because `rate_plans_date_window_complete` requires a window
    // to be whole — a half-open one would silently read as "always".
    await makePlan('ENDS-TODAY', {
      startDate: new Date(`${addDays(today, -10)}T00:00:00Z`),
      endDate: new Date(`${today}T00:00:00Z`),
    });

    const names = (await offers()).map((offer) => offer.name.en);
    expect(names).toContain(`${PREFIX} ENDS-TODAY`);
  });

  it('advertises an offer that has not started yet, with its dates', async () => {
    // Deliberate: a future offer is worth promoting, and the card carries the
    // window so the guest can see when it begins.
    const from = addDays(today, 30);
    await makePlan('FUTURE', {
      startDate: new Date(`${from}T00:00:00Z`),
      endDate: new Date(`${addDays(today, 60)}T00:00:00Z`),
    });

    const found = (await offers()).find(
      (offer) => offer.name.en === `${PREFIX} FUTURE`,
    );
    expect(found).toBeDefined();
    expect(found?.validTo).toBe(addDays(today, 60));
  });
});

describe('the saving shown on a card', () => {
  it('reports the standard rate when the offer is genuinely cheaper', async () => {
    await makePlan('CHEAPER', { nightlyRateAed: String(baseRate - 200) });

    const found = (await offers()).find(
      (offer) => offer.name.en === `${PREFIX} CHEAPER`,
    );
    expect(found?.standardRate).toBe(baseRate);
  });

  it('reports no standard rate when the offer costs more', async () => {
    // A plan can legitimately be a higher peak rate. Claiming a saving on one
    // of those would be false, and the front-end shows the badge from this
    // field alone.
    await makePlan('PEAK', { nightlyRateAed: String(baseRate + 500) });

    const found = (await offers()).find(
      (offer) => offer.name.en === `${PREFIX} PEAK`,
    );
    expect(found?.standardRate).toBeNull();
  });
});

describe('what the card needs', () => {
  it('carries the room type code, so the link can preselect it', async () => {
    await makePlan('LINKED', {});

    const found = (await offers()).find(
      (offer) => offer.name.en === `${PREFIX} LINKED`,
    );
    // A code, never a row id — the same rule every shape crossing the seam obeys.
    expect(found?.roomTypeCode).toBe('studio-room');
  });

  it('carries the day-of-week restriction', async () => {
    await makePlan('WEEKEND', { daysOfWeek: [5, 6] });

    const found = (await offers()).find(
      (offer) => offer.name.en === `${PREFIX} WEEKEND`,
    );
    expect(found?.daysOfWeek).toEqual([5, 6]);
  });

  it('needs no authentication', async () => {
    // It is a public marketing page.
    const response = await fetch(`${baseUrl}/api/offers`);
    expect(response.status).toBe(200);
  });
});
