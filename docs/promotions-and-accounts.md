# Vouchers, offers, and guest accounts

The working plan for three features added to Phase 1 scope on **15 August 2026**. **All three are built and tested
as of 9 October 2026**: vouchers (with editing and a per-code bookings report), offers (edited as rate plans in the
admin), and guest accounts (register, confirm email, sign in, reset password, "my bookings").

Read [`project-status.md`](project-status.md) first for where the rest of the project stands.

> **Scope note.** None of these three are in CLAUDE.md, the original proposal, or the approved mockups. They are a
> deliberate addition, and each brings a design decision the mockups do not answer — most importantly *where an
> offers page lives on the site* and *what a signed-in guest sees*. Those need the client, not a developer.

---

## Where things stand

| | Data model | Engine | API | Admin UI | Guest UI | Tests |
|---|---|---|---|---|---|---|
| **Vouchers** | ✅ | ✅ | ✅ | ✅ edit + bookings report | ✅ | ✅ 33 + 3 e2e |
| **Offers** | ✅ | — reuses rate plans | ✅ | ✅ Rates & offers screen | ✅ | ✅ 11 + 10 |
| **Guest accounts** | ✅ | n/a | ✅ | n/a | ✅ `/account` | ✅ 11 |

**150+ server tests pass** on the dev database, plus 3 browser tests for the discount flow. The account pages were
checked by hand in Chrome in English (desktop) and Arabic (phone width): sign in, "my bookings", staying signed in
across a reload, and sign out.

---

## What is already built

### The voucher engine

| Piece | Where |
|---|---|
| Schema + CHECK constraints | `server/prisma/schema.prisma`, `migrations/20260815195131_*` |
| Discount arithmetic | `server/src/booking/pricing.ts` — `calculatePrice({ discount })` |
| Validation and claiming | `server/src/booking/custom-db.provider.ts` — `validateVoucher`, `claimVoucher` |
| Tests | `tests/discount-pricing.test.ts` (9), `tests/voucher-concurrency.test.ts` (9) |

**The tax rule, which is the whole point.** A discount comes off the accommodation charge; VAT is charged on the
*discounted* accommodation charge; the Tourism Dirham is never discounted and is never in the VAT base.

```
Room total       2,000
Discount −10%     −200
VAT 5%              90     ← 5% of 1,800, not of 2,000
Tourism Dirham      40     ← a DET levy; not the hotel's to discount
Total            1,930
```

Getting either half of that backwards mis-taxes every promotional booking and would not be visible without doing
the sums by hand, which is what `discount-pricing.test.ts` does.

**Redemption is atomic.** The counter is incremented inside the booking transaction with the cap in the `WHERE`
clause, and a CHECK constraint (`vouchers_redemptions_within_max`) is the backstop — the same shape as the
inventory ledger, for the same reason. Ten simultaneous bookings on a single-use code yield exactly one success.

---

## Decisions already taken

Recorded so they are not re-litigated later. Each is reversible, but each has a reason.

| Decision | Why |
|---|---|
| **An exhausted code fails the booking** rather than proceeding at full price | The guest entered a code and was shown a discounted figure. Charging more than they were quoted is worse than telling them the code has gone. |
| **One code per booking; no stacking** | Enforced by a unique constraint on `VoucherRedemption.reservationId`. Stacking multiplies the ways a discount can reach zero or below and needs rules nobody has written. |
| **Codes are matched case-insensitively** | Guests type them off printed cards and emails, where case is never reliable. A `UNIQUE INDEX ON UPPER(code)` stops two codes differing only by case. |
| **A discount is clamped to the room total** | A fixed AED 5,000 code against a AED 2,000 stay makes the accommodation free, not negative — which would otherwise hand money back through the VAT line. |
| **Booking transactions get a 30s budget** | Every booking quoting one code queues on that row, so they serialise. Measured: five concurrent bookings exceeded the old 15s limit and failed with `P2028`. A booking that waits beats a booking that fails. |
| **Offers are rate plans, not a new entity** | `RatePlan` already resolves nightly rates by date window and priority, and that path is tested. A separate offers table would be a second pricing path competing with it, and two places for a rate to disagree. |
| **`GuestAccount` is separate from `Guest`** | `Guest.email` is deliberately **not** unique — a hotel legitimately has several guests on one family address. An account needs a unique email. Joining on email at read time keeps both facts true. |
| **An unverified account cannot see bookings** | Otherwise anyone could register a stranger's address and read their stays. |

### Still to confirm with the client

- Should a voucher be usable by the **same guest more than once**? Currently yes, unless a global cap stops them.
  Per-guest limits would need a rule about what identifies a guest, given emails are not unique.
- ~~Do offers need a dedicated page?~~ Decided 18 Aug 2026: their own page, in the nav.
- ~~Should a guest account be offered during booking?~~ Decided 9 Oct 2026: a separate sign-up page only, for now.
- ~~Should the nav's Members link go to `/account`?~~ Yes — done 9 Oct 2026.

---

## The work, in order

