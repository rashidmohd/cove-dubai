/**
 * Bilingual transactional email.
 *
 * Four messages: the guest's confirmation and cancellation, and the hotel's
 * notice of each. Copy lives here rather than in the web app's message files:
 * these are sent by the API, which has no access to next-intl, and an email
 * that renders in the wrong language because a translation lookup failed is
 * worse than one written plainly in both.
 *
 * Rules these templates follow:
 *
 *   - **Table layout and inline styles.** Email clients are not browsers —
 *     Outlook has no flexbox or grid, and most clients strip `<style>` blocks.
 *     This is the one place in the project where inline styles are correct.
 *   - **Arabic is genuinely RTL**, via `dir="rtl"` on the document and
 *     right-aligned cells, not a mirrored English layout — and without the
 *     tracked uppercase labels, which break Arabic letter joins (`arabic-rtl`).
 *   - **Every email has a plain-text part.** Some clients show it, spam filters
 *     read it, and the cancellation link must be reachable without HTML.
 *   - **The price lines add up to the total**, exactly as the reserve flow's
 *     summary did: room, extra guests, discount, Tourism Dirham, VAT.
 *   - **Money and dates are formatted for the guest's locale**, with Western
 *     digits, matching `web/lib/format.ts`.
 *   - **Colours come from the design tokens**, hardcoded because an email
 *     cannot read a CSS custom property. Web fonts are not loaded — most
 *     clients ignore them — so the brand serif falls back to Georgia, which is
 *     close in feel and installed everywhere.
 *   - **No images.** The brand mark is set in type. Images are blocked by
 *     default in many clients, and a confirmation must read completely without
 *     them.
 */
import type { Locale, PriceBreakdown, Reservation, Stay } from '../booking/types.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** The design tokens, inlined — an email cannot resolve `var(--gold)`. */
const INK = '#1c1410';
/** `--fog`: 5.11:1 on paper, so it is safe for small text. */
const FOG = '#74695d';
const GOLD = '#c49a52';
/** `--bronze`: the accent for small text on light grounds (5.27:1). */
const BRONZE = '#7d6540';
const DARK = '#180e06';
const LINEN = '#f2ebd9';
const PAPER = '#fef9f2';
const HAIRLINE = 'rgba(28,20,16,0.1)';

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = 'Helvetica,Arial,sans-serif';
/** Arabic: Tahoma renders Arabic well on Windows and Outlook; Arial elsewhere. */
const ARABIC = 'Tahoma,Arial,sans-serif';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

