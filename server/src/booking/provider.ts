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
  AvailabilityQuery,
  AvailableRoomType,
  IsoDate,
  OccupancyReport,
  PriceBreakdown,
  Reservation,
  ReservationChanges,
  ReservationDraft,
  ReservationFilter,
  RoomType,
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
}
