/**
 * Send every transactional email, filled with sample data, to one address.
 *
 *   npm run email:test -- you@example.com
 *
 * For checking the real sending setup end to end: the Resend key, the sending
 * domain's DNS (SPF, DKIM), and how the messages look in real inboxes — Gmail,
 * Outlook, Apple Mail. Uses the same transport as live bookings, so without
 * `EMAIL_API_KEY` it prints the messages instead of sending them.
 *
 * Subjects are prefixed `[TEST]` so nobody mistakes a sample for a booking.
 */
import { config, emailSendingEnabled } from '../src/config.js';
import { sendEmail } from '../src/emails/transport.js';
import { renderSamples } from './email-samples.js';

async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to || !to.includes('@')) {
    console.error('Usage: npm run email:test -- you@example.com');
    process.exit(1);
  }

  console.log(
    emailSendingEnabled
      ? `Sending from ${config.emailFrom} to ${to}…`
      : 'EMAIL_API_KEY is not set — printing instead of sending.',
  );

  let failed = 0;
  for (const { name, email } of renderSamples()) {
    const result = await sendEmail({ to, ...email, subject: `[TEST] ${email.subject}` });
    if (emailSendingEnabled) {
      console.log(`${result.sent ? '✓' : '✗'} ${name}${result.error ? ` — ${result.error}` : ''}`);
    }
    if (emailSendingEnabled && !result.sent) failed += 1;
  }
  process.exit(failed > 0 ? 1 : 0);
}

void main();
