# Project status

**Last updated:** 16 September 2026
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
cd web    && npm run typecheck && npm test     # 51 tests — pure, no network
cd web    && npm run check:translations        # Arabic coverage report
cd web    && npx playwright test               # 39 e2e — needs the API running
```

The 7 admin e2e tests skip unless `E2E_ADMIN_PASSWORD` is set to the password of `admin@covedubai.local`, so the
suite still runs for anyone without admin credentials. Set one with:

```bash
cd server && npm run admin:password -- admin@covedubai.local '<a long password>'
```

Playwright drives the **system Chrome** (`channel: 'chrome'`): its bundled Chromium has no build for macOS 13 on
ARM. On CI, set `E2E_USE_SYSTEM_CHROME=false` to use the bundled browser.

The e2e suite writes **real reservations** to the shared database under `@e2e-test.invalid`. It does not clean up
after itself. **`reserve.spec.ts` books the Cove Suite, of which the hotel has eight** — so eight runs exhaust it
for the suite's dates and the room vanishes from availability. The failure that follows is confusing, because it
surfaces in whatever *other* test happened to reference that room rather than in the one that consumed it.
`room-detail.spec.ts` therefore keys on the Studio Room (44 of them) even though it books nothing. Remove them and release their inventory with the SQL in [Cleaning up test bookings](#cleaning-up-test-bookings)
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

> ⚠️ ~~**`assets-dev.covehotels.ae` is not connected to the bucket.**~~ **Resolved 15 Sep 2026** — the custom
> domain now serves the bucket; see "Photography is live on the marketing site" below. Kept for the method.
>
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

#### Favicon and app icons (15 Sep 2026)

`app/favicon.ico` was still the stock Next.js mark (black circle, white triangle). Replaced with the brand's
own monogram — **the `C` in Cormorant**, which the design system already names as a signature effect (the
ghost monogram), so this is the existing mark rather than a new one: gold on `--dark`, carrying the wordmark's
gradient and a faint woven texture at the larger sizes.

Three files, using the Next.js `app/` file conventions — no `<link>` tags to maintain, the framework emits them:

| file | size | emitted as |
|---|---|---|
| `app/favicon.ico` | 16 / 32 / 48 | `rel="icon"` |
| `app/icon.png` | 512 | `rel="icon"` |
| `app/apple-icon.png` | 180 | `rel="apple-touch-icon"` |

Two things worth recording for whoever regenerates these:

- **Cormorant at its display weights disappears at 16px.** The wordmark's 300 has strokes too thin to survive
  the downscale. The icon uses **weight 600 at a larger optical size**, with the gradient's dark end lifted
  (`#f0d18f -> #e0b76a -> #cfa457` rather than down to `#c49a52`), because the stock gradient read as a dark
  smudge in a tab. Four weight/brightness candidates were compared at actual 16px before choosing.
- **PNGs inside an `.ico` must be RGBA.** The first build failed with `Format error decoding Ico: The PNG is
  not in RGBA format!` — `sips` drops the alpha channel on a fully opaque image, and Chrome does the same when
  encoding a screenshot. The sizes are now produced by halving down through a canvas (a single big downscale
  loses the serifs) and encoded as colour-type-6 PNGs explicitly.

Verified: build passes, all three assets return 200 with the right content types, and the `.ico` round-trips
through the server with all three resolutions intact.

#### The type scale — the UI sans was 30-40% too small (15 Sep 2026)

The contrast pass below fixed colour. It could not fix size, and size was the larger half of the complaint.

Measured across seven pages: **the entire UI sans (Jost) rendered between 6.4px and 12.8px.** Nothing in it
exceeded 12.8px except the hero lede. A primary CTA at 9.9px, room prices at 9.3px, form field labels at
7.7px, the "DUBAI" sub-mark at 6.4px, and body copy at **12px / weight 200 / line-height 2.3**. The serif
headings (Cormorant, 16-88px) were never the problem and are untouched.

**This came from the approved mockups** — `.body{font-size:0.75rem;line-height:2.3;font-weight:200}` is
verbatim from `design/mockups/home.html`. It is a deliberate deviation from an approved design, taken on the
client's instruction, and **is worth raising with them explicitly** rather than letting them discover it.

Rather than nudge 101 individual declarations, the **scale** was remapped — a monotonic non-decreasing
old->new table applied mechanically, so no two sizes ever swap order and the design's hierarchy survives
exactly:

| was | now | | was | now |
|---|---|---|---|---|
| 0.40-0.48rem (6.4-7.7px) | **11px** | | 0.68-0.72rem (10.9-11.5px) | **14px** |
| 0.50-0.56rem (8.0-9.0px) | **12px** | | 0.74-0.82rem (11.8-13.1px) | **15px** |
| 0.58-0.62rem (9.3-9.9px) | **13px** | | 0.85-0.95rem (13.6-15.2px) | **16px** |