interface Copy {
  subjectConfirmed: (reference: string) => string;
  subjectCancelled: (reference: string) => string;
  preheaderConfirmed: (checkIn: string, room: string) => string;
  preheaderCancelled: (reference: string) => string;
  eyebrowConfirmed: string;
  eyebrowCancelled: string;
  headlineConfirmed: (firstName: string) => string;
  headlineCancelled: string;
  confirmedIntro: string;
  cancelledIntro: string;
  reference: string;
  checkIn: string;
  checkOut: string;
  room: string;
  guests: string;
  rooms: string;
  specialRequests: string;
  priceHeading: string;
  roomTotal: string;
  extraGuests: string;
  discount: string;
  tourismDirham: string;
  vat: string;
  total: string;
  payAtCheckIn: string;
  cancelHeading: string;
  cancelPolicy: (hours: number) => string;
  cancelBody: string;
  cancelLink: string;
  linkFallback: string;
  bookAgain: string;
  questions: string;
  questionsAfterCancel: string;
  signOff: string;
  hotelName: string;
  address: string;
  footerReason: string;
  nights: (count: number) => string;
  adults: (count: number) => string;
  children: (count: number) => string;
  childAges: (ages: number[]) => string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    subjectConfirmed: (reference) => `Your reservation is confirmed — ${reference}`,
    subjectCancelled: (reference) => `Your reservation has been cancelled — ${reference}`,
    preheaderConfirmed: (checkIn, room) =>
      `${room}, arriving ${checkIn}. No payment taken — you pay at check-in.`,
    preheaderCancelled: (reference) =>
      `Reservation ${reference} is cancelled. No payment was taken.`,
    eyebrowConfirmed: 'Reservation confirmed',
    eyebrowCancelled: 'Reservation cancelled',
    headlineConfirmed: (firstName) => `We look forward to welcoming you, ${firstName}.`,
    headlineCancelled: 'Your reservation has been cancelled.',
    confirmedIntro:
      'Thank you for choosing Cove Dubai. Your room is held for the dates below, and everything you need for your stay is in this email.',
    cancelledIntro:
      'As you asked, we have cancelled the reservation below. No payment was taken, and nothing further is required from you.',
    reference: 'Booking reference',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    room: 'Room',
    guests: 'Guests',
    rooms: 'Rooms',
    specialRequests: 'Your requests',
    priceHeading: 'Your stay',
    roomTotal: 'Accommodation',
    extraGuests: 'Extra guests',
    discount: 'Discount',
    tourismDirham: 'Tourism Dirham',
    vat: 'VAT',
    total: 'Total',
    payAtCheckIn: 'No payment has been taken. You pay at the hotel, on arrival.',
    cancelHeading: 'If your plans change',
    cancelPolicy: (hours) =>
      `You may cancel free of charge up to ${hours} hours before check-in.`,
    cancelBody: 'Use the secure link below. It works once, and only for this booking.',
    cancelLink: 'Cancel this reservation',
    linkFallback: 'If the button does not work, copy this address into your browser:',
    bookAgain: 'Plan another stay',
    questions:
      'Any questions before you arrive? Simply reply to this email and our team will answer.',
    questionsAfterCancel: 'Any questions? Simply reply to this email and our team will answer.',
    signOff: 'With warm regards,',
    hotelName: 'Cove Dubai',
    address: 'Al Rigga, Deira, Dubai, United Arab Emirates',
    footerReason:
      'You are receiving this email because a reservation was made at Cove Dubai with this address.',
    nights: (count) => (count === 1 ? '1 night' : `${count} nights`),
    adults: (count) => (count === 1 ? '1 adult' : `${count} adults`),
    children: (count) => (count === 1 ? '1 child' : `${count} children`),
    childAges: (ages) =>
      ages.length === 1
        ? `age ${ageLabel(ages[0]!, 'en')}`
        : `ages ${ages.map((age) => ageLabel(age, 'en')).join(', ')}`,
  },
  // Draft Arabic, matching `messages/ar.json`, for the client's Arabic
  // copywriter to review before launch. Layout and direction are already
  // correct for it (`arabic-rtl`).
  ar: {
    subjectConfirmed: (reference) => `تم تأكيد حجزك — ${reference}`,
    subjectCancelled: (reference) => `تم إلغاء حجزك — ${reference}`,
    preheaderConfirmed: (checkIn, room) =>
      `${room}، الوصول ${checkIn}. لم يُحصَّل أي مبلغ — الدفع عند الوصول.`,
    preheaderCancelled: (reference) => `تم إلغاء الحجز ${reference}. لم يُحصَّل أي مبلغ.`,
    eyebrowConfirmed: 'تم تأكيد الحجز',
    eyebrowCancelled: 'تم إلغاء الحجز',
    headlineConfirmed: (firstName) => `نتطلع إلى استقبالك، ${firstName}.`,
    headlineCancelled: 'تم إلغاء حجزك.',
    confirmedIntro:
      'شكراً لاختيارك كوف دبي. غرفتك محجوزة للتواريخ أدناه، وكل ما تحتاجه لإقامتك موجود في هذه الرسالة.',
    cancelledIntro:
      'بناءً على طلبك، ألغينا الحجز أدناه. لم يُحصَّل أي مبلغ، ولا يلزمك القيام بأي إجراء آخر.',
    reference: 'رقم الحجز',
    checkIn: 'الوصول',
    checkOut: 'المغادرة',
    room: 'الغرفة',
    guests: 'الضيوف',
    rooms: 'الغرف',
    specialRequests: 'طلباتك',
    priceHeading: 'تفاصيل إقامتك',
    roomTotal: 'الإقامة',
    extraGuests: 'ضيوف إضافيون',
    discount: 'الخصم',
    tourismDirham: 'رسوم درهم السياحة',
    vat: 'ضريبة القيمة المضافة',
    total: 'الإجمالي',
    payAtCheckIn: 'لم يُحصَّل أي مبلغ. يتم الدفع في الفندق عند الوصول.',
    cancelHeading: 'إذا تغيّرت خططك',
    cancelPolicy: (hours) => `يمكنك الإلغاء مجاناً حتى ${hours} ساعة قبل موعد الوصول.`,
    cancelBody: 'استخدم الرابط الآمن أدناه. يعمل مرة واحدة فقط، ولهذا الحجز وحده.',
    cancelLink: 'إلغاء هذا الحجز',
    linkFallback: 'إذا لم يعمل الزر، انسخ هذا العنوان في متصفحك:',
    bookAgain: 'خطّط لإقامة أخرى',
    questions: 'هل لديك أي استفسار قبل وصولك؟ يكفي الرد على هذه الرسالة وسيجيبك فريقنا.',
    questionsAfterCancel: 'هل لديك أي استفسار؟ يكفي الرد على هذه الرسالة وسيجيبك فريقنا.',
    signOff: 'مع أطيب التحيات،',
    hotelName: 'كوف دبي',
    address: 'الرقة، ديرة، دبي، الإمارات العربية المتحدة',
    footerReason: 'تصلك هذه الرسالة لأن حجزاً تم في كوف دبي باستخدام هذا العنوان.',
    nights: (count) =>
      count === 1 ? 'ليلة واحدة' : count === 2 ? 'ليلتان' : count <= 10 ? `${count} ليالٍ` : `${count} ليلة`,
    adults: (count) =>
      count === 1 ? 'بالغ واحد' : count === 2 ? 'بالغان' : count <= 10 ? `${count} بالغين` : `${count} بالغاً`,
    children: (count) =>
      count === 1 ? 'طفل واحد' : count === 2 ? 'طفلان' : count <= 10 ? `${count} أطفال` : `${count} طفلاً`,
    childAges: (ages) => `الأعمار: ${ages.map((age) => ageLabel(age, 'ar')).join('، ')}`,
  },
};

