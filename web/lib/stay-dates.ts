/**
 * Stay dates, in the hotel's day rather than the visitor's.
 *
 * A guest in Los Angeles at 23:00 is already on tomorrow's date in Dubai. If
 * "today" came from the browser's clock, that guest would be offered a check-in
 * the API then rejects as in the past — an error they cannot act on and cannot
 * understand. Every floor on a date picker is therefore Dubai's today.
 *
 * These were three separate copies (the date picker, the booking state, and now
 * the home search). One copy, because the day a booking calendar starts on is
 * not a detail worth having two answers to.
 */

/** Today in Dubai, as `YYYY-MM-DD`. */
export function todayInDubai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** `YYYY-MM-DD` from calendar parts, where `month` is zero-based. */
export function isoFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * `iso` shifted by whole days.
 *
 * Done in UTC on purpose. Constructing a local `Date` from a date-only string
 * and adding days crosses daylight-saving boundaries in the visitor's zone and
 * can land on the same calendar day twice; UTC has no such boundaries, and the
 * value here is a calendar date, not an instant.
 */
export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoFromParts(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
}

/** Whether a string is a plausible `YYYY-MM-DD` calendar date. */
export function isStayDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 2026-02-31, which the regex alone accepts: `Date` rolls it forward
  // to March, so the parts no longer match what went in.
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * The most adults one booking can be made for.
 *
 * The step-1 counter stops here, so anything that seeds guest numbers from
 * outside — a search link, a bookmark — must stop at the same place. A URL that
 * could set eight adults would show a number the guest cannot then reduce past
 * six, or price a stay the form itself refuses to produce.
 *
 * Children have no counter in the flow at all: the field exists in the booking
 * state and is sent to the API, but nothing renders it, so nothing may seed it.
 */
export const MAX_ADULTS = 6;

/** A stay read out of a query string. Each field is null when not usable. */
export interface StayQuery {
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
}

/**
 * Read a stay from a query string — how a home page search reaches `/reserve`.
 *
 * Everything is validated rather than trusted. A query string is user input: it
 * arrives from a bookmark, a shared link, a stale email, or someone typing, and
 * `?checkIn=yesterday` has to degrade to an empty date field rather than to a
 * request the API rejects with an error the guest cannot act on.
 *
 * Dates come back **both or neither**. One date alone cannot start a search,
 * and a half-filled form is a worse place to land than an empty one.
 */
export function readStayQuery(
  params: URLSearchParams,
  today: string,
): StayQuery {
  const checkIn = params.get('checkIn');
  const checkOut = params.get('checkOut');

  const stay =
    isStayDate(checkIn) &&
    isStayDate(checkOut) &&
    checkIn >= today &&
    checkOut > checkIn
      ? { checkIn, checkOut }
      : { checkIn: null, checkOut: null };

  return { ...stay, adults: readAdults(params.get('adults')) };
}

/** A whole number of adults within the counter's range, or null. */
function readAdults(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;

  const value = Number(raw);
  // `Number('')` is 0 and `Number('2abc')` is NaN — both must fail, and an
  // out-of-range value is clamped rather than dropped so that a link asking for
  // more adults than we take still produces a usable search.
  if (!Number.isInteger(value)) return null;
  return Math.min(MAX_ADULTS, Math.max(1, value));
}

/**
 * A room type code handed over in a query string, or null.
 *
 * Lives beside the stay readers rather than with the API client because it
 * answers the same question they do: what the reserve flow should start from
 * when a link, not the guest, chose it. The offers page and the room detail
 * page both deep-link a room this way.
 *
 * **Shape only — existence is not checked here.** Whether the hotel still sells
 * this room, and whether it is free for the chosen nights, are the API's to
 * answer, and the flow already drops a room that is not in the availability
 * response. What this stops is an arbitrary string from a crafted URL reaching
 * component state and `sessionStorage`: codes are slugs, so anything that is
 * not slug-shaped was never a room and can be discarded before it travels.
 */
export function readRoomCode(raw: string | null): string | null {
  if (raw === null) return null;

  const value = raw.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64
    ? value
    : null;
}
