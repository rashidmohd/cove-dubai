---
name: arabic-rtl
description: How to implement Cove Dubai's bilingual English/Arabic website, booking flow, and admin panel with correct right-to-left (RTL) layout. Use this skill whenever building or editing any UI, text, form, calendar, or email on the Cove Dubai project — because every surface must work in both languages. Arabic is a first-class mirrored layout, never a bolt-on. Consult this before writing layout CSS, adding copy, or building form validation, even if the request only mentions the English side.
---

# Cove Dubai — Arabic & RTL

Both languages are delivered for all five public pages, the full booking flow, and the admin panel. Arabic is a
**fully mirrored** experience, not English with the text swapped.

## Architecture

- **Locale routing:** every route lives under a Next.js App Router locale segment — `/en/...` and `/ar/...` —
  via next-intl. The locale `layout` sets `<html lang dir>`: `lang="ar" dir="rtl"` for Arabic, `lang="en"
dir="ltr"` for English.
- **Copy lives in message files:** `web/messages/en.json` and `web/messages/ar.json`, keyed (e.g.
  `reserve.step1.title`), loaded via next-intl. Components render keys through the `t()` function, never hardcoded
  strings. This keeps the two languages in sync and lets the client supply Arabic copy without touching code.
  (Server-sent emails also read from message files — see **booking-engine**.)
- **Language toggle** in the header on every page. It switches locale while preserving the current route and,
  where possible, the guest's booking progress.
- **Marketing pages** (Home, About, Rooms) are server-rendered/static in **both** locales, so `/ar` pages ship
  real Arabic HTML for SEO — not an empty shell hydrated later.

## Do real RTL, not fake RTL

- Drive direction with `dir="rtl"` + **logical CSS properties**: `margin-inline-start`, `padding-inline-end`,
  `inset-inline-start`, `text-align:start`, `border-inline-start`, etc. These flip automatically with `dir`.
- **Never** simulate RTL with `transform: scaleX(-1)` or by hardcoding left/right — it breaks text, icons, and
  shadows. Directional icons (arrows, chevrons, "next" in the booking steps) must point the correct way per locale.
- Test every layout in both directions. Nav order, the booking step progression, form field flow, the
  availability calendar, and the booking summary must all mirror correctly.

## Typography

- Arabic uses a high-quality web font chosen to sit beside the brand — **Almarai** or **Cairo** (confirm with
  the client). Pair it so Arabic and Latin feel like one system; adjust line-height (Arabic often needs a little
  more) and font-size so the two languages read at matching visual weight.
- Keep the Latin faces (Cormorant Garamond + Jost) loaded for the English side — see **cove-design-system**.
- Numerals: decide with the client between Western (1234) and Arabic-Indic (١٢٣٤) digits for prices/dates, and
  apply consistently.

## Forms, dates, validation (booking flow + admin)

- Field labels, placeholders, helper text, and **error messages** must all be translated — validation errors are
  the most commonly missed strings. Wire validation messages through the message files.
- The date picker must render weekday/month names in the active language and align to RTL in Arabic.
- Confirmation and cancellation **emails are sent in the guest's selected language** — maintain bilingual email
  templates (see **booking-engine**).
- The admin panel is switchable to Arabic; room names and descriptions are editable in both languages from one
  screen, stored as separate localized fields in the DB.

## SEO

- Add `hreflang` alternates linking each page's `en` and `ar` versions (and `x-default`).
- Arabic pages carry their own translated `<title>`, meta description, and Open Graph text — so they index
  separately and capture Arabic-language hotel searches in Dubai and the GCC.
- Include both locales in the sitemap.

## Content ownership

- We build the bilingual **system**; the **client provides Arabic translations** for all copy, room descriptions,
  and UI labels. Never machine-translate luxury brand copy — leave professional translation to the client and
  keep the message keys clean and complete so translators have an obvious checklist.
- Ship with English copy in place and Arabic keys present (even if temporarily mirroring English) so missing
  translations are visible and trackable, never silently blank.

## Definition of done for any UI change

The change works, and looks right, in **both** `/en` (LTR) and `/ar` (RTL), with all its strings present in both
message files, before it is considered complete.