/** "under 1" rather than "0" — nobody describes a baby as aged zero. */
function ageLabel(age: number, locale: Locale): string {
  if (age > 0) return String(age);
  return locale === 'ar' ? 'أقل من سنة' : 'under 1';
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

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

/** The weekday on its own — `Wednesday` — for the date blocks. */
function formatWeekday(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'long',
    timeZone: 'UTC',
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

/** "2 adults, 1 child (age 6)" — the party as the guest described it. */
function describeParty(stay: Stay, locale: Locale): string {
  const copy = COPY[locale];
  const separator = locale === 'ar' ? '، ' : ', ';
  const parts = [copy.adults(stay.adults)];
  if (stay.children > 0) {
    const ages = stay.childAges ?? [];
    parts.push(
      ages.length === stay.children
        ? `${copy.children(stay.children)} (${copy.childAges(ages)})`
        : copy.children(stay.children),
    );
  }
  return parts.join(separator);
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

/** Escaped, with the guest's own line breaks kept. */
function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function siteUrl(path = ''): string {
  return `${config.webBaseUrl.replace(/\/$/, '')}${path}`;
}

/** The guest-facing cancellation link, keyed to the token from the booking. */
export function cancellationUrl(reference: string, token: string, locale: Locale): string {
  return `${siteUrl(`/${locale}/cancel`)}?reference=${encodeURIComponent(
    reference,
  )}&token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Price lines — shared by the HTML and the plain text
// ---------------------------------------------------------------------------

interface Row {
  label: string;
  value: string;
  strong?: boolean;
}

/**
 * The breakdown, in the order the money moves: the accommodation, then what
 * comes off it, then the fees on top. The same lines, in the same order, as
 * the summary the guest confirmed against — so they add up to the total.
 */
function priceRows(price: PriceBreakdown, locale: Locale): Row[] {
  const copy = COPY[locale];
  const money = (amount: number) => formatMoney(amount, price.currency, locale);

  return [
    { label: copy.roomTotal, value: money(price.roomTotal) },
    ...(price.extraGuests
      ? [{ label: copy.extraGuests, value: money(price.extraGuests.total) }]
      : []),
    ...(price.discount
      ? [
          {
            // In Arabic a Latin code in parentheses is torn apart by the bidi
            // algorithm — "(SPRING10" — so it is set off with a dot instead.
            label:
              locale === 'ar'
                ? `${copy.discount} — ${price.discount.name.ar} · ${price.discount.code}`
                : `${copy.discount} — ${price.discount.name.en} (${price.discount.code})`,
            value: `− ${money(price.discount.amount)}`,
          },
        ]
      : []),
    { label: copy.tourismDirham, value: money(price.tourismDirham.total) },
    { label: `${copy.vat} (${price.vat.ratePercent}%)`, value: money(price.vat.total) },
    { label: copy.total, value: money(price.grandTotal), strong: true },
  ];
}

// ---------------------------------------------------------------------------
// HTML building blocks
// ---------------------------------------------------------------------------

/** Per-language type and alignment, so no block has to ask twice. */
interface Look {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  /** The start edge — `left` in English, `right` in Arabic. */
  start: 'left' | 'right';
  end: 'left' | 'right';
  serif: string;
  sans: string;
  /** Tracked uppercase labels in English; plain in Arabic, where they break joins. */
  label: string;
}

function look(locale: Locale): Look {
  const rtl = locale === 'ar';
  return {
    locale,
    dir: rtl ? 'rtl' : 'ltr',
    start: rtl ? 'right' : 'left',
    end: rtl ? 'left' : 'right',
    serif: rtl ? ARABIC : SERIF,
    sans: rtl ? ARABIC : SANS,
    label: rtl
      ? `font-family:${ARABIC};font-size:13px;`
      : `font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;`,
  };
}

function eyebrow(text: string, l: Look): string {
  return `<p style="margin:0 0 12px;${l.label}color:${BRONZE};">${escapeHtml(text)}</p>`;
}

function headline(text: string, l: Look): string {
  return `<h1 style="margin:0 0 16px;font-family:${l.serif};font-size:${
    l.locale === 'ar' ? '24px' : '28px'
  };line-height:1.3;font-weight:normal;color:${INK};">${escapeHtml(text)}</h1>`;
}

function paragraph(text: string, l: Look, colour = INK): string {
  return `<p style="margin:0 0 16px;font-family:${l.sans};font-size:15px;line-height:1.7;color:${colour};">${escapeHtml(text)}</p>`;
}

/** The reference, large and set apart: the one thing the front desk will ask for. */
function referenceBlock(reference: string, l: Look): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 28px;">
      <tr>
        <td style="border:1px solid ${GOLD};padding:18px 16px;text-align:center;">
          <div style="${l.label}color:${FOG};">${escapeHtml(COPY[l.locale].reference)}</div>
          <div dir="ltr" style="margin-top:6px;font-family:${SERIF};font-size:24px;letter-spacing:3px;color:${INK};">${escapeHtml(reference)}</div>
        </td>
      </tr>
    </table>`;
}

/** Arrival and departure side by side, weekday beneath — the shape of the trip at a glance. */
function datesBlock(stay: Stay, l: Look, struck = false): string {
  const copy = COPY[l.locale];
  const cell = (label: string, date: string, second: boolean) => `
        <td width="50%" valign="top" style="padding:18px 20px;text-align:${l.start};${
          second ? `border-${l.start}:1px solid rgba(28,20,16,0.14);` : ''
        }">
          <div style="${l.label}color:${FOG};">${escapeHtml(label)}</div>
          <div style="margin-top:6px;font-family:${l.serif};font-size:20px;color:${INK};${
            struck ? 'text-decoration:line-through;' : ''
          }">${escapeHtml(formatDate(date, l.locale))}</div>
          <div style="margin-top:2px;font-family:${l.sans};font-size:13px;color:${FOG};">${escapeHtml(
            formatWeekday(date, l.locale),
          )}</div>
        </td>`;

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${l.dir}" style="background:${LINEN};margin-bottom:8px;">
      <tr>
        ${cell(copy.checkIn, stay.checkIn, false)}
        ${cell(copy.checkOut, stay.checkOut, true)}
      </tr>
    </table>`;
}

