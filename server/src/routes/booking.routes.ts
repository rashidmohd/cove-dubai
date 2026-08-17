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

bookingRouter.get(
  '/rates',
  readRateLimit,
  asyncRoute(async (req, res) => {
    const query = rateQuerySchema.parse(req.query);
    res.json({ price: await getBookingProvider().getRate(query) });
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
