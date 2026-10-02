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

/**
 * The hotel's age rules, read from the `guests_*` settings. Hotel-wide: an
 * infant is an infant in every room. What a *room* takes — beds, cots — is the
 * room type's own, edited per room in the admin.
 */
export interface GuestPolicy {
  /** A child this age or older counts as an adult. */
  adultFromAge: number;
  /** A child this age or younger is an infant: a cot, not a bed. */
  infantUpToAge: number;
  /** The most rooms one booking may take — the ceiling for `roomsNeeded`. */
  maxRoomsPerBooking: number;
}

/**
 * Used only when a setting is missing — a database seeded before the policy
 * existed. Unlike the tax settings, a missing value here cannot misprice a
 * stay, so falling back is safer than refusing every search.
 */
export const DEFAULT_GUEST_POLICY: GuestPolicy = {
  adultFromAge: 12,
  infantUpToAge: 1,
  maxRoomsPerBooking: 4,
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

/** What a room type takes, as the admin set it. */
export interface RoomCapacity {
  /** Beds: adults and children together. */
  maxOccupancy: number;
  maxAdults: number;
  maxChildren: number;
  /** Cots. */
  maxInfants: number;
}

/** Why a party does not fit a room type, or null when it does. */
export type OccupancyProblem =
  | 'too-many-adults'
  | 'too-many-children'
  | 'too-many-guests'
  | 'too-many-infants';

/**
 * Whether a party fits `roomsCount` rooms of a type.
 *
 * Capacity is shared across the rooms booked, as the existing occupancy check
 * always measured it: two rooms that sleep two take a party of four, however
 * the guests then split between them.
 */
export function occupancyProblem(
  occupants: Occupants,
  room: RoomCapacity,
  roomsCount: number,
): OccupancyProblem | null {
  if (occupants.adults > room.maxAdults * roomsCount) return 'too-many-adults';
  if (occupants.children > room.maxChildren * roomsCount) return 'too-many-children';
  if (occupants.adults + occupants.children > room.maxOccupancy * roomsCount) {
    return 'too-many-guests';
  }
  if (occupants.infants > room.maxInfants * roomsCount) {
    return 'too-many-infants';
  }
  return null;
}

/**
 * The fewest rooms of a type that take the whole party, or null if none do.
 *
 * This is what lets a family of four book two Deluxe Twin Rooms instead of
 * being told the room "is not large enough" — the way every large booking
 * site answers a party bigger than one room. The guest never counts rooms:
 * the API offers each room type at the number it takes.
 *
 * Two rules on top of capacity:
 *   - **Every room needs an adult.** One adult and three children cannot be
 *     split across two rooms, so the count never exceeds the adults.
 *   - **A booking takes at most `maxRoomsPerBooking`.** Beyond that it is a
 *     group, which the hotel handles directly.
 *
 * Capacity is shared across the rooms, as `occupancyProblem` measures it; how
 * the party splits between them is arranged at check-in.
 */
export function roomsNeeded(
  occupants: Occupants,
  room: RoomCapacity,
  policy: GuestPolicy,
): number | null {
  const ceiling = Math.min(policy.maxRoomsPerBooking, occupants.adults);
  for (let rooms = 1; rooms <= ceiling; rooms += 1) {
    if (!occupancyProblem(occupants, room, rooms)) return rooms;
  }
  return null;
}

/** Guests beyond what the rate includes, by who pays which fee. */
export interface ExtraGuests {
  adults: number;
  children: number;
}

/**
 * Who in the party is charged as an extra guest.
 *
 * The rate includes `baseOccupancy` guests per room. **Adults fill those places
 * first**, so when a party exceeds them it is the children who are extra —
 * charged the child fee, which is the lower one at every hotel that has both.
 * The other order would quietly charge a family the adult fee for their child.
 * Infants take no bed and are never charged.
 */
export function extraGuests(
  occupants: Occupants,
  baseOccupancy: number,
  roomsCount: number,
): ExtraGuests {
  const included = baseOccupancy * roomsCount;
  const adults = Math.max(0, occupants.adults - included);
  const placesLeft = Math.max(0, included - occupants.adults);
  return { adults, children: Math.max(0, occupants.children - placesLeft) };
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
    maxRoomsPerBooking: read(
      'guests_max_rooms_per_booking',
      DEFAULT_GUEST_POLICY.maxRoomsPerBooking,
      1,
      10,
    ),
  };
}

export const GUEST_POLICY_KEYS = [
  'guests_adult_from_age',
  'guests_infant_up_to_age',
  'guests_max_rooms_per_booking',
] as const;
