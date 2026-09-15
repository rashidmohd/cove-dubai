# Deploying

Railway for staging today, AWS for production later. The move between them is configuration, not code — that is
what the 12-factor discipline in `server/src/config.ts` and `web/lib/config.ts` buys.

---

## What gets deployed

Three pieces, one Railway project:

| Service | Root directory | Notes |
|---|---|---|
| **PostgreSQL** | — | Railway's managed plugin. Provides `DATABASE_URL`. |
| **`server`** | `server/` | Express API. Runs migrations on start. |
| **`web`** | `web/` | Next.js. Must run as a Node server, not a static bucket — the marketing pages are server-rendered. |

Both services carry a committed [`railway.json`](../server/railway.json), so build and start commands are in
version control rather than typed into a dashboard where nobody can review them.

The API's start command is `npx prisma migrate deploy && node dist/index.js`. Migrations run on every boot, which
is safe because `migrate deploy` only applies migrations that have not been applied, and it means a deploy can
never start serving against a schema it does not match.

---

## Environment variables

`server/.env.example` and `web/.env.example` are the authoritative lists. Both services validate at startup and
exit with a readable message naming exactly what is missing, so a misconfigured deploy fails at boot rather than
at the first booking.

### `server`

| Variable | Staging value |
|---|---|
| `DATABASE_URL` | Reference the Postgres service: `${{Postgres.DATABASE_URL}}` |
| `NODE_ENV` | `production` |
| `PORT` | Railway sets this. Do not hardcode it. |
| `CORS_ALLOWED_ORIGINS` | The **`web` service's** public URL, exactly — scheme, no trailing slash |
| `SESSION_SECRET` | 32+ random characters. Generate per environment; never reuse the local one. |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `30` |
| `SESSION_COOKIE_SAMESITE` | **`none`** — see below |
| `SESSION_COOKIE_SECURE` | **`true`** — see below |
| `EMAIL_API_KEY` | The Resend key. Leave empty to log emails instead of sending them. |
| `EMAIL_FROM` | `Cove Dubai <reservations@yourdomain.com>` — the domain must be verified in Resend |
| `EMAIL_HOTEL_NOTIFICATION_ADDRESS` | Where the front desk receives new-booking copies |
| `WEB_BASE_URL` | The `web` service's public URL. **Cancellation links are built from this** — get it wrong and every emailed link 404s. |

### `web`

| Variable | Staging value |
|---|---|
| `NEXT_PUBLIC_API_URL` | The `server` service's **public** URL. Reaches the browser, so it cannot be a private address. |
| `INTERNAL_API_URL` | The `server` URL used for server-side rendering. On Railway this can be the same public URL; on AWS it becomes the private one. |
| `NEXT_PUBLIC_SITE_URL` | The `web` service's own public URL, for canonical tags and the sitemap |

---

## ⚠️ The cross-origin cookie

**This is the failure that will happen on the first deploy if it is going to happen at all.**

On Railway, `web` and `server` are separate domains. That makes the admin session cookie a third-party cookie,
and browsers only accept one when it is `SameSite=None; Secure`. Set only one of the pair and the cookie is
dropped **silently**: login returns 200, the panel appears, and then every subsequent request is anonymous.

The API refuses to boot on a mismatched pairing and says why, so the wrong configuration cannot start. Set both:

```
SESSION_COOKIE_SAMESITE=none
SESSION_COOKIE_SECURE=true
```

Locally both services are `localhost`, which is same-site, so `lax` is correct there and this never appears in
development. **Passing locally proves nothing about staging.** Test the admin login on Railway before anything
else, and specifically test that a page *reload* keeps you signed in — that is the step that fails.

On AWS, both services sit behind one domain and this tightens back to `lax` with no code change.

**`SameSite=None` is a workaround, not a cure.** `up.railway.app` is on the Public Suffix List, so the two
services are cross-*site*, not merely cross-origin, and the cookie is a genuine third-party cookie. Chrome sends
it once it is `None; Secure`; **Safari blocks it outright** and no configuration changes that. Staging on Railway
subdomains is therefore Chrome-only for the admin panel. Putting both services on one registrable domain —
`covedubai.com` and `api.covedubai.com` — makes the cookie same-site, works in every browser, and lets this
tighten back to `lax`.

