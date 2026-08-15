/**
 * The shape of the booking API's responses.
 *
 * These mirror `server/src/booking/types.ts`. They are duplicated rather than
 * imported because `web` and `server` are separate npm projects that deploy
 * independently — there is no shared workspace package to import from, and
 * introducing one would complicate both builds for the sake of one file.
 *
 * The duplication is deliberate but it is a real cost: change a domain type on
 * the server and this file must follow. The e2e tests run against the real API,
 * so a drift shows up as a test failure rather than a silent runtime bug.
 */

export type IsoDate = string;

export type Locale = 'en' | 'ar';

export type ReservationStatus =
  | 'held'
  | 'confirmed'
  | 'cancelled'
  | 'checked-in'
  | 'checked-out';

export interface LocalizedText {
  en: string;
  ar: string;
}

export interface RoomType {
  code: string;
  name: LocalizedText;
  category: LocalizedText;
  description: LocalizedText;
  maxOccupancy: number;
  baseRate: number;
  imageKey: string;
}

export interface PriceBreakdown {
  currency: string;
  nights: number;
  roomsCount: number;
  nightlyRates: Array<{ date: IsoDate; rate: number }>;
  roomTotal: number;
  tourismDirham: { perRoomPerNight: number; total: number };
  vat: { ratePercent: number; total: number };
  grandTotal: number;
}

export interface AvailableRoomType extends RoomType {
  roomsAvailable: number;
  price: PriceBreakdown;
}

export interface GuestDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  locale: Locale;
}

export interface Stay {
  checkIn: IsoDate;
  checkOut: IsoDate;
  adults: number;
  children: number;
  roomsCount: number;
}

export interface Reservation {
  reference: string;
  status: ReservationStatus;
  roomType: RoomType;
  stay: Stay;
  guest: GuestDetails;
  specialRequests?: string;
  price: PriceBreakdown;
  createdAt: string;
  cancelledAt?: string;
}

export interface CreateReservationInput {
  roomTypeCode: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  adults: number;
  children: number;
  roomsCount: number;
  guest: GuestDetails;
  specialRequests?: string;
}

/** Error codes the API returns. The UI branches on these, never on prose. */
export type ApiErrorCode =
  | 'NO_AVAILABILITY'
  | 'ROOM_TYPE_NOT_FOUND'
  | 'RESERVATION_NOT_FOUND'
  | 'INVALID_STAY'
  | 'OCCUPANCY_EXCEEDED'
  | 'MINIMUM_STAY_NOT_MET'
  | 'ALREADY_CANCELLED'
  | 'CANCELLATION_NOT_PERMITTED'
  | 'INVALID_CANCELLATION_TOKEN'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  /** Raised by the client itself when the API cannot be reached at all. */
  | 'NETWORK_ERROR';
