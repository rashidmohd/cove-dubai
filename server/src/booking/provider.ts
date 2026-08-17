/**
 * The BookingProvider interface — **the seam**.
 *
 * Everything the hotel does with reservations passes through this one
 * interface. Express routes depend on it and nothing below it; they never reach
 * past it into Prisma.
 *
 * The client has not chosen a PMS. Rather than design for a specific vendor, we
 * make the reservation engine swappable so that whichever they eventually pick
 * is an integration rather than a rebuild. Concretely, Phase 2 means writing one
 * new class that implements this interface and changing one wiring line in
 * `getBookingProvider()`. Routes, the HTTP contract, and the entire front-end
 * stay untouched.
 *
 * Rules this interface obeys, from the `pms-readiness` skill:
 *
 *   - Methods are shaped around what any PMS offers, not around our tables.
 *   - Arguments and results reference entities and fields — a room type `code`,
 *     a booking `reference` — never a row id from a table of ours.
 *   - Results stay in shapes a typical PMS could also produce.
 *
 * There is deliberately **no** `PmsProvider` in this repository. That is Phase
 * 2, and the vendor is undecided; building an adapter now would mean designing
 * for a guess.
 */
import type {
  AdminAmenity,
  AdminRoomType,
  AmenityChanges,
  AmenityDraft,
  AvailabilityQuery,
  AvailableRoomType,
  InventoryCalendar,
  InventoryChanges,
  IsoDate,
  OccupancyReport,
  OperationalSetting,
  PriceBreakdown,
  Reservation,
  ReservationChanges,
  ReservationDraft,
  ReservationFilter,
  RoomType,
  RoomTypeChanges,
} from './types.js';

export interface BookingProvider {
  // --- Guest-facing reads --------------------------------------------------

  /** Every room type the hotel sells, for the marketing and rooms pages. */
  getRoomTypes(): Promise<RoomType[]>;

  getRoomType(code: string): Promise<RoomType | null>;

  /**
   * Room types with enough inventory for the whole stay, each priced for it.
   *
   * This is the guest's view of availability and is advisory only: inventory
   * can be taken between this call and `createReservation`. The authoritative
   * check happens inside that method's transaction.
   */
  checkAvailability(query: AvailabilityQuery): Promise<AvailableRoomType[]>;

  /** Price a stay in a room type without touching inventory. */
  getRate(args: {
    roomTypeCode: string;
    checkIn: IsoDate;
    checkOut: IsoDate;
    roomsCount?: number;
  }): Promise<PriceBreakdown>;

  // --- Writes --------------------------------------------------------------

  /**
   * Create a reservation. **Atomic.**
   *
   * Re-checking availability and committing inventory happen inside a single
   * database transaction, guarded by a constraint that makes overselling
   * impossible. Either the booking is written in full or nothing is — never a
   * partial write.
   *
   * Throws `BookingError('NO_AVAILABILITY')` when the stay cannot be committed,
   * which includes losing a race for the last room.
   */
  createReservation(draft: ReservationDraft): Promise<Reservation>;

  /**
   * Cancel a reservation and release its inventory.
   *
   * `guestToken` is the secret from the guest's confirmation email. When
   * present it is verified, so a guest can only cancel their own booking — a
   * booking reference alone is not sufficient authority, since references
   * appear in inboxes and on printouts. Admin callers omit it; they are already
   * authenticated.
   */
  cancelReservation(
    reference: string,
    context?: { guestToken?: string; reason?: string },
  ): Promise<Reservation>;

  /**
   * Change a reservation. Re-runs the same availability and atomicity rules as
   * creating one — a modification is a booking too.
   */
  modifyReservation(
    reference: string,
    changes: ReservationChanges,
  ): Promise<Reservation>;

  // --- Reservation reads ---------------------------------------------------

  /** Look a reservation up by its public reference. Never by internal id. */
  getReservation(reference: string): Promise<Reservation | null>;

  /**
   * The secret that authorises a guest to cancel their own booking.
   *
   * Deliberately **not** a field on `Reservation`: that shape is returned over
   * HTTP, and anyone who knows a reference could then cancel a stranger's
   * stay. It exists as its own method so the one legitimate caller — the email
   * layer, building the link at send time — is easy to find and audit.
   *
   * Returns null once the token has been burned by a cancellation.
   */
  getCancellationToken(reference: string): Promise<string | null>;

