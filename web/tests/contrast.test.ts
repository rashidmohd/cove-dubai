/**
 * Colour contrast — WCAG 2.1 AA.
 *
 * CLAUDE.md makes WCAG 2.1 AA non-negotiable. The mockups' text colours were
 * tuned by eye as translucent overlays on a photographic hero; read as flat
 * colour on `--dark`, several of them fell below the AA floor.
 *
 * This test parses the real token values out of `styles/tokens.css` rather than
 * restating them, so it fails if someone edits a token to something too faint —
 * which is exactly how this regresses: a designer nudges an alpha down and
 * nothing complains until an audit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(
  resolve(__dirname, '../styles/tokens.css'),
  'utf8',
);

type Rgb = [number, number, number];

function readToken(name: string): string {
  const match = tokensCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match?.[1]) throw new Error(`Token --${name} not found in tokens.css`);
  return match[1].trim();
}

function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '').trim();
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function parseRgba(value: string): { rgb: Rgb; alpha: number } {
  const match = value.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/,
  );
  if (!match) throw new Error(`Could not parse colour: ${value}`);
  return {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  };
}

/** Flatten a translucent colour onto an opaque background. */
function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((c, i) =>
    Math.round(c * alpha + (bg[i] as number) * (1 - alpha)),
  ) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Contrast of one opaque token against another. */
function ratioOn(tokenName: string, surfaceName: string): number {
  return contrastRatio(
    parseHex(readToken(tokenName)),
    parseHex(readToken(surfaceName)),
  );
}

/** Contrast of a token against the dark background. */
function ratioOnDark(tokenName: string): number {
  const dark = parseHex(readToken('dark'));
  const { rgb, alpha } = parseRgba(readToken(tokenName));
  return contrastRatio(composite(rgb, alpha, dark), dark);
}

const AA_NORMAL = 4.5;

describe('text on dark surfaces meets WCAG 2.1 AA', () => {
  it.each([
    ['link-on-dark', 'nav links'],
    ['link-on-dark-warm', 'footer links'],
    ['label-on-dark', 'small caps labels'],
    ['text-on-dark', 'body copy'],
    ['text-on-dark-muted', 'legal and meta text'],
  ])('--%s (%s)', (token) => {
    expect(ratioOnDark(token)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('gives links a comfortable margin, not a bare pass', () => {
    // These are 0.6rem uppercase with wide tracking. A bare 4.5:1 reads as
    // murky at that size, which is what prompted this work.
    expect(ratioOnDark('link-on-dark')).toBeGreaterThanOrEqual(7);
    expect(ratioOnDark('link-on-dark-warm')).toBeGreaterThanOrEqual(7);
  });
});

describe('hover states', () => {
  it('brightens links rather than dimming them', () => {
    // The trap when raising contrast: push the resting state past the gold
    // hover colour and hovering makes a link *darker*, inverting the
    // affordance. The resting state must stay below the hover.
    const goldLt = parseHex(readToken('gold-lt'));
    const dark = parseHex(readToken('dark'));
    const hoverRatio = contrastRatio(goldLt, dark);

    expect(hoverRatio).toBeGreaterThan(ratioOnDark('link-on-dark'));
    expect(hoverRatio).toBeGreaterThan(ratioOnDark('link-on-dark-warm'));
  });

  it('keeps the gold hover itself readable', () => {
    const goldLt = parseHex(readToken('gold-lt'));
    const dark = parseHex(readToken('dark'));
    expect(contrastRatio(goldLt, dark)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('the accent colours the design system reserves', () => {
  it('keeps gold readable on dark for eyebrow labels', () => {
    const gold = parseHex(readToken('gold'));
    const dark = parseHex(readToken('dark'));
    expect(contrastRatio(gold, dark)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('keeps ink readable on every light surface', () => {
    const ink = parseHex(readToken('ink'));
    for (const surface of ['w', 'linen', 'bone'] as const) {
      expect(
        contrastRatio(ink, parseHex(readToken(surface))),
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});

/**
 * The reserve flow's light surfaces.
 *
 * The booking flow sits on --w, and a selected room card on --linen — the
 * darker of the two, so it is the one that decides whether a colour passes.
 * These are asserted because the flow had a real failure here: the step you
 * had not reached yet was set in `rgba(28, 20, 16, 0.45)`, which measures
 * 2.94:1 and fails AA at 0.75rem. It was tuned by eye and nothing complained.
 */
describe('the reserve flow on light surfaces meets WCAG 2.1 AA', () => {
  it.each([
    ['fog', 'the step not yet reached, and card meta'],
    ['bronze', 'the View details button, and completed steps'],
    ['bronze-dk', 'their hover'],
  ])('--%s (%s) clears AA on --w and --linen', (token) => {
    expect(ratioOn(token, 'w')).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(ratioOn(token, 'linen')).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('darkens the quiet button on hover rather than lightening it', () => {
    // Same trap as the links on dark, mirrored: on a light ground the hover
    // must be *darker* than the resting state, or hovering reduces contrast.
    expect(ratioOn('bronze-dk', 'w')).toBeGreaterThan(ratioOn('bronze', 'w'));
    expect(ratioOn('bronze-dk', 'linen')).toBeGreaterThan(
      ratioOn('bronze', 'linen'),
    );
  });

  it('keeps white legible on a filled bronze step badge', () => {
    const white: Rgb = [255, 255, 255];
    expect(
      contrastRatio(white, parseHex(readToken('bronze'))),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('keeps the completed and upcoming steps distinguishable', () => {
    // --bronze marks a step behind you and --fog one ahead. They are close in
    // luminance by design (both are quiet), so what separates them is hue —
    // and if someone ever tunes one to match the other the control stops
    // saying anything at all.
    expect(readToken('bronze')).not.toBe(readToken('fog'));
  });
});