---

## First deploy, in order

1. **Create the Postgres service.** Take note of `DATABASE_URL`.
2. **Deploy `server`** with root directory `server/`. Set every variable above. The start command runs
   `prisma migrate deploy` itself, so the schema is created on first boot.
3. **Seed it**, once, from your machine with the staging `DATABASE_URL` exported:
   ```bash
   cd server && DATABASE_URL='<staging url>' SEED_ADMIN_PASSWORD='<a long password>' npm run seed
   ```
   The seed is idempotent and never overwrites edits made in the admin panel, so re-running it is safe.
4. **Deploy `web`** with root directory `web/`, pointing `NEXT_PUBLIC_API_URL` at the server's URL.
5. **Go back and set `CORS_ALLOWED_ORIGINS`** on the server to the web URL, and `WEB_BASE_URL` too. You could not
   know these before step 4. Redeploy the server.
6. **Verify**, in this order:
   - `GET /health` on the API returns `{"status":"ok"}`
   - The rooms page lists room types — proves `web` can reach the API
   - Admin login **and a page reload** — proves the cross-origin cookie works
   - A test booking end to end — proves email sends and the cancellation link resolves

---

## The build environment

Two things about the Nixpacks build are load-bearing, and both are in version control:

**Node 20 or newer.** Nixpacks defaults to Node 18 when nothing declares a version, and on 18 the install is a
wall of `EBADENGINE` warnings — the AWS SDK, Vite, and Vitest all require 20+. Both `package.json` files now
carry `"engines": { "node": ">=20" }`, which Nixpacks reads to pick the toolchain. If a builder ever ignores it,
set `NIXPACKS_NODE_VERSION=22` on the service as an override.

**`npm install`, not `npm ci`.** The builder mounts a persistent cache at `/app/node_modules/.cache`. `npm ci`
deletes `node_modules` wholesale before installing, cannot remove a live mountpoint, and dies with:

```
npm error EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'
```

`npm install` writes in place and never hits it. With a committed lockfile and `package.json` in sync it resolves
to the same tree; the difference is that it will quietly amend the lockfile if they have drifted, so keep
`package-lock.json` committed and current. Setting `NIXPACKS_NO_CACHE=1` also works, at the cost of a cold build
every time.

---

## Email

Nothing sends until `EMAIL_API_KEY` is set; without it both services log emails to the console instead, which is
the local and CI default. Before the client sees staging:

1. Verify the sending domain in Resend (DNS records on the hotel's domain).
2. Set `EMAIL_FROM` to an address at that domain. An unverified domain fails at send time, not at boot.
3. Set `EMAIL_HOTEL_NOTIFICATION_ADDRESS` to a real inbox the front desk reads.

A failed send never fails a booking — it is logged and the reservation stands. That is deliberate, but it does
mean a broken email configuration is quiet. Check the logs after the first test booking rather than assuming.

---

## Cleaning up after the e2e suite

The Playwright tests write **real reservations** under `@e2e-test.invalid` and do not clean up after themselves.
Never point them at production. The SQL to remove them and release their inventory is in
[`project-status.md`](project-status.md#cleaning-up-test-bookings) — deleting the rows alone leaves those nights
permanently consumed.

---

## Moving to AWS later

The checklist, because the code does not change:

- **Postgres → RDS.** Enable automated backups; that satisfies the daily-backup baseline in CLAUDE.md. Repoint
  `DATABASE_URL`.
- **`server` and `web` → two Node runtimes** (ECS/Fargate, Elastic Beanstalk, or EC2) behind a load balancer.
  Both must be Node processes; neither can be a static bucket.
- **Secrets → SSM Parameter Store or Secrets Manager**, same variable names.
- **Behind one domain**, so `SESSION_COOKIE_SAMESITE` tightens to `lax`.
- **Run `prisma migrate deploy`** as a release step, or keep it in the start command as it is now.
