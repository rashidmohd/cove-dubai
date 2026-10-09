/**
 * Seed script — idempotent by design.
 *
 * It runs against a shared hosted database, so it must be safe to re-run at any
 * time: every write is an upsert or a skip-duplicates insert, and re-running
 * never duplicates a room type or resets a booking count.
 *
 * English copy is taken verbatim from the approved mockups in design/mockups/.
 * Arabic fields carry a DRAFT translation (27 Sep 2026), written so the client
 * could see the Arabic site; their Arabic copywriter reviews it before launch
 * (docs/project-status.md). As with English, an existing row keeps whatever the
 * hotel has since written in the admin panel.
 */
import { PrismaClient, Prisma } from '@prisma/client';

import { hashPassword } from '../src/auth/password.js';

const prisma = new PrismaClient();

/** How far ahead the booking calendar is open. */
const INVENTORY_HORIZON_DAYS = 550;

/**
 * The three room types the hotel sells: Deluxe King, Deluxe Twin and The Cove
 * Suite, matching the photography folders the client supplied (27 Sep 2026).
 *
 * The Cove Suite's copy and rate are from design/mockups/rooms.html. The two
 * Deluxe rooms have no mockup copy yet, so their descriptions describe only
 * what the renders show, and their rate, occupancy and room count are
 * PLACEHOLDERS for the client to confirm (docs/project-status.md). Room counts
 * total 106, matching the hotel described in CLAUDE.md.
 */
const ROOM_TYPES = [
  {
    code: 'deluxe-king-room',
    nameEn: 'Deluxe King Room',
    nameAr: 'غرفة ديلوكس بسرير كينغ',
    categoryEn: 'Deluxe',
    categoryAr: 'ديلوكس',
    descriptionEn:
      'A king bed, a lounge chair by the window and a walk-in wardrobe, in warm neutrals with a single note of colour.',
    descriptionAr:
      'سرير كينغ، وكرسي مريح بجانب النافذة، وغرفة ملابس، بألوان محايدة دافئة تتخللها لمسة لون واحدة.',
    baseRateAed: '1200.00',
    maxOccupancy: 2,
    maxAdults: 2,
    maxChildren: 1,
    baseOccupancy: 2,
    totalRooms: 49,
    imageKey: 'img-king',
    sortOrder: 1,
  },
  {
    code: 'deluxe-twin-room',
    nameEn: 'Deluxe Twin Room',
    nameAr: 'غرفة ديلوكس بسريرين منفصلين',
    categoryEn: 'Deluxe',
    categoryAr: 'ديلوكس',
    descriptionEn:
      'Two beds side by side, a vanity desk and a walk-in wardrobe, in soft olive and sand.',
    descriptionAr:
      'سريران متجاوران، ومكتب زينة، وغرفة ملابس، بدرجات الزيتوني الهادئ والرملي.',
    baseRateAed: '1200.00',
    maxOccupancy: 2,
    maxAdults: 2,
    maxChildren: 1,
    baseOccupancy: 2,
    totalRooms: 49,
    imageKey: 'img-twin',
    sortOrder: 2,
  },
  {
    code: 'cove-suite',
    nameEn: 'The Cove Suite',
    nameAr: 'جناح كوف',
    categoryEn: 'Signature',
    categoryAr: 'سيغنتشر',
    descriptionEn:
      'The largest room in the hotel. Two aspects, one terrace, and enough space to forget you are in a city.',
    descriptionAr:
      'أكبر غرفة في الفندق. واجهتان، وتراس واحد، ومساحة تكفي لتنسى أنك في مدينة.',
    baseRateAed: '2400.00',
    maxOccupancy: 4,
    maxAdults: 4,
    maxChildren: 3,
    baseOccupancy: 2,
    totalRooms: 8,
    imageKey: 'img-suite',
    sortOrder: 3,
  },
] as const;

/**
 * Room types the hotel no longer sells. They are deactivated rather than
 * deleted: a reservation made against one keeps its room type, and deleting
 * would cascade through its inventory and rate history.
 */
