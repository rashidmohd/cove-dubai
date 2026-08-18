/**
 * Admin endpoints.
 *
 * Same discipline as the guest routes: validate, call the provider, shape the
 * response. Reservations, rooms, inventory, and pricing settings all go
 * through the `BookingProvider` — a future PMS owns exactly this data, so an
 * admin route reaching into Prisma would mean rebuilding the admin panel in
 * Phase 2 as well as the booking flow (`pms-readiness`).
 *
 * The two things this file *does* read from Prisma directly are the audit log
 * and admin accounts. Neither is reservation data and no PMS would own them,
 * so they sit outside the seam by design.
 *
 * Everything here is mounted behind `requireAdmin` and `requireCsrfToken` in
 * one place at the bottom of the file, so a new route cannot be added without
 * authentication by forgetting a middleware argument.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { auditContextOf, recordAudit } from '../auth/audit.js';
import { getBookingProvider } from '../booking/index.js';
import { today } from '../booking/dates.js';
import { sendCancellationConfirmation } from '../emails/index.js';
import { prisma } from '../db/prisma.js';
import { currentAdmin, requireAdmin, requireRole } from '../middleware/auth.js';
import { requireCsrfToken } from '../middleware/csrf.js';
import { asyncRoute, HttpError } from '../middleware/errors.js';
import {
  allowedContentTypes,
  createSignedUpload,
  isAllowedContentType,
} from '../media/storage.js';
import { mediaUploadsEnabled } from '../config.js';
import { BookingError } from '../booking/types.js';
import { bookingReferenceSchema } from './schemas.js';
import {
  auditLogFilterSchema,
  cancelReservationSchema,
  createAmenitySchema,
  createVoucherSchema,
  dateRangeSchema,
  dateSchema,
  modifyReservationSchema,
  reservationFilterSchema,
  addRoomTypeImageSchema,
  mediaUploadRequestSchema,
  reorderRoomTypeImagesSchema,
  setRoomTypeAmenitiesSchema,
  updateAmenitySchema,
  updateInventorySchema,
  updateRoomTypeSchema,
  updateSettingSchema,
  updateVoucherSchema,
} from './admin.schemas.js';

/**
 * A generous limit — this is an authenticated panel, not the open internet,
 * and the front desk works fast. It exists to bound a runaway client, not to
 * police staff.
 */
const adminRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const adminRouter = Router();

adminRouter.use(adminRateLimit);
adminRouter.use(requireAdmin);
adminRouter.use(requireCsrfToken);

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

adminRouter.get(
  '/reservations',
  asyncRoute(async (req, res) => {
    const filter = reservationFilterSchema.parse(req.query);
    res.json(await getBookingProvider().listReservations(filter));
  }),
);

adminRouter.get(
  '/reservations/:reference',
  asyncRoute(async (req, res) => {
    const reference = bookingReferenceSchema.parse(req.params.reference);
    const reservation = await getBookingProvider().getReservation(reference);

    if (!reservation) {
      throw new HttpError(
        404,
        'RESERVATION_NOT_FOUND',
        'No reservation with that reference.',
      );
    }
    res.json({ reservation });
  }),
);

adminRouter.patch(
  '/reservations/:reference',
  asyncRoute(async (req, res) => {
    const reference = bookingReferenceSchema.parse(req.params.reference);
    const changes = modifyReservationSchema.parse(req.body);

    const before = await getBookingProvider().getReservation(reference);
    const reservation = await getBookingProvider().modifyReservation(
      reference,
      changes,
    );

    await recordAudit({
      ...auditContextOf(req),
      action: 'reservation.modify',
      entityType: 'reservation',
      entityId: reference,
      // Before and after, so the log answers "what changed" rather than only
      // "something changed".
      details: { before: before?.stay ?? null, after: reservation.stay },
    });

    res.json({ reservation });
  }),
);

/**
 * Cancel on the guest's behalf.
 *
 * No cancellation token: the admin is already authenticated, and a guest
 * ringing the front desk will not have their emailed link to hand.
 */
adminRouter.post(
  '/reservations/:reference/cancel',
  asyncRoute(async (req, res) => {
    const reference = bookingReferenceSchema.parse(req.params.reference);
    const { reason } = cancelReservationSchema.parse(req.body);

    // Built conditionally rather than passing `{ reason }` directly:
    // `exactOptionalPropertyTypes` is on, so a present-but-undefined key is
    // not the same as an absent one.
    const reservation = await getBookingProvider().cancelReservation(
      reference,
      reason ? { reason } : {},
    );

    await recordAudit({
      ...auditContextOf(req),
      action: 'reservation.cancel',
      entityType: 'reservation',
      entityId: reference,
      details: { reason: reason ?? null, cancelledBy: 'admin' },
    });

    res.json({ reservation });

    // The guest did not initiate this, so telling them matters more here than
    // when they cancel it themselves.
    void sendCancellationConfirmation(reservation);
  }),
);

