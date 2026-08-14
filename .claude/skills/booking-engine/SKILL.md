---
name: booking-engine
description: The reservation business rules for Cove Dubai — availability checks, concurrency-safe atomic booking writes, the pay-at-check-in (no online payment) model, Tourism Dirham and UAE VAT price display, booking references, bilingual confirmation/cancellation emails, and cancellation/modification. Use this skill for ANY work in the reservation path on the Cove Dubai project: the Reserve flow, the booking API, availability queries, pricing, or the admin reservations dashboard. These rules protect against double-bookings and pricing errors — do not improvise them.
---

# Cove Dubai — Booking Engine

Rules for everything in the reservation path. Getting these wrong means double-bookings or wrong prices, so
follow them exactly. All logic here lives in the **Express API** (the booking API layer), behind the `BookingProvider` interface —
never in the Next.js front-end (see **pms-readiness**).

## The booking journey (from the mockups)

1. **Availability** — guest picks check-in/check-out + guest count. Query live inventory; show available room
   types with pricing for the stay.
2. **Room selection** — guest picks a room type; show price per night and total for the stay, clearly.
3. **Guest details** — name, email, phone, special requests. **No payment is taken** (see below).
4. **Confirmation** — reservation written atomically; unique booking reference generated; confirmation email
   sent to guest **and** hotel automatically.

Support **session persistence** (progress survives navigation away) and clear **error states** for unavailable
dates, failed submissions, and network errors. Full **WCAG 2.1 AA** on all inputs (see **arabic-rtl** for
bilingual labels and error messages).

## No online payment — pay at check-in

- The launch model is **pay at check-in**. The booking completes **without** taking money.
- Do **not** add a payment gateway, card capture, or deposit step. If the client later wants deposits, that's a
  scope change — raise it, don't implement it silently.
- The confirmation should make the pay-at-check-in policy and the cancellation terms explicit to the guest.

## Concurrency & data integrity (the double-booking guard)

- Treat "create reservation" as a **single atomic transaction**: re-check availability and write the booking
  inside the same DB transaction, with constraints that make overselling impossible. Either the booking is fully
  saved or fully rolled back — never a partial write.
- Do **not** rely on "check availability, then later insert" as two separate steps — that races. The final
  availability check and the insert must be atomic.
- Enforce it at the **database** level (constraints / exclusion on overlapping date ranges per room-type
  inventory), not just in application code. Application checks are UX; the DB constraint is the guarantee.
- Index availability queries on **date range + room type**.

## Pricing: Tourism Dirham + VAT (display correctly)

- Show a clear price breakdown on the summary: **room total** (nightly rate × nights), **Tourism Dirham**
  (a per-room, per-night government fee — amount depends on the property's classification; keep it a configurable
  value, not a magic number), and **5% UAE VAT** on the accommodation charge, then the **grand total**.
- Keep these as **configurable settings**, not hardcoded — rates and fees change, and a future PMS may automate
  this in Phase 2. In Phase 1 this is basic/manual but must be visible and correct.
- Snapshot the price breakdown onto the reservation at creation time, so a later rate change never rewrites a
  guest's confirmed total.

## Booking reference

- Generate a **unique, human-friendly, non-sequential** reference (e.g. `CV-2026-4821`). Do not expose internal
  database IDs in URLs, emails, or to the guest — use the reference everywhere (also a **pms-readiness** rule).
- The reference must be genuinely unique (enforced by a DB constraint), not a client-side random value.

## Emails (bilingual)

- On confirmation: email the **guest** (in their selected language — see **arabic-rtl**) and **notify the hotel**.
- On cancellation: email the guest a confirmation of cancellation.
- Templates are transactional and localized; include booking reference, dates, room type, price breakdown, and
  the pay-at-check-in + cancellation policy.
- Sending is triggered from the API layer as part of the booking transaction's success path — a failed email must
  be retryable and must not silently lose a confirmed booking.

## Cancellation & modification

- Guests can **cancel via a secure link** (keyed to the booking reference, not an internal id).
- Hotel admin can **cancel or modify** any reservation from the admin panel; modifications re-run the same
  availability + atomicity rules.
- Cancelling/modifying releases inventory correctly and writes an **audit-log** entry (who/what/when).

## Admin reservations (dashboard rules)

- All bookings in one view; filter by date, status, room type; search by guest name or reference.
- Detail view shows guest, contact, dates, room, requests, reference, status; actions: confirm / modify / cancel,
  add internal notes, mark checked-in / checked-out, trigger guest email.
- Basic reporting: occupancy by date range, upcoming arrivals/departures, revenue summary.

## Definition of done for booking-path work

Concurrency-safe (DB-enforced), atomic, priced correctly (Tourism Dirham + VAT shown and snapshotted), reference
is unique and used everywhere, emails fire in the right language, and it all works through the `BookingProvider`
interface in both `/en` and `/ar`.
