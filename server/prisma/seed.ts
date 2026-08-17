/**
 * Seed script — idempotent by design.
 *
 * It runs against a shared hosted database, so it must be safe to re-run at any
 * time: every write is an upsert or a skip-duplicates insert, and re-running
 * never duplicates a room type or resets a booking count.
 *
 * English copy is taken verbatim from the approved mockups in design/mockups/.
 * Arabic fields are seeded with the English text as a visible placeholder — the
 * client supplies the real translations, and the `arabic-rtl` skill is explicit
 * that we never machine-translate luxury brand copy. Seeding them non-empty
 * keeps untranslated content obvious rather than silently blank.
 */
import { PrismaClient, Prisma } from '@prisma/client';

import { hashPassword } from '../src/auth/password.js';

const prisma = new PrismaClient();

/** How far ahead the booking calendar is open. */
const INVENTORY_HORIZON_DAYS = 550;

/**
 * The four room types, with copy and rates taken from design/mockups/rooms.html
 * and design/mockups/reserve.html.
 *
 * Room counts total 106, matching the hotel described in CLAUDE.md. Note that
 * the mockup copy currently tells guests "Forty-eight rooms" — that sentence is
 * stale and is flagged for the client to reword; it lives in the message files,
 * not here.
 */
const ROOM_TYPES = [
  {
    code: 'studio-room',
    nameEn: 'Studio Room',
    categoryEn: 'Classic',
    descriptionEn:
      'The smallest room in the hotel. Also the most considered. Nothing was left in that did not need to be there.',
    baseRateAed: '980.00',
    maxOccupancy: 2,
    totalRooms: 44,
    imageKey: 'img-studio',
    sortOrder: 1,
  },
  {
    code: 'terrace-room',
    nameEn: 'Terrace Room',
    categoryEn: 'Deluxe',
    descriptionEn:
      'A private terrace where the morning coffee tastes different. The room itself is generous without being excessive.',
    baseRateAed: '1400.00',
    maxOccupancy: 3,
    totalRooms: 34,
    imageKey: 'img-terrace',
    sortOrder: 2,
  },
  {
    code: 'corner-suite',
    nameEn: 'Corner Suite',
    categoryEn: 'Premium',
    descriptionEn:
      'Two walls of glass. The city on one side, stillness on the other. A room that earns its corner.',
    baseRateAed: '1800.00',
    maxOccupancy: 4,
    totalRooms: 20,
    imageKey: 'img-corner',
    sortOrder: 3,
  },
  {
    code: 'cove-suite',
    nameEn: 'The Cove Suite',
    categoryEn: 'Signature',
    descriptionEn:
      'The largest room in the hotel. Two aspects, one terrace, and enough space to forget you are in a city.',
    baseRateAed: '2400.00',
    maxOccupancy: 4,
    totalRooms: 8,
    imageKey: 'img-suite',
    sortOrder: 4,
  },
] as const;

/**
 * Operational values the hotel can change without a deploy.
 *
 * The Tourism Dirham amount depends on the property's official DET
 * classification, which is not yet confirmed — AED 20 is the top-tier rate and
 * the safe placeholder. It must be confirmed before go-live.
 */
const SETTINGS = [
  {
    key: 'tourism_dirham_per_room_per_night_aed',
    value: '20',
    description:
      'Dubai Tourism Dirham, charged per room per night. Depends on the property classification — PLACEHOLDER, confirm with the client before launch.',
  },
  {
    key: 'vat_rate_percent',
    value: '5',
    description: 'UAE VAT rate applied to the accommodation charge.',
  },
  {
    key: 'currency',
    value: 'AED',
    description: 'Currency all published rates are quoted in.',
  },
  {
    key: 'cancellation_policy_hours',
    value: '48',
    description:
      'Hours before check-in that a guest may cancel free of charge.',
  },
] as const;

/** Midnight UTC for a day offset from today, matching Postgres `date` columns. */
function utcDateFromToday(offsetDays: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + offsetDays,
    ),
  );
}

/**
 * The amenity vocabulary, against OpenTravel **RMA (Room Amenity Type)** codes.
 *
 * Codes are the ones OTAs and channel managers exchange — Booking.com's
 * connectivity API consumes this exact list — so whatever PMS the client picks
 * later, mapping these is a lookup rather than re-entering the data.
 *
 * `otaCode: null` is legitimate: a genuinely bespoke amenity the standard has
 * no code for is better recorded honestly than forced onto a code that means
 * something else.
 */