  /** Admin list view: filter by date, status and room type; search by name. */
  listReservations(
    filter: ReservationFilter,
  ): Promise<{ reservations: Reservation[]; total: number }>;

  // --- Admin reporting -----------------------------------------------------

  getOccupancyReport(args: { from: IsoDate; to: IsoDate }): Promise<OccupancyReport>;

  /** Arrivals and departures for a given day, for the front desk. */
  getArrivalsAndDepartures(date: IsoDate): Promise<{
    arrivals: Reservation[];
    departures: Reservation[];
  }>;

  // --- Admin writes --------------------------------------------------------
  //
  // These belong behind the seam for the same reason the guest reads do: rooms,
  // rates, inventory and tax configuration are exactly what a PMS takes over.
  // If the admin panel wrote them through Prisma directly, Phase 2 would have
  // to rebuild the admin panel as well as the booking flow.

  /** Room types including inactive ones, which guests never see. */
  listRoomTypes(): Promise<AdminRoomType[]>;

  // --- Amenities -----------------------------------------------------------
  //
  // Behind the seam like everything else about a room: amenities are standard
  // hospitality data (OpenTravel RMA codes), and a PMS would own them.

  /** Every amenity, including withdrawn ones, for the admin screen. */
  listAmenities(): Promise<AdminAmenity[]>;

  createAmenity(draft: AmenityDraft): Promise<AdminAmenity>;

  updateAmenity(code: string, changes: AmenityChanges): Promise<AdminAmenity>;

  /**
   * Remove an amenity from the vocabulary entirely.
   *
   * Refused while any room type still lists it — deleting would silently strip
   * it from those rooms' published descriptions. Withdraw it with
   * `isActive: false` instead, which hides it without rewriting history.
   */
  deleteAmenity(code: string): Promise<void>;

  /**
   * Replace a room type's amenity list wholesale.
   *
   * A set rather than add/remove calls: the admin screen edits the whole list
   * at once, and one atomic replacement cannot leave a half-applied selection
   * if the request fails midway.
   */
  setRoomTypeAmenities(
    roomTypeCode: string,
    amenityCodes: string[],
  ): Promise<AdminRoomType>;

  /** Edit a room type's content, occupancy, or base rate. */
  updateRoomType(
    code: string,
    changes: RoomTypeChanges,
  ): Promise<AdminRoomType>;

  /**
   * The availability calendar for one room type over a span of days.
   *
   * `to` is inclusive here, unlike a stay's check-out — a calendar is read as
   * a range of days, and an exclusive end date reads as an off-by-one bug to
   * whoever maintains the screen.
   */
  getInventoryCalendar(args: {
    roomTypeCode: string;
    from: IsoDate;
    to: IsoDate;
  }): Promise<InventoryCalendar>;

  /**
   * Set inventory across a date range. **Atomic.**
   *
   * Throws `BookingError('INVENTORY_BELOW_BOOKED')` rather than truncating if
   * the new count is below what is already sold on any night in the range —
   * silently overselling to satisfy an admin's typo is the one outcome the
   * whole engine exists to prevent.
   */
  updateInventory(args: {
    roomTypeCode: string;
    from: IsoDate;
    to: IsoDate;
    changes: InventoryChanges;
  }): Promise<InventoryCalendar>;

  /** Move a reservation through the front-desk lifecycle. */
  setReservationStatus(
    reference: string,
    status: 'checked-in' | 'checked-out',
  ): Promise<Reservation>;

  // --- Operational settings ------------------------------------------------

  /** Every operational setting, for the admin settings screen. */
  listSettings(): Promise<OperationalSetting[]>;

  /**
   * Change one setting. Takes effect on the next quote — pricing reads these
   * per request, so the Tourism Dirham can be corrected without a deploy.
   *
   * Existing reservations are unaffected: each one snapshots its own price
   * breakdown at booking time and is never repriced.
   */
  updateSetting(key: string, value: string): Promise<OperationalSetting>;
}
