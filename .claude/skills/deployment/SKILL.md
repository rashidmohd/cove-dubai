---
name: deployment
description: How to deploy, host, and configure the Cove Dubai project — the Next.js front-end, the separate Express API, and PostgreSQL — on Railway (for testing/staging) and AWS (for production later). Use this skill for ANY hosting, environment-variable, deployment, database-provisioning, migration-running, or CI/CD work on the Cove Dubai project. The guiding rule is strict 12-factor portability so the Railway→AWS move is a config change, not a rewrite. Consult it before adding config, wiring env vars, or setting up any environment.
---

# Cove Dubai — Deployment

Three deployable pieces: **`web`** (Next.js front-end), **`server`** (Express API), and a **PostgreSQL** database.
We host on **Railway first (testing/staging)** and move to **AWS later (production)**. Both run the same code —
only configuration differs.

## The one rule that makes the move painless: 12-factor config

Everything environment-specific comes from **environment variables**. Nothing about Railway, AWS, a hostname, a
port, or a credential is hardcoded. If it changes between laptop / Railway / AWS, it is an env var.

Core variables (name them consistently across all environments):

- `DATABASE_URL` — PostgreSQL connection string (Railway Postgres now; RDS later).
- `NEXT_PUBLIC_API_URL` — public base URL of the Express API the browser calls.
- `INTERNAL_API_URL` — API URL for Next.js server-side calls (may differ from the public one).
- `SESSION_SECRET` — admin session signing secret.
- `EMAIL_API_KEY` / SMTP settings — transactional email provider.
- `NODE_ENV`, `PORT` — standard.

Rules:

- Provide a committed **`.env.example`** in both `web/` and `server/` listing every variable with dummy values.
  Never commit real `.env` files.
- Read config once at startup into a typed config object; fail fast if a required variable is missing.
- CORS on the Express API is env-driven (allow the `web` origin per environment), not hardcoded.

## Phase A — Railway (testing / staging)

Set up three Railway services in one project:

1. **PostgreSQL** — add Railway's managed Postgres plugin. It provides `DATABASE_URL`; reference it in `server`.
2. **`server` (Express)** — deploy from the `server/` directory.
   - Build: `npm install && npx prisma generate && npm run build`
   - Release/migrate: run `npx prisma migrate deploy` on deploy (Railway release command or a start-time step).
   - Start: `node dist/index.js` (or your compiled entry).
   - Env: `DATABASE_URL` (from the Postgres service), `SESSION_SECRET`, email keys, allowed CORS origin.
3. **`web` (Next.js)** — deploy from the `web/` directory.
   - Build: `npm install && npm run build`
   - Start: `npm run start` (Next needs a Node runtime — it is **not** static-only, because marketing pages are
     server-rendered).
   - Env: `NEXT_PUBLIC_API_URL` + `INTERNAL_API_URL` pointing at the `server` service's Railway URL.

Railway gives each service an HTTPS domain. Use this environment as the **staging** the client reviews before
go-live. Keep a separate set of variables per environment (staging vs any production-on-Railway).

## Phase B — AWS (production, later)

Map each piece to AWS; the code does not change, only config and infra:

- **PostgreSQL → Amazon RDS (PostgreSQL).** Enable automated backups (satisfies the daily-backup baseline).
  Repoint `DATABASE_URL` at the RDS endpoint.
- **`server` (Express) → a Node runtime** — ECS/Fargate, Elastic Beanstalk, or EC2 behind an ALB. Run
  `prisma migrate deploy` as a release step.
- **`web` (Next.js) → a Node runtime too** — ECS/Fargate or Amplify (Next SSR support), behind CloudFront for
  CDN/static assets. It must run as a Node server (SSR), not an S3 static bucket.
- **Secrets → AWS SSM Parameter Store or Secrets Manager** instead of Railway variables — same variable names.
- **TLS** at the load balancer / CloudFront; enforce HTTPS end-to-end.

Because config is 12-factor, the migration checklist is essentially: provision RDS → set the same env vars from
SSM/Secrets Manager → deploy the two Node services → run migrations → cut DNS over. No source changes.

## Migrations & data

- Schema changes are **always** Prisma migrations (`prisma migrate dev` locally, `prisma migrate deploy` in
  hosted envs). Never hand-edit a hosted database.
- Keep migrations reversible and the seed script current, so staging can be rebuilt and the future AWS DB can be
  stood up cleanly.

## Gotchas

- **Two Node processes.** Both `web` and `server` need a Node runtime — don't treat the Next.js app as static
  hosting. On a single VPS this would be two PM2/systemd processes behind Nginx; on Railway/AWS it's two services.
- **API URL differs by side.** The browser uses `NEXT_PUBLIC_API_URL` (public); Next server-side rendering may use
  `INTERNAL_API_URL` (internal networking on AWS). Keep both.
- **CORS** must allow the correct `web` origin per environment — it's a common first-deploy failure.
- **Run migrations before the new server starts serving**, or a deploy can hit a schema it expects but doesn't have.
- Don't let a Railway-specific convenience (an auto-injected variable, a plugin-only feature) leak into code —
  wrap it behind your own named env var so AWS can supply the same thing differently.
