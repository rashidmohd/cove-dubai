# Project status

**Last updated:** 15 August 2026
**Phase 1 progress:** milestones M0–M7 complete · **not yet deployed to Railway**
**In flight:** vouchers, offers, and guest accounts — see [`promotions-and-accounts.md`](promotions-and-accounts.md)

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
cd server && npm run typecheck && npm test     # 106 tests — hits the real database
cd web    && npm run typecheck && npm test     # 10 tests — pure, no network
cd web    && npm run check:translations        # Arabic coverage report
cd web    && npx playwright test               # 17 e2e — needs the API running
```

The 7 admin e2e tests skip unless `E2E_ADMIN_PASSWORD` is set to the password of `admin@covedubai.local`, so the
suite still runs for anyone without admin credentials. Set one with:

```bash
cd server && npm run admin:password -- admin@covedubai.local '<a long password>'
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
| **M6** Admin panel | Done | Sessions, RBAC, CSRF, audit log, 6 screens in both locales. Redesigned 15 Aug 2026 — see below |
| **M7** Emails + deploy | Done | Bilingual Resend templates, guest cancellation page, `railway.json` for both services |

#### Object storage for room photography — foundation only (16 Aug 2026)

`MediaAsset` + `RoomTypeImage` tables, a 12-factor config block, and an S3-compatible storage adapter in
`server/src/media/storage.ts`. **Cloudflare R2 is the chosen provider**, but nothing in the code names it: the
endpoint, bucket, credentials and public origin are all environment variables, so the AWS S3 + CloudFront move
later is config, not a rewrite (`deployment`).

Decisions worth knowing:

- **Presigned direct-to-bucket uploads.** The browser PUTs to a short-lived signed URL; the photograph never
  passes through Express. Proxying would buffer multi-megabyte files in the same process that holds the booking
  transaction, on a container with a fixed memory ceiling.
- **`storageKey`, never an absolute URL.** The public origin is prefixed at read time, so moving the bucket or
  putting a CDN in front is one variable rather than a migration over every row.
- **`width`/`height` are required.** The front-end reserves layout space from them; unsized images are the usual
  way to blow the CLS < 0.1 budget.
- **`altEn`/`altAr` are required, not optional.** WCAG 2.1 AA is non-negotiable, and an optional field is one
  nobody fills in. An empty string is the correct alt for a decorative image; NULL means nobody decided.
- **SVG is not an allowed upload type** — it executes script, and an SVG on the media origin is stored XSS.
- **Signature pins `ContentType` *and* `ContentLength`**, so a signed URL cannot be reused to upload something
  else or something larger.
- Storage config is **all-or-nothing**: five variables or none. A partial set is refused at boot instead of
  failing at the first upload.

**The API layer is now built** (17 Aug 2026): `addRoomTypeImage`, `removeRoomTypeImage` and
`reorderRoomTypeImages` behind the seam, four routes under `/admin`, and `images` on every `RoomType` the API
returns — as **URLs**, never bucket keys, so the front-end never learns a bucket exists. Verified live:
`GET /api/room-types` returns `images: []` on all four seeded types alongside the existing `imageKey` gradient.

More decisions:

- **The primary image is the lowest `sortOrder`**, not a boolean. An `isPrimary` flag needs a partial unique index
  to stop two rows claiming it and still allows "no primary at all"; ordering cannot express either broken state.
- **New uploads append.** Adding a photograph must never silently change the hero shot on the public site.
- **Reorder takes the whole list**, so the result cannot depend on what the caller believed the old order was; a
  partial list is refused with `MEDIA_ORDER_MISMATCH`.
- **Bytes are deleted only when the last reference goes** — the same asset may sit on more than one room type —
  and that delete happens *after* the transaction and never fails the request. The row is the record; an orphaned
  object costs a fraction of a cent, whereas failing there would leave an admin looking at an image they were
  told was gone. Orphans are logged.
- **`publicUrlFor` returns null when no public origin is set**, and those images are dropped rather than thrown
  on, so a misconfigured `MEDIA_PUBLIC_BASE_URL` degrades a room type to its gradient instead of failing every
  read of the rooms page.
