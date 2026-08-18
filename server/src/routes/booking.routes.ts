/**
 * Guest-facing booking endpoints.
 *
 * These routes are deliberately thin: validate the input, call the
 * `BookingProvider`, shape the response. No availability logic, no pricing, no
 * Prisma. All of that sits behind the seam so a future PMS can own it without
 * these handlers changing (`pms-readiness`).
 *
 * If a route in this file ever needs to import Prisma, the design has gone
 * wrong — the provider interface should grow a method instead.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { getBookingProvider } from '../booking/index.js';
import {
  sendBookingConfirmation,
  sendCancellationConfirmation,
} from '../emails/index.js';
import { asyncRoute, HttpError } from '../middleware/errors.js';
import {
  availabilityQuerySchema,
  bookingReferenceSchema,
  cancelReservationSchema,
  createReservationSchema,
  rateQuerySchema,
  voucherPreviewSchema,
} from './schemas.js';

/**
 * Rate limit on writes.
 *
 * Required by the baseline in CLAUDE.md. Beyond abuse, an unthrottled booking
 * endpoint lets someone exhaust real inventory with junk reservations, which
 * takes rooms off sale for genuine guests.
 */
const bookingRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many booking attempts. Please try again shortly.',
    },
  },
});

/** Looser limit for reads, which are cheap and used throughout the flow. */
const readRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const bookingRouter = Router();

bookingRouter.get(
  '/room-types',
  readRateLimit,
  asyncRoute(async (_req, res) => {
    res.json({ roomTypes: await getBookingProvider().getRoomTypes() });
  }),
);

bookingRouter.get(
  '/availability',
  readRateLimit,
  asyncRoute(async (req, res) => {
    const query = availabilityQuerySchema.parse(req.query);
    res.json({
      roomTypes: await getBookingProvider().checkAvailability(query),
    });
  }),
);

/**
 * The offers the hotel is advertising.
 *
 * Cacheable in the same way room types are — this changes when the hotel edits
 * a rate plan, not per request — but expiry is handled in the query rather than
 * by cache lifetime, so a stale cache can never advertise a finished offer for
 * longer than its revalidation window.
 */
bookingRouter.get(
  '/offers',
  readRateLimit,
  asyncRoute(async (_req, res) => {
    res.json({ offers: await getBookingProvider().listPublicOffers() });
  }),
);

bookingRouter.get(
  '/rates',
  readRateLimit,
  asyncRoute(async (req, res) => {
    const query = rateQuerySchema.parse(req.query);
    res.json({ price: await getBookingProvider().getRate(query) });
  }),
);

/**
 * What a discount code is worth for a stay, before committing to it.
 *
 * Read-only: it claims nothing. A code shown as valid here can still be
 * exhausted by the time the booking commits, exactly as availability can —
 * `createReservation` is the authority in both cases.
 *
 * Rate-limited on the write budget rather than the read one. It is a read, but
 * an unthrottled one is a free oracle for guessing codes.
 */
bookingRouter.post(
  '/vouchers/preview',
  bookingRateLimit,
  asyncRoute(async (req, res) => {
    const query = voucherPreviewSchema.parse(req.body);
    res.json({ preview: await getBookingProvider().previewVoucher(query) });
  }),
);

bookingRouter.post(
  '/reservations',
  bookingRateLimit,
  asyncRoute(async (req, res) => {
    const draft = createReservationSchema.parse(req.body);
    const reservation = await getBookingProvider().createReservation(draft);

    // Respond first, then send. The booking is already committed and the guest
    // has their reference on screen; making them wait on a mail provider — or
    // worse, showing them a failure because of one — would be wrong.
    res.status(201).json({ reservation });

    void sendBookingConfirmation(reservation);
  }),
);

/**
 * Look up a booking by its reference.
 *
 * The reference is the guest's own identifier, but it is not a secret strong
 * enough to authorise changes — so this returns the booking for display, while
 * cancelling additionally requires the token from the confirmation email.
 */
bookingRouter.get(
  '/reservations/:reference',
  readRateLimit,
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

/**
 * Guest self-cancellation, via the secure link in their confirmation email.
 *
 * The link is keyed to the cancellation token, never to an internal id, and the
 * token is single-use — cancelling clears it so the link cannot be replayed.
 */
bookingRouter.post(
  '/reservations/:reference/cancel',
  bookingRateLimit,
  asyncRoute(async (req, res) => {
    const reference = bookingReferenceSchema.parse(req.params.reference);
    const { token } = cancelReservationSchema.parse(req.body);

    const cancelled = await getBookingProvider().cancelReservation(reference, {
      guestToken: token,
    });

    res.json({ reservation: cancelled });

    void sendCancellationConfirmation(cancelled);
  }),
);
