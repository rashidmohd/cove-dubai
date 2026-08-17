# Vouchers, offers, and guest accounts

The working plan for three features added to Phase 1 scope on **15 August 2026**. The voucher engine is built and
tested; offers and guest accounts have their data model in place and nothing above it.

Read [`project-status.md`](project-status.md) first for where the rest of the project stands.

> **Scope note.** None of these three are in CLAUDE.md, the original proposal, or the approved mockups. They are a
> deliberate addition, and each brings a design decision the mockups do not answer — most importantly *where an
> offers page lives on the site* and *what a signed-in guest sees*. Those need the client, not a developer.

---

## Where things stand

| | Data model | Engine | API | Admin UI | Guest UI | Tests |
|---|---|---|---|---|---|---|
| **Vouchers** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ 18 |
| **Offers** | ✅ | — reuses rate plans | ❌ | ❌ | ❌ | ❌ |
| **Guest accounts** | ✅ | ❌ | ❌ | n/a | ❌ | ❌ |

**74 server tests pass.** Nothing here is half-applied: the migration is deployed, everything typechecks, and the
unused tables are empty and inert.

⚠️ **The Railway database now has empty `vouchers`, `voucher_room_types`, `voucher_redemptions`,
`guest_accounts`, and `guest_account_tokens` tables, plus three new columns on `rate_plans`.** Harmless, but they
are there and unused until the work below is done.

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
- Do offers need a **dedicated page**, or do they sit on the Rooms page? The mockups have neither.
- Should a guest account be **offered during booking** ("save these details"), or only from a separate sign-up?

---

## The work, in order

Dependency order. Each step ends somewhere the suite is green and the app runs.

### 1 · Voucher API and admin *(the engine has no way in yet)*

Codes can only be created with SQL today, which is the main reason this is first.

- **`server/src/booking/types.ts`** — `AdminVoucher`, `VoucherDraft`, `VoucherChanges`.
- **`server/src/booking/provider.ts`** — `listVouchers`, `createVoucher`, `updateVoucher`, `deleteVoucher`, and a
  `previewVoucher(code, stay)` for the guest-facing check. These belong behind the seam: a PMS would own promotions.
- **`custom-db.provider.ts`** — implement them. Deleting a voucher with redemptions must be **refused**, exactly as
  an in-use amenity is: the redemptions are the campaign's financial record. Deactivate instead.
- **`server/src/routes/admin.routes.ts`** — CRUD under `/admin/vouchers`, `requireRole('ADMIN')`, every write
  audited. Add `voucher.create` / `.update` / `.delete` to `AuditAction`.
- **`server/src/routes/booking.routes.ts`** — a guest-facing `POST /api/vouchers/preview` so the reserve flow can
  show the discount *before* committing. It must **not** claim a use — validation only.
- **`server/src/routes/schemas.ts`** — accept `voucherCode` on `createReservationSchema`. The provider already
  reads `draft.voucherCode`; nothing passes it yet.
- **`web/app/[locale]/admin/vouchers/`** — list, create, edit, deactivate. Follow `admin/amenities/` exactly.
- **`web/app/[locale]/reserve/`** — a code field on the guest-details step, with the discount shown as its own
  line in `StaySummary`. The summary lines must still sum to the total; there is already an e2e test asserting that.
- **Tests** — an API test file mirroring `tests/amenities.test.ts`, plus an e2e booking with a code applied.

### 2 · Offers

Small, because the pricing already works. This is mostly exposure and editing.

- **Provider** — `listRatePlans(roomTypeCode)`, `createRatePlan`, `updateRatePlan`, `deleteRatePlan`, and
  `listPublicOffers()` returning active plans with `isPublicOffer` true and a live date window.
- **Admin** — rate-plan editing per room type, including the new `descriptionEn/Ar` and `isPublicOffer`. This also
  closes the "no rate-plan editing" gap already recorded in `project-status.md`.
- **Guest** — `GET /api/offers`, and a surface for them. **Decide with the client where that lives** before
  building the page.
- **Watch:** an offer whose window has passed must stop being advertised. `listPublicOffers` filters on date; do
  not rely on someone deactivating it by hand.

### 3 · Guest accounts

The largest of the three, and the only one that is genuinely new machinery rather than an extension.

- **Auth** — reuse `scrypt` from `server/src/auth/password.ts`. Sessions must be **separate from admin sessions**:
  a different cookie name and a guest-only middleware. A guest must never be able to reach an admin route by
  holding a session, so do not add a role field to the existing admin session and branch on it.
- **Email** — verification and password-reset messages, in `server/src/emails/templates.ts` alongside the existing
  three. Tokens are stored **hashed** (`GuestAccountToken.tokenHash`), single-use, and expiring; the schema is
  already shaped for it.
- **Routes** — register, verify, sign in, sign out, request reset, reset, and `GET /api/account/reservations`.
- **The join** — a signed-in account sees reservations whose guest email matches its own, case-insensitively.
  There is no foreign key from `Reservation` to `GuestAccount` on purpose: bookings made before an account existed
  must appear, and the account is a view over them rather than their owner.
- **Guest UI** — `web/app/[locale]/account/` — sign in, register, verify, reset, and "my bookings".
- **Rate limit** registration and reset requests as tightly as admin login. Both send email to an
  attacker-supplied address.
- **Never require an account to book.** The guest flow must keep working end to end for someone who has never been
  here and never will again.

---

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
cd server && npm run typecheck && npm test     # 74 tests
cd web    && npm run typecheck && npm test && npm run build
cd web    && npx playwright test               # needs the API running
```

The concurrency tests are slow on purpose — they fire real simultaneous transactions at the hosted database.
`tests/voucher-concurrency.test.ts` alone takes around 100 seconds.
