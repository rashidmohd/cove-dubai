/**
 * Stay dates, and the query string a search arrives in.
 *
 * `readStayQuery` is the front door for dates that came from outside the app —
 * a home page search, a bookmark, a shared link, someone typing in the address
 * bar. Everything it lets through reaches a date picker and then the booking
 * API, so the cases that matter here are the malformed ones: what it refuses is
 * more important than what it accepts.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_ADULTS,
  addDays,
  isStayDate,
  isoFromParts,
  readStayQuery,
} from '../lib/stay-dates';

const TODAY = '2026-09-15';

/** Shorthand: a query string as the browser would hand it over. */
const query = (search: string) => new URLSearchParams(search);

describe('isStayDate', () => {
  it('accepts a well-formed calendar date', () => {
    expect(isStayDate('2026-09-15')).toBe(true);
  });

  it('rejects nothing, the wrong shape, and prose', () => {
    expect(isStayDate(null)).toBe(false);
    expect(isStayDate('')).toBe(false);
    expect(isStayDate('2026-9-5')).toBe(false);
    expect(isStayDate('15/09/2026')).toBe(false);
    expect(isStayDate('tomorrow')).toBe(false);
  });

  it('rejects a date that matches the shape but is not a day', () => {
    // The regex alone accepts these; `Date` rolls them into the next month.
    expect(isStayDate('2026-02-31')).toBe(false);
    expect(isStayDate('2026-13-01')).toBe(false);
    expect(isStayDate('2026-00-10')).toBe(false);
  });

  it('knows which Februaries have 29 days', () => {
    expect(isStayDate('2028-02-29')).toBe(true);
    expect(isStayDate('2026-02-29')).toBe(false);
  });
});

describe('isoFromParts', () => {
  it('pads the month and day', () => {
    expect(isoFromParts(2026, 0, 5)).toBe('2026-01-05');
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('crosses a year boundary, forwards and back', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('lands on 29 February in a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('readStayQuery', () => {
  it('reads a stay a search bar produced', () => {
    expect(
      readStayQuery(query('checkIn=2026-10-02&checkOut=2026-10-05'), TODAY),
    ).toMatchObject({ checkIn: '2026-10-02', checkOut: '2026-10-05' });
  });

  it('takes today as an arrival', () => {
    expect(
      readStayQuery(query(`checkIn=${TODAY}&checkOut=2026-09-16`), TODAY)
        .checkIn,
    ).toBe(TODAY);
  });

  it('drops a stay that has already happened', () => {
    const stay = readStayQuery(
      query('checkIn=2026-09-01&checkOut=2026-09-04'),
      TODAY,
    );
    expect(stay).toMatchObject({ checkIn: null, checkOut: null });
  });

  it('drops a departure that is not after the arrival', () => {
    for (const search of [
      'checkIn=2026-10-02&checkOut=2026-10-02',
      'checkIn=2026-10-02&checkOut=2026-10-01',
    ]) {
      expect(readStayQuery(query(search), TODAY)).toMatchObject({
        checkIn: null,
        checkOut: null,
      });
    }
  });

  it('drops one date without the other', () => {
    // A half-filled form is a worse place to land than an empty one.
    expect(readStayQuery(query('checkIn=2026-10-02'), TODAY)).toMatchObject({
      checkIn: null,
      checkOut: null,
    });
    expect(readStayQuery(query('checkOut=2026-10-05'), TODAY)).toMatchObject({
      checkIn: null,
      checkOut: null,
    });
  });

  it('drops a malformed date rather than passing it to the API', () => {
    expect(
      readStayQuery(query('checkIn=2026-02-31&checkOut=2026-03-02'), TODAY),
    ).toMatchObject({ checkIn: null, checkOut: null });
  });

  it('reads a guest count', () => {
    expect(readStayQuery(query('adults=3'), TODAY).adults).toBe(3);
  });

  it('clamps a guest count to what the counter offers', () => {
    expect(readStayQuery(query('adults=99'), TODAY).adults).toBe(MAX_ADULTS);
    expect(readStayQuery(query('adults=0'), TODAY).adults).toBe(1);
    expect(readStayQuery(query('adults=-4'), TODAY).adults).toBe(1);
  });

  it('ignores a guest count that is not a whole number', () => {
    for (const search of ['adults=two', 'adults=2.5', 'adults=', 'adults= ']) {
      expect(readStayQuery(query(search), TODAY).adults).toBeNull();
    }
  });

  it('says nothing about guests when the link says nothing', () => {
    expect(readStayQuery(query(''), TODAY).adults).toBeNull();
  });

  it('keeps the guest count even when the dates are unusable', () => {
    // The two are independent: a stale date should not silently reset a party
    // of four back to the default of two.
    expect(
      readStayQuery(query('checkIn=nonsense&adults=4'), TODAY),
    ).toMatchObject({ checkIn: null, checkOut: null, adults: 4 });
  });
});
