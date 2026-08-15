/**
 * Brand typefaces.
 *
 * Loaded through `next/font`, which self-hosts them at build time. That means
 * no request to Google's servers at runtime — one less third party, no
 * render-blocking stylesheet, and no layout shift from a late-arriving font
 * (CLS is part of the performance baseline in CLAUDE.md).
 *
 * The mockups load exactly these weights; the Arabic face is added per the
 * `arabic-rtl` skill without dropping the Latin ones.
 */
import { Almarai, Cormorant_Garamond, Jost } from 'next/font/google';

/** Display face — headings, hero lines, ledes. Italic is used for emphasis. */
export const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
  display: 'swap',
});

/** UI face — nav, buttons, labels, form fields, dense body copy. */
export const jost = Jost({
  subsets: ['latin'],
  weight: ['200', '300', '400'],
  variable: '--font-jost',
  display: 'swap',
});

/**
 * Arabic face.
 *
 * Almarai is the default pending the client's confirmation — the `arabic-rtl`
 * skill lists Almarai or Cairo and asks that the choice be confirmed with them.
 */
export const almarai = Almarai({
  subsets: ['arabic'],
  weight: ['300', '400', '700'],
  variable: '--font-almarai',
  display: 'swap',
});

export const fontVariables = [
  cormorant.variable,
  jost.variable,
  almarai.variable,
].join(' ');