- **`MEDIA_NOT_CONFIGURED` is a 503, not a 500** — the service is healthy, this one capability is switched off,
  and retrying will not help until someone sets the variables.

**Verified against the real bucket** (18 Aug 2026, `r2-cove-dev`): sign → PUT → `HeadObject` confirms the object
lands with the right size and content type → delete. Uploading works.

> 🔒 **A presigned URL did not pin its content type until this was found by testing it.**
>
> Setting `ContentType` and `ContentLength` on `PutObjectCommand` does **not** bind them into a presigned URL.
> The presigner signs only `host` by default and hoists the rest, so a URL issued for `image/png` happily
> accepted a `text/html` body — measured, 200 OK. Because objects are served from a public origin, that is a
> stored-XSS hole: request a signature for a PNG, upload HTML, and it is hosted on the assets domain. Exactly
> the risk the SVG exclusion exists to close, left wide open beside it.
>
> Fixed by passing `signableHeaders: new Set(['content-type', 'content-length'])` to `getSignedUrl`. Re-measured:
> honest PUT 200, wrong content type 403, wrong content length 403.
>
> **The lesson is general.** Options on the *command* describe the request; only `signableHeaders` constrains
> what the URL will accept. Any future presigned operation needs the same treatment, and needs an abuse case
> proving it — the original code carried a comment claiming this protection while not having it.

> ⚠️ **`assets-dev.covehotels.ae` is not connected to the bucket.** Proved by uploading an object, confirming it
> exists via `HeadObject`, and getting a Cloudflare `404 text/html` from the custom domain for the same key. DNS
> resolves to Cloudflare and TLS is valid, so the hostname exists — it is just not bound to `r2-cove-dev`.
> Connect it under **R2 → the bucket → Settings → Public access → Custom Domains**. Until then every uploaded
> image resolves to a 404 and room types must keep falling back to `imageKey`.

**The admin gallery is built** (18 Aug 2026): `web/app/[locale]/admin/rooms/RoomImages.tsx`, a section on each
room-type card. Upload with a preview, bilingual alt text collected *before* upload, reorder, remove, and an
"Untitled"-style warning badge on any image with no alt text in either language. Reordering uses buttons rather
than drag-and-drop — dragging is not keyboard-reachable without a lot of extra work, and WCAG 2.1 AA is not
optional. Verified rendering in both locales; mirrors correctly on /ar.