const RETIRED_ROOM_TYPE_CODES = ['studio-room', 'terrace-room', 'corner-suite'];

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
  // The hotel's age rules. Both are PLACEHOLDERS until the client
  // confirms them (docs/project-status.md); the API reads them on every
  // availability check, so changing one needs no deploy.
  {
    key: 'guests_adult_from_age',
    value: '12',
    description:
      'Age from which a child is counted as an adult for room capacity. PLACEHOLDER, confirm with the client.',
  },
  {
    key: 'guests_max_rooms_per_booking',
    value: '4',
    description:
      'Most rooms one online booking may take. A party needing more is a group, handled by the hotel directly.',
  },
  {
    key: 'guests_infant_up_to_age',
    value: '1',
    description:
      'Children this age or younger sleep in a cot and do not count toward room capacity. PLACEHOLDER, confirm with the client.',
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
  { code: 'bathrobe', otaCode: 10, nameEn: 'Bathrobe', nameAr: 'روب استحمام', category: 'BATHROOM', sortOrder: 10 },
  { code: 'slippers', otaCode: 228, nameEn: 'Slippers', nameAr: 'خُفّان', category: 'BATHROOM', sortOrder: 20 },
  { code: 'hairdryer', otaCode: 50, nameEn: 'Hairdryer', nameAr: 'مجفف شعر', category: 'BATHROOM', sortOrder: 30 },
  { code: 'rain-shower', otaCode: null, nameEn: 'Rain shower', nameAr: 'دش مطري', category: 'BATHROOM', sortOrder: 40 },
  { code: 'soaking-tub', otaCode: null, nameEn: 'Soaking tub', nameAr: 'حوض استحمام عميق', category: 'BATHROOM', sortOrder: 50 },

  // --- Comfort -------------------------------------------------------------
  { code: 'air-conditioning', otaCode: 2, nameEn: 'Air conditioning', nameAr: 'تكييف هواء', category: 'COMFORT', sortOrder: 10 },
  { code: 'minibar', otaCode: 69, nameEn: 'Minibar', nameAr: 'ميني بار', category: 'COMFORT', sortOrder: 20 },
  { code: 'coffee-tea-maker', otaCode: 19, nameEn: 'Coffee & tea maker', nameAr: 'آلة قهوة وشاي', category: 'COMFORT', sortOrder: 30 },
  { code: 'safe', otaCode: 92, nameEn: 'In-room safe', nameAr: 'خزنة داخل الغرفة', category: 'COMFORT', sortOrder: 40 },
  { code: 'desk', otaCode: 28, nameEn: 'Writing desk', nameAr: 'مكتب للكتابة', category: 'COMFORT', sortOrder: 50 },
  { code: 'balcony', otaCode: 5017, nameEn: 'Private balcony', nameAr: 'شرفة خاصة', category: 'COMFORT', sortOrder: 60 },
  { code: 'soundproofed', otaCode: 144, nameEn: 'Soundproofed', nameAr: 'عازل للصوت', category: 'COMFORT', sortOrder: 70 },
  { code: 'blackout-curtains', otaCode: null, nameEn: 'Blackout curtains', nameAr: 'ستائر معتمة', category: 'COMFORT', sortOrder: 80 },

  // --- Technology ----------------------------------------------------------
  { code: 'television', otaCode: 251, nameEn: 'Television', nameAr: 'تلفزيون', category: 'TECHNOLOGY', sortOrder: 10 },
  { code: 'wifi', otaCode: null, nameEn: 'High-speed Wi-Fi', nameAr: 'واي فاي عالي السرعة', category: 'TECHNOLOGY', sortOrder: 20 },
  { code: 'telephone', otaCode: 107, nameEn: 'Telephone', nameAr: 'هاتف', category: 'TECHNOLOGY', sortOrder: 30 },

  // --- Services ------------------------------------------------------------
  { code: 'iron', otaCode: 55, nameEn: 'Iron & board', nameAr: 'مكواة وطاولة كيّ', category: 'SERVICES', sortOrder: 10 },
  { code: 'housekeeping-daily', otaCode: null, nameEn: 'Daily housekeeping', nameAr: 'تنظيف يومي للغرفة', category: 'SERVICES', sortOrder: 20 },
  { code: 'room-service', otaCode: null, nameEn: 'Room service', nameAr: 'خدمة الغرف', category: 'SERVICES', sortOrder: 30 },
] as const;

/**
 * Which amenities each room type has. The Cove Suite's terrace and soaking
 * tub are from the mockups; the Deluxe rooms' list is what their renders show.
 */
const ROOM_TYPE_AMENITIES: Record<string, string[]> = {
  'deluxe-king-room': [
    'air-conditioning', 'safe', 'minibar', 'coffee-tea-maker', 'desk',
    'blackout-curtains', 'television', 'wifi', 'telephone', 'hairdryer',
    'bathrobe', 'rain-shower', 'iron', 'housekeeping-daily', 'room-service',
  ],
  'deluxe-twin-room': [
    'air-conditioning', 'safe', 'minibar', 'coffee-tea-maker', 'desk',
    'blackout-curtains', 'television', 'wifi', 'telephone', 'hairdryer',
    'bathrobe', 'rain-shower', 'iron', 'housekeeping-daily', 'room-service',
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
        // Draft Arabic (27 Sep 2026) for the client's translator to review.
        nameAr: amenity.nameAr,
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
    await prisma.roomType.upsert({
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
        nameAr: room.nameAr,
        categoryEn: room.categoryEn,
        categoryAr: room.categoryAr,
        descriptionEn: room.descriptionEn,
        descriptionAr: room.descriptionAr,
        baseRateAed: new Prisma.Decimal(room.baseRateAed),
        maxOccupancy: room.maxOccupancy,
        maxAdults: room.maxAdults,
        maxChildren: room.maxChildren,
        baseOccupancy: room.baseOccupancy,
        totalRooms: room.totalRooms,
        imageKey: room.imageKey,
        sortOrder: room.sortOrder,
      },
    });

    // No rate plans are seeded. A night no plan covers is priced at the base
    // rate above, so a room is sellable without one — and an always-on plan
    // copying the base rate would outrank it, leaving a base-rate edit in the
    // admin with no effect. Seasonal rates and offers are added in the panel.
  }
}

async function retireRoomTypes() {
  const { count } = await prisma.roomType.updateMany({
    where: { code: { in: RETIRED_ROOM_TYPE_CODES }, isActive: true },
    data: { isActive: false },
  });
  if (count > 0) console.log(`  deactivated ${count} retired room type(s)`);
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
  await retireRoomTypes();

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
    prisma.roomType.count({ where: { isActive: true } }),
    prisma.roomTypeInventory.count(),
    prisma.setting.count(),
    prisma.amenity.count(),
  ]);
  const totalRooms = (
    await prisma.roomType.findMany({ where: { isActive: true } })
  ).reduce(
    (sum, r) => sum + r.totalRooms,
    0,
  );

  console.log(
    `\nDone. ${types} active room types (${totalRooms} rooms), ` +
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