Nothing is pushed past 1rem, so the Cormorant headings keep their lead. **11px is the floor.** Also:
`font-weight: 200` -> `300` in 7 places (Jost 200 breaks up at body size), and the three loose leadings
(2.3, 2.1, 2.0) -> 1.8. The existing `[lang='ar']` overrides scale with everything else, so Arabic stays a
step larger than English as designed.

> ⚠️ **This broke the booking flow on phones, and the break was caught only by measuring.** `.steps` is a flex
> row of items that cannot shrink below their own text; at the larger type its min-content went to 385px
> against 342px of available phone column, forcing `.formSide` out to 433px and scrolling `/reserve`
> sideways at 390px. Confirmed as newly introduced by stashing the change and re-measuring the baseline
> clean. Fixed with tighter gutters and `flex-wrap` in the existing `max-width: 1000px` block. **The reserve
> flow has exactly one breakpoint (1000px)** — it is tuned for tablet, not phone, and is the place any future
> type or copy change will break first.

Verified after: **no horizontal overflow at 1440 / 1024 / 768 / 390 / 360px** across 13 page/locale
combinations, **0 contrast failures**, and the smallest text rendered anywhere is now **11px, up from 6.4px**.

**Not done: the `/admin` panel.** It has its own visual language and its own small type, and was deliberately
left out of scope — this pass covers the guest-facing site and the booking flow only.

#### Text contrast on light surfaces — the accent is now bronze (15 Sep 2026)

An audit of every text style on all seven pages, measured in the browser against each element's actual
rendered background, found **43 failing styles**. Three root causes, not scattered mistakes:

1. **`--gold` on light grounds.** 2.48:1 on `--w`, 2.18:1 on `--linen` — every section label, italic heading
   accent, venue kind, press source, staff role and step numeral on a pale ground.
2. **White on a `--gold` button.** 2.60:1, including `CHECK AVAILABILITY` and the `Select date` placeholder
   (2.55:1) — inside the booking flow, where CLAUDE.md makes WCAG 2.1 AA non-negotiable.
3. **`--fog` on `--linen`.** 4.17:1 — passed on `--w` (4.73) and failed only on the alternating linen sections.

**The stakeholders asked for "bronze or light brown".** Bronze works; light brown does not, and it is worth
recording why: lightness is the failing variable, so a lighter accent cannot fix it. Measured — a literal light
brown `#b08d57` is 2.95:1, and web "bronze" `#cd7f32` is 3.00:1 and reads terracotta rather than metal.

`--bronze: #7d6540` is the **lightest** bronze clearing AA for small text on both light surfaces (5.27:1 on
`--w`, 4.64:1 on `--linen`). One step lighter, `#8c7853`, drops to 4.07:1 and fails. It also carries white text
at 5.52:1, so bronze-filled buttons keep their white labels. `--bronze-dk: #6b5636` is the hover.

> **It is a second token, not a redefinition of `--gold`.** Gold still carries text on dark grounds at 7.33:1
> (nav, footer, quote bands, the hero, room-card labels over the scrim). Darkening it globally would have
> broken all of those — `--bronze` on `--dark` is only 3.45:1. Same split the `--text-on-dark` block already
> uses.

Two rules fell out of it:

- **On light grounds hover goes darker** (`--bronze-dk`), the mirror of the existing note on `--link-on-dark`.
  Lightening a bronze on cream would make the hovered state fainter and invert the affordance.
- **Buttons on dark grounds keep the gold fill and darken the label instead** (`--dark` on `--gold`, 7.33:1).
  A bronze fill on the dark hero reads as recessed rather than hovered, and hover to `--gold-lt` is 9.13:1, so
  the hovered state is both brighter and higher contrast.

`--fog` moved `#7a6e62` -> `#74695d` (two steps of lightness, same hue and saturation): 5.11:1 on `--w`,
4.50:1 on `--linen`. The two booking-flow placeholders went to `rgba(28,20,16,0.62)` — 5.00:1 on `--w` — and
stay clearly lighter than an entered value, which is full `--ink`.

**Re-measured after the change: 0 failing text styles across 13 page/locale combinations**, English and Arabic.

> One audit artifact worth knowing for next time: the `COVE` wordmark reports 1.05:1 to any script that reads
> the `color` property. It is painted with `background-clip: text` and a gold gradient, so `color` is unused
> and the real contrast is ~7.3–9.1:1. Skip elements whose `-webkit-text-fill-color` is transparent.

> ⚠️ **Contrast was the fixable half. The type is still very small.** Body copy is **12px at `font-weight:
> 200` with `line-height: 2.3`**, and small labels run 7.7–8.3px. That combination — extra-light, small, very
> loose leading — is the other half of why the pages read as hard work, and no colour change reaches it.
> **This is not a build defect:** `.body{font-size:0.75rem;line-height:2.3;font-weight:200}` is verbatim from
> the approved mockups. Raising it to ~14–15px at weight 300 with ~1.7 leading is a client decision, not ours.

#### Photography is live on the marketing site (15 Sep 2026)

