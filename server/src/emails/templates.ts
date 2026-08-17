/**
 * Bilingual transactional email.
 *
 * Copy lives here rather than in the web app's message files: these are sent by
 * the API, which has no access to next-intl, and an email that renders in the
 * wrong language because a translation lookup failed is worse than one written
 * plainly in both.
 *
 * Rules these templates follow:
 *
 *   - **Table layout and inline styles.** Email clients are not browsers —
 *     Outlook has no flexbox or grid, and most clients strip `<style>` blocks.
 *     This is the one place in the project where inline styles are correct.
 *   - **Arabic is genuinely RTL**, via `dir="rtl"` on the document and
 *     `text-align: right`, not a mirrored English layout (`arabic-rtl`).
 *   - **Every email has a plain-text part.** Some clients show it, spam filters
 *     read it, and the cancellation link must be reachable without HTML.
 *   - **Money and dates are formatted for the guest's locale**, with Western
 *     digits, matching `web/lib/format.ts`.
 *   - **Colours come from the design tokens**, hardcoded because an email
 *     cannot read a CSS custom property.
 */
import type { Locale, PriceBreakdown, Reservation } from '../booking/types.js';
import { config } from '../config.js';

/** The design tokens, inlined — an email cannot resolve `var(--gold)`. */
const INK = '#1c1410';
const FOG = '#7a6e62';
const GOLD = '#c49a52';
const DARK = '#180e06';
const LINEN = '#f2ebd9';
const PAPER = '#fef9f2';

interface Copy {
  subjectConfirmed: (reference: string) => string;
  subjectCancelled: (reference: string) => string;
  subjectHotel: (reference: string) => string;
  greeting: (name: string) => string;
  confirmedIntro: string;
  cancelledIntro: string;
  reference: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: string;
  guests: string;
  rooms: string;
  roomTotal: string;
  tourismDirham: string;
  vat: string;
  total: string;
  payAtCheckIn: string;
  cancelHeading: string;
  cancelBody: string;
  cancelLink: string;
  questions: string;
  signOff: string;
  hotelName: string;
  address: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    subjectConfirmed: (reference) => `Your reservation is confirmed — ${reference}`,
    subjectCancelled: (reference) => `Your reservation has been cancelled — ${reference}`,
    subjectHotel: (reference) => `New booking — ${reference}`,
    greeting: (name) => `Dear ${name},`,
    confirmedIntro:
      'Thank you for choosing Cove Dubai. Your reservation is confirmed and we look forward to welcoming you.',
    cancelledIntro:
      'Your reservation has been cancelled. No payment was taken, and nothing further is required from you.',
    reference: 'Booking reference',
    roomType: 'Room',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    nights: 'Nights',
    guests: 'Guests',
    rooms: 'Rooms',
    roomTotal: 'Accommodation',
    tourismDirham: 'Tourism Dirham',
    vat: 'VAT',
    total: 'Total',
    payAtCheckIn:
      'No payment has been taken. Settlement is on arrival, at the hotel.',
    cancelHeading: 'Need to cancel?',
    cancelBody:
      'Use the secure link below. It works once, and only for this booking.',
    cancelLink: 'Cancel this reservation',
    questions: 'Any questions, simply reply to this email.',
    signOff: 'With warm regards,',
    hotelName: 'Cove Dubai',
    address: 'Al Rigga, Deira, Dubai',
  },
  // Placeholder copy, in English, exactly as `messages/ar.json` holds English
  // for its untranslated keys. The client supplies the Arabic; the layout and
  // direction below are already correct for it (`arabic-rtl`).
  ar: {
    subjectConfirmed: (reference) => `Your reservation is confirmed — ${reference}`,
    subjectCancelled: (reference) => `Your reservation has been cancelled — ${reference}`,
    subjectHotel: (reference) => `New booking — ${reference}`,
    greeting: (name) => `Dear ${name},`,
    confirmedIntro:
      'Thank you for choosing Cove Dubai. Your reservation is confirmed and we look forward to welcoming you.',
    cancelledIntro:
      'Your reservation has been cancelled. No payment was taken, and nothing further is required from you.',
    reference: 'Booking reference',
    roomType: 'Room',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    nights: 'Nights',
    guests: 'Guests',
    rooms: 'Rooms',
    roomTotal: 'Accommodation',
    tourismDirham: 'Tourism Dirham',
    vat: 'VAT',
    total: 'Total',
    payAtCheckIn:
      'No payment has been taken. Settlement is on arrival, at the hotel.',
    cancelHeading: 'Need to cancel?',
    cancelBody:
      'Use the secure link below. It works once, and only for this booking.',
    cancelLink: 'Cancel this reservation',
    questions: 'Any questions, simply reply to this email.',
    signOff: 'With warm regards,',
    hotelName: 'Cove Dubai',
    address: 'Al Rigga, Deira, Dubai',
  },
};