/** Label-and-value lines with hairlines between; the total, if any, ruled in ink. */
function rowsTable(rows: Row[], l: Look): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${l.dir}" style="margin-bottom:24px;">
      ${rows
        .map((row) => {
          const border = `border-top:1px solid ${row.strong ? INK : HAIRLINE};`;
          return `
        <tr>
          <td valign="top" style="${border}padding:11px 0;font-family:${l.sans};font-size:14px;line-height:1.5;color:${
            row.strong ? INK : FOG
          };text-align:${l.start};">${escapeHtml(row.label)}</td>
          <td valign="top" style="${border}padding:11px 0;padding-${l.start}:16px;font-family:${
            row.strong ? l.serif : l.sans
          };font-size:${row.strong ? '18px' : '14px'};line-height:1.5;color:${INK};text-align:${l.end};white-space:nowrap;">${escapeHtml(
            row.value,
          )}</td>
        </tr>`;
        })
        .join('')}
    </table>`;
}

function sectionHeading(text: string, l: Look): string {
  return `<h2 style="margin:8px 0 10px;font-family:${l.serif};font-size:18px;font-weight:normal;color:${INK};">${escapeHtml(text)}</h2>`;
}

/** A tinted panel for the one sentence nobody should miss. */
function notice(html: string, l: Look): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="background:#f3e7cf;border-${l.start}:3px solid ${GOLD};padding:14px 16px;font-family:${l.sans};font-size:14px;line-height:1.6;color:${INK};text-align:${l.start};">
          ${html}
        </td>
      </tr>
    </table>`;
}

