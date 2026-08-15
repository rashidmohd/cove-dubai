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
  /** Nightly rates summed across every night and room. */
  roomTotal: number;
  /** Dubai Tourism Dirham: a per-room, per-night government fee. */
  tourismDirham: {
    perRoomPerNight: number;
    total: number;
  };
  /** UAE VAT on the accommodation charge. */
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

export interface ReservationFilter {
  status?: ReservationStatus;
  roomTypeCode?: string;
  /** Reservations whose stay overlaps this window. */
  from?: IsoDate;
  to?: IsoDate;
  /** Free-text search over guest name, email, and booking reference. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ReservationChanges {
  checkIn?: IsoDate;
  checkOut?: IsoDate;
  roomTypeCode?: string;
  adults?: number;
  children?: number;
  roomsCount?: number;
  specialRequests?: string;
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
  | 'INVALID_CANCELLATION_TOKEN';

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
