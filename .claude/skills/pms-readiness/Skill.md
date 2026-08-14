---
name: pms-readiness
description: The architectural discipline that keeps Cove Dubai's Phase 1 custom booking system cleanly swappable for a future third-party PMS. The client has NOT chosen a PMS (IDS Next, Cloudbeds, and Mews are all candidates), so this skill is vendor-neutral. Use it for ANY work touching the database schema, the Express booking API, reservation logic, or how the Next.js front-end fetches availability and creates bookings on the Cove Dubai project. Phase 1 must stand alone AND stay swappable — consult this before designing tables, adding API endpoints, or wiring the booking flow to data.
---

# Cove Dubai — PMS Readiness (vendor-neutral)

We are building **Phase 1**: a complete custom reservation engine the hotel runs on at launch. Later, the hotel
may move reservations onto a third-party PMS — but **no vendor has been chosen** (IDS Next, Cloudbeds, and Mews
are all in the running, and they may pick none of them). So do not design for any specific PMS. Design so that
_whatever_ they pick becomes a clean integration rather than a rebuild. That swappability is the whole point.

Our stack helps here: the **Express API is a physically separate service from the Next.js front-end**, so the seam
already exists — we just keep it disciplined.

## Two goals at once

1. **Phase 1 stands alone.** The custom engine is fully functional by itself — no external PMS required to launch.
2. **Phase 1 stays swappable.** All reservation work sits behind one interface inside the API, so a future PMS
   replaces the implementation without touching the Next.js front-end or the booking flow.

Do **not** build any PMS adapter now. There is no `PmsProvider` implementation in Phase 1 — only the interface
and the custom implementation behind it.

## The layers — and the seam

```
Next.js front-end  (marketing + booking flow + /admin)   <- talks to the API over HTTP only
        |
        v   HTTP (/api/...)
Express API  ── BookingProvider interface ── the SEAM (a future PMS replaces what's below)
        |
        v
CustomDbProvider (Phase 1)  ->  Prisma  ->  PostgreSQL   [ future: PmsProvider — Phase 2, vendor TBD ]
```

- The **Next.js front-end** never imports Prisma, never sees SQL, never knows a table shape. It only calls the Express
  API over HTTP. If a front-end component touches the database or Prisma, that's a defect.
- **Express routes** depend only on the `BookingProvider` interface — never reaching past it into Prisma directly.
  Routes stay thin: validate input, call the provider, shape the response.
- A future PMS is added by writing one new provider implementation and changing one wiring line. Client and
  routes are untouched.

## The BookingProvider interface (the contract)

Live in `server/src/booking/provider.ts`. One stable interface, shaped around what any PMS offers — not around our
current tables:

- `checkAvailability({ checkIn, checkOut, guests }) -> AvailableRoomType[]`
- `getRoomTypes() -> RoomType[]`
- `getRate({ roomTypeId, dateRange }) -> RatePlan`
- `createReservation(draft) -> Reservation` (atomic; returns a booking reference)
- `getReservation(ref)` · `cancelReservation(ref)` · `modifyReservation(ref, changes)`
- admin reads: `listReservations(filter)`, occupancy / report queries

Rules for the contract:

- Reference **entities and fields**, never storage details. No "row id from table X" leaking through the HTTP API.
- Return a **stable booking reference** in our own format (mappable to any PMS's reference later).
- Keep availability/pricing results in shapes a typical PMS could also produce.
- The Phase 1 implementation is `server/src/booking/custom-db.provider.ts` — the only provider that exists now.

## Database schema — follow a standard hospitality model

Lives in `server/prisma/schema.prisma`. Model the domain the way the whole industry does, so it's portable:

- **Room types** as the booking unit (PMS platforms book by type + inventory count, not by individual room).
- **Rate plans** — base nightly rate per room type, seasonal overrides, minimum-stay rules, as first-class data.
- **Reservations** — status lifecycle (held / confirmed / cancelled / checked-in / checked-out), booking
  reference, guest link, room type, date range, and a price-breakdown snapshot.
- **Guests** — the profile fields any PMS expects (name, contact, and nationality/ID fields ready to capture
  later, since compliance reporting will need them under whatever PMS is chosen).
- **Availability** — derived from inventory minus active reservations, queried by date + room type (indexed).
- Store **localized fields** (room name/description in en + ar) — see **arabic-rtl**.
- Add a nullable **external-reference column** on reservations/guests now, so a future migration can record the
  PMS's own IDs without a schema change.

## Migration discipline (do this as you build)

- Keep a running **data-model note**: each of our entities/fields and what it represents, in vendor-neutral terms.
  When a PMS is finally chosen, this note maps straight onto their model and becomes the Phase 2 brief.
- Write reversible Prisma migrations; never edit the DB by hand.
- Keep a **seed of representative data** so any future migration can be tested against realistic rows.

## Integration protocol — deliberately deferred

Different PMS platforms integrate differently (modern REST APIs; some enterprise systems use HTNG; access is
usually gated behind a subscription/partner agreement with variable onboarding time). **We do not pick or design
for any of these in Phase 1.** When the client chooses a vendor, that shapes Phase 2 — not now.

## What NOT to do

- Do not name or hardcode a specific PMS anywhere in the codebase, schema, or config.
- Do not let pricing, availability, or eligibility logic live in the Next.js front-end — it belongs in the API so a
  future PMS can own it. (Also a **booking-engine** rule.)
- Do not expose internal numeric IDs over the HTTP API, in URLs, or in emails — use the booking reference.
- Do not build a PMS adapter, channel-manager hook, or automated DTCM export. All Phase 2.
