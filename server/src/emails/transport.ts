/**
 * How email actually leaves the building.
 *
 * Two transports behind one interface. Which one is used is decided by whether
 * `EMAIL_API_KEY` is set, so local development and CI log emails to the console
 * instead of sending them, and nobody needs a Resend key to work on the booking
 * flow. No code anywhere else branches on the environment.
 *
 * **Sending never throws.** A confirmation email that fails must not fail the
 * booking that produced it — the guest has a room either way, and the reference
 * is on screen in front of them. Failures are logged loudly and reported in the
 * return value so a caller who cares can react.
 */
import { Resend } from 'resend';

import { config, emailSendingEnabled } from '../config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Set for Arabic mail so clients that honour it lay the message out RTL. */
  replyTo?: string;
}

export interface SendResult {
  sent: boolean;
  /** Present when the send failed, for logging rather than for the guest. */
  error?: string;
}

let resend: Resend | undefined;

function client(): Resend {
  resend ??= new Resend(config.emailApiKey);
  return resend;
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  if (!emailSendingEnabled) {
    // The console transport. Prints enough to check the content and the
    // cancellation link during development, without the HTML noise.
    console.log(
      [
        '',
        '─── email (not sent — EMAIL_API_KEY is unset) ───',
        `to:      ${message.to}`,
        `from:    ${config.emailFrom}`,
        `subject: ${message.subject}`,
        '',
        message.text,
        '────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return { sent: false };
  }

  try {
    const { error } = await client().emails.send({
      from: config.emailFrom,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });

    if (error) {
      console.error('[cove-dubai/server] email rejected by provider:', {
        to: message.to,
        subject: message.subject,
        error,
      });
      return { sent: false, error: String(error.message ?? error) };
    }

    return { sent: true };
  } catch (caught) {
    // Network failure, bad key, provider outage. Never rethrown: the caller is
    // in the middle of confirming a booking that has already been committed.
    console.error('[cove-dubai/server] email failed to send:', {
      to: message.to,
      subject: message.subject,
      error: caught,
    });
    return {
      sent: false,
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}
