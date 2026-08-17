/**
 * When transactional email goes out.
 *
 * Called from the routes, deliberately **not** from inside the
 * `BookingProvider`. Sending a confirmation is not part of running a
 * reservation engine, and a PMS that takes over in Phase 2 will send its own —
 * at which point this becomes a deleted call at the route, rather than surgery
 * inside the booking layer (`pms-readiness`).
 *
 * Every function here is fire-and-forget and swallows its own failures. The
 * booking is already committed by the time any of them run; a mail provider
 * outage must not turn a successful stay into a 500.
 */
import { getBookingProvider } from '../booking/index.js';
import type { Reservation } from '../booking/types.js';
import { config } from '../config.js';
import {
  cancellationEmail,
  confirmationEmail,
  hotelNotificationEmail,
} from './templates.js';
import { sendEmail } from './transport.js';

/**
 * Confirmation to the guest, plus a copy to the hotel.
 *
 * Sent in parallel: neither depends on the other, and the front desk's copy
 * should not wait behind the guest's.
 */
export async function sendBookingConfirmation(
  reservation: Reservation,
): Promise<void> {
  try {
    const token = await getBookingProvider().getCancellationToken(
      reservation.reference,
    );

    await Promise.all([
      // Without a token there is no safe link to include. Sending the
      // confirmation anyway is right — the guest still needs their reference —
      // but it is worth knowing about.
      token
        ? sendGuest(reservation, confirmationEmail({ reservation, cancellationToken: token }))
        : logMissingToken(reservation),
      sendEmail({
        to: config.emailHotelNotificationAddress,
        ...hotelNotificationEmail(reservation),
      }),
    ]);
  } catch (error) {
    console.error('[cove-dubai/server] confirmation email failed:', {
      reference: reservation.reference,
      error,
    });
  }
}

export async function sendCancellationConfirmation(
  reservation: Reservation,
): Promise<void> {
  try {
    await sendGuest(reservation, cancellationEmail(reservation));
  } catch (error) {
    console.error('[cove-dubai/server] cancellation email failed:', {
      reference: reservation.reference,
      error,
    });
  }
}

function sendGuest(
  reservation: Reservation,
  rendered: { subject: string; html: string; text: string },
) {
  return sendEmail({
    to: reservation.guest.email,
    ...rendered,
    // Replies go to the hotel, so a guest answering the confirmation reaches
    // a human rather than an unattended sending address.
    replyTo: config.emailHotelNotificationAddress,
  });
}

async function logMissingToken(reservation: Reservation): Promise<void> {
  console.error(
    '[cove-dubai/server] no cancellation token for a new booking — ' +
      'the confirmation will have no cancellation link:',
    reservation.reference,
  );
}