**The custom domain is now bound.** `assets-dev.covehotels.ae` serves the bucket — re-measured, not assumed:
`GET /images/hotel.jpg` returns `200 image/jpeg`, where it previously returned a Cloudflare `404 text/html`.
That clears the display half of the two bucket-side blockers above. **CORS is still unconfigured**, so browser
uploads through the admin gallery remain blocked; the images now on the site were put in the bucket directly.

The client supplied **18 JPEGs under `images/`**: the facade, entrance, lobby (x2), reception, lift lobby,
restaurant (x2), pool (x2), gym (x2), and six room interiors. All are 2821x1596 except `hotel.jpg`, which is
portrait 1423x1688.

How they reach the page:

- **`web/lib/media.ts`** names every file against an object key and records its intrinsic size. Keys, never
  absolute URLs — the origin is `NEXT_PUBLIC_MEDIA_BASE_URL`, mirroring the server's `MEDIA_PUBLIC_BASE_URL`.
- **`resolveRoomPhoto` prefers the database.** A room type's uploaded `images[0]` wins; only if the gallery is
  empty does it fall back to a photograph named by `imageKey`, and only then to the gradient. So the moment CORS
  is fixed and someone uploads through the admin panel, that upload replaces the stand-in with no deploy.
- **`<Photo>`** (`web/components/marketing/Photo.tsx`) fills a slot with `next/image`, which re-encodes the
  JPEGs to WebP with a responsive `srcset` and lazy loading. Measured: `lobby.jpg` goes 1.3 MB -> 87 KB at
  1080px.
- **The gradients stay underneath every slot.** They are the loading state, the no-photography state, and the
  misconfigured-origin state at once. `mediaUrl` returns null with no origin set, exactly as the server's
  `publicUrlFor` does, so a bad environment degrades the page instead of breaking it.

> **The slots are portrait and the photography is 16:9.** Room cards are `3/4`, the About composition and the
> dining venues `4/5`. Cropping to fill discards roughly 58% of a frame's width. This was put to the client, who
> chose to keep the mockups' layout and accept the crop rather than relax the slots to landscape. The one slot
> that fits its photograph is the About building: the facade was shot portrait.

> ⚠️ **The room-card scrim had to be strengthened.** Its single linear ramp reached near-zero opacity exactly
> where the gold category label sits, and `CLASSIC` and `SIGNATURE` washed out against the pale ceilings in
> these interiors — invisible while the slots were gradients. The scrim now holds `0.86` to 40% and `0.6` to
> 70% with `4.5rem` of top padding. Verified legible on all four room types.

**A new Facilities section on the home page** ("The building") carries the pool, fitness floor, entrance and
lift lobby, which had no page to live on — there is no wellness page, though the nav links to one. Its slots are
`4/3`, chosen to suit the photography rather than crop against it.

**Still unplaced:** `lobby-2.jpg`, `pool-2.jpg`, `gym.jpg`, `room.jpg`, `room-2.jpg`. **Still gradients:** the
three staff portraits on About — the client has supplied no people photography.

> **The Offers page wiring is unverified.** It resolves photographs the same way the Rooms page does and it
> typechecks and builds, but the database has no offers seeded, so the page renders its empty state and the
> photograph path has never actually executed there.

**Alt text is in `photos.*` in the message files, English in both.** `ar.json` is an English placeholder
throughout (2/569 keys translated), and CLAUDE.md says the client supplies Arabic. The new keys join the 567
already awaiting translation rather than being machine-translated.

#### Three home page drafts, and a stay search that carries its dates (15 Sep 2026)

The home page has no search. A guest's first question is whether the hotel has their dates, and answering it
costs them a page load into `/reserve` and a date picker they then fill in from scratch. Three drafts of a new
first screen are at **`/[locale]/preview`**, which lists them and links back to the home page as it stands:

| Draft | Route | The bet |
|---|---|---|
| **Still** | `/preview/still` | One photograph at full bleed, hero line over it, search resting on the lower third. |
| **Editorial** | `/preview/editorial` | Words and search on a linen panel, the facade full-height beside them. |
| **Gallery** | `/preview/gallery` | Type masthead, four photographs, the search crossing the seam beneath them. |

**They are drafts, not pages of the site.** Each carries `robots: noindex, nofollow`, nothing links to them, and
`sitemap.ts` is an allowlist they are not on — a second home page with the same copy is a duplicate of the real
one, and indexing it would let the draft win. They are **not** in `robots.txt`: a `Disallow` there would stop a
crawler fetching the page and therefore stop it reading the `noindex`, which is the opposite of the intent.

Everything below the hero is one shared `components/marketing/HomeSections.tsx`, so comparing the drafts compares
the heroes rather than three drifting copies of a page. That file is a **copy** of the live home page's sections,
not yet a refactor of it: the page the client has signed off must not move while they are choosing. When a hero
wins it becomes `(marketing)/page.tsx` and the losers and the duplicate go with it.

**The search is the part worth keeping whichever hero wins.** `components/booking/StaySearch.tsx` takes check-in,
check-out and guests and links to `/reserve?checkIn=…&checkOut=…&adults=…`; `useBookingState` reads that query
string, so the flow opens already filled in and nobody enters the same dates twice. It deliberately does **not**
call the availability API — availability and pricing belong behind the Express seam, and a home page that quotes
prices is a home page that needs rewriting when a PMS takes those over (`pms-readiness`). It is a very good link.

