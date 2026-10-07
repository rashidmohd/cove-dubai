# The Cove logo beside our emails (BIMI)

How to make the Cove logo appear as the sender picture next to booking emails in inboxes. The standard is
**BIMI**. This guide covers the version that needs **no paid certificate**, which shows the logo in **Yahoo
Mail and AOL**. Gmail and Apple Mail additionally need a logo certificate (VMC/CMC, about US$1,000–1,500 a
year); that is the optional last step.

Nothing here changes code. It is DNS records and one logo file. After each step, check it:

```bash
cd server && npm run bimi:check -- mail.covedubai.com
```

Pass the domain after the `@` in `EMAIL_FROM`. The examples use `covedubai.com` and the sending subdomain
`mail.covedubai.com`; substitute the hotel's real domain.

---

## Cove's actual values (3 Oct 2026)

| | |
|---|---|
| Emails are sent from | `reservations@covehotels.ae` — so BIMI and DMARC are looked up on **`covehotels.ae`** itself |
| DNS is hosted at | **Cloudflare** (`kurt` / `nancy.ns.cloudflare.com`) — Cloudflare appends the domain, so type names without it |
| Office mail | Yahoo Business Mail (MX `mx-biz.mail.am0.yahoodns.net`) — needs its SPF/DKIM before DMARC is enforced |
| BIMI record | TXT, Name **`default._bimi`**, Content `v=BIMI1; l=https://dev.covehotels.ae/bimi/cove-logo.svg; a=;` |
| Logo | Live and passing at `https://dev.covehotels.ae/bimi/cove-logo.svg`; move to the production domain before launch |
| Check | `npm run bimi:check -- covehotels.ae` |

The first BIMI record was added as `default._bimi.mail`, which is only read for mail sent from
`@mail.covehotels.ae` — not our case. Rename it to `default._bimi`.

**Gmail shows no BIMI logo without a VMC/CMC certificate** (step 7), whatever else is right. The free route for
Gmail is a Google Account on `reservations@covehotels.ae` with the monogram as its public profile photo.

The examples below use the placeholder `covedubai.com`; read them with the values above.

## Before you start

| Need | From |
|---|---|
| Email sending set up and verified in Resend | [`deploying.md` → Email](deploying.md#email) |
| Access to the domain's DNS (GoDaddy, Cloudflare, etc.) | The hotel's IT or whoever registered the domain |
| A list of **everything else that sends email as the domain** — office mailboxes (Microsoft 365 / Google Workspace), newsletters, the PMS later | The hotel's IT |
| The Cove logo as a vector file (SVG, AI, EPS or PDF) | The hotel's designer |

---

## Step 1 — Make sure all the domain's email passes SPF and DKIM

BIMI requires DMARC to be **enforced** (step 2), and an enforced DMARC tells inboxes to **junk any email that
fails it**. So first, every service that sends as `@covedubai.com` must be authenticated, or its mail starts
going to spam:

1. **Resend** — already done if the sending domain shows *Verified*.
2. **Office email** — Microsoft 365 or Google Workspace each publish their own SPF include and DKIM setup.
   Turn on DKIM in their admin console if it isn't.
3. **Anything else** (newsletter tool, booking engine, website contact form) — each needs its SPF/DKIM records.

## Step 2 — Publish DMARC, watch it, then enforce it

**2a. Start in monitoring mode.** Add a `TXT` record:

| Name | Value |
|---|---|
| `_dmarc.covedubai.com` | `v=DMARC1; p=none; rua=mailto:dmarc@covedubai.com; fo=1` |

`rua` is where inboxes send daily reports. A free report reader (dmarcian, Postmark DMARC, Valimail Monitor)
turns them into a readable list of who is sending as the domain and whether they pass.

**2b. Wait one to two weeks** and read the reports. Every legitimate sender must show *pass*. Fix any that don't
(step 1) before going on.

**2c. Enforce.** Change the same record to:

```
v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@covedubai.com; fo=1
```

`p=reject` also works and is stronger. **Do not skip 2b**: enforcing too early sends the hotel's own office
email to spam.

Check: `npm run bimi:check -- mail.covedubai.com` → the two DMARC lines show ✓.

## Step 3 — Prepare the logo as "SVG Tiny PS"

> **Done (2 Oct 2026):** `web/public/bimi/cove-logo.svg` is the site's existing monogram — the gold `C` in
> Cormorant Garamond at weight 600, the same mark and gradient as `web/app/icon.png` — rebuilt as a vector in the
> Tiny PS profile: the letter is its real outline from the self-hosted font file (no text, no font dependency),
> centred at 56% height so a circular crop never clips it, 1.4 KB. Check it any time with
> `npm run bimi:check -- --svg https://dev.covehotels.ae/bimi/cove-logo.svg`. If the client later supplies an
> official logo, replace this file; the brief below is for that.

Inboxes only accept the logo in one strict SVG format. Give the designer this brief:

> Square SVG of the Cove logo for email (BIMI). SVG Tiny Portable/Secure profile: `version="1.2"`,
> `baseProfile="tiny-ps"`, a `<title>Cove Dubai</title>`, square `viewBox`, no `x`/`y` on the root element,
> no scripts, no embedded images, no external links, no animation, under 32 KB. Solid background colour (inboxes
> show it in a circle or rounded square, so keep the mark centred with space around it). Dark background
> `#180e06` with the logo in `#fef9f2` or gold `#c49a52` matches the emails.

Most design tools can't export Tiny PS directly. The usual route is: export a plain SVG, then convert it with a
BIMI converter (e.g. the free "SVG to SVG Tiny PS" tools from BIMI Group or Valimail), then check it in the BIMI
Group's online inspector.

## Step 4 — Host the logo on the website

Save the file as `web/public/bimi/cove-logo.svg` and deploy. It is then served at
`https://covedubai.com/bimi/cove-logo.svg`. Files with a dot in the name skip the site's language redirect, so
the path stays exactly that. Open the URL in a browser to confirm the logo shows.

## Step 5 — Publish the BIMI record

Add a `TXT` record on the **sending** domain:

| Name | Value |
|---|---|
| `default._bimi.mail.covedubai.com` | `v=BIMI1; l=https://covedubai.com/bimi/cove-logo.svg; a=;` |

`a=` is left empty: that is where a certificate URL goes in step 7.

Check: `npm run bimi:check -- mail.covedubai.com` → every line ✓.

## Step 6 — Test

1. `cd server && npm run email:test -- someone@yahoo.com` (a Yahoo or AOL address you can open).
2. Look in the Yahoo inbox for the logo beside the sender name.

DNS changes can take a few hours to be seen everywhere. **Yahoo also only shows logos for senders with a good
sending reputation and some volume**, so a brand-new domain may need a few weeks of real booking emails before
the logo appears, even with everything correct. The checker passing is the part we control.

## Step 7 (optional, paid) — Gmail and Apple Mail

Buy a **VMC** (needs the logo to be a **registered trademark**) or a **CMC** (needs the logo to have been in
public use for a year) from DigiCert or Entrust. Host the certificate `.pem` they issue next to the logo, e.g.
`web/public/bimi/cove-vmc.pem`, and set `a=https://covedubai.com/bimi/cove-vmc.pem` in the BIMI record.