function intlLocale(locale: Locale): string {
  return locale === 'ar' ? 'ar-AE' : 'en-AE';
}

/** `12 Sep 2026`, Western digits, matching the site. */
function formatDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
    numberingSystem: 'latn',
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatMoney(amount: number, currency: string, locale: Locale): string {
  const formatted = new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
    numberingSystem: 'latn',
  }).format(amount);
  return `${currency} ${formatted}`;
}

/**
 * Escape text destined for HTML.
 *
 * Guest names and special requests are user input and go straight into the
 * message body. Without this, a name containing `<` breaks the layout at best.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The guest-facing cancellation link, keyed to the token from the booking. */
export function cancellationUrl(
  reference: string,
  token: string,
  locale: Locale,
): string {
  const base = config.webBaseUrl.replace(/\/$/, '');
  return `${base}/${locale}/cancel?reference=${encodeURIComponent(
    reference,
  )}&token=${encodeURIComponent(token)}`;
}

interface Row {
  label: string;
  value: string;
  strong?: boolean;
}

function summaryRows(reservation: Reservation, locale: Locale): Row[] {
  const copy = COPY[locale];
  const price: PriceBreakdown = reservation.price;

  return [
    { label: copy.reference, value: reservation.reference, strong: true },
    { label: copy.roomType, value: reservation.roomType.name[locale] },
    { label: copy.checkIn, value: formatDate(reservation.stay.checkIn, locale) },
    {
      label: copy.checkOut,
      value: formatDate(reservation.stay.checkOut, locale),
    },
    { label: copy.nights, value: String(price.nights) },
    {
      label: copy.guests,
      value: String(reservation.stay.adults + reservation.stay.children),
    },
    { label: copy.rooms, value: String(reservation.stay.roomsCount) },
  ];
}

function priceRows(reservation: Reservation, locale: Locale): Row[] {
  const copy = COPY[locale];
  const price = reservation.price;

  return [
    {
      label: copy.roomTotal,
      value: formatMoney(price.roomTotal, price.currency, locale),
    },
    {
      label: copy.tourismDirham,
      value: formatMoney(price.tourismDirham.total, price.currency, locale),
    },
    {
      label: `${copy.vat} (${price.vat.ratePercent}%)`,
      value: formatMoney(price.vat.total, price.currency, locale),
    },
    {
      label: copy.total,
      value: formatMoney(price.grandTotal, price.currency, locale),
      strong: true,
    },
  ];
}

function renderRows(rows: Row[], align: 'left' | 'right'): string {
  const opposite = align === 'left' ? 'right' : 'left';

  return rows
    .map(
      (row) => `
        <tr>
          <td style="padding:8px 0;color:${FOG};font-size:13px;text-align:${align};">
            ${escapeHtml(row.label)}
          </td>
          <td style="padding:8px 0;color:${INK};font-size:14px;text-align:${opposite};${
            row.strong ? 'font-weight:600;' : ''
          }">
            ${escapeHtml(row.value)}
          </td>
        </tr>`,
    )
    .join('');
}