Three things fell out of building it, each worth knowing:

- **One calendar, not two.** The reserve flow's month grid moved to `components/booking/CalendarPopover.tsx` and
  both now render it. The CSS moved verbatim and the `data-testid`s are unchanged, so the reserve flow renders
  the pixels it did before — a hotel with two calendars is a hotel where one of them is wrong about the earliest
  bookable day.
- **The query string is validated, not trusted.** `readStayQuery` in `lib/stay-dates.ts` is pure and tested (19
  cases): a stay in the past, a departure before its arrival, one date without the other, and `2026-02-31` all
  degrade to an empty date field rather than to a request the API rejects for reasons the guest cannot act on.
  `/reserve` needed a `<Suspense>` boundary for `useSearchParams` — without it the page silently stops
  prerendering, and it is still SSG in the build output.
- **The bar sizes itself with a container query, not a media query.** The same component sits full-width under a
  hero and in a half-width editorial panel, where on a 1440px screen it has 540px. A viewport breakpoint gets
  that case exactly backwards — it was the first thing that broke.

Checked in a browser at 1440px and 390px in both languages: the bar mirrors natively under RTL (check-in is the
rightmost field on `/ar`, which is the assertion in `e2e/home-search.spec.ts`), and the `still` hero's scrim was
measured against the lightest part of its photograph rather than its average, because the nav floats over a lit
chandelier there. `SiteNav` treats `/preview/still` as an overlay page for the same reason the home page is one;
the other two open on a pale panel and keep the solid bar.

**Not done here:** the drafts share the home page's existing copy, so nothing new awaits translation except 12
keys (`preview.*` and one photo caption).

> **Chosen: "Still" (15 Sep 2026).** It is now `(marketing)/page.tsx` — see the entry below. `preview/still` was
> deleted rather than kept, because it had become a byte-for-byte second copy of the home page. Editorial and
> Gallery remain under `/preview` until nobody needs them.

#### "Still" is the home page, and the navigation brings its own ground (15 Sep 2026)

The client chose the full-bleed photographic hero. What changed:

- **`(marketing)/page.tsx` is now that hero** — photograph, hero line, stay search on the lower third — followed
  by `HomeSections`. It defines **no metadata of its own**, deliberately: the locale layout already sets the
  canonical URL, the language alternates and the default title for this exact page, and a `generateMetadata` here
  would have to restate all three correctly or quietly break them. The draft's `noindex` is gone with it.
- **`preview/still` was deleted.** Once promoted it was a second copy of the home page at a second URL, which is
  the duplicate-content problem the drafts were marked `noindex` to avoid in the first place.
- **The home page's stylesheet now holds only its hero.** The section chrome moved wholesale into
  `HomeSections.module.css`, so the copy that existed while the heroes were being compared is resolved — there is
  one set of rules again, shared by the home page and the two remaining drafts.
- **`SiteNav` is back to `pathname === '/'`** for the overlay variant. The `/preview/still` special case went with
  the directory.

**The navigation carries its own gradient now.** A `::before` on the transparent bar only, fading out once the
page scrolls and the bar takes its solid background. Previously the nav's legibility was borrowed entirely from
the hero's scrim, which meant darkening the whole ceiling of the photograph — an 0.8 alpha top stop — to keep
seven nav items readable. The wrong thing was paying for it. With the bar bringing its own ground the hero scrim
drops to **0.42**, and the chandelier and lobby that the client supplied are actually visible.

> ⚠️ **The nav contrast was not re-measured.** Lightening the hero scrim moves the nav links closer to their
> floor, and CLAUDE.md makes WCAG 2.1 AA non-negotiable. It reads clearly by eye at 1440px and 390px in both
> languages, but nobody has put a number on it — **check it on staging** against the real photograph, or measure
> it before launch. The gradient's alpha is one value in `SiteNav.module.css` if it needs to go up.

Verified: 39 unit tests, 33 e2e (the home search suite now drives `/` rather than the draft path), the five
reserve tests that exercise the calendar without writing reservations, a clean build with the home page and both
drafts prerendered in both locales, and lint steady at its 11 pre-existing errors.

#### The calendar now opens where it can be reached — including in the live booking flow (15 Sep 2026)

The date picker was pinned below its field (`top: calc(100% + 6px)`), and every field we have sits low on the
screen. Found on the new hero search, but **the shipping reserve flow had it too**, which is the part that
mattered. Measured in Chrome before the fix, calendar 289px tall:

| Surface | Viewport | Below the fold |
|---|---|---|
| `/preview/still` | 1440x900 | 224px — only the month header was visible |
| `/preview/gallery` | 1440x900 | 246px |
| **`/reserve`** | 1440x620 | **271px** |
| **`/reserve`** | 390x844 | **57px** |