adminRouter.post(
  '/reservations/:reference/check-in',
  asyncRoute(async (req, res) => {
    const reference = bookingReferenceSchema.parse(req.params.reference);
    const reservation = await getBookingProvider().setReservationStatus(
      reference,
      'checked-in',
    );

    await recordAudit({
      ...auditContextOf(req),
      action: 'reservation.check_in',
      entityType: 'reservation',
      entityId: reference,
    });

    res.json({ reservation });
  }),
);

adminRouter.post(
  '/reservations/:reference/check-out',
  asyncRoute(async (req, res) => {
    const reference = bookingReferenceSchema.parse(req.params.reference);
    const reservation = await getBookingProvider().setReservationStatus(
      reference,
      'checked-out',
    );

    await recordAudit({
      ...auditContextOf(req),
      action: 'reservation.check_out',
      entityType: 'reservation',
      entityId: reference,
    });

    res.json({ reservation });
  }),
);

// ---------------------------------------------------------------------------
// Room types
// ---------------------------------------------------------------------------

adminRouter.get(
  '/room-types',
  asyncRoute(async (_req, res) => {
    res.json({ roomTypes: await getBookingProvider().listRoomTypes() });
  }),
);

/**
 * Editing a room type changes published prices and public copy, so it is
 * ADMIN-only. Front-desk staff work with reservations, not the rate card.
 */
adminRouter.patch(
  '/room-types/:code',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    const changes = updateRoomTypeSchema.parse(req.body);

    const roomType = await getBookingProvider().updateRoomType(code, changes);

    await recordAudit({
      ...auditContextOf(req),
      action: 'room_type.update',
      entityType: 'room_type',
      entityId: code,
      details: { changed: Object.keys(changes) },
    });

    res.json({ roomType });
  }),
);

// ---------------------------------------------------------------------------
// Amenities
// ---------------------------------------------------------------------------

adminRouter.get(
  '/amenities',
  asyncRoute(async (_req, res) => {
    res.json({ amenities: await getBookingProvider().listAmenities() });
  }),
);

/**
 * The amenity vocabulary is ADMIN-only to change.
 *
 * It is shared across every room type — renaming one rewrites published copy
 * on several rooms at once, which is a pricing-adjacent decision rather than a
 * front-desk one.
 */
adminRouter.post(
  '/amenities',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const draft = createAmenitySchema.parse(req.body);
    const amenity = await getBookingProvider().createAmenity(draft);

    await recordAudit({
      ...auditContextOf(req),
      action: 'amenity.create',
      entityType: 'amenity',
      entityId: amenity.code,
      details: { otaCode: amenity.otaCode, category: amenity.category },
    });

    res.status(201).json({ amenity });
  }),
);

adminRouter.patch(
  '/amenities/:code',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    const changes = updateAmenitySchema.parse(req.body);

    const amenity = await getBookingProvider().updateAmenity(code, changes);

    await recordAudit({
      ...auditContextOf(req),
      action: 'amenity.update',
      entityType: 'amenity',
      entityId: code,
      details: { changed: Object.keys(changes) },
    });

    res.json({ amenity });
  }),
);

adminRouter.delete(
  '/amenities/:code',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    await getBookingProvider().deleteAmenity(code);

    await recordAudit({
      ...auditContextOf(req),
      action: 'amenity.delete',
      entityType: 'amenity',
      entityId: code,
    });

    res.json({ ok: true });
  }),
);

/** Replace which amenities a room type lists. */
adminRouter.put(
  '/room-types/:code/amenities',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    const { amenityCodes } = setRoomTypeAmenitiesSchema.parse(req.body);

    const roomType = await getBookingProvider().setRoomTypeAmenities(
      code,
      amenityCodes,
    );

    await recordAudit({
      ...auditContextOf(req),
      action: 'room_type.set_amenities',
      entityType: 'room_type',
      entityId: code,
      details: { amenityCodes },
    });

    res.json({ roomType });
  }),
);


// ---------------------------------------------------------------------------
// Room type photography
//
// Uploads go straight from the browser to object storage against a presigned
// URL; the file never passes through this service. These two endpoints are the
// bookends: sign, then confirm.
// ---------------------------------------------------------------------------