const AMENITIES = [
  // --- Bathroom ------------------------------------------------------------
  { code: 'bathrobe', otaCode: 10, nameEn: 'Bathrobe', category: 'BATHROOM', sortOrder: 10 },
  { code: 'slippers', otaCode: 228, nameEn: 'Slippers', category: 'BATHROOM', sortOrder: 20 },
  { code: 'hairdryer', otaCode: 50, nameEn: 'Hairdryer', category: 'BATHROOM', sortOrder: 30 },
  { code: 'rain-shower', otaCode: null, nameEn: 'Rain shower', category: 'BATHROOM', sortOrder: 40 },
  { code: 'soaking-tub', otaCode: null, nameEn: 'Soaking tub', category: 'BATHROOM', sortOrder: 50 },

  // --- Comfort -------------------------------------------------------------
  { code: 'air-conditioning', otaCode: 2, nameEn: 'Air conditioning', category: 'COMFORT', sortOrder: 10 },
  { code: 'minibar', otaCode: 69, nameEn: 'Minibar', category: 'COMFORT', sortOrder: 20 },
  { code: 'coffee-tea-maker', otaCode: 19, nameEn: 'Coffee & tea maker', category: 'COMFORT', sortOrder: 30 },
  { code: 'safe', otaCode: 92, nameEn: 'In-room safe', category: 'COMFORT', sortOrder: 40 },
  { code: 'desk', otaCode: 28, nameEn: 'Writing desk', category: 'COMFORT', sortOrder: 50 },
  { code: 'balcony', otaCode: 5017, nameEn: 'Private balcony', category: 'COMFORT', sortOrder: 60 },
  { code: 'soundproofed', otaCode: 144, nameEn: 'Soundproofed', category: 'COMFORT', sortOrder: 70 },
  { code: 'blackout-curtains', otaCode: null, nameEn: 'Blackout curtains', category: 'COMFORT', sortOrder: 80 },

  // --- Technology ----------------------------------------------------------
  { code: 'television', otaCode: 251, nameEn: 'Television', category: 'TECHNOLOGY', sortOrder: 10 },
  { code: 'wifi', otaCode: null, nameEn: 'High-speed Wi-Fi', category: 'TECHNOLOGY', sortOrder: 20 },
  { code: 'telephone', otaCode: 107, nameEn: 'Telephone', category: 'TECHNOLOGY', sortOrder: 30 },

  // --- Services ------------------------------------------------------------
  { code: 'iron', otaCode: 55, nameEn: 'Iron & board', category: 'SERVICES', sortOrder: 10 },
  { code: 'housekeeping-daily', otaCode: null, nameEn: 'Daily housekeeping', category: 'SERVICES', sortOrder: 20 },
  { code: 'room-service', otaCode: null, nameEn: 'Room service', category: 'SERVICES', sortOrder: 30 },
] as const;

/**
 * Which amenities each room type has, matching the specs in the mockups —
 * the Cove Suite's terrace and soaking tub, the Studio's walk-in shower.
 */
const ROOM_TYPE_AMENITIES: Record<string, string[]> = {
  'studio-room': [
    'air-conditioning', 'safe', 'minibar', 'coffee-tea-maker', 'desk',
    'blackout-curtains', 'television', 'wifi', 'telephone', 'hairdryer',
    'rain-shower', 'iron', 'housekeeping-daily',
  ],
  'terrace-room': [
    'air-conditioning', 'safe', 'minibar', 'coffee-tea-maker', 'desk',
    'balcony', 'blackout-curtains', 'television', 'wifi', 'telephone',
    'hairdryer', 'bathrobe', 'rain-shower', 'iron', 'housekeeping-daily',
    'room-service',
  ],
  'corner-suite': [
    'air-conditioning', 'safe', 'minibar', 'coffee-tea-maker', 'desk',
    'soundproofed', 'blackout-curtains', 'television', 'wifi', 'telephone',
    'hairdryer', 'bathrobe', 'slippers', 'soaking-tub', 'rain-shower',
    'iron', 'housekeeping-daily', 'room-service',
  ],
  'cove-suite': [
    'air-conditioning', 'safe', 'minibar', 'coffee-tea-maker', 'desk',
    'balcony', 'soundproofed', 'blackout-curtains', 'television', 'wifi',
    'telephone', 'hairdryer', 'bathrobe', 'slippers', 'soaking-tub',
    'rain-shower', 'iron', 'housekeeping-daily', 'room-service',
  ],
};

async function seedAmenities() {
  for (const amenity of AMENITIES) {
    await prisma.amenity.upsert({
      where: { code: amenity.code },
      // Never overwrite copy the hotel has edited in the admin panel; only
      // refresh the structural fields, exactly as room types are treated.
      update: {
        otaCode: amenity.otaCode,
        category: amenity.category,
        sortOrder: amenity.sortOrder,
      },
      create: {
        code: amenity.code,
        otaCode: amenity.otaCode,
        nameEn: amenity.nameEn,
        // Placeholder, visibly untranslated — the client supplies the Arabic.
        nameAr: amenity.nameEn,
        category: amenity.category,
        sortOrder: amenity.sortOrder,
      },
    });
  }
}