> ⚠️ **CORS is not configured on the bucket, so browser uploads will fail.** Measured, not assumed: a real
> preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method: PUT`) against a signed URL returns
> **403 with no `Access-Control-Allow-*` headers at all**. Add a CORS rule to `r2-cove-dev` allowing `PUT` and
> `GET` from the web origins, with `Content-Type` in the allowed headers. Until then the UI shows its
> "browser blocked the upload" message, which is the correct diagnosis but not a working upload.
>
> Combined with the unbound custom domain above, **two bucket-side settings still block images end to end**:
> CORS (blocks upload) and the custom domain (blocks display).

> ⚠️ **No upload has ever been performed from a browser.** The path is proven from Node — sign, PUT, HeadObject,
> delete all work against the real bucket — but the browser leg is blocked by CORS and cannot be exercised until
> that is fixed. Also untested: the whole admin flow behind a real login, because the password on file does not
> match the database.

The R2 token has object read/write but **not** bucket list permission. That is fine — the application never
lists — but `ListObjectsV2` will fail if anyone reaches for it while debugging.

**Before uploads can work, someone must configure the bucket itself** (not represented in `.env.example` because
it is not application config): an R2 API token scoped to Object Read & Write on that one bucket, a public origin
(r2.dev or a custom domain), and a **CORS rule allowing PUT from the web origin** — without it the browser
refuses the direct upload.

#### Rates now vary by day of week, not just by season (16 Aug 2026)

`RatePlan` gained `daysOfWeek Int[]` (**0 = Sunday … 6 = Saturday**, matching `getUTCDay()`, which the inventory
calendar already uses — a second numbering convention would eventually price the wrong night). A plan applies to a
night when **both** hold: the night is inside the date window *and* its weekday is one the plan prices. "Peak
season, weekends only" is one plan rather than one row per weekend, forever.

`resolveNightlyRates` and `resolveMinimumStay` both honour it, so availability, quoting and the minimum-stay gate
agree. Each night resolves independently — a stay crossing a surcharge is billed per night, never averaged. A
night belongs to the day it is **slept on**, parsed as UTC; a local-time parse on a server in another zone shifts
a night into the neighbouring day and misprices it silently.

Backward compatible: every pre-existing row defaulted to all seven days, so applying the migration could not
change a quoted price. 82 server tests pass (was 74).

> ⚠️ **A CHECK constraint that did not constrain.** The first migration guarded the empty array with
> `array_length("daysOfWeek", 1) >= 1`. `array_length('{}', 1)` returns **NULL**, not 0, and a CHECK constraint
> **passes** when its expression is NULL — so the one value it existed to reject was the one value it allowed.
> That matters because the resolver reads "no day restriction" as *every* night, so a plan saved with every
> checkbox cleared would have priced all seven, silently, on the money path. Fixed in
> `20260816093000_fix_rate_plan_days_empty_check` using `cardinality()`, which returns 0 for the empty array.
> Verified against the live database: `[]` and `[7]` are refused, `[4,5,6]` and all-seven are accepted.
> **Use `cardinality()`, never `array_length()`, in any future array CHECK.**

**Still to do on this thread:** room type create / publish / archive with inventory opening (a new room type has
no `RoomTypeInventory` rows, so it is unsellable and its calendar reads "not open" until a range is opened — the
two must be one flow); the rate-plan admin UI (season window + day grid); the missing `category`, `totalRooms`
and `sortOrder` edit fields; an advisory allocated-vs-106 reconciliation; and room images on S3-compatible
storage with presigned direct upload.

#### The admin panel has its own visual language (15 Aug 2026)

The panel was first built in the guest brand: Cormorant at display sizes, uppercase Jost at 0.22em tracking on
every label and table header, gold on near-black, 2px radii. That is right for someone choosing a hotel and wrong
for someone working a shift — the tracked micro-caps are slow to scan and the oldstyle serif figures read as
decoration on a screen where the number *is* the content.

It now follows dashboard-UI conventions instead: a neutral warm-grey ramp, a 14px system sans, sentence case,
8px radii, hairline borders, and the brand gold reserved for the active nav item, primary buttons, focus rings
and the monogram. **No Tailwind and no component library** — it is still CSS Modules and design tokens, with a
small hand-built component layer in `web/app/[locale]/admin/ui.tsx`.

This is an agreed exception to **cove-design-system**, recorded in that skill's guardrails and in the header
comment of `Admin.module.css`. It applies to `/admin` and nowhere else; every guest-facing surface is unchanged.
The RTL rules did not change — the panel is still logical properties throughout and still mirrors natively.

Also in that pass: `window.confirm` replaced with a real `<dialog>` (it could not be translated or mirrored),
`window.confirm`-era copy reworded, an off-canvas sidebar below 60rem, and a Lucide-derived inline icon set.

Added to Phase 1 scope after M7, and **not yet finished** — the plan and the decisions already taken are in
[`promotions-and-accounts.md`](promotions-and-accounts.md):

| Feature | State |
|---|---|
| **Vouchers** | **Done.** Engine, API, admin screen, and a code field in the reserve flow. Verified in a browser: discount applied, VAT charged on the discounted total, Tourism Dirham untouched. Editing an existing code's value from the panel is still to do — only activate/deactivate/delete are offered. |
| **Offers** | **Guest side done.** `GET /api/offers`, a public page at `/[locale]/offers`, and a nav entry between Rooms and Dining. **No admin editing yet** — offers can only be created with SQL. |
| **Guest accounts** | Data model only (`GuestAccount`, `GuestAccountToken`). No auth, no email, no screens. |

### Routes live today

All prerender as static HTML in both locales (`●` SSG in the build output). The admin routes prerender only as
empty shells — they hold no data, because every admin request needs the session cookie and is made from the
browser.

```
/[locale]                 home
/[locale]/about
/[locale]/rooms           reads live room types from the API
/[locale]/offers          advertised rate plans, from the API
/[locale]/dining
/[locale]/coming-soon     stands in for Wellness, Experiences, Members
/[locale]/reserve         the booking flow (noindex)
/[locale]/cancel          guest self-cancellation, from the emailed link (noindex, nofollow)
/[locale]/admin           dashboard          (noindex, nofollow)
/[locale]/admin/reservations
/[locale]/admin/rooms
/[locale]/admin/amenities
/[locale]/admin/inventory
/[locale]/admin/settings
```

The admin routes are excluded from the sitemap, which uses an explicit allowlist rather than enumerating the app.

### API endpoints live today

```
# Guest-facing
GET  /room-types
GET  /availability?checkIn&checkOut&adults&children&roomsCount
GET  /rates?roomTypeCode&checkIn&checkOut&roomsCount
POST /reservations
GET  /reservations/:reference
POST /reservations/:reference/cancel     requires the emailed token