A guest on a 13-inch laptop or any phone was being asked to scroll blind to reach the days, on the one journey
that earns money. Because both surfaces already shared `CalendarPopover`, one fix covered both — `DatePicker.tsx`
and `StaySearch.tsx` are untouched, which is what the extraction above was for.

The popover now measures its field on open and flips above it when it does not fit below. The arithmetic is in
`components/booking/placement.ts`, pure and tested apart from the DOM; the component measures and applies it in a
**`useLayoutEffect`**, so the flip lands in the same frame the calendar appears in and is never seen as a jump.
It re-measures on resize and scroll, since the reserve page can be scrolled with the picker open.

Decisions worth knowing:

- **Below is preferred and only given up when it does not fit.** It is what a date field is expected to do and it
  leaves the field itself unobscured.
- **The margin is 8px, and that number was measured, not chosen.** The reserve flow at 1440x900 clears the bottom
  of the window by 18px. At a margin of 12 that case sits exactly on the boundary, where the field's fractional
  pixel decides whether it flips — and flipping there throws the calendar over the step heading for no gain. It
  still opens downwards, as it always has. The point was to rescue what was broken, not to move what worked.
- **Nothing special-cases the fixed nav** on `/preview/still`. A flipped calendar could only slide under that bar
  when the field is near the top of the screen — and then there is more room below, so it never flips. The rule
  corrects for the nav without being told it exists.
- **When it fits on neither side** (a phone in landscape) it takes the roomier side and scrolls internally, with
  a floor so it can never be capped to an unusable sliver.

Verified: 9 unit cases in `tests/calendar-placement.test.ts` built from the measured numbers, 9 new e2e cases in
`e2e/home-search.spec.ts` asserting the open dialog lies fully within the viewport (both calendars, three drafts,
two viewports, plus `/reserve` at 1440x620 and 390x844), and the 5 reserve tests that exercise the calendar
without writing reservations. Re-measured afterwards: every case above opens fully on screen, and `/reserve` at
1440x900 still opens downwards.

> ⚠️ **Found while checking this, not caused by it: the Arabic weekday row is cramped.** In the 272px calendar,
> `الأربعاء` / `الخميس` and their neighbours collide at 0.6875rem across seven columns — Arabic weekday names are
> much longer than `WED`/`THU`. It predates this work and is equally visible in the reserve flow. Either the
> calendar widens on `/ar` or the names shorten; both are a design call, not a bug fix.

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
/[locale]/rooms/[code]    one room: description, specs, amenities, gallery
                          (in the booking flow the same detail is a dialog, not this page)
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

## Header contrast pass (16 Sep 2026) — one item needs the client's sign-off

Measured against the live hero rather than judged by eye. `SiteNav.module.css` carries the reasoning inline.

| | before | after |
|---|---|---|
| Nav links | 8.1–9.9:1 | unchanged, but set in Jost **400** rather than the inherited 300 |
| Reserve button | 3.72:1 — **failed AA** | **7.33:1** |

- **Reserve is now a filled gold CTA** (`--dark` on `--gold`, hover `--gold-lt` at 9.13:1). ⚠️ **This departs
  from the approved mockup**, where `.nbtn` is `background: transparent` with a gold border, and
  `cove-design-system` says the mockup wins on a disagreement — **so this needs the client's confirmation.**
  Two reasons it was still the right call: the outlined version failed AA at 3.72:1 and only passed on /ar
  because the bar mirrors onto a darker part of the same photograph; and a filled button's contrast owes nothing
  to the image behind it. Worth noting the system and the mockup already contradicted each other —
  `cove-design-system` permits "two kinds only, a filled gold CTA and a text/underline quiet button", and the
  outlined gold button was a third. **If the client prefers the outlined look, it needs a scrim behind it** —
  `rgba(24, 14, 6, 0.25)` measured 4.79:1, which is the version that was in place before this.
- **Nav links moved from weight 300 to 400.** Nominal contrast was flattering them: at 13px/300/0.28em over a
  photograph, the average pixel actually drawing a letter sat at luminance 112 of 255 — under half the white it
  was nominally set in. 400 lays down 16% more ink and lifts that to 127. Within the system (Jost 200/300/400)
  and already in the `next/font` subset, so it costs no extra download.
- **The nav's scroll transition now fades.** The solid bar (colour, blur, hairline) moved onto `.nav::after` and
  animates **opacity**. Previously `transition: all` swept up `padding`, so the bar collapsed as it darkened,
  and `backdrop-filter` cannot transition from `none` so the blur snapped on in one frame. Opacity is
  compositor-only, so the fade also stopped running layout on every frame of a scroll.

> ⚠️ **Everything above except the Reserve button is tuned to a placeholder hero.** The nav-link weight and the
> gradient were measured against the image currently on the home page. **Re-measure when the client's
> photography lands.** The filled button is the one element that will not need it.

---

## Room detail — a dialog in the flow, a page for search (16 Sep 2026)

Until now there was nowhere to read about a room: the Rooms page was one long listing, and **step 2 of the
booking flow showed a room as a name, a category, a rooms-left count and a price, with no way to find out
anything more before committing to it.**

There are two answers, and they are deliberately not alternatives:

