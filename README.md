# Cove Dubai

A 106-room boutique luxury hotel in Al Quoz, Dubai. This repository delivers the
Phase 1 system the hotel runs on at launch: a bilingual EN/AR marketing site, a
bespoke guest booking flow, a hotel admin panel, and the custom booking API and
PostgreSQL database behind them.

Read [`CLAUDE.md`](CLAUDE.md) before making changes — it is the operating manual,
and the `.claude/skills/` directory holds the detailed rules for design, Arabic
and RTL, the booking engine, PMS readiness, and deployment.

## Shape

Two independently deployable Node services plus a database:

| Directory | What it is |
|---|---|
| [`web/`](web/) | Next.js (App Router) — marketing site, booking flow, `/admin`. Talks to the API over HTTP only. |
| [`server/`](server/) | Express API — the booking engine and the swappable PMS seam. The only thing that touches the database. |
| [`design/`](design/) | The client-approved HTML/CSS mockups (the visual source of truth) and the project proposal. |
| [`docs/`](docs/) | The vendor-neutral data-model note that becomes the Phase 2 brief. |

`web/` and `server/` are separate npm projects with their own `package.json` and
no shared workspace root. That is deliberate: it matches how each is deployed
from its own directory, and avoids a hoisted `node_modules` the build cannot see.

## Local development

There is **no Docker in this project**. Both services run as plain Node
processes, and the database is a hosted PostgreSQL instance reached over the
network — so there is nothing to containerise and no local database to install.

Requirements: Node 22+ (this was set up on 24.3) and npm.

```bash
# One-time: install dependencies in each service
cd server && npm install
cd ../web && npm install

# One-time: create local env files from the committed examples,
# then fill in real values (DATABASE_URL in particular)
cp server/.env.example server/.env
cp web/.env.example web/.env.local
```

Then run each service in its own terminal:

```bash
cd server && npm run dev     # http://localhost:4000
cd web    && npm run dev     # http://localhost:3000
```

Both services validate their environment at startup and exit immediately with a
readable message if anything required is missing, rather than failing later
inside a request.

### Database

Schema changes are always Prisma migrations — never hand-edited on a hosted
database.

```bash
cd server
npm run prisma:migrate    # create + apply a migration (development)
npm run seed              # idempotent; safe to re-run
npm run prisma:studio     # browse the data
```

## Checks

Each service runs the same set:

```bash
npm run typecheck
npm run lint
npm run test
```

Plus `npm run e2e` in `web/` for the Playwright end-to-end suite.

## Configuration

Every environment-specific value is an environment variable — nothing about a
host, port, or credential is hardcoded. `web/.env.example` and
`server/.env.example` list every variable with dummy values and are the
authoritative reference. Real `.env` files are never committed.

This is what keeps the eventual Railway → AWS move a configuration change rather
than a rewrite. See the `deployment` skill for the full rules.
