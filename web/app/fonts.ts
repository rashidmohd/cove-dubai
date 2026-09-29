/**
 * Brand typefaces.
 *
 * Self-hosted from `styles/fonts/`, through `next/font/local`. The files are
 * the ones Google Fonts serves for these families (SIL Open Font License; the
 * licences sit beside them), committed so the build never fetches anything.
 *
 * They used to come through `next/font/google`, which downloads them at build
 * time. That made every build depend on what Google returned to the build
 * machine, and on 30 Sep 2026 Railway's build failed on it: Turbopack could not
 * parse the font URLs it was given for Jost there, though the same build passed
 * locally. With the files in the repo the build is the same everywhere — which
 * is also what the Railway → AWS move wants (see the deployment skill).
 *
 * `next/font` still does what it did: no request to a third party at runtime,
 * no render-blocking stylesheet, preloading, and a metric-matched fallback so
 * the late font causes no layout shift (CLS is in the CLAUDE.md baseline).
 *
 * Latin subset only for the Latin faces, as before; the Arabic face is added
 * per the `arabic-rtl` skill without dropping the Latin ones.
 */
import localFont from 'next/font/local';

/** Display face — headings, hero lines, ledes. Italic is used for emphasis. */
export const cormorant = localFont({
  // Variable files, one upright and one italic, covering 300 and 400.
  src: [
    {
      path: '../styles/fonts/cormorant-garamond-latin-var.woff2',
      weight: '300 400',
      style: 'normal',
    },
    {
      path: '../styles/fonts/cormorant-garamond-latin-italic-var.woff2',
      weight: '300 400',
      style: 'italic',
    },
  ],
  variable: '--font-cormorant',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
});

/** UI face — nav, buttons, labels, form fields, dense body copy. */
export const jost = localFont({
  // One variable file for all three weights.
  src: '../styles/fonts/jost-latin-var.woff2',
  weight: '200 400',
  variable: '--font-jost',
  display: 'swap',
});

/**
 * Arabic face.
 *
 * Almarai is the default pending the client's confirmation — the `arabic-rtl`
 * skill lists Almarai or Cairo and asks that the choice be confirmed with them.
 *
 * Two loaders, because Arabic pages set everything in Almarai, Latin included
 * (prices, "COVE"), and `next/font/local` cannot give each file its own
 * `unicode-range`. The Arabic files come first in the stack and hold no Latin
 * glyphs, so the browser takes those characters from the Latin files — the
 * same split Google's stylesheet made with ranges. Only the Arabic files are
 * preloaded, as before.
 *
 * The Arabic loader has no generated fallback. `next/font` would otherwise put
 * a size-matched Arial straight after it in the stack, and Arial has Latin
 * glyphs — so Latin text on Arabic pages stopped at Arial and never reached
 * the Latin Almarai files. The Latin loader's fallback still covers the swap.
 */
export const almarai = localFont({
  src: [
    { path: '../styles/fonts/almarai-arabic-300.woff2', weight: '300' },
    { path: '../styles/fonts/almarai-arabic-400.woff2', weight: '400' },
    { path: '../styles/fonts/almarai-arabic-700.woff2', weight: '700' },
  ],
  variable: '--font-almarai',
  display: 'swap',
  adjustFontFallback: false,
});

export const almaraiLatin = localFont({
  src: [
    { path: '../styles/fonts/almarai-latin-300.woff2', weight: '300' },
    { path: '../styles/fonts/almarai-latin-400.woff2', weight: '400' },
    { path: '../styles/fonts/almarai-latin-700.woff2', weight: '700' },
  ],
  variable: '--font-almarai-latin',
  display: 'swap',
  preload: false,
});

export const fontVariables = [
  cormorant.variable,
  jost.variable,
  almarai.variable,
  almaraiLatin.variable,
].join(' ');