/**
 * Attach amenities to room types.
 *
 * `skipDuplicates` rather than a delete-and-recreate: re-running the seed must
 * not strip an amenity the hotel added to a room in the admin panel.
 */
async function seedRoomTypeAmenities() {
  for (const [roomTypeCode, amenityCodes] of Object.entries(
    ROOM_TYPE_AMENITIES,
  )) {
    const roomType = await prisma.roomType.findUnique({
      where: { code: roomTypeCode },
    });
    if (!roomType) continue;

    const amenities = await prisma.amenity.findMany({
      where: { code: { in: amenityCodes } },
    });

    await prisma.roomTypeAmenity.createMany({
      data: amenities.map((amenity) => ({
        roomTypeId: roomType.id,
        amenityId: amenity.id,
      })),
      skipDuplicates: true,
    });
  }
}

async function seedRoomTypesAndRates() {
  for (const room of ROOM_TYPES) {
    const roomType = await prisma.roomType.upsert({
      where: { code: room.code },
      // Re-running must not silently revert edits the hotel made in the admin
      // panel, so an existing row keeps its copy and rates. Only the fields
      // that are structurally ours are refreshed.
      update: {
        imageKey: room.imageKey,
        sortOrder: room.sortOrder,
      },
      create: {
        code: room.code,
        nameEn: room.nameEn,
        nameAr: room.nameEn,
        categoryEn: room.categoryEn,
        categoryAr: room.categoryEn,
        descriptionEn: room.descriptionEn,
        descriptionAr: room.descriptionEn,
        baseRateAed: new Prisma.Decimal(room.baseRateAed),
        maxOccupancy: room.maxOccupancy,
        totalRooms: room.totalRooms,
        imageKey: room.imageKey,
        sortOrder: room.sortOrder,
      },
    });

    // The always-applicable default plan. Seasonal plans are added by the hotel
    // later, with a higher priority and a date window.
    const existingDefault = await prisma.ratePlan.findFirst({
      where: { roomTypeId: roomType.id, startDate: null, endDate: null },
    });

    if (!existingDefault) {
      await prisma.ratePlan.create({
        data: {
          roomTypeId: roomType.id,
          nameEn: 'Standard Rate',
          nameAr: 'Standard Rate',
          nightlyRateAed: new Prisma.Decimal(room.baseRateAed),
          minimumStayNights: 1,
          priority: 0,
        },
      });
    }
  }
}

async function seedInventory() {
  const roomTypes = await prisma.roomType.findMany();

  for (const roomType of roomTypes) {
    const rows: Prisma.RoomTypeInventoryCreateManyInput[] = [];

    for (let offset = 0; offset < INVENTORY_HORIZON_DAYS; offset += 1) {
      rows.push({
        roomTypeId: roomType.id,
        date: utcDateFromToday(offset),
        totalRooms: roomType.totalRooms,
      });
    }

    // skipDuplicates makes this idempotent against the (roomTypeId, date)
    // unique constraint: dates already open keep their bookedRooms count, and
    // only newly-reachable dates at the far end of the horizon are added.
    await prisma.roomTypeInventory.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }
}

async function seedSettings() {
  for (const setting of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      // Never overwrite a value the hotel has tuned; only refresh the
      // explanatory text.
      update: { description: setting.description },
      create: setting,
    });
  }
}

async function seedAdminUser() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@covedubai.local';
  const password = process.env.SEED_ADMIN_PASSWORD;

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`  admin user ${email} already exists — left untouched`);
    return;
  }

  if (!password) {
    console.log(
      '  no SEED_ADMIN_PASSWORD set — skipping admin user.\n' +
        '  Create one with: SEED_ADMIN_PASSWORD=... npm run seed',
    );
    return;
  }

  await prisma.adminUser.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      name: 'Cove Dubai Admin',
      role: 'ADMIN',
    },
  });
  console.log(`  created admin user ${email}`);
}

async function main() {
  console.log('Seeding Cove Dubai...');

  console.log('- room types and rate plans');
  await seedRoomTypesAndRates();

  console.log('- amenities');
  await seedAmenities();
  await seedRoomTypeAmenities();

  console.log(`- inventory (${INVENTORY_HORIZON_DAYS} days ahead)`);
  await seedInventory();

  console.log('- settings');
  await seedSettings();

  console.log('- admin user');
  await seedAdminUser();

  const [types, inventory, settings, amenities] = await Promise.all([
    prisma.roomType.count(),
    prisma.roomTypeInventory.count(),
    prisma.setting.count(),
    prisma.amenity.count(),
  ]);
  const totalRooms = (await prisma.roomType.findMany()).reduce(
    (sum, r) => sum + r.totalRooms,
    0,
  );

  console.log(
    `\nDone. ${types} room types (${totalRooms} rooms), ` +
      `${inventory} inventory rows, ${amenities} amenities, ${settings} settings.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