/**
 * Sign a one-shot upload.
 *
 * Nothing is written here — a signature is not a promise that the upload will
 * happen. The row appears only when the browser confirms, below, so a transfer
 * that fails halfway leaves no half-image in the gallery.
 */
adminRouter.post(
  '/media/uploads',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    if (!mediaUploadsEnabled) {
      throw new BookingError(
        'MEDIA_NOT_CONFIGURED',
        'Image uploads are not configured on this environment.',
      );
    }

    const request = mediaUploadRequestSchema.parse(req.body);

    if (!isAllowedContentType(request.contentType)) {
      throw new BookingError(
        'MEDIA_NOT_FOUND',
        `Unsupported image type. Allowed: ${allowedContentTypes.join(', ')}.`,
      );
    }

    const upload = await createSignedUpload({
      contentType: request.contentType,
      byteSize: request.byteSize,
    });

    // Not audited. Signing grants nothing on its own and writes nothing; the
    // attach below is the action worth a record, and auditing both would put
    // two rows in the log for every photograph.
    res.json(upload);
  }),
);

/** Confirm an upload landed, and attach it to a room type. */
adminRouter.post(
  '/room-types/:code/images',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    const draft = addRoomTypeImageSchema.parse(req.body);

    if (!isAllowedContentType(draft.contentType)) {
      throw new BookingError(
        'MEDIA_NOT_FOUND',
        `Unsupported image type. Allowed: ${allowedContentTypes.join(', ')}.`,
      );
    }

    const roomType = await getBookingProvider().addRoomTypeImage(code, draft);

    await recordAudit({
      ...auditContextOf(req),
      action: 'room_type.add_image',
      entityType: 'room_type',
      entityId: code,
      details: { storageKey: draft.storageKey },
    });

    res.status(201).json({ roomType });
  }),
);

/** Detach a photograph and delete its bytes. */
adminRouter.delete(
  '/room-types/:code/images/:storageKey(*)',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    // The key contains slashes (`room-types/<uuid>.webp`), hence the wildcard
    // parameter above and the decode here.
    const storageKey = decodeURIComponent(String(req.params.storageKey));

    const roomType = await getBookingProvider().removeRoomTypeImage(
      code,
      storageKey,
    );

    await recordAudit({
      ...auditContextOf(req),
      action: 'room_type.remove_image',
      entityType: 'room_type',
      entityId: code,
      details: { storageKey },
    });

    res.json({ roomType });
  }),
);

/** Reorder the gallery. The first key becomes the primary image. */
adminRouter.put(
  '/room-types/:code/images',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    const { storageKeys } = reorderRoomTypeImagesSchema.parse(req.body);

    const roomType = await getBookingProvider().reorderRoomTypeImages(
      code,
      storageKeys,
    );

    await recordAudit({
      ...auditContextOf(req),
      action: 'room_type.reorder_images',
      entityType: 'room_type',
      entityId: code,
      details: { storageKeys },
    });

    res.json({ roomType });
  }),
);

// ---------------------------------------------------------------------------
// Availability calendar
// ---------------------------------------------------------------------------

adminRouter.get(
  '/room-types/:code/inventory',
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    const { from, to } = dateRangeSchema.parse(req.query);

    res.json(
      await getBookingProvider().getInventoryCalendar({
        roomTypeCode: code,
        from,
        to,
      }),
    );
  }),
);

adminRouter.patch(
  '/room-types/:code/inventory',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    const { from, to, ...changes } = updateInventorySchema.parse(req.body);

    const calendar = await getBookingProvider().updateInventory({
      roomTypeCode: code,
      from,
      to,
      changes,
    });

    await recordAudit({
      ...auditContextOf(req),
      action: 'inventory.update',
      entityType: 'room_type_inventory',
      entityId: code,
      details: { from, to, ...changes },
    });

    res.json(calendar);
  }),
);

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

/**
 * Reading the list is open to STAFF: the front desk fields "is my code still
 * valid" on the phone. Creating and changing them moves money, so those are
 * ADMIN-only like every other pricing control.
 */
adminRouter.get(
  '/vouchers',
  asyncRoute(async (_req, res) => {
    res.json({ vouchers: await getBookingProvider().listVouchers() });
  }),
);

adminRouter.post(
  '/vouchers',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const draft = createVoucherSchema.parse(req.body);
    const voucher = await getBookingProvider().createVoucher(draft);

    await recordAudit({
      ...auditContextOf(req),
      action: 'voucher.create',
      entityType: 'voucher',
      entityId: voucher.code,
      details: {
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        maxRedemptions: voucher.maxRedemptions,
        validFrom: voucher.validFrom,
        validTo: voucher.validTo,
      },
    });

    res.status(201).json({ voucher });
  }),
);