# Session
POST /auth/login
GET  /auth/session                        who am I + the CSRF token
POST /auth/logout

# Admin — every one behind requireAdmin, mutations behind requireCsrfToken
GET   /admin/dashboard
GET   /admin/reservations                 filter, search, paginate
GET   /admin/reservations/:reference
PATCH /admin/reservations/:reference
POST  /admin/reservations/:reference/cancel | /check-in | /check-out
GET   /admin/room-types
PATCH /admin/room-types/:code                          ADMIN only
PUT   /admin/room-types/:code/amenities                ADMIN only — replaces the list
GET   /admin/amenities                                 with per-amenity usage counts
POST  /admin/amenities                                 ADMIN only
PATCH /admin/amenities/:code                           ADMIN only
DELETE /admin/amenities/:code                          ADMIN only — refused while in use
GET   /admin/room-types/:code/inventory?from&to
PATCH /admin/room-types/:code/inventory                ADMIN only
GET   /admin/reports/occupancy?from&to
GET   /admin/reports/arrivals-departures?date
GET   /admin/settings
PATCH /admin/settings/:key                             ADMIN only
GET   /admin/audit-log                                 ADMIN only
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
- **Admin routes are closed by default.** Every admin endpoint returns 401 without a session; the middleware is
  mounted on the router rather than per-route, so a new route cannot be added unauthenticated by forgetting an
  argument.
- **Revocation is immediate.** Disabling an account mid-session kills its very next request — the role is re-read
  from the database on every request rather than trusted from the cookie.
- **CSRF is enforced.** A mutating request with no token, or with a token belonging to a different session, is
  refused. A real write through the browser proves the token reaches the server on the happy path.
- **Roles are enforced server-side.** STAFF can read reservations and are refused the settings and the audit log;
  hiding those buttons in the UI is a courtesy, not the control.
- **Login does not leak which addresses exist.** A wrong password and an unknown account return byte-identical
  bodies, and an unknown account still runs a scrypt verification against a decoy hash so the timing matches.
- **Inventory cannot be cut below what is sold.** Setting a range to fewer rooms than any night already has
  booked is refused whole — verified against the client's real 20 Aug booking, with the other nights in the range
  left untouched rather than partially applied.
- **The audit log is no longer empty.** It went from 0 rows to recording every login, failed login, logout,
  setting change, and reservation action, with before/after values on edits.
- **An amenity in use cannot be deleted.** The foreign key cascades, so without the guard a delete would strip it
  from every room type that lists it — silently rewriting published descriptions. The API refuses with 409 and
  the amenity is verifiably still there afterwards.
- **Replacing a room type's amenities is all-or-nothing.** Sending one unknown code changes nothing, rather than
  saving the codes it recognised.
- **A withdrawn amenity disappears from guests but stays on the room.** `isActive: false` hides it everywhere
  without deleting the link, so it can be restored.
