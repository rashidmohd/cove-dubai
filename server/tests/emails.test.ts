/**
 * Transactional email rendering.
 *
 * Pure template tests — no network, no database. What they guard is the set of
 * mistakes that are invisible until a guest receives the message:
 *
 *   - the cancellation link pointing at the wrong host, or losing its token
 *   - a guest's name being interpolated into HTML unescaped
 *   - the price breakdown not summing to the total the guest was quoted
 *   - the Arabic email not actually being RTL
 */
import { describe, expect, it } from 'vitest';

import {
  cancellationEmail,
  cancellationUrl,
  confirmationEmail,
  hotelCancellationEmail,
  hotelNotificationEmail,
} from '../src/emails/templates.js';
import { config } from '../src/config.js';
import type { Reservation } from '../src/booking/types.js';

const TOKEN = 'a-test-cancellation-token';

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    reference: 'CV-2026-482137',
    status: 'confirmed',
    roomType: {
      code: 'studio-room',
      name: { en: 'Studio Room', ar: 'غرفة استوديو' },
      category: { en: 'Classic', ar: 'كلاسيك' },
      description: { en: 'A room.', ar: 'غرفة.' },
      maxOccupancy: 2,
      maxAdults: 2,
      maxChildren: 1,
      maxInfants: 1,
      baseOccupancy: 2,
      extraAdultFee: 0,
      extraChildFee: 0,
      baseRate: 980,
      imageKey: 'img-studio',
      amenities: [],
    images: [],
    },
    stay: {
      checkIn: '2027-03-10',
      checkOut: '2027-03-12',
      adults: 2,
      children: 0,
      childAges: [],
      roomsCount: 1,
    },
    guest: {
      firstName: 'Amira',
      lastName: 'Hassan',
      email: 'guest@example.com',
      phone: '+971500000000',
      locale: 'en',
    },
    price: {
      currency: 'AED',
      nights: 2,
      roomsCount: 1,
      nightlyRates: [
        { date: '2027-03-10', rate: 980 },
        { date: '2027-03-11', rate: 980 },
      ],
      roomTotal: 1960,
      tourismDirham: { perRoomPerNight: 20, total: 40 },
      vat: { ratePercent: 5, total: 98 },
      grandTotal: 2098,
    },
    createdAt: '2026-08-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('the cancellation link', () => {
  it('is built from WEB_BASE_URL and carries the reference and token', () => {
    const url = cancellationUrl('CV-2026-482137', TOKEN, 'en');

    expect(url.startsWith(config.webBaseUrl.replace(/\/$/, ''))).toBe(true);
    expect(url).toContain('/en/cancel');
    expect(url).toContain('reference=CV-2026-482137');
    expect(url).toContain(`token=${TOKEN}`);
  });

  it('points at the guest’s own language', () => {
    expect(cancellationUrl('CV-1', TOKEN, 'ar')).toContain('/ar/cancel');
  });

  it('escapes a token containing URL-significant characters', () => {
    // Tokens are base64url so this should not arise, but a link that silently
    // truncates at an `&` is not a failure anyone would notice in review.
    const url = cancellationUrl('CV-1', 'a+b&c=d', 'en');
    expect(url).toContain('token=a%2Bb%26c%3Dd');
  });
});

