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
import type { GuestAccount } from '@prisma/client';

import {
  accountExistsEmail,
  cancellationEmail,
  confirmationEmail,
  hotelCancellationEmail,
  hotelNotificationEmail,
  passwordResetEmail,
  verificationEmail,
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
    const [token, cancellationHours] = await Promise.all([
      getBookingProvider().getCancellationToken(reservation.reference),
      readCancellationHours(),
    ]);

    await Promise.all([
      // Without a token there is no safe link to include. Sending the
      // confirmation anyway is right — the guest still needs their reference —
      // but it is worth knowing about.
      token
        ? sendGuest(
            reservation,
            confirmationEmail({ reservation, cancellationToken: token, cancellationHours }),
          )
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
    // The hotel hears of it too: a cancelled arrival is a room the front desk
    // should stop preparing.
    await Promise.all([
      sendGuest(reservation, cancellationEmail(reservation)),
      sendEmail({
        to: config.emailHotelNotificationAddress,
        ...hotelCancellationEmail(reservation),
      }),
    ]);
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

/**
 * The free-cancellation window from settings, so the email states the policy
 * the hotel has actually set. Unreadable or missing, the line is left out of
 * the email rather than stating a number nobody chose.
 */
async function readCancellationHours(): Promise<number | undefined> {
  try {
    const settings = await getBookingProvider().listSettings();
    const raw = settings.find((setting) => setting.key === 'cancellation_policy_hours')?.value;
    const hours = raw === undefined ? NaN : Number(raw);
    return Number.isInteger(hours) && hours >= 0 ? hours : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Guest accounts
//
// Same rule as the booking emails: sent after the response, never thrown. A
// guest who does not receive one can ask again from the page.
// ---------------------------------------------------------------------------

type AccountRecipient = Pick<GuestAccount, 'email' | 'firstName' | 'preferredLocale'>;

function localeOf(account: AccountRecipient) {
  return account.preferredLocale === 'AR' ? 'ar' : 'en';
}

export async function sendVerificationEmail(
  account: AccountRecipient,
  token: string,
): Promise<void> {
  await sendEmail({
    to: account.email,
    ...verificationEmail({ firstName: account.firstName, locale: localeOf(account), token }),
  });
}

export async function sendPasswordResetEmail(
  account: AccountRecipient,
  token: string,
): Promise<void> {
  await sendEmail({
    to: account.email,
    ...passwordResetEmail({ locale: localeOf(account), token }),
  });
}

export async function sendAccountExistsEmail(
  account: AccountRecipient,
  token: string,
): Promise<void> {
  await sendEmail({
    to: account.email,
    ...accountExistsEmail({ firstName: account.firstName, locale: localeOf(account), token }),
  });
}