- **A discount reaches the guest correctly through the whole stack.** Measured in a browser on a two-night stay:
  room total AED 1,960, discount −392, VAT **78.40** — five per cent of the discounted 1,568, not of 1,960 — and
  the Tourism Dirham still 40. The summary lines reconcile with the total.
- **A code shown as valid is the code that is charged.** The preview and the booking run the same validation, so
  the reserve flow cannot display a discount the booking would refuse.
- **Previewing a code claims nothing.** Two previews leave `redemptionCount` at zero.
- **A mistyped code fails inline and by name** — "not recognised", "expired", "fully redeemed" — rather than
  putting the booking flow into a generic error state.
- **The whole email loop works in a browser.** A real booking was made, the confirmation rendered with a working
  link, the link opened the cancellation page, cancelling released the inventory, and replaying the burned link
  no longer offers to cancel. Verified end to end, then cleaned up.
- **The emailed breakdown sums to the total.** The same guarantee the reserve flow makes on screen, asserted on
  the rendered email body: 1,960 + 40 + 98 = 2,098.
- **Guest names are escaped in email HTML.** A name containing a `<script>` tag renders as text.
- **The Arabic email is genuinely RTL** — `dir="rtl"`, `lang="ar"`, and the Arabic room name rather than the
  English fallback.
- **The confirmation says no payment was taken**, asserted in a test. The launch model is pay-at-check-in, and a
  confirmation that read like a receipt would be actively wrong.
- **VAT is charged on the discounted room total, and the Tourism Dirham is never discounted.** Asserted by doing
  the arithmetic by hand across percentage, fixed, 100% and over-large discounts. Getting either backwards
  mis-taxes every promotional booking invisibly.
- **A single-use voucher is redeemed exactly once.** Ten simultaneous bookings quoting the same code yield one
  success and nine `VOUCHER_EXHAUSTED`; the counter and the redemption records agree afterwards. The CHECK
  constraint was separately proven to fire.
- **A refused booking does not consume a voucher use.** The claim is inside the booking transaction and rolls
  back with it.

---

## The admin panel (M6, done)

### How it is put together

| Piece | Where |
|---|---|
| Session middleware | `server/src/auth/session.ts` — `express-session`, rolling idle timeout |
| Session storage | `server/src/auth/session-store.ts` — a Postgres store, so a deploy does not sign everyone out |
| Auth + roles | `server/src/middleware/auth.ts` — `requireAdmin`, `requireRole` |
| CSRF | `server/src/middleware/csrf.ts` — synchroniser token in the session, `X-CSRF-Token` on writes |
| Audit log | `server/src/auth/audit.ts` — `recordAudit`, plus `recordAuditIn` to join a transaction |
| Admin routes | `server/src/routes/admin.routes.ts` and `auth.routes.ts` |
| Admin screens | `web/app/[locale]/admin/` — CSS Modules, no UI kit |
| Amenities | `Amenity` + `RoomTypeAmenity` in the schema; `admin/amenities` screen and a picker on each room type |
| Admin API client | `web/lib/api/admin-client.ts` — the only place `credentials: 'include'` and the CSRF header live |

**No component library.** The panel is hand-built React with CSS Modules and the design tokens, like the rest of
the site. shadcn/Tailwind was considered and rejected: it would have meant a second styling system alongside CSS
Modules, and a default look to strip out to reach the mockups' tokens.

**Admin writes go through the `BookingProvider`.** Room types, inventory, and pricing settings are exactly what a
PMS takes over, so the provider grew `listRoomTypes`, `updateRoomType`, `getInventoryCalendar`, `updateInventory`,
`setReservationStatus`, `listSettings`, and `updateSetting`. Admin accounts, sessions, and the audit log are the
deliberate exception — no PMS would own our staff accounts, so those use Prisma directly.

### Managing admin accounts

Full detail — roles, sessions, troubleshooting, adding staff — is in [`admin-access.md`](admin-access.md). In
short: the seed creates the first account only when `SEED_ADMIN_PASSWORD` is set, and never changes an existing
password. To set or reset one:

```bash
cd server && npm run admin:password -- admin@covedubai.local '<a long password>'
```

