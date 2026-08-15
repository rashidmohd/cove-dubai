/**
 * Translation status report.
 *
 * We build the bilingual system; the client supplies the Arabic copy. Brand
 * copy for a luxury hotel is never machine-translated, so Arabic ships with the
 * English text in place as a deliberate placeholder.
 *
 * The risk with that approach is a string quietly staying English forever. This
 * script makes the gap visible: it reports every key whose Arabic value is
 * still identical to the English, and fails if a key is missing from either
 * file entirely — which would render blank rather than merely untranslated.
 *
 *   npm run check:translations           report
 *   npm run check:translations -- --ci   also fail while anything is untranslated
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const load = (locale) =>
  JSON.parse(readFileSync(resolve(here, `../messages/${locale}.json`), 'utf8'));

function flatten(value, prefix = '', out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, path, out);
    } else {
      out.set(path, child);
    }
  }
  return out;
}

const en = flatten(load('en'));
const ar = flatten(load('ar'));

const missing = [...en.keys()].filter((key) => !ar.has(key));
const orphaned = [...ar.keys()].filter((key) => !en.has(key));
const untranslated = [...en.keys()].filter(
  (key) => ar.has(key) && ar.get(key) === en.get(key),
);

const translated = en.size - untranslated.length - missing.length;
const percent = Math.round((translated / en.size) * 100);

console.log(`\nArabic translation: ${translated}/${en.size} keys (${percent}%)\n`);

if (missing.length > 0) {
  console.log(`MISSING from ar.json — these render blank (${missing.length}):`);
  for (const key of missing) console.log(`  ${key}`);
  console.log();
}

if (orphaned.length > 0) {
  console.log(`In ar.json but not en.json — probably stale (${orphaned.length}):`);
  for (const key of orphaned) console.log(`  ${key}`);
  console.log();
}

if (untranslated.length > 0) {
  console.log(`Awaiting the client's Arabic copy (${untranslated.length}):`);
  for (const key of untranslated) console.log(`  ${key}`);
  console.log();
}

// A missing key is always a defect: it renders as nothing at all. An
// untranslated one is a known, expected state until the client delivers copy,
// so it only fails the build under --ci.
const ci = process.argv.includes('--ci');
if (missing.length > 0 || orphaned.length > 0) process.exit(1);
if (ci && untranslated.length > 0) process.exit(1);
