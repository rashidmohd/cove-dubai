---
name: cove-design-system
description: The Cove Dubai visual design system — exact colour tokens, typography, and signature brand effects (ghost monogram, woven texture, warm glow) extracted from the client's approved mockups. Use this skill for ANY user-interface work on the Cove Dubai project — building or editing pages, components, forms, the booking flow, the admin panel, or emails — even when the request doesn't mention design. Any pixel the guest sees must match these tokens; do not invent colours, fonts, or spacing.
---

# Cove Dubai — Design System

The mockups are the source of truth. These tokens are extracted directly from them. Never approximate the
brand with "close enough" values — use these exact ones.

## Colour tokens

Define once in `web/styles/tokens.css` as CSS custom properties and reference everywhere:

```css
:root {
  --ink: #1c1410; /* primary text on light */
  --fog: #7a6e62; /* muted text, captions */
  --bone: #eae0d0; /* light text on dark */
  --linen: #f2ebd9; /* warm light surface */
  --w: #fef9f2; /* near-white / headings on dark */

  --gold: #c49a52; /* primary accent */
  --gold-lt: #d4ae6e; /* accent hover / emphasis */
  --orange: #b85228; /* rare live/alert accent — use sparingly */

  --dark: #180e06; /* primary dark background */
  --dark2: #241408; /* raised dark surface */

  --s: "Cormorant Garamond", serif; /* display / serif */
  --b: "Jost", sans-serif; /* body / UI / sans */
}
```

**Usage discipline:** gold is the accent, not a fill — use it for fine lines, small labels, and hover states,
not large blocks. Orange is reserved for genuinely live signals (e.g. an "opening soon" pulse) and appears
almost nowhere else.

## Typography

- **Cormorant Garamond** (`--s`) — headings, hero lines, lede paragraphs, anything expressive. Weights 300/400,
  with italic used for emphasis (e.g. a single italic word inside a heading). This is where the luxury feel lives.
- **Jost** (`--b`) — all UI: nav, buttons, labels, form fields, body copy in dense contexts. Weights 200/300/400.
- **Signature detail:** small labels and buttons use uppercase Jost with wide letter-spacing (`.22em`–`.34em`)
  and a matching `text-indent` so the tracking looks optically centred.
- Load via Google Fonts with `Cormorant Garamond` (ital 300,400) + `Jost` (200,300,400). Add the Arabic face
  per the **arabic-rtl** skill — do not drop the Latin faces when adding Arabic.

## Signature effects (what makes it feel like Cove)

Reproduce these from the mockups — they are the brand, not decoration:

1. **Ghost monogram** — an oversized, very-low-opacity `C` in Cormorant, fixed and centred behind content
   (`color:rgba(234,224,208,.02)` on dark). Never let it reduce text contrast.
2. **Woven texture** — a faint repeating gold linear-gradient grid overlay (`rgba(196,154,82,.03)`), fixed,
   `pointer-events:none`, sitting above the background but below content.
3. **Warm glow** — a large radial gradient (orange→gold→transparent) behind the hero that slowly "breathes".
   Respect `prefers-reduced-motion` and disable the animation when set.
4. **Rise-in reveals** — content fades up (`translateY(20px)` → `0`) on load/scroll, staggered by ~120ms.
   Always gate behind `prefers-reduced-motion: reduce`.

## Component conventions

- **Buttons:** two kinds only — a filled gold CTA and a text/underline "quiet" button. Uppercase Jost, wide
  tracking. Hover shifts colour to `--gold-lt` and nudges 2–3px, never a heavy shadow.
- **Fields:** underline-only inputs (bottom border), transparent background, border brightens to gold on focus.
  No boxy bordered inputs on guest-facing surfaces.
- **Surfaces:** dark sections use `--dark` with `--dark2` for raised cards; light sections use `--linen`/`--w`.
- **Radius & shadows:** minimal radius, essentially no drop shadows. Depth comes from tone and the glow, not boxes.
- **Spacing:** generous. Luxury reads as whitespace; do not crowd.

## Guardrails

- Do not introduce a new colour, font, or heavy UI pattern (cards with shadows, bright fills, rounded pills
  everywhere) that isn't in the mockups.
- **The admin panel is an agreed exception** (15 August 2026). `/admin`
  is a work tool used all day, and this system's hero typography — tracked uppercase micro-caps, oldstyle serif
  figures, 3rem gutters — actively slows down scanning a reservations table. It runs its own dashboard-UI
  language instead: a neutral warm-grey ramp, a 14px system sans, sentence case, 8px radii, hairline borders.
  The rules for it are in the header comment of `web/app/[locale]/admin/Admin.module.css`, and its component
  layer is `web/app/[locale]/admin/ui.tsx`. Everything in this file still governs **every guest-facing surface**,
  and the exception does not travel: do not import an admin token, an admin component, or its font stack into a
  marketing page, the reserve flow, or an email.
  - What the panel still takes from here: the accent (`--gold`), the ink (`--ink`), the alert colour
    (`--orange`), the spacing scale, and the whole of **arabic-rtl**. Only the neutrals and a four-step semantic
    status ramp are new, and they are defined once with their measured contrast.
  - Still no utility-CSS framework anywhere, admin included. The panel is CSS Modules and custom properties like
    the rest of the project — it borrows shadcn/ui's *conventions*, not Tailwind.
- If a mockup and this file ever disagree, the mockup wins — flag the discrepancy so this file can be updated.