There is deliberately no password-reset endpoint. Reset-by-email is not built, and an admin-facing "reset anyone's
password" route is a privilege-escalation path that needs designing rather than bolting on. **`ADMIN` and `STAFF`
both exist and are enforced, but there is no screen for creating accounts** — a second member of staff is added
with this script today.

### Still to do here

- **No screen for the audit log.** The endpoint exists and is ADMIN-only; nothing renders it yet.
- **No rate-plan editing.** Seasonal overrides and minimum stays are seeded data; only the base rate is editable.
- **The Arabic panel is in English.** All 130-odd admin keys are placeholders in `ar.json`, like the rest of the
  site — the layout mirrors correctly, the copy awaits the client.

---

## Email (M7, done)

| Piece | Where |
|---|---|
| Transport | `server/src/emails/transport.ts` — Resend, or a console transport when `EMAIL_API_KEY` is unset |
| Templates | `server/src/emails/templates.ts` — confirmation, cancellation, hotel notification |
| Orchestration | `server/src/emails/index.ts`, called **from the routes**, not from the provider |
| Cancellation page | `web/app/[locale]/cancel/` — where the emailed link lands |

Three messages go out: the guest's **confirmation** (with their single-use cancellation link), the guest's
**cancellation confirmation**, and the hotel's **copy of a new booking** with the guest's contact details.

**Sending is deliberately outside the seam.** Emails are sent from the route after the provider returns, never
from inside `CustomDbProvider`. Sending confirmations is not part of running a reservation engine, and a PMS that
takes over in Phase 2 will send its own — at which point this is a deleted call at the route rather than surgery
inside the booking layer (`pms-readiness`).

**A failed send can never fail a booking.** The response is sent first and the email dispatched after; every
transport failure is caught and logged. The guest has a room and a reference either way. The cost of that choice
is that a broken email configuration is *quiet* — check the logs after the first booking on a new environment
rather than assuming.

**The cancellation token never crosses the HTTP boundary.** It is not a field on `Reservation`; the email layer
reads it through a dedicated `getCancellationToken` provider method at send time. Anything else would let anyone
holding a booking reference cancel a stranger's stay.

### Still to do here

- **The Arabic email copy is English.** The template carries a full `ar` block with correct `dir="rtl"` layout;
  the strings themselves are placeholders, like `ar.json`. This is the one place Arabic copy is **not** in the
  message files, so it is easy to miss — it lives in `server/src/emails/templates.ts`.
- **No email is sent on an admin *modification*** — only on cancellation. A guest whose dates are changed by the
  front desk is not told.
- **No retry.** A send that fails is logged and dropped. There is no queue.

---

## What's next — deploying to Railway

Everything is built; nothing is deployed. The runbook is [`deploying.md`](deploying.md); both services carry a
committed `railway.json`, so build and start commands are in version control rather than typed into a dashboard.

1. **Provision** Postgres, `server`, and `web` in one Railway project.
2. **Set the environment variables** from the tables in the runbook. `CORS_ALLOWED_ORIGINS` and `WEB_BASE_URL`
   cannot be set until the `web` service has a URL, so the server is deployed twice on the first pass.
3. **Seed once**, with `SEED_ADMIN_PASSWORD` set, then set a real admin password.
4. **Verify the cross-origin cookie first** — see below.
5. **Verify the Resend domain** before the client sees staging, or no email leaves the building.

### The one thing to get right early

Admin sessions cross **two origins** on Railway — `web` and `server` are different domains — so the cookie needs
`SameSite=None; Secure`. The config supports it and refuses to boot on a mismatched pairing, and login works end
to end **locally**, where both services are `localhost` and `SameSite=Lax` is enough. That is precisely why this
is still the risk: passing locally proves nothing about the cross-site case. A dropped cookie looks like a
successful login followed by every request being anonymous, so the test that matters is **signing in and then
reloading the page**. On AWS both services sit behind one domain and it tightens back to `Lax` with no code change.

---

## Open items for the client

None of these block development.