/**
 * A button built from a table cell — the only shape Outlook draws with padding
 * and a background. `dark` for a primary action, outlined for a quieter one.
 */
function button(href: string, text: string, l: Look, variant: 'dark' | 'outline'): string {
  const colour = variant === 'dark' ? PAPER : INK;
  const fill =
    variant === 'dark'
      ? `background:${DARK};border:1px solid ${DARK};`
      : `background:${PAPER};border:1px solid ${INK};`;
  const type =
    l.locale === 'ar'
      ? `font-family:${ARABIC};font-size:14px;`
      : `font-family:${SANS};font-size:12px;letter-spacing:2px;text-transform:uppercase;`;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;">
      <tr>
        <td style="${fill}">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;${type}color:${colour};text-decoration:none;">${escapeHtml(text)}</a>
        </td>
      </tr>
    </table>`;
}

/** A hairline, then content — closes the body before the sign-off. */
function ruled(html: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="border-top:1px solid ${HAIRLINE};padding-top:24px;">${html}</td></tr>
    </table>`;
}

function signOff(l: Look): string {
  const copy = COPY[l.locale];
  return `
    <p style="margin:8px 0 0;font-family:${l.sans};font-size:15px;line-height:1.7;color:${INK};">
      ${escapeHtml(copy.signOff)}<br>
      <span style="font-family:${l.serif};font-size:17px;">${escapeHtml(copy.hotelName)}</span>
    </p>`;
}

/**
 * The frame every message shares: linen ground, a paper card, the wordmark on
 * a dark band, and a footer with the address.
 *
 * The preheader is the grey line an inbox shows after the subject. Left unset,
 * clients fill it with whatever text comes first — here, "COVE DUBAI" — which
 * wastes the one line a guest reads before opening.
 */
