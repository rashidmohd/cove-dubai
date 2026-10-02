/**
 * Occupancy rules — who counts as what, and who fits where.
 *
 * Pure functions, no database. These decide which rooms a family is offered at
 * all, so a wrong boundary here quietly hides rooms that would have fitted or
 * offers rooms the booking will then refuse.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GUEST_POLICY,
  classifyGuests,
  occupancyProblem,
  parseGuestPolicy,
} from '../src/booking/occupancy.js';
import { availabilityQuerySchema, createReservationSchema } from '../src/routes/schemas.js';

const policy = { adultFromAge: 12, infantUpToAge: 1, infantsPerRoom: 1 };
const sleepsThreeTwoAdults = { maxOccupancy: 3, maxAdults: 2 };

describe('classifyGuests', () => {
  it('sorts children by age at the policy boundaries', () => {
    expect(
      classifyGuests({ adults: 2, children: 4, childAges: [0, 1, 2, 12] }, policy),
    ).toEqual({ adults: 3, children: 1, infants: 2 });
  });

  it('counts children without an age as children, never as infants', () => {
    expect(classifyGuests({ adults: 2, children: 2, childAges: [] }, policy)).toEqual({
      adults: 2,
      children: 2,
      infants: 0,
    });
  });
});

describe('occupancyProblem', () => {
  const fit = (adults: number, childAges: number[], roomsCount = 1) =>
    occupancyProblem(
      classifyGuests({ adults, children: childAges.length, childAges }, policy),
      sleepsThreeTwoAdults,
      roomsCount,
      policy,
    );

  it('takes two adults and a child in a room that sleeps three', () => {
    expect(fit(2, [6])).toBeNull();
  });

  it('refuses a third adult, even one who is a 14-year-old', () => {
    expect(fit(3, [])).toBe('too-many-adults');
    expect(fit(2, [14])).toBe('too-many-adults');
  });

  it('does not count an infant toward the beds', () => {
    expect(fit(2, [6, 0])).toBeNull();
  });

  it('refuses more infants than the room has cots', () => {
    expect(fit(2, [0, 1])).toBe('too-many-infants');
  });

  it('refuses a party that outnumbers the beds', () => {
    expect(fit(1, [4, 6, 8])).toBe('too-many-guests');
  });

  it('shares capacity across the rooms booked', () => {
    expect(fit(4, [5, 7], 2)).toBeNull();
  });
});

describe('parseGuestPolicy', () => {
  it('reads the settings', () => {
    const rows: Record<string, string> = {
      guests_adult_from_age: '13',
      guests_infant_up_to_age: '2',
      guests_infants_per_room: '2',
    };
    expect(parseGuestPolicy((key) => rows[key])).toEqual({
      adultFromAge: 13,
      infantUpToAge: 2,
      infantsPerRoom: 2,
    });
  });

  it('falls back per value on a missing or nonsensical setting', () => {
    const rows: Record<string, string> = { guests_adult_from_age: 'twelve' };
    expect(parseGuestPolicy((key) => rows[key])).toEqual(DEFAULT_GUEST_POLICY);
  });
});

describe('child ages in requests', () => {
  const stay = { checkIn: '2027-03-01', checkOut: '2027-03-03', adults: '2' };

  it('reads a comma-separated list and derives the count from it', () => {
    const query = availabilityQuerySchema.parse({ ...stay, childAges: '4,9' });
    expect(query.childAges).toEqual([4, 9]);
    expect(query.children).toBe(2);
  });

  it('still accepts a bare count from a caller that sends no ages', () => {
    const query = availabilityQuerySchema.parse({ ...stay, children: '1' });
    expect(query).toMatchObject({ children: 1, childAges: [] });
  });

  it('refuses a count and ages that disagree', () => {
    expect(() =>
      availabilityQuerySchema.parse({ ...stay, children: '3', childAges: '4,9' }),
    ).toThrow();
  });

  it('refuses an age of eighteen — that guest is an adult', () => {
    expect(() => availabilityQuerySchema.parse({ ...stay, childAges: '18' })).toThrow();
  });

  it('carries ages through a booking', () => {
    const draft = createReservationSchema.parse({
      roomTypeCode: 'cove-suite',
      checkIn: '2027-03-01',
      checkOut: '2027-03-03',
      adults: 2,
      childAges: [3],
      guest: {
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        phone: '+971 50 000 0000',
      },
    });
    expect(draft).toMatchObject({ children: 1, childAges: [3] });
  });
});