Dependency order. Each step ends somewhere the suite is green and the app runs.

### 1 · Voucher API and admin — **done** (editing and report added 9 Oct 2026)

Built and verified end to end in a browser: a code created in the panel, applied in the reserve flow, with the
summary reconciling line by line.

| Piece | Where |
|---|---|
| Provider methods | `listVouchers`, `createVoucher`, `updateVoucher`, `deleteVoucher`, `previewVoucher` |
| Admin routes | `/admin/vouchers` — read open to STAFF, writes ADMIN-only, every write audited |
| Guest route | `POST /api/vouchers/preview` — prices a stay with a code, **claims nothing** |
| Admin screen | `web/app/[locale]/admin/vouchers/` |
| Reserve flow | A code field under the summary total, and a discount line in the breakdown |
| Tests | `tests/vouchers-api.test.ts` (13), `e2e/voucher.spec.ts` (3) |

Measured in the browser on a two-night stay: room total AED 1,960, discount −392, **VAT 78.40 (5% of the
discounted 1,568, not of 1,960)**, Tourism Dirham 40 undiscounted, total 1,686.40.

Two things worth knowing about the shape of it:

- **The preview and the booking share one validation path.** `previewVoucher` calls the same `validateVoucher`
  the booking transaction uses, so a guest cannot be shown a discount the booking would then refuse.
- **A rejected code fails inline, not as a booking error.** `applyVoucher` returns a message rather than throwing,
  so a mistyped code does not put the whole flow into its error state.

#### Added 9 Oct 2026

- **Editing a code's fields** from the panel — discount, window, cap, minimum nights, minimum spend, room types.
  The code itself is fixed once created (guests already have it). The cap cannot go below the uses already made.
- **Bookings report per code** — `GET /admin/vouchers/:code/redemptions`, open to STAFF: reference, guest, stay,
  status and discount for every booking that used it, with the total given away. Cancelled bookings stay listed,
  because cancelling does not return a use.
- Fixed on the way: the voucher form's room-type checkboxes used CSS classes that did not exist and rendered
  unstyled; and creating a duplicate code showed "redeemed and cannot be deleted" instead of "already exists".

### 2 · Offers — **done** (admin editing added 9 Oct 2026)

**Where offers live was decided on 18 Aug 2026:** their own nav entry and page, between Rooms and Dining. That is
the standard position on hotel sites — Hilton, and the hotel-website structure guides, all put Offers in the core
nav — and it is where a guest who has just looked at rooms will go next.

| Piece | Where |
|---|---|
| Provider | `listPublicOffers()` — active, flagged, and not expired |
| Guest route | `GET /api/offers` |
| Page | `web/app/[locale]/(marketing)/offers/` — in the nav and the sitemap |
| Tests | `tests/offers.test.ts` (11) |

The page follows the Rooms layout deliberately rather than inventing one: an offer is a room at a price, and the
guest is making the same kind of decision. It shows a saving badge, the struck-through standard rate, minimum
stay, which nights it applies to, and a link into the booking flow with the room preselected.

Decisions taken here:

- **An expired offer removes itself.** `listPublicOffers` filters on the date window, so nobody has to remember to
  deactivate last summer's rate. An offer ending *today* is still shown — "valid until the 31st" includes the 31st.
- **A saving is only claimed when it is real.** `standardRate` comes back null when the plan is not actually
  cheaper than the room's base rate, and the badge renders from that field alone. A rate plan can legitimately be
  a *higher* peak rate, and "save 0%" on one of those would be a lie.
- **A future offer is advertised, with its dates.** Worth promoting before it starts.
- **Ordinary rate plans are never advertised.** Only `isPublicOffer` ones — otherwise the hotel's internal
  seasonal pricing structure ends up on a marketing page.
- **Weekday restrictions are formatted with `Intl.ListFormat`**, not by joining on a comma. Arabic does not use
  "," and renders "الجمعة والسبت" correctly.

#### Left undone in step 2