function layout(args: {
  locale: Locale;
  title: string;
  body: string;
}): string {
  const rtl = args.locale === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const copy = COPY[args.locale];

  // Table-based and inline-styled on purpose — see the note at the top.
  return `<!doctype html>
<html lang="${args.locale}" dir="${dir}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(args.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${LINEN};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${LINEN};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${PAPER};border:1px solid rgba(196,154,82,0.35);">

            <tr>
              <td style="background:${DARK};padding:32px;text-align:center;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;letter-spacing:6px;color:${PAPER};">
                  COVE
                </div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:4px;color:${GOLD};margin-top:6px;">
                  DUBAI
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:32px;font-family:Arial,Helvetica,sans-serif;text-align:${align};" dir="${dir}">
                ${args.body}
              </td>
            </tr>

            <tr>
              <td style="padding:24px 32px;border-top:1px solid rgba(28,20,16,0.1);text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${FOG};line-height:1.7;">
                ${escapeHtml(copy.hotelName)}<br>
                ${escapeHtml(copy.address)}
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** The guest's confirmation, including their single-use cancellation link. */
export function confirmationEmail(args: {
  reservation: Reservation;
  cancellationToken: string;
}): RenderedEmail {
  const { reservation, cancellationToken } = args;
  const locale = reservation.guest.locale;
  const copy = COPY[locale];
  const align = locale === 'ar' ? 'right' : 'left';

  const guestName = `${reservation.guest.firstName} ${reservation.guest.lastName}`;
  const cancelUrl = cancellationUrl(
    reservation.reference,
    cancellationToken,
    locale,
  );

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${INK};">${escapeHtml(copy.greeting(guestName))}</p>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:${INK};">${escapeHtml(copy.confirmedIntro)}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(28,20,16,0.1);margin-bottom:8px;">
      ${renderRows(summaryRows(reservation, locale), align)}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(28,20,16,0.1);margin-bottom:24px;">
      ${renderRows(priceRows(reservation, locale), align)}
    </table>

    <p style="margin:0 0 24px;padding:12px;background:rgba(196,154,82,0.12);font-size:13px;line-height:1.6;color:${INK};">
      ${escapeHtml(copy.payAtCheckIn)}
    </p>

    <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${INK};">${escapeHtml(copy.cancelHeading)}</p>
    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${FOG};">${escapeHtml(copy.cancelBody)}</p>
    <p style="margin:0 0 24px;">
      <a href="${cancelUrl}" style="display:inline-block;padding:12px 24px;background:${GOLD};color:${DARK};text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;">
        ${escapeHtml(copy.cancelLink)}
      </a>
    </p>

    <p style="margin:0 0 4px;font-size:13px;color:${FOG};">${escapeHtml(copy.questions)}</p>
    <p style="margin:16px 0 0;font-size:14px;color:${INK};">${escapeHtml(copy.signOff)}<br>${escapeHtml(copy.hotelName)}</p>
  `;

  const text = [
    copy.greeting(guestName),
    '',
    copy.confirmedIntro,
    '',
    ...summaryRows(reservation, locale).map((row) => `${row.label}: ${row.value}`),
    '',
    ...priceRows(reservation, locale).map((row) => `${row.label}: ${row.value}`),
    '',
    copy.payAtCheckIn,
    '',
    `${copy.cancelHeading} ${copy.cancelBody}`,
    cancelUrl,
    '',
    copy.questions,
    '',
    copy.signOff,
    copy.hotelName,
    copy.address,
  ].join('\n');

  return {
    subject: copy.subjectConfirmed(reservation.reference),
    html: layout({
      locale,
      title: copy.subjectConfirmed(reservation.reference),
      body,
    }),
    text,
  };
}

export function cancellationEmail(reservation: Reservation): RenderedEmail {
  const locale = reservation.guest.locale;
  const copy = COPY[locale];
  const align = locale === 'ar' ? 'right' : 'left';
  const guestName = `${reservation.guest.firstName} ${reservation.guest.lastName}`;

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${INK};">${escapeHtml(copy.greeting(guestName))}</p>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:${INK};">${escapeHtml(copy.cancelledIntro)}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(28,20,16,0.1);margin-bottom:24px;">
      ${renderRows(summaryRows(reservation, locale), align)}
    </table>

    <p style="margin:0 0 4px;font-size:13px;color:${FOG};">${escapeHtml(copy.questions)}</p>
    <p style="margin:16px 0 0;font-size:14px;color:${INK};">${escapeHtml(copy.signOff)}<br>${escapeHtml(copy.hotelName)}</p>
  `;

  const text = [
    copy.greeting(guestName),
    '',
    copy.cancelledIntro,
    '',
    ...summaryRows(reservation, locale).map((row) => `${row.label}: ${row.value}`),
    '',
    copy.questions,
    '',
    copy.signOff,
    copy.hotelName,
  ].join('\n');

  return {
    subject: copy.subjectCancelled(reservation.reference),
    html: layout({
      locale,
      title: copy.subjectCancelled(reservation.reference),
      body,
    }),
    text,
  };
}

/**
 * The hotel's own copy of a new booking.
 *
 * Always in English regardless of the guest's language — this one is read by
 * staff, not by the guest, and it carries the contact details the front desk
 * needs rather than a price breakdown they already hold.
 */
export function hotelNotificationEmail(
  reservation: Reservation,
): RenderedEmail {
  const copy = COPY.en;
  const guestName = `${reservation.guest.firstName} ${reservation.guest.lastName}`;

  const rows: Row[] = [
    ...summaryRows(reservation, 'en'),
    { label: 'Guest', value: guestName },
    { label: 'Email', value: reservation.guest.email },
    { label: 'Phone', value: reservation.guest.phone },
    { label: 'Language', value: reservation.guest.locale === 'ar' ? 'Arabic' : 'English' },
    {
      label: 'Total',
      value: formatMoney(
        reservation.price.grandTotal,
        reservation.price.currency,
        'en',
      ),
      strong: true,
    },
  ];

  if (reservation.specialRequests) {
    rows.push({ label: 'Special requests', value: reservation.specialRequests });
  }

  const body = `
    <p style="margin:0 0 24px;font-size:15px;color:${INK};">A new reservation has been made on the website.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(28,20,16,0.1);">
      ${renderRows(rows, 'left')}
    </table>
  `;

  return {
    subject: copy.subjectHotel(reservation.reference),
    html: layout({
      locale: 'en',
      title: copy.subjectHotel(reservation.reference),
      body,
    }),
    text: [
      'A new reservation has been made on the website.',
      '',
      ...rows.map((row) => `${row.label}: ${row.value}`),
    ].join('\n'),
  };
}
