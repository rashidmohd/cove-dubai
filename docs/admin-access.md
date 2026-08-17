# Admin access

How to get into the admin panel, and how staff accounts work.

> **No real password appears in this file, and none should.** It is committed to the repository. Live credentials
> live in `ADMIN-CREDENTIALS.local.md` at the repo root, which is gitignored, or in your password manager.

---

## Where the panel is

| Environment | URL |
|---|---|
| Local | `http://localhost:3000/en/admin` — Arabic at `/ar/admin` |
| Railway staging | `https://<web-service>.up.railway.app/en/admin` |

The panel needs **both** services running: the Next.js app serves the screens, and every piece of data comes from
the Express API over HTTP.

```bash
cd server && npm run dev    # http://localhost:4000
cd web    && npm run dev    # http://localhost:3000
```

If the API is down the panel loads and then shows *"We could not reach the hotel's booking system"* — that is the
login form telling you the truth, not a broken build.

---

## The seeded account

The seed creates one account:

| Field | Value |
|---|---|
| Email | `admin@covedubai.local` |
| Name | Cove Dubai Admin |
| Role | `ADMIN` |

It is created **only** when `SEED_ADMIN_PASSWORD` is set at seed time, and the seed never touches the password of
an account that already exists. So re-running `npm run seed` will not reset a forgotten password — use the script
below.

Before launch this address should be replaced with a real one at the hotel's own domain. `.local` is a reserved
TLD and can never receive email, which is fine now (nothing emails admins) and will not be once password reset
exists.

---

## Setting or resetting a password

```bash
cd server
npm run admin:password -- admin@covedubai.local '<a long password>'
```

- The account must already exist; the script will not create one.
- Minimum 12 characters.
- **Quote the password** so the shell does not interpret `!`, `$`, or spaces.
- It will land in your shell history. Clear it, or prefix the command with a space if your shell is configured to
  skip those.

The change is recorded in the audit log as `admin.password_set`. Existing sessions are **not** ended — if the old
password was compromised, clear the sessions too:

```sql
DELETE FROM admin_sessions;
```

Everyone is signed out and signs back in. There is no per-user revocation UI yet; disabling the account
(`UPDATE admin_users SET "isActive" = false WHERE email = '...'`) kills its sessions on the very next request.

### Why this is a script and not a screen

Password-reset-by-email is not built — that is part of M7, which is where transactional email arrives at all. And
an admin-facing "reset anyone's password" endpoint is a privilege-escalation path that deserves designing rather
than bolting on. A command run by whoever already holds the database URL is the honest version of this for now.

---

## Adding a second member of staff

There is **no screen for creating accounts yet**. Both roles exist and are enforced; only the creation UI is
missing. Add one directly, then set the password with the script:

```sql
INSERT INTO admin_users (id, email, "passwordHash", name, role, "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'frontdesk@example.com', 'placeholder', 'Front Desk', 'STAFF', true, now(), now());
```

```bash
cd server && npm run admin:password -- frontdesk@example.com '<a long password>'
```

The `placeholder` hash cannot be logged in with — `verifyPassword` rejects anything that is not in the
`scrypt$N$r$p$salt$hash` format — so the account is unusable until the script sets a real one.

---

## What each role can do

| | `STAFF` | `ADMIN` |
|---|---|---|
| Dashboard, arrivals and departures | ✅ | ✅ |
| Reservations: search, filter, check in/out, cancel | ✅ | ✅ |
| View room types | ✅ | ✅ |
| View the availability calendar | ✅ | ✅ |
| **Edit room types and rates** | ❌ | ✅ |
| **Edit availability / stop-sell** | ❌ | ✅ |
| **Edit settings** (Tourism Dirham, VAT) | ❌ | ✅ |
| **Read the audit log** | ❌ | ✅ |

Roles are enforced **in the API**, not in the browser. The panel hides buttons a `STAFF` user cannot use, but that
is a courtesy — the server returns `403 FORBIDDEN` regardless, and there is a test for exactly that.

---

## How the session works

- The cookie is `cove.sid`: **HttpOnly**, so no script can read it, and opaque — it carries a session id and
  nothing else. Who you are is re-read from the database on every request.
- **Idle timeout** comes from `SESSION_IDLE_TIMEOUT_MINUTES` (default 30) and is rolling: every request pushes it
  out again, so it expires only after genuine inactivity.
- Sessions live in the `admin_sessions` table, not in memory, so a deploy does not sign everyone out.
- Every mutating request carries an `X-CSRF-Token` header matching a value held in the session. The client handles
  this; you only see it if you are calling the API by hand.

### The cross-origin catch

On Railway, `web` and `server` are **different domains**, so the session cookie is a third-party cookie and needs:

```
SESSION_COOKIE_SAMESITE=none
SESSION_COOKIE_SECURE=true
```

Set only one of those and the API refuses to boot, with a message saying why — browsers silently drop a
`SameSite=None` cookie that is not `Secure`, and the symptom is a login that appears to succeed followed by every
request being anonymous.

Locally both services are `localhost`, which is same-site, so the default `lax` is correct and this never bites.
**That is exactly why it is worth testing on staging early** — passing locally proves nothing about the
cross-origin case. On AWS both services sit behind one domain and it tightens back to `lax` with no code change.

---

## Calling the admin API directly

For debugging. Every admin route needs the session cookie, and writes also need the CSRF token.

```bash
# Sign in, keeping the cookie
curl -s -c /tmp/cove.txt -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@covedubai.local","password":"<password>"}'

# Read the token back
TOKEN=$(curl -s -b /tmp/cove.txt localhost:4000/api/auth/session \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["csrfToken"])')

# A write
curl -s -b /tmp/cove.txt -X PATCH \
  localhost:4000/api/admin/settings/tourism_dirham_per_room_per_night_aed \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" \
  -d '{"value":"20"}'
```

Reads need no token. A write without one returns `403 CSRF_TOKEN_INVALID`.

---

## Running the admin end-to-end tests

They skip unless a password is provided, so the suite still runs for anyone without admin credentials:

```bash
cd web
E2E_ADMIN_PASSWORD='<the password>' npx playwright test e2e/admin.spec.ts
```

The tests sign in as `admin@covedubai.local` by default; override with `E2E_ADMIN_EMAIL`. They write nothing
permanent — the one write sets VAT to its existing value, so a failure cannot leave the hotel quoting a wrong
price.

---

## If you cannot get in

| Symptom | Cause |
|---|---|
| *"Incorrect email or password"* | Wrong credentials, **or the account is disabled**. The message is identical either way, on purpose — anything else would reveal which addresses are real. Check `isActive` in `admin_users`. |
| *"Too many sign-in attempts"* | 10 failures in 15 minutes from your IP. Wait it out; successful logins are not counted. |
| Login succeeds, then everything is signed out | The session cookie is being dropped. Cross-origin `SameSite`/`Secure` pairing — see above. |
| *"Could not reach the booking service"* | The API is not running, or `NEXT_PUBLIC_API_URL` points somewhere else. |
| *"Your session has ended"* mid-work | Idle timeout, or someone cleared `admin_sessions`. |