- ~~**The deep link did not preselect the room.**~~ **Fixed 16 Sep 2026.** The link carried
  `?room=<code>` from the start, but nothing in `useBookingState` read it, so every offer landed on step 1 with
  no room chosen. Found while building the room detail page, which needs the same parameter. See
  [`project-status.md`](project-status.md#room-detail-pages-16-sep-2026).
- ~~**No admin editing of rate plans.**~~ **Done 9 Oct 2026.** Admin → **Rates & offers** lists every plan by
  room type and adds, edits, (de)activates and deletes them; ticking "Show on the offers page" makes a plan an
  offer. Behind the seam as `listRatePlans` / `createRatePlan` / `updateRatePlan` / `deleteRatePlan`; routes
  `GET /admin/rate-plans` (STAFF) and `POST|PATCH|DELETE /admin/room-types/:code/rate-plans[/:planCode]` (ADMIN,
  audited with before/after rates). Tests: `tests/rate-plans-api.test.ts` (10), which check that an edit changes
  the price `/api/rates` quotes.
  - Plans now have a **`code`** (a slug, unique per room type) — the admin API addresses them by room type plus
    code, never by row id. Migration `20261009090000_rate_plan_codes` backfilled codes.
  - The same migration **deleted the seeded "Standard Rate" plans**, and the seed no longer creates them. Each
    copied its room's base rate with no dates on every night, so it *outranked* the base rate: editing a base
    rate in Admin → Rooms changed nothing a guest paid. Only rows still exactly mirroring the base rate were
    removed, so no price changed. Railway staging gets this on its next deploy.
  - A one-sided date window or no weekdays is refused (as the database CHECKs already required), both in the
    form and in the API, checked against the plan *as it would be saved*.
- **No per-offer page.** The list links straight into the booking flow. If marketing wants to link to a single
  offer from an email, `RatePlan` needs a `slug` — a small migration, deliberately not done on spec.

### 3 · Guest accounts — **done 9 Oct 2026**

Sign-up is a separate page only (decided 9 Oct 2026): nothing in the booking flow offers an account, and booking
never requires one. Linked from the nav as **Members** and from the footer as **Your bookings**.

| Piece | Where |
|---|---|
| Sessions | `server/src/accounts/guest-session.ts` — own cookie `cove.guest`, own table `guest_sessions` (migration `20261009120000_guest_sessions`), own middleware. Only a SHA-256 of the cookie is stored. Idle timeout `GUEST_SESSION_IDLE_DAYS` (default 30), rolled forward at most hourly. |
| Routes | `server/src/routes/account.routes.ts`, under `/api/account`: `register`, `verify`, `verification` (resend), `login`, `session`, `logout`, `password-reset/request`, `password-reset`, `reservations` |
| Bookings read | `BookingProvider.listReservationsForGuestEmail` — matched on the address, case-insensitively, so bookings made before the account existed appear |
| Emails | `verificationEmail`, `passwordResetEmail`, `accountExistsEmail` in `server/src/emails/templates.ts` (draft Arabic included) |
| Guest UI | `web/app/[locale]/account/` — sign in / my bookings, `register`, `verify`, `reset` |
| Tests | `server/tests/guest-accounts.test.ts` (11) — follows the real emailed links via a captured transport |

How the privacy rules are met:

- **No route says whether an address has an account.** Register and reset-request always answer `202 {ok:true}`;
  the email differs. Registering an address that already has a confirmed account emails its owner ("you already
  have an account", with sign-in and reset links) and changes nothing. Registering an unconfirmed one re-sends
  the confirmation and does **not** overwrite the first registrant's password.
- **Bookings need a confirmed address** (`403 EMAIL_NOT_VERIFIED` otherwise). Completing a password reset also
  confirms the address — the link arrived in that inbox.
- **Emailed links are single-use**, stored hashed, and expire (confirm 48h, reset 1h). Asking again withdraws the
  previous link. A reset signs the account out everywhere.
- **A guest session opens nothing on the admin side** — tested against `/api/admin/*` and `/api/auth/session`.
- **Rate limits** on everything that sends email: 3 per address and 20 per IP per 15 minutes. Sign-in: 10 failed
  attempts per IP per 15 minutes, with a decoy hash so a wrong address and a wrong password take the same time.
- Signed-in writes (resend confirmation) need the `X-CSRF-Token` from `login`/`session`, as admin writes do.

Left for later: cancelling from "my bookings" (it still goes through the emailed link, and the page says so),
editing name or password while signed in, and deleting an account.

## Things that will bite

- **`RoomType.amenities` is optional in `web/lib/api/types.ts`** and the same reasoning applies to anything added
  to a cached response. The marketing pages cache for an hour and the two services deploy independently, so the
  front-end will meet responses that predate a new field. Type it optional and let the compiler find the reads.
- **The price snapshot is authoritative.** A reservation stores its own `PriceBreakdown`, discount included, and
  is never repriced. Changing a voucher after a booking must not alter what that guest was quoted.
- **Cancelling does not return a voucher use.** `redemptionCount` is not decremented on cancellation. That is
  probably right for a promotion with a fixed budget, and wrong for a single-use gift code — **confirm which
  before launch**, because it is a data-losing decision to reverse.
- **Arabic copy.** Voucher and offer names are stored in the database in both languages, like amenities, so they
  are edited in the admin panel rather than in `ar.json`. Account and offer *interface* strings are message-file
  keys and will show in `npm run check:translations`.
- **The e2e suite writes real bookings.** Any test applying a voucher also increments a real counter. Use codes
  prefixed `ZZ` and clean them up, as `voucher-concurrency.test.ts` does.

---

## Checks

```bash
cd server && npm run db:export                 # tests write to the shared dev database — back it up first
cd server && npm run typecheck && npm test     # 150+ tests
cd web    && npm run typecheck && npm test && npm run build
cd web    && npx playwright test               # needs the API running
```

The concurrency tests are slow on purpose — they fire real simultaneous transactions at the hosted database.
`tests/voucher-concurrency.test.ts` alone takes around 100 seconds.
