/**
 * Who is staying, and whether they fit a room.
 *
 * A guest tells us how many adults and the age of each child. What those ages
 * *mean* is the hotel's policy, not the guest's: a baby sleeps in a cot and
 * takes no bed, a teenager takes one and counts as an adult. That judgement is
 * made here, in the API, from operational settings — never in the browser —
 * so a future PMS, which applies its own age categories, can own it without
 * the booking flow changing (`pms-readiness`).
 *
 * Pure, with no database access, so the rules are tested directly.
 */

/** The hotel's child policy, read from the `guests_*` settings. */
export interface GuestPolicy {
  /** A child this age or older counts as an adult. */
  adultFromAge: number;
  /** A child this age or younger is an infant: a cot, not a bed. */
  infantUpToAge: number;
  /** Cots per room — the most infants one room can take. */
  infantsPerRoom: number;
}

/**
 * Used only when a setting is missing — a database seeded before the policy
 * existed. Unlike the tax settings, a missing value here cannot misprice a
 * stay, so falling back is safer than refusing every search.
 */
export const DEFAULT_GUEST_POLICY: GuestPolicy = {
  adultFromAge: 12,
  infantUpToAge: 1,
  infantsPerRoom: 1,
};

/** The party, sorted into the categories capacity is measured in. */
export interface Occupants {
  adults: number;
  /** Children who take a bed. */
  children: number;
  /** Children who sleep in a cot and take no bed. */
  infants: number;
}

/**
 * Sort a party into adults, children and infants.
 *
 * `children` is the count the guest gave. When it exceeds the ages given — a
 * booking from before ages were asked — the unaged children are counted as
 * children, which is the cautious reading: it never lets a party into a room
 * that a known age would have kept them out of.
 */
export function classifyGuests(
  party: { adults: number; children: number; childAges: readonly number[] },
  policy: GuestPolicy,
): Occupants {
  const occupants: Occupants = { adults: party.adults, children: 0, infants: 0 };

  for (const age of party.childAges) {
    if (age >= policy.adultFromAge) occupants.adults += 1;
    else if (age <= policy.infantUpToAge) occupants.infants += 1;
    else occupants.children += 1;
  }

  occupants.children += Math.max(0, party.children - party.childAges.length);
  return occupants;
}

/** Why a party does not fit a room type, or null when it does. */
export type OccupancyProblem = 'too-many-adults' | 'too-many-guests' | 'too-many-infants';

/**
 * Whether a party fits `roomsCount` rooms of a type.
 *
 * Capacity is shared across the rooms booked, as the existing occupancy check
 * always measured it: two rooms that sleep two take a party of four, however
 * the guests then split between them.
 */
export function occupancyProblem(
  occupants: Occupants,
  room: { maxAdults: number; maxOccupancy: number },
  roomsCount: number,
  policy: GuestPolicy,
): OccupancyProblem | null {
  if (occupants.adults > room.maxAdults * roomsCount) return 'too-many-adults';
  if (occupants.adults + occupants.children > room.maxOccupancy * roomsCount) {
    return 'too-many-guests';
  }
  if (occupants.infants > policy.infantsPerRoom * roomsCount) {
    return 'too-many-infants';
  }
  return null;
}

/**
 * Read the policy from settings rows, falling back per value.
 *
 * A value that is present but not a sensible whole number falls back too: an
 * admin typing "twelve" into the settings screen must not take every room off
 * sale.
 */
export function parseGuestPolicy(
  value: (key: string) => string | undefined,
): GuestPolicy {
  const read = (key: string, fallback: number, min: number, max: number) => {
    const raw = value(key);
    if (raw === undefined) return fallback;
    const parsed = Number(raw.trim());
    return Number.isInteger(parsed) && parsed >= min && parsed <= max
      ? parsed
      : fallback;
  };

  return {
    adultFromAge: read('guests_adult_from_age', DEFAULT_GUEST_POLICY.adultFromAge, 1, 18),
    infantUpToAge: read('guests_infant_up_to_age', DEFAULT_GUEST_POLICY.infantUpToAge, 0, 5),
    infantsPerRoom: read('guests_infants_per_room', DEFAULT_GUEST_POLICY.infantsPerRoom, 0, 4),
  };
}

export const GUEST_POLICY_KEYS = [
  'guests_adult_from_age',
  'guests_infant_up_to_age',
  'guests_infants_per_room',
] as const;
