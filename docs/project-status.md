# Project status

**Last updated:** 15 August 2026
**Phase 1 progress:** milestones M0–M5 complete · **M6 (admin panel) is next** · M7 remaining

Read this alongside [`CLAUDE.md`](../CLAUDE.md) before starting work, and update it as you go.

---

## How to run it

No Docker anywhere. Two plain Node processes against a Railway-hosted Postgres.

```bash
cd server && npm install && npm run dev    # http://localhost:4000
cd web    && npm install && npm run dev    # http://localhost:3000
```

`server/.env` and `web/.env` already exist locally and are gitignored. Both services validate their environment
at startup and exit with a readable message if anything required is missing. `server/.env.example` and
`web/.env.example` are the authoritative list of variables.

### Checks

```bash
cd server && npm run typecheck && npm test     # 17 tests — hits the real database
cd web    && npm run typecheck && npm test     # 10 tests — pure, no network
cd web    && npm run check:translations        # Arabic coverage report
cd web    && npx playwright test               # 7 e2e — needs the API running
```

Playwright drives the **system Chrome** (`channel: 'chrome'`): its bundled Chromium has no build for macOS 13 on
ARM. On CI, set `E2E_USE_SYSTEM_CHROME=false` to use the bundled browser.

The e2e suite writes **real reservations** to the shared database under `@e2e-test.invalid`. It does not clean up
after itself. Remove them and release their inventory with the SQL in [Cleaning up test bookings](#cleaning-up-test-bookings)
— deleting the rows alone leaves those nights permanently consumed.

---

## What is built

| Milestone | State | Notes |
|---|---|---|
| **M0** Foundation | Done | Two independent npm projects, 12-factor config, mockups under version control |
| **M1** Database | Done | Schema, 9 CHECK constraints, idempotent seed, data-model note |
| **M2** Booking API | Done | `BookingProvider` seam, `CustomDbProvider`, pricing, 6 guest routes |
| **M3** Web foundation | Done | Tokens, i18n/RTL shell, typed API client, nav + footer |
| **M4** Reserve flow | Done | 3 steps + confirmation, live pricing, session persistence |
| **M5** Marketing pages | Done | Home, About, Rooms, Dining, sitemap, robots |
| **M6** Admin panel | **Not started** | See [What's next](#whats-next) |
| **M7** Emails + deploy | Not started | Resend templates, cancellation link, Railway |

### Routes live today

All ten prerender as static HTML in both locales (`●` SSG in the build output).

```
/[locale]                 home
/[locale]/about
/[locale]/rooms           reads live room types from the API
/[locale]/dining
/[locale]/coming-soon     stands in for Wellness, Experiences, Members
/[locale]/reserve         the booking flow (noindex)
```

### API endpoints live today

All under `/api`, guest-facing only. **No admin endpoints exist yet.**

```
GET  /room-types
GET  /availability?checkIn&checkOut&adults&children&roomsCount
GET  /rates?roomTypeCode&checkIn&checkOut&roomsCount
POST /reservations
GET  /reservations/:reference
POST /reservations/:reference/cancel     requires the emailed token
```

---

## What is actually verified

Claims below were tested, not inferred.

- **Overselling is impossible.** Ten simultaneous bookings for one remaining room yield exactly one success; the
  rest get `NO_AVAILABILITY`. Proven against the live database.
- **The guarantee is the database, not the code.** Deleting the `SELECT … FOR UPDATE` lock and re-running the
  suite still passes — the atomic increment plus the ledger's CHECK constraint is what prevents overselling. The
  lock stays for precise error detail, not correctness.
- **Cancellation authorisation.** Wrong token → 403, correct token → cancels and releases inventory, replaying the
  burned link → 403.
- **Price breakdown reconciles.** An e2e test reads the rendered summary lines and asserts they sum to the total.
- **Arabic is genuinely mirrored.** Measured: the summary panel sits left of the form on `/ar` and right on `/en`.
  Month names render in Arabic script.
- **Contrast meets WCAG 2.1 AA.** A test parses `tokens.css` and fails if any token drops below 4.5:1, and asserts
  links stay below the gold hover so hovering brightens rather than dims.

---

## What's next — M6, the admin panel

Nothing of the admin UI exists. What already exists to build on:

| Piece | Where |
|---|---|
| `AdminUser` + `AuditLog` tables | Applied in the initial migration |
| Seeded admin account | `admin@covedubai.local` — never logged in |
| Password hashing | `server/src/auth/password.ts` — scrypt, round-trip verified |
| Session env config | `SESSION_SECRET`, idle timeout, cookie `SameSite`/`Secure` — validated at boot |
| Admin data methods | `listReservations`, `getOccupancyReport`, `getArrivalsAndDepartures` — implemented on the provider, **not exposed over HTTP** |

Suggested order:

1. **Session middleware + login endpoint** in the API. Role-based, idle timeout, CSRF on mutating routes.
2. **Admin routes** exposing the provider methods that already exist, plus room-type and inventory writes. Keep
   routes thin — they must call the provider, never Prisma (`pms-readiness`).
3. **Audit logging** on every admin write. The table has **0 rows** because nothing writes to it yet, and
   `CLAUDE.md` requires an entry per admin action.
4. **`/[locale]/admin`** — login, room types (both languages on one screen), availability calendar editing
   `RoomTypeInventory.totalRooms`, reservations dashboard with filter/search, occupancy and arrivals reports.

### The one thing to get right early

Admin sessions cross **two origins** on Railway — `web` and `server` are different domains — so the cookie needs
`SameSite=None; Secure`. The config already supports this and fails fast on a mismatched pairing, but it has
never been exercised because there is no login yet. On AWS both services sit behind one domain, where it tightens
to `Lax` with no code change. Test this on Railway staging early; it is the kind of thing that works locally and
fails on first deploy.

---

## Open items for the client

None of these block development.

| Item | State |
|---|---|
| **Tourism Dirham amount** | Placeholder **AED 20**/room/night. Depends on the property's DET classification. Stored as a `Setting`, changeable without a deploy, but **must be confirmed before launch**. |
| **"Forty-eight rooms" copy** | The site reads 106, but that is a number substituted into the client's prose. The About story and footer tagline need re-wording properly. |
| **Arabic translations** | 2 of 308 keys. Deliberate — brand copy is never machine-translated. `npm run check:translations` prints the exact checklist. |
| **Arabic numerals** | Western (1234) applied consistently. Switch the single constant in `web/lib/format.ts` if the client wants Arabic-Indic. |
| **Arabic font** | Almarai, pending confirmation (skill lists Almarai or Cairo). |
| **Photography** | All imagery is CSS gradients, as in the mockups. `imageKey` on `RoomType` is the hook for real images. |
| **Resend domain** | Not verified. No email is sent yet — that is M7. |

---

## Decisions worth knowing

- **Booking references use six digits** (`CV-2026-482137`), not the skill's four-digit example. Four gives 10,000
  per year, which collides too often at this hotel's volume.
- **Room specs live in message files**, not the database. Phase 1 has no structured column for size/bed/view, and
  inventing one means guessing the shape a future PMS expects.
- **scrypt, not bcrypt/argon2.** Those are native modules needing a compiler at install time; Nixpacks builds on
  Railway and there is no image we control.
- **The server is ESM** (`"type": "module"`). The web app is not — it is a standard Next.js project.
- **Measurements pin `dir="ltr"`** and database text is wrapped in `<bdi>`. Without it, Arabic rendered the floor
  range "2 – 6" as "6 – 2" — wrong information, not wrong styling.

---

## Cleaning up test bookings

```sql
BEGIN;
UPDATE room_type_inventory i SET "bookedRooms" = i."bookedRooms" - sub.rooms
FROM (
  SELECT r."roomTypeId", d.day::date AS day, SUM(r."roomsCount") AS rooms
  FROM reservations r JOIN guests g ON g.id = r."guestId"
  CROSS JOIN LATERAL generate_series(r."checkIn", r."checkOut" - INTERVAL '1 day', INTERVAL '1 day') AS d(day)
  WHERE g.email LIKE '%e2e-test.invalid' AND r.status <> 'CANCELLED'
  GROUP BY r."roomTypeId", d.day
) sub WHERE i."roomTypeId" = sub."roomTypeId" AND i.date = sub.day;

DELETE FROM reservations WHERE "guestId" IN (SELECT id FROM guests WHERE email LIKE '%e2e-test.invalid');
DELETE FROM guests WHERE email LIKE '%e2e-test.invalid';
COMMIT;
```

The database currently holds **one real reservation** (`CV-2026-581047`, Studio Room, 20–21 Aug 2026) made by the
client from the live UI. Leave it alone.
