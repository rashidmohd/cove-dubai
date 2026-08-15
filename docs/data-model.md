# Cove Dubai — data model

A vendor-neutral description of every entity and field in the Phase 1
reservation engine, in the language the hospitality industry uses rather than
ours.

This document exists because the client may later move reservations onto a
third-party PMS, and no vendor has been chosen. When one is, this note maps
directly onto their model and becomes the Phase 2 integration brief. Keep it
current as the schema changes — the `pms-readiness` skill requires it.

The schema itself is [`server/prisma/schema.prisma`](../server/prisma/schema.prisma).

## Shape of the model

```
RoomType ──< RatePlan              what a room costs, and when
   │
   ├──────< RoomTypeInventory      how many exist per night, how many are sold
   │
   └──────< Reservation >── Guest  who is staying, when, for how much
```

Every entity here has a direct counterpart in any mainstream PMS. Nothing is
shaped around our current screens.

## Entities

### RoomType

The bookable unit. PMS platforms sell by *type and count* rather than by
individual room, so this — not a physical room — is what a guest reserves.

| Field | Meaning |
|---|---|
| `code` | Stable public identifier (`cove-suite`). Used in URLs and the API so internal ids are never exposed. |
| `nameEn` / `nameAr` | Room name, per language. |
| `categoryEn` / `categoryAr` | Marketing tier shown above the name — Classic, Deluxe, Premium, Signature. |
| `descriptionEn` / `descriptionAr` | Long description. |
| `baseRateAed` | Fallback nightly rate when no RatePlan covers a date. |
| `maxOccupancy` | Maximum guests. |
| `totalRooms` | Rooms of this type the hotel owns. Seeds the per-date ledger; the ledger is authoritative thereafter. |
| `imageKey` | Style key for the CSS treatment in the mockups. Becomes an asset path when the client supplies photography. |
| `sortOrder`, `isActive` | Display order; soft removal without deleting history. |

Current inventory totals 106 rooms: Studio 44, Terrace 34, Corner Suite 20,
Cove Suite 8.

**Physical rooms are deliberately not modelled.** Assigning a guest to room 412
is a housekeeping concern that a PMS owns. Adding it now would build toward a
vendor we have not chosen.

### RatePlan

A nightly rate for a room type, optionally limited to a date window — so
seasonal pricing is data the hotel edits, not code we redeploy.

| Field | Meaning |
|---|---|
| `nightlyRateAed` | The rate this plan charges. |
| `startDate` / `endDate` | The window. `NULL` on both means the always-applicable default plan. A database constraint forbids a one-sided window, which would be ambiguous to price against. |
| `minimumStayNights` | Minimum stay this plan requires. |
| `priority` | Higher wins where windows overlap. |

### RoomTypeInventory

One row per room type per night. **This is the double-booking guard.**

| Field | Meaning |
|---|---|
| `date` | The night being sold. A three-night stay touches three rows. |
| `totalRooms` | Rooms available that night. |
| `bookedRooms` | Rooms already sold that night. |
| `isClosed` | Closes a date for maintenance without losing its booking count. |

Availability is derived — `totalRooms - bookedRooms` — rather than stored, so it
cannot drift from reality. Unique on `(roomTypeId, date)` and indexed for
range queries.

Booking increments `bookedRooms` across every night of the stay inside a single
transaction. A CHECK constraint enforces `0 <= bookedRooms <= totalRooms`, so if
any night is full the entire transaction rolls back and nothing is written.

> **Why a ledger rather than a Postgres `EXCLUDE` constraint.** An exclusion
> constraint over overlapping date ranges is the usual instinct, and it is the
> right tool when each row is one physical room. It cannot express "at most 8 of
> this type on this night", which is what selling by type and count requires.
> The ledger can, and keeps the guarantee in the database where it belongs.

### Guest

The profile any PMS expects.