function layout(args: {
  l: Look;
  title: string;
  preheader: string;
  body: string;
  /** The "why you are receiving this" line — for guests, not for staff. */
  footerReason?: boolean;
}): string {
  const { l } = args;
  const copy = COPY[l.locale];

  return `<!doctype html>
<html lang="${l.locale}" dir="${l.dir}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(args.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${LINEN};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${LINEN};">${escapeHtml(
      args.preheader,
    )}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${LINEN};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${PAPER};">

            <tr>
              <td style="background:${DARK};padding:36px 32px 32px;text-align:center;">
                <div style="font-family:${SERIF};font-size:26px;letter-spacing:9px;color:${PAPER};padding-left:9px;">COVE</div>
                <div style="font-family:${SANS};font-size:10px;letter-spacing:5px;color:${GOLD};margin-top:8px;padding-left:5px;">DUBAI</div>
              </td>
            </tr>
            <tr>
              <td style="height:3px;line-height:3px;font-size:0;background:${GOLD};">&nbsp;</td>
            </tr>

            <tr>
              <td dir="${l.dir}" style="padding:40px 36px 36px;text-align:${l.start};">
                ${args.body}
              </td>
            </tr>

            <tr>
              <td dir="${l.dir}" style="background:${DARK};padding:28px 32px;text-align:center;font-family:${l.sans};font-size:12px;line-height:1.8;color:#cbbfae;">
                <div style="font-family:${l.serif};font-size:15px;color:${PAPER};">${escapeHtml(copy.hotelName)}</div>
                ${escapeHtml(copy.address)}<br>
                <a href="${escapeHtml(siteUrl(`/${l.locale}`))}" style="color:${GOLD};text-decoration:none;">${escapeHtml(
                  siteUrl().replace(/^https?:\/\//, ''),
                )}</a>
                ${
                  args.footerReason === false
                    ? ''
                    : `<div style="margin-top:14px;font-size:11px;color:#a89b8b;">${escapeHtml(copy.footerReason)}</div>`
                }
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

/** Plain-text label-and-value lines. */
function textRows(rows: Row[]): string[] {
  return rows.map((row) => `${row.label}: ${row.value}`);
}

// ---------------------------------------------------------------------------
// The guest's confirmation
// ---------------------------------------------------------------------------

/** The rows describing the stay itself, below the date blocks. */
function stayRows(reservation: Reservation, locale: Locale): Row[] {
  const copy = COPY[locale];
  return [
    {
      label: copy.room,
      value: `${reservation.roomType.name[locale]} · ${copy.nights(reservation.price.nights)}`,
    },
    { label: copy.guests, value: describeParty(reservation.stay, locale) },
    ...(reservation.stay.roomsCount > 1
      ? [{ label: copy.rooms, value: String(reservation.stay.roomsCount) }]
      : []),
  ];
}

/** The guest's confirmation, including their single-use cancellation link. */
export function confirmationEmail(args: {
  reservation: Reservation;
  cancellationToken: string;
  /** From the `cancellation_policy_hours` setting. Omitted, the policy line is left out. */
  cancellationHours?: number | undefined;
}): RenderedEmail {
  const { reservation, cancellationToken, cancellationHours } = args;
  const locale = reservation.guest.locale;
  const copy = COPY[locale];
  const l = look(locale);

  const cancelUrl = cancellationUrl(reservation.reference, cancellationToken, locale);
  const stay = stayRows(reservation, locale);
  const price = priceRows(reservation.price, locale);
  const subject = copy.subjectConfirmed(reservation.reference);

  const body = `
    ${eyebrow(copy.eyebrowConfirmed, l)}
    ${headline(copy.headlineConfirmed(reservation.guest.firstName), l)}
    ${paragraph(copy.confirmedIntro, l)}
    ${referenceBlock(reservation.reference, l)}
    ${datesBlock(reservation.stay, l)}
    ${rowsTable(stay, l)}
    ${
      reservation.specialRequests
        ? `${sectionHeading(copy.specialRequests, l)}
    <p style="margin:0 0 24px;font-family:${l.sans};font-size:14px;line-height:1.7;color:${INK};">${escapeMultiline(
      reservation.specialRequests,
    )}</p>`
        : ''
    }
    ${sectionHeading(copy.priceHeading, l)}
    ${rowsTable(price, l)}
    ${notice(escapeHtml(copy.payAtCheckIn), l)}
    ${sectionHeading(copy.cancelHeading, l)}
    ${cancellationHours !== undefined ? paragraph(copy.cancelPolicy(cancellationHours), l) : ''}
    ${paragraph(copy.cancelBody, l, FOG)}
    ${button(cancelUrl, copy.cancelLink, l, 'outline')}
    <p style="margin:0 0 28px;font-family:${l.sans};font-size:12px;line-height:1.6;color:${FOG};">
      ${escapeHtml(copy.linkFallback)}<br>
      <a href="${escapeHtml(cancelUrl)}" dir="ltr" style="color:${BRONZE};word-break:break-all;">${escapeHtml(cancelUrl)}</a>
    </p>
    ${ruled(paragraph(copy.questions, l))}
    ${signOff(l)}
  `;

  const text = [
    copy.eyebrowConfirmed.toUpperCase(),
    copy.headlineConfirmed(reservation.guest.firstName),
    '',
    copy.confirmedIntro,
    '',
    `${copy.reference}: ${reservation.reference}`,
    `${copy.checkIn}: ${formatWeekday(reservation.stay.checkIn, locale)}, ${formatDate(reservation.stay.checkIn, locale)}`,
    `${copy.checkOut}: ${formatWeekday(reservation.stay.checkOut, locale)}, ${formatDate(reservation.stay.checkOut, locale)}`,
    ...textRows(stay),
    ...(reservation.specialRequests
      ? ['', `${copy.specialRequests}: ${reservation.specialRequests}`]
      : []),
    '',
    copy.priceHeading,
    ...textRows(price),
    '',
    copy.payAtCheckIn,
    '',
    copy.cancelHeading,
    ...(cancellationHours !== undefined ? [copy.cancelPolicy(cancellationHours)] : []),
    copy.cancelBody,
    cancelUrl,
    '',
    copy.questions,
    '',
    copy.signOff,
    copy.hotelName,
    copy.address,
  ].join('\n');

  return {
    subject,
    html: layout({
      l,
      title: subject,
      preheader: copy.preheaderConfirmed(
        formatDate(reservation.stay.checkIn, locale),
        reservation.roomType.name[locale],
      ),
      body,
    }),
    text,
  };
}

// ---------------------------------------------------------------------------
// The guest's cancellation
// ---------------------------------------------------------------------------

export function cancellationEmail(reservation: Reservation): RenderedEmail {
  const locale = reservation.guest.locale;
  const copy = COPY[locale];
  const l = look(locale);
  const stay = stayRows(reservation, locale);
  const subject = copy.subjectCancelled(reservation.reference);
  const bookUrl = siteUrl(`/${locale}/reserve`);

  // No cancellation link: the token is spent, and offering it again would only
  // produce an error page. A way back to booking instead.
  const body = `
    ${eyebrow(copy.eyebrowCancelled, l)}
    ${headline(copy.headlineCancelled, l)}
    ${paragraph(copy.cancelledIntro, l)}
    ${referenceBlock(reservation.reference, l)}
    ${datesBlock(reservation.stay, l, true)}
    ${rowsTable(stay, l)}
    ${button(bookUrl, copy.bookAgain, l, 'dark')}
    <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
    ${ruled(paragraph(copy.questionsAfterCancel, l))}
    ${signOff(l)}
  `;

  const text = [
    copy.eyebrowCancelled.toUpperCase(),
    copy.headlineCancelled,
    '',
    copy.cancelledIntro,
    '',
    `${copy.reference}: ${reservation.reference}`,
    `${copy.checkIn}: ${formatDate(reservation.stay.checkIn, locale)}`,
    `${copy.checkOut}: ${formatDate(reservation.stay.checkOut, locale)}`,
    ...textRows(stay),
    '',
    `${copy.bookAgain}: ${bookUrl}`,
    '',
    copy.questionsAfterCancel,
    '',
    copy.signOff,
    copy.hotelName,
  ].join('\n');

  return {
    subject,
    html: layout({ l, title: subject, preheader: copy.preheaderCancelled(reservation.reference), body }),
    text,
  };
}

// ---------------------------------------------------------------------------
// The hotel's notices
// ---------------------------------------------------------------------------

/**
 * Everything the front desk needs about one booking, in the order they act on
 * it: who and when, what to prepare, how to reach the guest, what was quoted.
 *
 * Always in English regardless of the guest's language — read by staff, not by
 * the guest. The subject carries the name and arrival date so the inbox list
 * is useful on its own; email and phone are links, so a reply or a call is one
 * tap.
 */
function staffEmail(reservation: Reservation, kind: 'new' | 'cancelled'): RenderedEmail {
  const l = look('en');
  const guestName = `${reservation.guest.firstName} ${reservation.guest.lastName}`;
  const arrival = formatDate(reservation.stay.checkIn, 'en');
  const subject =
    kind === 'new'
      ? `New booking — ${reservation.reference} · ${guestName} · arrives ${arrival}`
      : `Cancelled — ${reservation.reference} · ${guestName} · was arriving ${arrival}`;
  const lead =
    kind === 'new'
      ? 'A guest has booked on the website. No payment was taken: the stay is settled on arrival.'
      : 'The guest cancelled with the link in their confirmation email. The room is back on sale for these dates.';

  const stayRowsForStaff: Row[] = [
    {
      label: 'Room',
      value: `${reservation.roomType.name.en} · ${COPY.en.nights(reservation.price.nights)}`,
    },
    { label: 'Rooms', value: String(reservation.stay.roomsCount) },
    { label: 'Guests', value: describeParty(reservation.stay, 'en') },
  ];
  const guestRows: Row[] = [
    { label: 'Guest', value: guestName },
    { label: 'Email', value: reservation.guest.email },
    { label: 'Phone', value: reservation.guest.phone },
    { label: 'Language', value: reservation.guest.locale === 'ar' ? 'Arabic' : 'English' },
  ];
  const price = priceRows(reservation.price, 'en');

  const contact = (row: Row) =>
    row.label === 'Email'
      ? `<a href="mailto:${escapeHtml(row.value)}" style="color:${BRONZE};">${escapeHtml(row.value)}</a>`
      : row.label === 'Phone'
        ? `<a href="tel:${escapeHtml(row.value.replace(/[^+\d]/g, ''))}" style="color:${BRONZE};">${escapeHtml(row.value)}</a>`
        : escapeHtml(row.value);

  const guestTable = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      ${guestRows
        .map(
          (row) => `
        <tr>
          <td style="border-top:1px solid ${HAIRLINE};padding:10px 0;font-family:${SANS};font-size:14px;color:${FOG};">${escapeHtml(row.label)}</td>
          <td style="border-top:1px solid ${HAIRLINE};padding:10px 0;font-family:${SANS};font-size:14px;color:${INK};text-align:right;">${contact(row)}</td>
        </tr>`,
        )
        .join('')}
    </table>`;

  const body = `
    ${eyebrow(kind === 'new' ? 'New booking · website' : 'Cancelled by the guest', l)}
    ${headline(`${guestName}`, l)}
    <p style="margin:-8px 0 16px;font-family:${SERIF};font-size:18px;letter-spacing:2px;color:${BRONZE};">${escapeHtml(reservation.reference)}</p>
    ${paragraph(lead, l)}
    ${datesBlock(reservation.stay, l, kind === 'cancelled')}
    ${rowsTable(stayRowsForStaff, l)}
    ${
      reservation.specialRequests
        ? notice(
            // `dir="auto"`: the guest may have written in Arabic, and their
            // text must keep its own direction inside the English email.
            `<strong style="font-weight:600;">Special requests</strong><br><span dir="auto">${escapeMultiline(
              reservation.specialRequests,
            )}</span>`,
            l,
          )
        : ''
    }
    ${sectionHeading('Guest', l)}
    ${guestTable}
    ${sectionHeading(kind === 'new' ? 'Quoted price' : 'Price that was quoted', l)}
    ${rowsTable(price, l)}
    <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${FOG};">Booked ${escapeHtml(
      new Date(reservation.createdAt).toUTCString(),
    )}. Search the reference in Admin → Reservations for the full record.</p>
  `;

  const text = [
    lead,
    '',
    `Reference: ${reservation.reference}`,
    `Check-in: ${arrival}`,
    `Check-out: ${formatDate(reservation.stay.checkOut, 'en')}`,
    ...textRows(stayRowsForStaff),
    ...(reservation.specialRequests ? [`Special requests: ${reservation.specialRequests}`] : []),
    '',
    ...textRows(guestRows),
    '',
    ...textRows(price),
  ].join('\n');

  return {
    subject,
    html: layout({ l, title: subject, preheader: lead, body, footerReason: false }),
    text,
  };
}

/** The hotel's copy of a new booking. */
export function hotelNotificationEmail(reservation: Reservation): RenderedEmail {
  return staffEmail(reservation, 'new');
}

/**
 * The hotel's notice that a guest cancelled.
 *
 * Without it the front desk learned of a guest cancellation only by spotting
 * the status in the admin panel — after, perhaps, preparing the room.
 */
export function hotelCancellationEmail(reservation: Reservation): RenderedEmail {
  return staffEmail(reservation, 'cancelled');
}