| | Where | Why this shape |
|---|---|---|
| **Dialog** | `web/app/[locale]/reserve/RoomDetailDialog.tsx` | A guest comparing rooms is mid-decision. Navigating away ends the comparison and makes them find their way back. |
| **Page** | `web/app/[locale]/(marketing)/rooms/[code]/` | A modal has no URL. A room page is the strongest thing a hotel has to show a searcher, and it is shareable. |
| **Shared body** | `web/components/RoomDetail/` | Description, specs and amenities rendered once, so the two surfaces cannot drift apart. |

Entry points: **View details** on every card in reserve step 2 (opens the dialog), and **View room** on the Rooms
listing (goes to the page). Tests: `e2e/room-detail.spec.ts` (6), `tests/stay-dates.test.ts` (+5 unit).

**No server change was needed.** `AvailableRoomType extends RoomType` and `checkAvailability` already loads
`WITH_AMENITIES`, so the booking flow was fetching every room's description, occupancy, amenities and
photographs and discarding them. The dialog fetches nothing at all — it is a different view of data the step
already holds, and the price it shows is the total the card behind it already quoted.

Decisions worth knowing:

- **The dialog is a native `<dialog>` with `showModal()`**, as the admin panel's `ConfirmDialog` is. That brings
  the focus trap, the Escape key and top-layer stacking with no library, which is most of what WCAG 2.1 AA asks
  of a modal. Escape is intercepted (`onCancel`) so the close goes through React state rather than the element
  closing itself while React still believes a room is open.
- **The open room is held as a code, not an object**, and resolved from the current availability list on each
  render — so a refreshed response cannot leave the dialog quoting a price the row behind it has stopped showing,
  and a room that sells out while the dialog is open closes it rather than leaving an unbookable price on screen.
- **The page is statically prerendered in both locales** — 8 pages, revalidated hourly, in the sitemap with
  canonical and hreflang. It ships **no JavaScript of its own**: its price is the nightly "from" rate, rendered
  on the server, because nobody reaching that page has chosen dates. "What do my nights cost" is the dialog's
  question, and it answers it without a page load.
- **Specs still come from the message files** — `rooms.specs.<code>.*`, guarded by `t.has()`. Now read through
  `lib/room-specs.ts` so the listing, the page and the dialog cannot disagree about which specs exist or which
  read left-to-right. This is the *known* weakness: they are keyed by room code and invisible to the admin panel,
  so **a room type added in the admin panel shows no specs at all**. See the open item below.
- **The card in step 2 is now a card, not a button.** A control cannot be nested inside a button, and making the
  whole card a link would have taken away the one-click selection the step exists for. The frame and the selected
  state moved to a wrapping `div`; the `<button>` inside it still carries `data-testid="room-<code>"` and
  `aria-pressed`, so the Playwright suite drives it unchanged.

> 🐛 **`?room=` was doing nothing, and had never worked.** The offers page has linked into the booking flow with
> `query: { room: offer.roomTypeCode }` since 18 Aug — "a link into the booking flow with the room preselected" —
> but nothing in `useBookingState` ever read the parameter. Offers deep-linked to step 1 with no room chosen.
> Now read and validated (`readRoomCode`), which is what makes the room page's reserve button work and fixes
> offers as a side effect.

> 🐛 **A sold-out room could survive into step 3.** `searchAvailability` clears a `roomTypeCode` the availability
> response does not contain, but the *other* path into step 2 — the effect that re-fetches after a restored
> session, and now after a `?room=` link — did not. A guest restoring a session whose room had since sold out
> kept it selected and could press Continue, failing at the booking instead of picking again. The same guard now
> runs on both paths.

> ⚠️ **An author `display` on a `<dialog>` keeps it laid out when closed.** The UA stylesheet hides one with
> `dialog:not([open]) { display: none }`, but *any* author `display` beats a UA rule whatever the specificity
> says. Setting `display: grid` unconditionally left an invisible full-viewport box in the flow after the dialog
> closed, swallowing clicks meant for the room list behind it. The layout is scoped to `.detailDialog[open]`.
> Caught by the e2e suite, not by looking at it — the box is transparent.

---

## Reserve step 2 contrast pass (16 Sep 2026)

Prompted by a look at the room list, and measured rather than judged by eye. Two of the three findings were not
cosmetic.

| | before | after |
|---|---|---|
| Step not yet reached | `rgba(28,20,16,.45)` — **2.94:1, failed AA** | `--fog`, **5.11:1** |
| Step badges | circles, `border-radius: 50%` | **squares**, like the selection tick below them |
| "View details" | `--fog` 5.11:1 / 4.50:1 on a selected card | `--bronze`, **5.27:1 / 4.64:1** |
| Its underline | `rgba(28,20,16,.2)` — **1.53:1, failed the 3:1 UI floor** | solid `--bronze`, **5.27:1** |

- **The stepper's idle state failed AA outright** at 0.75rem, and had since the flow was built — tuned by eye as
  a translucent black, which is exactly the failure mode `tests/contrast.test.ts` was written for. It is now
  `--fog`, a token, so the test covers it.