adminRouter.patch(
  '/vouchers/:code',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    const changes = updateVoucherSchema.parse(req.body);

    const before = (await getBookingProvider().listVouchers()).find(
      (voucher) => voucher.code === code.toUpperCase(),
    );

    const voucher = await getBookingProvider().updateVoucher(code, changes);

    await recordAudit({
      ...auditContextOf(req),
      action: 'voucher.update',
      entityType: 'voucher',
      entityId: voucher.code,
      // Discount changes are worth their before and after in full: this is the
      // one edit here that alters what future guests pay.
      details: {
        changed: Object.keys(changes),
        ...(changes.discountValue !== undefined
          ? {
              discountFrom: before?.discountValue ?? null,
              discountTo: voucher.discountValue,
            }
          : {}),
      },
    });

    res.json({ voucher });
  }),
);

adminRouter.delete(
  '/vouchers/:code',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const code = String(req.params.code);
    await getBookingProvider().deleteVoucher(code);

    await recordAudit({
      ...auditContextOf(req),
      action: 'voucher.delete',
      entityType: 'voucher',
      entityId: code.toUpperCase(),
    });

    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

adminRouter.get(
  '/reports/occupancy',
  asyncRoute(async (req, res) => {
    const { from, to } = dateRangeSchema.parse(req.query);
    res.json(await getBookingProvider().getOccupancyReport({ from, to }));
  }),
);

adminRouter.get(
  '/reports/arrivals-departures',
  asyncRoute(async (req, res) => {
    // Defaults to today, which is what the front desk wants on open.
    const { date } = dateSchema.parse({ date: req.query.date ?? today() });
    res.json({
      date,
      ...(await getBookingProvider().getArrivalsAndDepartures(date)),
    });
  }),
);

// ---------------------------------------------------------------------------
// Operational settings
// ---------------------------------------------------------------------------

adminRouter.get(
  '/settings',
  asyncRoute(async (_req, res) => {
    res.json({ settings: await getBookingProvider().listSettings() });
  }),
);

/**
 * Change a setting — the Tourism Dirham amount above all.
 *
 * ADMIN-only and audited with both the old and new value, because this moves
 * what every future guest is quoted. Existing reservations keep the price they
 * were given; their breakdown was snapshotted at booking time.
 */
adminRouter.patch(
  '/settings/:key',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const key = String(req.params.key);
    const { value } = updateSettingSchema.parse(req.body);

    const before = (await getBookingProvider().listSettings()).find(
      (setting) => setting.key === key,
    );

    const setting = await getBookingProvider().updateSetting(key, value);

    await recordAudit({
      ...auditContextOf(req),
      action: 'setting.update',
      entityType: 'setting',
      entityId: key,
      details: { from: before?.value ?? null, to: value },
    });

    res.json({ setting });
  }),
);

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Read the audit trail. ADMIN-only — it records who did what, and that is not
 * ordinary front-desk reading.
 *
 * Read directly from Prisma rather than through the provider: the audit log is
 * ours, not reservation data, and a PMS would never own it.
 */
adminRouter.get(
  '/audit-log',
  requireRole('ADMIN'),
  asyncRoute(async (req, res) => {
    const filter = auditLogFilterSchema.parse(req.query);

    const where = {
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
    };

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
        skip: filter.offset,
        include: { adminUser: { select: { email: true, name: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      total,
      entries: entries.map((entry) => ({
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        details: entry.details,
        ipAddress: entry.ipAddress,
        createdAt: entry.createdAt.toISOString(),
        admin: entry.adminUser
          ? { email: entry.adminUser.email, name: entry.adminUser.name }
          : null,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Everything the landing screen needs, in one request rather than four. */
adminRouter.get(
  '/dashboard',
  asyncRoute(async (req, res) => {
    const provider = getBookingProvider();
    const date = today();

    const [movements, occupancy, recent] = await Promise.all([
      provider.getArrivalsAndDepartures(date),
      provider.getOccupancyReport({ from: date, to: date }),
      provider.listReservations({ limit: 5, offset: 0 }),
    ]);

    const admin = currentAdmin(req);

    res.json({
      date,
      // Name, role, email — never `admin.id`. No internal row id crosses the
      // HTTP boundary, and the panel has no use for one.
      admin: { email: admin.email, name: admin.name, role: admin.role },
      arrivals: movements.arrivals,
      departures: movements.departures,
      occupancyToday: occupancy.days[0] ?? null,
      recentReservations: recent.reservations,
      totalReservations: recent.total,
    });
  }),
);
