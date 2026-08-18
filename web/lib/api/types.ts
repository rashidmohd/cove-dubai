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

export type AmenityCategory =
  | 'bathroom'
  | 'comfort'
  | 'technology'
  | 'services'
  | 'accessibility';

/**
 * Something a room comes with.
 *
 * `otaCode` is the OpenTravel RMA code — the vocabulary channel managers and
 * PMS platforms exchange. The front-end does not use it, but it travels with
 * the amenity so nothing downstream has to look it up separately.
 */
export interface Amenity {
  code: string;
  otaCode: number | null;
  name: LocalizedText;
  category: AmenityCategory;
  iconKey: string | null;
}

/**
 * A photograph of a room type.
 *
 * A URL, already public and ready to render — the front-end never sees a bucket
 * key or learns which object store the bytes are in.
 */
export interface RoomImage {
  url: string;
  /** Identifies the image in admin calls. Already public: it is in the URL. */
  storageKey: string;
  alt: LocalizedText;
  /** Intrinsic pixels, so space can be reserved before the image loads. */
  width: number;
  height: number;
}

export interface RoomType {
  code: string;
  name: LocalizedText;
  category: LocalizedText;
  description: LocalizedText;
  maxOccupancy: number;
  baseRate: number;
  imageKey: string;
  /**
   * Ordered by category then sort order, ready to render as-is.
   *
   * **Optional on purpose.** The marketing pages cache room types for an hour
   * and the two services deploy independently, so a response from before this
   * field existed is a normal thing to meet rather than a fault. Marking it
   * optional makes the compiler insist on the guard at every read instead of
   * leaving it to whoever writes the next component.
   */
  amenities?: Amenity[];
  /**
   * Photographs, primary first.
   *
   * Optional for the same reason as `amenities`: the marketing pages cache room
   * types for an hour and the two services deploy independently, so a response
   * from before this field existed is normal rather than a fault. `imageKey`
   * remains the fallback for a room type with no photography.
   */
  images?: RoomImage[];
}

/** A rate plan the hotel is advertising. See `Offer` in the server types. */
export interface Offer {
  roomTypeCode: string;
  roomTypeName: LocalizedText;
  imageKey: string;
  images: RoomImage[];
  name: LocalizedText;
  description: LocalizedText | null;
  nightlyRate: number;
  /** Null when the offer is not actually cheaper than the standard rate. */
  standardRate: number | null;
  validFrom: IsoDate | null;
  validTo: IsoDate | null;
  minimumStayNights: number;
  /** `0` = Sunday. All seven means no restriction. */
  daysOfWeek: number[];
}

export interface PriceBreakdown {
  currency: string;
  nights: number;
  roomsCount: number;
  nightlyRates: Array<{ date: IsoDate; rate: number }>;
  /** Before any discount. */
  roomTotal: number;
  /**
   * Present only when a voucher was applied.
   *
   * VAT below is already charged on the discounted accommodation total, and
   * the Tourism Dirham is untouched by it — the API does that arithmetic, and
   * the summary only renders what it is given (`pms-readiness`).
   */
  discount?: {
    code: string;
    name: LocalizedText;
    amount: number;
  };
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
  /** Optional discount code, claimed atomically when the booking commits. */
  voucherCode?: string;
}

/** What a discount code is worth for a stay, before committing to it. */
export interface VoucherPreview {
  code: string;
  name: LocalizedText;
  /** The whole stay repriced, so the summary never does arithmetic itself. */
  price: PriceBreakdown;
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
  // --- Admin panel ---------------------------------------------------------
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF_TOKEN_MISSING'
  | 'CSRF_TOKEN_INVALID'
  | 'INVALID_CREDENTIALS'
  | 'INVENTORY_BELOW_BOOKED'
  | 'INVALID_STATUS_TRANSITION'
  /** No such image, or it is not attached to the room type named. */
  | 'MEDIA_NOT_FOUND'
  /** A gallery reorder listed something other than the current images. */
  | 'MEDIA_ORDER_MISMATCH'
  /** Object storage is not configured on this environment. */
  | 'MEDIA_NOT_CONFIGURED'
  | 'SETTING_NOT_FOUND'
  | 'AMENITY_NOT_FOUND'
  | 'AMENITY_CODE_IN_USE'
  | 'VOUCHER_NOT_FOUND'
  | 'VOUCHER_EXPIRED'
  | 'VOUCHER_EXHAUSTED'
  | 'VOUCHER_NOT_APPLICABLE'
  | 'VOUCHER_CODE_IN_USE'
  /** Raised by the client itself when the API cannot be reached at all. */
  | 'NETWORK_ERROR';
