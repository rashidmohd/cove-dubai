/**
 * Sample reservations for previewing and test-sending the transactional
 * email. Invented guests and figures — never real bookings — chosen so every
 * optional part of a template shows: children with ages, an extra-guest
 * charge, a voucher, special requests, and both languages.
 */
import type { Reservation } from '../src/booking/types.js';
import {
  cancellationEmail,
  confirmationEmail,
  hotelCancellationEmail,
  hotelNotificationEmail,
  type RenderedEmail,
} from '../src/emails/templates.js';

const base: Reservation = {
  reference: 'CV-2027-418306',
  status: 'confirmed',
  roomType: {
    code: 'cove-suite',
    name: { en: 'The Cove Suite', ar: 'جناح كوف' },
    category: { en: 'Signature', ar: 'سيغنتشر' },
    description: { en: '', ar: '' },
    maxOccupancy: 4,
    maxAdults: 4,
    maxChildren: 3,
    maxInfants: 1,
    baseOccupancy: 2,
    extraAdultFee: 0,
    extraChildFee: 150,
    baseRate: 2400,
    imageKey: 'img-suite',
    amenities: [],
    images: [],
  },
  stay: {
    checkIn: '2027-03-10',
    checkOut: '2027-03-12',
    adults: 2,
    children: 2,
    childAges: [6, 0],
    roomsCount: 1,
  },
  guest: {
    firstName: 'Amira',
    lastName: 'Hassan',
    email: 'guest@example.com',
    phone: '+971 50 123 4567',
    locale: 'en',
  },
  specialRequests: 'A cot for our baby, please, and a quiet room if possible.',
  price: {
    currency: 'AED',
    nights: 2,
    roomsCount: 1,
    nightlyRates: [
      { date: '2027-03-10', rate: 2400 },
      { date: '2027-03-11', rate: 2400 },
    ],
    roomTotal: 4800,
    extraGuests: { adults: 0, children: 1, perNight: 150, total: 300 },
    discount: { code: 'SPRING10', name: { en: 'Spring offer', ar: 'عرض الربيع' }, amount: 510 },
    tourismDirham: { perRoomPerNight: 20, total: 40 },
    vat: { ratePercent: 5, total: 229.5 },
    grandTotal: 4859.5,
  },
  createdAt: '2026-10-02T09:30:00.000Z',
};

const arabic: Reservation = {
  ...base,
  guest: { ...base.guest, firstName: 'أميرة', lastName: 'حسن', locale: 'ar' },
  specialRequests: 'سرير أطفال لطفلنا من فضلكم، وغرفة هادئة إن أمكن.',
};

const SAMPLE_TOKEN = 'sample-cancellation-token';

/** Every email the system sends, by a file-friendly name. */
export function renderSamples(): Array<{ name: string; email: RenderedEmail }> {
  return [
    {
      name: 'guest-confirmation-en',
      email: confirmationEmail({ reservation: base, cancellationToken: SAMPLE_TOKEN, cancellationHours: 48 }),
    },
    {
      name: 'guest-confirmation-ar',
      email: confirmationEmail({ reservation: arabic, cancellationToken: SAMPLE_TOKEN, cancellationHours: 48 }),
    },
    { name: 'guest-cancellation-en', email: cancellationEmail({ ...base, status: 'cancelled' }) },
    { name: 'guest-cancellation-ar', email: cancellationEmail({ ...arabic, status: 'cancelled' }) },
    { name: 'hotel-new-booking', email: hotelNotificationEmail(arabic) },
    { name: 'hotel-cancellation', email: hotelCancellationEmail({ ...arabic, status: 'cancelled' }) },
  ];
}
