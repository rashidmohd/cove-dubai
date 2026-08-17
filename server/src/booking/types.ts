/**
 * Domain types for the booking layer.
 *
 * These are the vocabulary of the seam. Every one of them describes a
 * hospitality *concept* — a room type, a stay, a price breakdown — and none of
 * them describes how we happen to store it. No Prisma model, no table name, and
 * no internal database id appears here or crosses the HTTP boundary.
 *
 * That discipline is what lets a future PMS replace the implementation without
 * the front-end noticing (see the `pms-readiness` skill).
 *
 * Conventions:
 *   - Dates are `YYYY-MM-DD` strings. A stay is a range of calendar days, not
 *     a range of instants, so a timezone-bearing timestamp would be actively
 *     misleading here.
 *   - Check-in is inclusive, check-out is exclusive: 12th → 14th is two nights.
 *   - Money is a number of AED rounded to 2 decimal places. Arithmetic is done
 *     in Decimal internally and only rounded at this boundary.
 *   - A room type is identified by `code`, a reservation by `reference`.
 */

/** A calendar day, `YYYY-MM-DD`. */
export type IsoDate = string;

export type Locale = 'en' | 'ar';

export type ReservationStatus =
  | 'held'
  | 'confirmed'
  | 'cancelled'
  | 'checked-in'
  | 'checked-out';

/** Localized text, always carrying both languages so neither can go missing. */
export interface LocalizedText {
  en: string;
  ar: string;
}

/**
 * Something a room comes with — air conditioning, a safe, a balcony.
 *
 * `otaCode` is the OpenTravel **RMA (Room Amenity Type)** code, the vocabulary
 * OTAs, channel managers and PMS platforms exchange. Carrying it through the
 * seam means a future integration maps these by lookup rather than by someone
 * re-typing them. Null where the standard has no code for it.
 */
export interface Amenity {
  code: string;
  otaCode: number | null;
  name: LocalizedText;
  category: AmenityCategory;
  iconKey: string | null;
}

export type AmenityCategory =
  | 'bathroom'
  | 'comfort'
  | 'technology'
  | 'services'
  | 'accessibility';

export interface RoomType {
  /** Public identifier used in URLs and the API (`cove-suite`). */
  code: string;
  name: LocalizedText;
  category: LocalizedText;
  description: LocalizedText;
  maxOccupancy: number;
  /** Lowest nightly rate currently published, for "from AED x" displays. */
  baseRate: number;
  imageKey: string;
  /** What the room comes with, ordered for display. */
  amenities: Amenity[];
}

/** A room type offered for a specific stay, with that stay priced. */
export interface AvailableRoomType extends RoomType {
  /** Rooms of this type still sellable for every night of the stay. */
  roomsAvailable: number;
  /** What this stay costs in this room type. */
  price: PriceBreakdown;
}

/**
 * The full cost of a stay, itemised.
 *
 * `booking-engine` requires the guest sees room total, Tourism Dirham and VAT
 * separately rather than one opaque figure — the fees are shown, not charged,
 * and both are government-set.
 *
 * A copy of this is snapshotted onto the reservation at creation. It is never
 * recomputed afterwards, so a later rate or tax change cannot rewrite a total
 * the guest has already been quoted.
 */
export interface PriceBreakdown {
  currency: string;
  nights: number;
  roomsCount: number;
  /** Per-night rates making up the room total, for a transparent breakdown. */
  nightlyRates: Array<{ date: IsoDate; rate: number }>;
  /** Nightly rates summed across every night and room, before any discount. */
  roomTotal: number;
  /**
   * Present only when a voucher was applied.
   *
   * `amount` comes off `roomTotal`, and VAT below is charged on what remains.
   * The Tourism Dirham is untouched by it — see `pricing.ts` for why.
   */
  discount?: {
    code: string;
    name: LocalizedText;
    amount: number;
  };
  /** Dubai Tourism Dirham: a per-room, per-night government fee. Never discounted. */
  tourismDirham: {
    perRoomPerNight: number;
    total: number;
  };
  /** UAE VAT, charged on the accommodation total *after* any discount. */
  vat: {
    ratePercent: number;
    total: number;
  };
  grandTotal: number;
}

export interface GuestDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Decides which language the guest's emails are sent in. */
  locale: Locale;
}

export interface Stay {
  checkIn: IsoDate;
  /** Exclusive — the departure day, not the last night. */
  checkOut: IsoDate;
  adults: number;
  children: number;
  roomsCount: number;
}

export interface AvailabilityQuery extends Omit<Stay, 'roomsCount'> {
  roomsCount?: number;
}

/** Everything needed to create a reservation. */
export interface ReservationDraft extends Stay {
  roomTypeCode: string;
  guest: GuestDetails;
  // `| undefined` is explicit because `exactOptionalPropertyTypes` is on and
  // validated request bodies arrive with the key present but undefined.
  specialRequests?: string | undefined;
  /** An optional discount code, validated and claimed when the booking commits. */
  voucherCode?: string | undefined;
}

export interface Reservation {
  /** The booking's public identity (`CV-2026-4821`). */
  reference: string;
  status: ReservationStatus;
  roomType: RoomType;
  stay: Stay;
  guest: GuestDetails;
  specialRequests?: string;
  /** The snapshot taken at booking time. */
  price: PriceBreakdown;
  createdAt: string;
  cancelledAt?: string;
  checkedInAt?: string;
  checkedOutAt?: string;
}