| Item | State |
|---|---|
| **Tourism Dirham amount** | Placeholder **AED 20**/room/night. Depends on the property's DET classification. Now changeable from **Admin → Settings** by an ADMIN, and it takes effect on the next quote — pricing reads it per request, so no deploy and no restart. Verified end to end: 20 → 15 changed a live quote immediately, and the change is audited with its before and after value. Bookings already taken keep the price they were quoted. Still **must be confirmed before launch**. |
| **"Forty-eight rooms" copy** | The site reads 106, but that is a number substituted into the client's prose. The About story and footer tagline need re-wording properly. |
| **Arabic translations** | 2 of 441 keys — the admin panel and amenities added the rest. Deliberate: brand copy is never machine-translated. `npm run check:translations` prints the exact checklist. **The 19 seeded amenity names also need Arabic** — they live in the database, not the message files, so they are edited in Admin → Amenities rather than in `ar.json`. **The transactional emails need Arabic too**, and those live in `server/src/emails/templates.ts` — the one place Arabic copy is not in a message file. |
| **Amenity list** | 19 seeded from the mockups' room specs, against OpenTravel RMA codes. The hotel should review which rooms have what, and add anything missing — it is all editable in the panel. |
| **Arabic numerals** | Western (1234) applied consistently. Switch the single constant in `web/lib/format.ts` if the client wants Arabic-Indic. |
| **Arabic font** | Almarai, pending confirmation (skill lists Almarai or Cairo). |
| **Photography** | All imagery is CSS gradients, as in the mockups. `imageKey` on `RoomType` is the hook for real images. |
| **Resend domain** | **Not verified — this now blocks real email.** The templates and sending are built and tested, but nothing leaves the building until the hotel's domain is verified in Resend and `EMAIL_FROM` points at an address on it. Until then the console transport logs messages instead. |

---

## Decisions worth knowing

- **Booking references use six digits** (`CV-2026-482137`), not the skill's four-digit example. Four gives 10,000
  per year, which collides too often at this hotel's volume.
- **Room specs live in message files**, not the database. Phase 1 has no structured column for size/bed/view, and
  inventing one means guessing the shape a future PMS expects.
- **Amenities are the exception to that, and are in the database.** The reasoning above turns on *having to guess
  a shape*. Room amenities have a published one: the OpenTravel **RMA (Room Amenity Type)** code list, which OTAs,
  channel managers and PMS platforms exchange. Storing them against those codes is what `pms-readiness` asks for —
  model the domain the way the industry does — and makes a future integration a lookup rather than a re-entry.
  The prose specs stay in the message files, because nothing standard sits behind "Soaking tub & rain shower".
- **`RoomType.amenities` is optional in the web's type mirror.** The marketing pages cache room types for an hour
  and the two services deploy independently, so meeting a response from before the field existed is a normal
  state. Typing it optional makes the compiler demand the guard at every read — it found six sites that would
  otherwise have thrown, which is exactly how this was discovered.
- **scrypt, not bcrypt/argon2.** Those are native modules needing a compiler at install time; Nixpacks builds on
  Railway and there is no image we control.
- **The server is ESM** (`"type": "module"`). The web app is not — it is a standard Next.js project.
- **Measurements pin `dir="ltr"`** and database text is wrapped in `<bdi>`. Without it, Arabic rendered the floor
  range "2 – 6" as "6 – 2" — wrong information, not wrong styling.
- **In the admin panel, `<bdi>` is left on `auto` rather than pinned to `ltr`.** Pinning looks right for a booking
  reference and is wrong for a date: `formatStayDate` returns "15 أغسطس 2026" on `/ar`, and forcing LTR reorders
  it to "15 2026 أغسطس". `auto` reads the first strong character and gets references, prices, Arabic dates, and
  bare numbers all right.
- **Admin sessions live in Postgres**, not in memory. Railway restarts containers on every deploy, and an
  in-memory store would sign every admin out each time and could not work across more than one instance.
- **Admin figures use `font-variant-numeric: lining-nums`.** Cormorant's default figures are oldstyle, which
  renders 0 as a glyph shaped like O and 1 like a small-cap I — acceptable in a hero line, misleading on an
  operations dashboard where the number is the content.

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