- **Idle is deliberately *not* `--bronze`.** `.stepDone` is bronze; giving both the same colour would erase the
  only thing the control says — which steps are behind you and which are ahead.
- **The step badges are square.** `cove-design-system` asks for minimal radius (`--radius` is 2px) and warns off
  rounded pills, and this was the only `border-radius: 50%` on any guest-facing surface — the selection tick on
  the room cards directly below it was already a sharp square.
- **Filled for where you have been and where you are, outlined for what is ahead**, so the progression reads
  from the shapes before any colour is interpreted — which is all someone who cannot separate bronze from
  grey-brown has to go on. Done is filled `--bronze` with a white tick (5.52:1); the current step is filled
  `--ink` with a white number (18.15:1); what is ahead is a hairline outline in `--fog`.
- **The current step is the darkest mark, not the accent one.** Bronze is this site's accent and pulls the eye,
  so making a *completed* step bronze and the current step bronze as well would have left the underline doing
  all the work of saying where you are.
- **No alpha below 1 clears 3:1 for the underline** on either surface — measured at 0.3 through 0.7, the best
  being 2.91:1 on `--w`. It is the only thing marking that control as pressable, so it is solid.

> 🐛 **"View details" was rendering as a grey box.** It was a link until the details moved into a dialog, and a
> `button` brings the UA's `ButtonFace` background and a full border with it. Nothing reset them, so a quiet
> text button rendered as a washed-out box that read as *disabled*.

> 🐛 **The completed step's tick was a fallback-font glyph.** It was the literal character `✓` (U+2713), and
> the `next/font` faces are subset to `latin`, whose `unicode-range` stops well short of the Dingbats block.
> Since `unicode-range` decides which characters a face is used for at all, Jost was **never** used to draw it —
> the browser fell through to whatever symbol font the OS supplies, so the mark was Apple Symbols on one machine
> and Segoe UI Symbol on the next. Measured, not assumed: `✓` renders at an identical width under `Jost` and
> under a deliberately non-existent family, while letters and digits differ. It is now drawn in CSS, like the
> selection tick on the room cards.

> 🐛 **The room card's selection tick was a ">" in Arabic.** `.checkMark` is drawn with
> `border-inline-start` + `border-bottom` rotated -45°, and under RTL the inline-start border resolves to the
> *right* one — so the shape became a right-plus-bottom corner and drew a chevron rather than a tick. The
> comment directly above it claimed "a tick, not a layout mirror: it reads the same in both directions", which
> is what it was *for*, not what it did. Physical `border-left` is the one case here where a logical property is
> the wrong tool: a tick is a mark, not a reading direction. **Pre-existing**, and invisible unless you look at
> `/ar` with a room selected.

> 🐛 **The room card's three lines were rendering as one** — "Studio Room44 rooms left". `.roomCategory`,
> `.roomName` and `.roomMeta` are `<span>`s and were never given `display: block`, so their `margin-bottom` did
> nothing: margins do not apply to inline boxes. **Pre-existing**, from when the card was first built against
> the mockup, where those three are `div`s.

`tests/contrast.test.ts` now asserts the light surfaces too — `--fog`, `--bronze` and `--bronze-dk` on both
`--w` and the `--linen` of a selected card, plus that hover *darkens* on a light ground rather than lightening
(the mirror of the trap already noted for links on dark).

---

## Room photographs were never reaching the site (16 Sep 2026)

Reported as "the search result is not showing the image I uploaded in the admin". It was two separate faults
stacked on top of each other, and the second one hid the first.

### 1. The booking flow never rendered a photograph at all

*(and the slot it would have rendered into was swatch-sized — see below)*

Step 2's room card drew `<span class="roomSwatch" data-swatch={imageKey}>` — the mockup's CSS gradient, and
nothing else. **Every other surface already rendered the real photograph**: the home page, the Rooms listing,
the Offers page, the room page and the detail dialog all call `resolveRoomPhoto` + `Photo`. The availability
response has carried `images` the whole time; this one card discarded them. Now fixed, with the gradient kept
underneath as the loading and failure state and `aria-hidden` retained so the alt text does not get read into
the button's accessible name ahead of the room's own name.

The slot was also **56×56**, straight from the mockup — where it held a CSS *gradient*, because the mockups
have no photography at all. A 16:9 room photograph cropped to a 56px square shows a patch of wall: it read as a
colour chip rather than as a picture of the room being chosen. It is now **200×113**, dropping to 104px wide
at the ≤1000px breakpoint, set with `aspect-ratio` so the two sizes cannot drift. **16:9 is the photographs' own
ratio** — the uploads are 2821×1596 — so the slot crops nothing and the room is shown as it was shot; it also
keeps the card shorter than a taller ratio would at the same width. This departs from the mockup
knowingly — `cove-design-system` says the mockup wins on a disagreement, but the mockup never depicted a
photograph here, so there is nothing to disagree with.