| Field | Meaning |
|---|---|
| `firstName`, `lastName`, `email`, `phone` | Contact details. |
| `nationality`, `idDocumentType`, `idDocumentNumber` | Optional, unused in Phase 1. Present because compliance reporting will need them under whatever PMS is chosen, and adding them later would mean migrating live guest data. |
| `preferredLocale` | `EN` or `AR` — decides which language the guest's emails are sent in. |
| `externalRef` | Reserved for a PMS's own guest identifier. Null in Phase 1. |

### Reservation

| Field | Meaning |
|---|---|
| `bookingReference` | The booking's public identity (`CV-2026-4821`) — human-friendly, non-sequential, unique in the database. Used in URLs, emails and the admin UI. Internal ids are never exposed. |
| `checkIn` / `checkOut` | Check-in inclusive, check-out exclusive: 12th→14th is two nights. A constraint enforces `checkOut > checkIn`, so a zero-night booking — which would touch no ledger rows and therefore consume no inventory — cannot exist. |
| `adults`, `children`, `roomsCount` | Occupancy. |
| `status` | `HELD` · `CONFIRMED` · `CANCELLED` · `CHECKED_IN` · `CHECKED_OUT`. Phase 1 confirms immediately, so `HELD` is rare. |
| `priceBreakdown` | The full breakdown as computed at booking time — room total, Tourism Dirham, VAT, grand total. **Snapshotted, never recomputed**, so a later rate or tax change cannot rewrite a total the guest was already quoted and emailed. |
| `totalAmountAed` | Grand total from that snapshot, denormalised for reporting. |
| `specialRequests` / `internalNotes` | Guest-supplied; staff-only. |
| `cancellationToken` | Single-use secret behind the guest's cancellation link. The link is keyed to this, never to an internal id. |
| `externalRef` | Reserved for a PMS's own reservation identifier. Null in Phase 1. |

### AdminUser, AuditLog, Setting

`AdminUser` — session-based hotel staff accounts, roles `ADMIN` or `STAFF`.
Passwords are scrypt hashes with their cost parameters stored alongside, so the
parameters can be raised later without invalidating existing passwords.

`AuditLog` — append-only record of every administrative action, required by the
baseline in `CLAUDE.md`. `adminUserId` is null for system-initiated actions such
as a guest self-cancelling.

`Setting` — operational values that must change without a deploy:

| Key | Value | Note |
|---|---|---|
| `tourism_dirham_per_room_per_night_aed` | `20` | **Placeholder.** Depends on the property's DET classification, not yet confirmed. Must be verified before launch. |
| `vat_rate_percent` | `5` | UAE VAT on the accommodation charge. |
| `currency` | `AED` | |
| `cancellation_policy_hours` | `48` | Free-cancellation window before check-in. |

## Integrity guaranteed by the database

Nine CHECK constraints, applied in the initial migration and verified against
the live database. They are written by hand because Prisma's schema language
cannot express them.

| Constraint | Prevents |
|---|---|
| `room_type_inventory_booked_within_total` | **Overselling.** The core guarantee. |
| `room_type_inventory_total_non_negative` | Negative inventory. |
| `reservations_checkout_after_checkin` | Zero- or negative-length stays. |
| `reservations_occupancy_positive` | A booking for nobody, or zero rooms. |
| `reservations_total_non_negative` | Negative totals. |
| `room_types_base_rate_non_negative`, `rate_plans_nightly_rate_non_negative` | Negative rates. |
| `rate_plans_date_window_complete` | One-sided or inverted seasonal windows. |
| `rate_plans_minimum_stay_positive` | A minimum stay below one night. |

Application-level availability checks exist for user experience only. These
constraints are the guarantee — two guests racing for the last room are
separated by the database, not by our code.

## Notes for a future PMS migration

- Map `bookingReference` to the PMS's own reference and keep ours as the guest
  facing identifier, so links in already-sent emails keep working.
- `externalRef` on `Reservation` and `Guest` is where the PMS's identifiers go.
  No schema change is needed to start recording them.
- If the chosen PMS owns availability, `RoomTypeInventory` becomes a read-through
  cache or is retired — nothing outside the booking provider reads it directly.
- `priceBreakdown` is a snapshot and should be migrated as historical data, not
  recomputed against the PMS's current rates.