describe('the confirmation email', () => {
  it('includes the reference, the link, and the total', () => {
    const email = confirmationEmail({
      reservation: reservation(),
      cancellationToken: TOKEN,
    });

    expect(email.subject).toContain('CV-2026-482137');
    for (const part of [email.html, email.text]) {
      expect(part).toContain('CV-2026-482137');
      expect(part).toContain(TOKEN);
      expect(part).toContain('2,098');
    }
  });

  it('shows a breakdown that sums to the total', () => {
    const booking = reservation();
    const { text } = confirmationEmail({
      reservation: booking,
      cancellationToken: TOKEN,
    });

    // The same guarantee the reserve flow makes on screen: the guest can add
    // up the lines they were shown and reach the figure they were charged.
    const { roomTotal, tourismDirham, vat, grandTotal } = booking.price;
    expect(roomTotal + tourismDirham.total + vat.total).toBe(grandTotal);

    expect(text).toContain('Accommodation: AED 1,960');
    expect(text).toContain('Tourism Dirham: AED 40');
    expect(text).toContain('VAT (5%): AED 98');
    expect(text).toContain('Total: AED 2,098');
  });

  it('states that no payment was taken', () => {
    // The launch model is pay-at-check-in. A confirmation that reads like a
    // receipt would be actively wrong.
    const { text } = confirmationEmail({
      reservation: reservation(),
      cancellationToken: TOKEN,
    });
    expect(text.toLowerCase()).toContain('no payment has been taken');
  });

  it('escapes HTML in a guest’s name', () => {
    const email = confirmationEmail({
      reservation: reservation({
        guest: {
          firstName: '<script>alert(1)</script>',
          lastName: 'O”Brien',
          email: 'guest@example.com',
          phone: '+971500000000',
          locale: 'en',
        },
      }),
      cancellationToken: TOKEN,
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('renders Arabic right-to-left', () => {
    const email = confirmationEmail({
      reservation: reservation({
        guest: {
          firstName: 'Amira',
          lastName: 'Hassan',
          email: 'guest@example.com',
          phone: '+971500000000',
          locale: 'ar',
        },
      }),
      cancellationToken: TOKEN,
    });

    expect(email.html).toContain('dir="rtl"');
    expect(email.html).toContain('lang="ar"');
    // And the room name comes through in Arabic, not the English fallback.
    expect(email.html).toContain('غرفة استوديو');
  });

  it('renders English left-to-right', () => {
    const email = confirmationEmail({
      reservation: reservation(),
      cancellationToken: TOKEN,
    });

    expect(email.html).toContain('dir="ltr"');
    expect(email.html).not.toContain('dir="rtl"');
  });
});

describe('the cancellation email', () => {
  it('confirms the cancellation and carries no link', () => {
    const email = cancellationEmail(
      reservation({ status: 'cancelled' }),
    );

    expect(email.subject).toContain('cancelled');
    expect(email.text).toContain('CV-2026-482137');
    // The token is spent; offering the link again would only produce a 403.
    expect(email.html).not.toContain('/cancel?reference=');
  });
});

describe('the hotel’s copy', () => {
  it('carries the guest’s contact details', () => {
    const { text } = hotelNotificationEmail(reservation());

    expect(text).toContain('guest@example.com');
    expect(text).toContain('+971500000000');
    expect(text).toContain('Amira Hassan');
  });

  it('is in English even for an Arabic-speaking guest', () => {
    // Read by staff, not by the guest.
    const email = hotelNotificationEmail(
      reservation({
        guest: {
          firstName: 'Amira',
          lastName: 'Hassan',
          email: 'guest@example.com',
          phone: '+971500000000',
          locale: 'ar',
        },
      }),
    );

    expect(email.html).toContain('lang="en"');
    expect(email.text).toContain('Language: Arabic');
  });

  it('passes on special requests when there are any', () => {
    const withRequest = hotelNotificationEmail(
      reservation({ specialRequests: 'High floor, away from the lift' }),
    );
    expect(withRequest.text).toContain('High floor, away from the lift');

    const without = hotelNotificationEmail(reservation());
    expect(without.text).not.toContain('Special requests');
  });
});

describe('a stay with children, extra guests and a voucher', () => {
  // 2 nights at 2,400: 4,800 room + 300 extra child = 5,100; 10% off = 4,590;
  // VAT 5% = 229.5; Dirham 40; total 4,859.5.
  const booking = reservation({
    stay: {
      checkIn: '2027-03-10',
      checkOut: '2027-03-12',
      adults: 2,
      children: 2,
      childAges: [6, 0],
      roomsCount: 1,
    },
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
      discount: { code: 'SPRING10', name: { en: 'Spring', ar: 'الربيع' }, amount: 510 },
      tourismDirham: { perRoomPerNight: 20, total: 40 },
      vat: { ratePercent: 5, total: 229.5 },
      grandTotal: 4859.5,
    },
  });

  it('lists every line, so the email adds up to the total', () => {
    const { text } = confirmationEmail({ reservation: booking, cancellationToken: TOKEN });
    // Previously the discount was missing, and a discounted booking's lines
    // added up to more than its total.
    expect(text).toContain('Accommodation: AED 4,800');
    expect(text).toContain('Extra guests: AED 300');
    expect(text).toContain('Discount — Spring (SPRING10): − AED 510');
    expect(text).toContain('VAT (5%): AED 229.50');
    expect(text).toContain('Total: AED 4,859.50');
    const { roomTotal, extraGuests, discount, tourismDirham, vat, grandTotal } = booking.price;
    expect(roomTotal + extraGuests!.total - discount!.amount + tourismDirham.total + vat.total).toBe(grandTotal);
  });

  it('describes the party with the children’s ages', () => {
    const { text } = confirmationEmail({ reservation: booking, cancellationToken: TOKEN });
    expect(text).toContain('Guests: 2 adults, 2 children (ages 6, under 1)');
  });

  it('tells the front desk the ages too', () => {
    expect(hotelNotificationEmail(booking).text).toContain('2 children (ages 6, under 1)');
  });
});

describe('the cancellation policy line', () => {
  it('states the hours the hotel set', () => {
    const { text } = confirmationEmail({
      reservation: reservation(),
      cancellationToken: TOKEN,
      cancellationHours: 48,
    });
    expect(text).toContain('free of charge up to 48 hours before check-in');
  });

  it('is left out rather than invented when no hours are known', () => {
    const { text } = confirmationEmail({ reservation: reservation(), cancellationToken: TOKEN });
    expect(text).not.toContain('free of charge');
  });
});

describe('the hotel’s cancellation notice', () => {
  it('names the guest and arrival in the subject, in English', () => {
    const email = hotelCancellationEmail(
      reservation({
        status: 'cancelled',
        guest: {
          firstName: 'Amira',
          lastName: 'Hassan',
          email: 'guest@example.com',
          phone: '+971500000000',
          locale: 'ar',
        },
      }),
    );
    expect(email.subject).toBe('Cancelled — CV-2026-482137 · Amira Hassan · was arriving 10 Mar 2027');
    expect(email.html).toContain('lang="en"');
    expect(email.text).toContain('back on sale');
  });
});