// `| undefined` is explicit throughout the optional fields below because
// `exactOptionalPropertyTypes` is on: a validated request body arrives with
// the key present and set to undefined, which is not the same as absent.

export interface ReservationFilter {
  status?: ReservationStatus | undefined;
  roomTypeCode?: string | undefined;
  /** Reservations whose stay overlaps this window. */
  from?: IsoDate | undefined;
  to?: IsoDate | undefined;
  /** Free-text search over guest name, email, and booking reference. */
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ReservationChanges {
  checkIn?: IsoDate | undefined;
  checkOut?: IsoDate | undefined;
  roomTypeCode?: string | undefined;
  adults?: number | undefined;
  children?: number | undefined;
  roomsCount?: number | undefined;
  specialRequests?: string | undefined;
}

export interface OccupancyReport {
  from: IsoDate;
  to: IsoDate;
  days: Array<{
    date: IsoDate;
    roomsAvailable: number;
    roomsBooked: number;
    occupancyPercent: number;
  }>;
  /** Confirmed revenue for stays overlapping the window. */
  revenueTotal: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Admin-facing shapes
// ---------------------------------------------------------------------------

/**
 * A room type as the admin sees it.
 *
 * Carries the two fields the guest view has no business knowing: whether the
 * type is on sale at all, and how many rooms of it the hotel physically owns.
 */
export interface AdminRoomType extends RoomType {
  isActive: boolean;
  totalRooms: number;
}

/** An amenity as the admin sees it, including ones withdrawn from display. */
export interface AdminAmenity extends Amenity {
  isActive: boolean;
  sortOrder: number;
  /** How many room types currently list it — a delete guard for the UI. */
  roomTypeCount: number;
}

export interface AmenityDraft {
  code: string;
  otaCode?: number | null | undefined;
  name: LocalizedText;
  category: AmenityCategory;
  iconKey?: string | null | undefined;
  sortOrder?: number | undefined;
}

export interface AmenityChanges {
  otaCode?: number | null | undefined;
  name?: LocalizedText | undefined;
  category?: AmenityCategory | undefined;
  iconKey?: string | null | undefined;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
}

export interface RoomTypeChanges {
  name?: LocalizedText | undefined;
  category?: LocalizedText | undefined;
  description?: LocalizedText | undefined;
  maxOccupancy?: number | undefined;
  baseRate?: number | undefined;
  imageKey?: string | undefined;
  isActive?: boolean | undefined;
}

/** One night of sellable inventory for one room type. */
export interface InventoryDay {
  date: IsoDate;
  /** Rooms of this type on sale that night. */
  totalRooms: number;
  /** Rooms already committed to reservations. Never editable directly. */
  bookedRooms: number;
  /** Stop-sell: the type is withheld that night regardless of the count. */
  isClosed: boolean;
}

export interface InventoryCalendar {
  roomTypeCode: string;
  from: IsoDate;
  /** Inclusive — a calendar is read as a span of days, not a stay. */
  to: IsoDate;
  days: InventoryDay[];
}

export interface InventoryChanges {
  totalRooms?: number | undefined;
  isClosed?: boolean | undefined;
}

/**
 * An operational value the hotel can change without a deploy — the Tourism
 * Dirham amount above all, which depends on a DET classification the client
 * has not yet confirmed.
 */
export interface OperationalSetting {
  key: string;
  value: string;
  description: string;
  updatedAt: string;
}

/**
 * Errors the booking layer raises.
 *
 * A distinct type per failure so routes can map them to status codes without
 * inspecting messages, and so `NO_AVAILABILITY` — the one a guest will actually
 * hit in a race — is unambiguous.
 */
export type BookingErrorCode =
  | 'NO_AVAILABILITY'
  | 'ROOM_TYPE_NOT_FOUND'
  | 'RESERVATION_NOT_FOUND'
  | 'INVALID_STAY'
  | 'OCCUPANCY_EXCEEDED'
  | 'MINIMUM_STAY_NOT_MET'
  | 'ALREADY_CANCELLED'
  | 'CANCELLATION_NOT_PERMITTED'
  | 'INVALID_CANCELLATION_TOKEN'
  /** An admin tried to cut inventory below the rooms already sold. */
  | 'INVENTORY_BELOW_BOOKED'
  | 'SETTING_NOT_FOUND'
  | 'AMENITY_NOT_FOUND'
  /** An amenity code is already taken, or an OTA code is claimed twice. */
  | 'AMENITY_CODE_IN_USE'
  | 'VOUCHER_NOT_FOUND'
  | 'VOUCHER_EXPIRED'
  /** Fully redeemed — the guest lost a race, or the campaign is over. */
  | 'VOUCHER_EXHAUSTED'
  /** Real and live, but not for this stay: too short, wrong room, too cheap. */
  | 'VOUCHER_NOT_APPLICABLE'
  | 'VOUCHER_CODE_IN_USE'
  /** A reservation cannot move to the requested status from its current one. */
  | 'INVALID_STATUS_TRANSITION';

export class BookingError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    message: string,
    /** Extra context for the client, e.g. which nights were unavailable. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BookingError';
  }
}
