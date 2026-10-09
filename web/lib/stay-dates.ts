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
/** The time now on a clock in Dubai, `HH:MM`. */
export function timeInDubai(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

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
 */
export const MAX_ADULTS = 6;

/**
 * The most children one booking can be made for.
 *
 * Each child comes with an age, which the guest states — in step 1, or in the
 * home search, which hands them over as `?childAges=`. A link that carries a
 * count without ages cannot say who needs a cot, so none is ever accepted.
 */
export const MAX_CHILDREN = 4;

/** The oldest a child can be. Eighteen and over books as an adult. */
export const MAX_CHILD_AGE = 17;

/**
 * Ages as the step-1 form holds them: one entry per child, `null` until the
 * guest picks it. Returns the ages when every child has one, else null.
 *
 * Validation for the guest's benefit only — what each age *means* (a cot, a
 * bed, an adult) is decided by the API.
 */
export function completeChildAges(
  ages: ReadonlyArray<number | null>,
): number[] | null {
  return ages.every((age): age is number => age !== null) ? [...ages] : null;
}

/** A stay read out of a query string. Each field is null when not usable. */
export interface StayQuery {
  checkIn: string | null;
  checkOut: string | null;
  adults: number | null;
  /**
   * Ages from `?childAges=4,9`. `[]` when the parameter is absent — a search
   * with no children — and null when it is present but unusable, so the flow
   * can tell "no children" from "children it could not read".
   */
  childAges: number[] | null;
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

  return {
    ...stay,
    adults: readAdults(params.get('adults')),
    childAges: readChildAges(params.get('childAges')),
  };
}

/**
 * A comma-separated list of child ages, all or nothing.
 *
 * Unlike adults, nothing is clamped or dropped: a list with one bad age is
 * refused whole. Quietly searching for two children when the guest asked for
 * three would offer rooms that do not fit the family that arrives.
 */
function readChildAges(raw: string | null): number[] | null {
  if (raw === null || raw.trim() === '') return [];

  const parts = raw.split(',');
  if (parts.length > MAX_CHILDREN) return null;

  const ages = parts.map((part) => (/^\s*\d{1,2}\s*$/.test(part) ? Number(part) : NaN));
  return ages.every((age) => Number.isInteger(age) && age <= MAX_CHILD_AGE)
    ? ages
    : null;
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
