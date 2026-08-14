# CLAUDE.md — Cove Dubai

Operating manual for this repository. Read this before making changes.

## Scope right now: Phase 1 only

**We are building Phase 1 and nothing else.** Phase 1 is a complete, self-contained system the hotel can run on
its own at launch. Phase 2 (handing the reservation engine over to a third-party PMS) is a **future, separate
engagement** — and the client **has not chosen a PMS yet**. Do not build, wire, or assume any specific PMS.

## What we are building (Phase 1)

**Cove Dubai** is a 106-room boutique luxury hotel under construction in Al Quoz, Dubai. This repo delivers:

1. **Marketing website** — Home, About, Rooms, Reserve. Built pixel-perfect to the Cove Dubai mockups.
2. **Bespoke guest booking flow** — live availability → room selection → guest details → confirmation.
3. **Hotel admin panel** — room types, rates, availability calendar, reservations dashboard.
4. **Custom booking API + PostgreSQL** — the reservation engine that runs the hotel at launch.
5. **Bilingual EN / AR** with full right-to-left (RTL) support across every surface.

## The Prime Directive: keep the reservation engine swappable

At some future point the hotel may move its reservations onto a third-party PMS. **Which one is undecided** —
IDS Next, Cloudbeds, and Mews are all candidates the client is weighing. We do **not** design for any one of them.
Instead we make the reservation engine **cleanly swappable**, so whatever they pick later is an *integration*,
not a *rebuild*. This is easy on our stack because the **Express API is a physically separate service** — it is
the seam. Concretely:

- The **Next.js front-end talks to the Express API over HTTP only** — never to the database. Only the API touches data.
- Inside the API, all reservation work goes through one **`BookingProvider` interface**. Routes call the
  interface, not Prisma directly.
- The **database schema follows a standard hospitality data model** (room types, rate plans, reservations,
  guests) — concepts common to every PMS, so the schema is portable to whichever one is chosen.
- **No booking / pricing / availability business logic lives in the front-end.** It all lives in the API.

If a change would make a future PMS swap harder, it is the wrong change. See the **pms-readiness** skill.

## Tech stack (confirmed)

Two services: a Next.js front-end and a separate Express API.

- **Front-end:** Next.js (App Router) + TypeScript (strict) — the marketing site, the guest booking flow, and
  the `/admin` panel. Next.js is used specifically for **server-side rendering / static generation of the
  marketing pages**, so SEO, Core Web Vitals, and per-locale Arabic HTML are handled natively (this is why we
  moved off a plain SPA).
- **API:** Node + Express + TypeScript (strict), a **separate service**. This is the booking API layer and the
  swappable seam (see **pms-readiness**). The Next.js app calls it over HTTP — server-side for rendered pages,
  client-side for interactive booking steps.
- **Styling:** CSS Modules + CSS custom properties (design tokens). No utility-CSS framework. See **cove-design-system**.
- **i18n / RTL:** Next.js App Router locale segments (`/en`, `/ar`) via next-intl, with `<html lang dir>` set per
  locale in the locale layout. Marketing pages are rendered in both locales for SEO. See **arabic-rtl**.
- **Database:** **PostgreSQL** via Prisma (typed client + migrations) — **in the API service only**. The front-end
  never touches Prisma or SQL. Postgres is chosen for its exclusion-constraint double-booking protection
  (see **booking-engine**).
- **Booking layer:** the Express API is the seam — a `BookingProvider` interface with a `CustomDbProvider`
  (Phase 1). A future `PmsProvider` is Phase 2 only — do not create it yet.
- **Admin auth:** session-based, role-based, idle timeout. `/admin` route in the Next.js app; admin endpoints in
  the Express API behind auth.
- **Email:** transactional provider (Resend or Nodemailer), bilingual templates — in the API service.
- **Config:** strict 12-factor — every environment value (DB URL, API base URL, secrets, email keys) comes from
  environment variables. Nothing hostname- or vendor-specific is hardcoded. This is what makes the Railway→AWS
  move painless. See **deployment**.
- **Tooling:** ESLint, Prettier, TypeScript strict, Vitest (unit), Playwright (e2e), Git.

## Hosting: Railway now, AWS later

Portable by design, so environments differ only in configuration, never code.

- **Testing / staging — Railway:** three pieces — `web` (Next.js), `server` (Express), and Railway-managed
  **PostgreSQL**. All config via Railway environment variables; run `prisma migrate deploy` on the server.
- **Production (later) — AWS:** Next.js and Express as two Node services (e.g. ECS/Fargate, Elastic Beanstalk, or
  EC2) behind a load balancer, with PostgreSQL on **RDS**. The move is config, not rework: repoint `DATABASE_URL`
  at RDS, move secrets to SSM/Secrets Manager, redeploy, run migrations.