**"View details" moved to the trailing edge**, under the price rather than under the photograph — the wider
image left a column of dead space on that side, and the price is the last thing read before deciding whether to
look closer. The card is a flex column and the control uses `align-self: flex-end`, so it follows the reading
direction and needs no RTL rule of its own.

While doing it: **the mobile grid track and the swatch had already drifted apart** — a 40px column holding a
56px image, so the image, not the track, was deciding the column width.

### 2. Every uploaded photograph 404s at the public origin — **config, not code**

```
MEDIA_ENDPOINT=https://<account>.r2.cloudflarestorage.com/cove-dev   ← trailing path segment
MEDIA_BUCKET=r2-cove-dev                                            ← not the real bucket
```

R2's S3 API is path-style, so the first segment after the host **is the bucket**. With `/cove-dev` already on
the endpoint, the SDK appended `MEDIA_BUCKET` as the first segment of the *object key*. Every upload landed at
`r2-cove-dev/room-types/<uuid>.jpg` in a bucket actually named `cove-dev`, while `MediaAsset.storageKey` stored
`room-types/<uuid>.jpg`. `publicUrlFor` joins the public origin to that key, so every URL the site emits is
wrong by exactly one path segment.

Measured, not inferred:

| | |
|---|---|
| `assets-dev.covehotels.ae/images/room.jpg` | **200** — the custom domain is correctly wired to `cove-dev` |
| `assets-dev.covehotels.ae/r2-cove-dev/room-types/<uuid>.jpg` | **200** — the photograph is there, and public |
| `assets-dev.covehotels.ae/room-types/<uuid>.jpg` | **404** — the URL the site actually builds |

A `ListObjectsV2` on `cove-dev` shows the 19 seeded `images/*` objects alongside 5 uploads all carrying the
stray `r2-cove-dev/` prefix. `HeadObject` on bucket `r2-cove-dev` is a 403 — it does not exist; the credentials
are scoped to `cove-dev`.

**`server/.env` is corrected** (endpoint without the path segment, bucket `cove-dev`; previous file kept as
`.env.bak-media-fix`). That fixes *future* uploads, and needs an API restart to take effect.

> ⚠️ **Two things are still outstanding.**
> 1. **The 5 existing objects are at the wrong key** and need copying from `r2-cove-dev/room-types/…` to
>    `room-types/…` — or simply re-uploading in the admin panel once the API is restarted. Until then those
>    rooms render their gradient. Attempting the copy was correctly refused as a shared-resource change.
> 2. **Railway carries the same two variables** and will have the same fault. Fix them there before the client
>    sees staging, or every photograph they upload will silently fail to appear.

> ⚠️ **A 404 photograph shows the browser's broken-image glyph**, it does not fall back cleanly to the gradient
> underneath. `Photo`'s own docstring claims the gradient is "the loading state and the failure state at once",
> and that holds when there is *no* photograph — `resolveRoomPhoto` returns null and no `<img>` is rendered — but
> not when a URL exists and fails. Harmless once the keys above are fixed, and very visible until then, more so
> now the slot is 144px rather than 56px. Closing it properly means an `onError` handler, which would make
> `Photo` a Client Component on every marketing page; not worth it to paper over a misconfiguration.

> 🐛 **The upload path reports success either way.** The presigned PUT genuinely succeeds — the object is
> created, just under a key nobody will ask for — so the admin panel showed a green result and a thumbnail
> sourced from the same broken URL. Worth a follow-up: `addRoomTypeImage` could `HeadObject` the key it just
> signed, so a misconfigured origin fails at upload rather than silently months later.

---

## Open items for the client

None of these block development.

| Item | State |
|---|---|
| **Tourism Dirham amount** | Placeholder **AED 20**/room/night. Depends on the property's DET classification. Now changeable from **Admin → Settings** by an ADMIN, and it takes effect on the next quote — pricing reads it per request, so no deploy and no restart. Verified end to end: 20 → 15 changed a live quote immediately, and the change is audited with its before and after value. Bookings already taken keep the price they were quoted. Still **must be confirmed before launch**. |
| **"Forty-eight rooms" copy** | The site reads 106, but that is a number substituted into the client's prose. The About story and footer tagline need re-wording properly. |
| **Arabic translations** | 2 of 441 keys — the admin panel and amenities added the rest. Deliberate: brand copy is never machine-translated. `npm run check:translations` prints the exact checklist. **The 19 seeded amenity names also need Arabic** — they live in the database, not the message files, so they are edited in Admin → Amenities rather than in `ar.json`. **The transactional emails need Arabic too**, and those live in `server/src/emails/templates.ts` — the one place Arabic copy is not in a message file. |
| **Room specs (size, bed, view)** | Marketing copy in `messages/`, keyed by room code, not database fields — so **a room type added in the admin panel shows no specs** on either the Rooms page or its own page. Fine for the four seeded rooms, wrong the moment the hotel adds a fifth. Giving `RoomType` the columns is a migration plus admin editing plus moving the existing copy out of the message files; it was not done on spec because the shape a future PMS expects is a guess (`pms-readiness`). **Decide before the hotel starts adding rooms.** |
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