- Details and the portability rules that keep this move clean live in the **deployment** skill.

## Directory shape

```
cove-dubai/
├── CLAUDE.md
├── .claude/skills/            # cove-design-system, arabic-rtl, pms-readiness, booking-engine, deployment
├── web/                       # Next.js (App Router) + TS — marketing + booking flow + /admin
│   ├── app/
│   │   └── [locale]/          # en | ar — locale layout sets <html lang dir>
│   │       ├── (marketing)/   # home, about, rooms   (SSR/SSG for SEO)
│   │       ├── reserve/       # booking flow          (interactive)
│   │       └── admin/         # auth-gated
│   ├── components/
│   ├── i18n/                  # next-intl config
│   ├── messages/             # en.json, ar.json
│   ├── lib/api/              # thin HTTP client -> Express API
│   └── styles/               # tokens.css (design system) + globals
└── server/                    # Node + Express API  (the booking API layer + seam)
    ├── src/
    │   ├── booking/
    │   │   ├── provider.ts    # BookingProvider interface (the "port")
    │   │   └── custom-db.provider.ts   # Phase 1 implementation (only one for now)
    │   ├── routes/            # THIN express routes -> call the booking service
    │   ├── db/                # prisma client + repositories
    │   ├── emails/            # bilingual transactional templates
    │   ├── middleware/        # auth, csrf, rate-limit, validation
    │   └── index.ts
    └── prisma/schema.prisma
```

> Note: there is intentionally **no** `pms.provider.ts`. That's Phase 2, and the vendor isn't chosen.

## Domain rules that are easy to get wrong

- **No online payment at launch.** The model is *pay at check-in*. Do not add a payment gateway, card capture,
  or deposit step unless the scope explicitly changes. The booking completes without taking money.
- **Tourism Dirham + VAT are shown, not charged.** Room prices must display the per-night Tourism Dirham and
  5% UAE VAT clearly on the summary. Keep these as configurable values (a future PMS may automate them later).
  See the **booking-engine** skill.
- **Every booking write is atomic and concurrency-safe.** Two guests must never book the last room. Use DB
  transactions + constraints, not application-level guesswork. See **booking-engine**.
- **Arabic is a first-class layout, not a bolt-on.** Real RTL — mirrored nav, content flow, forms, calendar —
  never faked with CSS transforms. See **arabic-rtl**.
- **Translations are the client's content.** We build the bilingual *system*; the client supplies Arabic copy.
  Never machine-translate luxury brand copy. Use clear keys and leave copy to the translation files.

## Non-negotiable baseline (applies to every change)

**Security:** HTTPS everywhere · authenticated admin sessions with timeout · all inputs validated & sanitised
server-side (in the API) · CSRF protection on forms · rate limiting on the booking endpoint · secrets in env vars
only, never hardcoded.

**Data integrity:** PostgreSQL constraints (no orphans, no duplicate bookings) · atomic transactions on booking
writes · audit log on every admin action · daily automated backups.

**Performance:** Core Web Vitals — LCP < 2.5s, CLS < 0.1, INP < 200ms · marketing pages server-rendered/static ·
images in WebP with lazy loading + responsive `srcset` · availability queries indexed on date + room type ·
static assets via CDN.

**Accessibility:** WCAG 2.1 AA on all form inputs and the full booking flow.

## Skills in this repo (use them)

- **cove-design-system** — design tokens, fonts, and the brand's signature effects. Use for ANY UI work.
- **arabic-rtl** — bilingual + RTL implementation rules. Use whenever touching layout, text, or forms.
- **pms-readiness** — how to keep the Phase 1 reservation engine cleanly swappable for any future PMS. Use for
  any DB / API / booking-layer work. (Vendor-neutral — no PMS is chosen.)
- **booking-engine** — availability, concurrency, atomic writes, pricing (Tourism Dirham + VAT), references,
  confirmation emails, cancellation. Use for anything in the reservation path.
- **deployment** — how to deploy and configure the two services + PostgreSQL on Railway (testing) and AWS
  (production), and the portability rules that keep that move clean. Use for any hosting, env, or deploy work.

## Out of scope (do not build)

- **Anything Phase 2:** a specific PMS integration, OTA channel manager, real automated DTCM export. The PMS
  vendor is not chosen — do not build toward one.
- **Online payment gateway** — not at launch.
- **Client responsibilities:** photography, English + Arabic copy, domain/DNS, branded email, DET/DTCM registration.

## Working style

- Confirm which service + layer a change belongs in before writing code (Next.js front-end / Express route /
  booking provider / DB).
- Prefer small, reviewable changes. Everything ships through **staging (Railway)** before production.
- Keep the front-end talking to the Express API over HTTP; keep Express routes talking to the `BookingProvider`.
- If something here is ambiguous or seems to conflict with the proposal, ask before guessing.
