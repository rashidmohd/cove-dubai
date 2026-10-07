/**
 * Check the setup that puts the Cove logo beside our emails in Yahoo and AOL
 * inboxes (BIMI). Run after each step of `docs/email-logo-bimi.md`:
 *
 *   npm run bimi:check -- mail.covedubai.com
 *   npm run bimi:check -- --svg https://dev.covehotels.ae/bimi/cove-logo.svg
 *
 * The second form checks only the logo file, before any DNS exists.
 * Pass the domain the emails are sent **from** — the part after the @ in
 * EMAIL_FROM. Reads public DNS and fetches the logo; changes nothing.
 *
 * What it checks, in the order the steps are done:
 *   1. DMARC on the sending domain and on the main domain is at enforcement —
 *      `p=quarantine` or `p=reject`, at 100%. BIMI is ignored under `p=none`.
 *   2. The BIMI record exists and points at an https SVG.
 *   3. The SVG is in the SVG Tiny PS profile inboxes require: square, titled,
 *      no scripts, no embedded images, no outside links, small.
 */
import { Resolver } from 'node:dns/promises';

/**
 * Public DNS, not this machine's resolver. A local cache (a VPN, an ad blocker,
 * the router) can hold a "no such record" answer for 30 minutes after a record
 * is added, and report a correct setup as broken. Inboxes see public DNS.
 */
const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);

type Result = { ok: boolean; label: string; detail?: string };
const results: Result[] = [];
const check = (ok: boolean, label: string, detail?: string) =>
  results.push({ ok, label, ...(detail ? { detail } : {}) });

async function txt(name: string): Promise<string[]> {
  try {
    return (await resolver.resolveTxt(name)).map((parts) => parts.join(''));
  } catch {
    return [];
  }
}

/** Tag values out of a `k=v; k=v` record. */
function tags(record: string): Record<string, string> {
  return Object.fromEntries(
    record
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length >= 2)
      .map(([key, ...value]) => [key!.trim().toLowerCase(), value.join('=').trim()]),
  );
}

/** The registered domain: `mail.covedubai.com` → `covedubai.com`. Good enough for .com/.ae/.co.ae. */
function organisationalDomain(domain: string): string {
  const parts = domain.split('.');
  const twoPartSuffix = ['co.ae', 'com.ae', 'net.ae', 'co.uk'].includes(parts.slice(-2).join('.'));
  return parts.slice(twoPartSuffix ? -3 : -2).join('.');
}

async function checkDmarc(domain: string, label: string, inheritedFrom?: Record<string, string>) {
  const record = (await txt(`_dmarc.${domain}`)).find((value) => value.toLowerCase().startsWith('v=dmarc1'));
  // A subdomain without its own record is covered by the main domain's `sp=`.
  const policy = record
    ? tags(record).p
    : inheritedFrom
      ? (inheritedFrom.sp ?? inheritedFrom.p)
      : undefined;
  const pct = record ? (tags(record).pct ?? '100') : (inheritedFrom?.pct ?? '100');

  if (!record && !inheritedFrom) {
    check(false, `DMARC record on ${label}`, `No TXT record at _dmarc.${domain}`);
    return undefined;
  }
  check(
    policy === 'quarantine' || policy === 'reject',
    `DMARC on ${label} is enforced`,
    record ? `p=${policy ?? '?'}` : `inherits sp=${policy ?? '?'} from the main domain`,
  );
  check(pct === '100', `DMARC on ${label} applies to all mail`, `pct=${pct}`);
  return record ? tags(record) : undefined;
}

async function checkSvg(url: string) {
  let svg: string;
  try {
    const response = await fetch(url, { redirect: 'follow' });
    check(response.ok, 'Logo loads', `${response.status} ${url}`);
    if (!response.ok) return;
    const type = response.headers.get('content-type') ?? '';
    check(type.includes('svg'), 'Logo is served as SVG', type || 'no content-type');
    svg = await response.text();
  } catch (error) {
    check(false, 'Logo loads', `${url} — ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  check(/baseProfile=["']tiny-ps["']/.test(root), 'SVG declares baseProfile="tiny-ps"');
  check(/version=["']1\.2["']/.test(root), 'SVG declares version="1.2"');
  check(/<title>[^<]+<\/title>/i.test(svg), 'SVG has a <title> (the brand name)');

  const viewBox = /viewBox=["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*["']/i.exec(root);
  check(
    Boolean(viewBox) && viewBox![3] === viewBox![4],
    'SVG is square',
    viewBox ? `viewBox ${viewBox.slice(1).join(' ')}` : 'no viewBox',
  );
  check(!/\s(x|y)=["']/.test(root), 'SVG root has no x= / y=');
  check(!/<script\b/i.test(svg), 'SVG has no scripts');
  check(!/<image\b/i.test(svg), 'SVG embeds no raster images');
  check(!/(xlink:)?href=["']https?:/i.test(svg), 'SVG links to nothing outside itself');
  check(!/<(animate|foreignObject)\b/i.test(svg), 'SVG has no animation or foreign content');
  const kb = Buffer.byteLength(svg) / 1024;
  check(kb <= 32, 'SVG is 32 KB or smaller', `${kb.toFixed(1)} KB`);
}

function report(): never {
  for (const result of results) {
    console.log(`${result.ok ? '✓' : '✗'} ${result.label}${result.detail ? `  — ${result.detail}` : ''}`);
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(failed === 0 ? '\nAll checks pass.' : `\n${failed} to fix — see docs/email-logo-bimi.md.`);
  process.exit(failed === 0 ? 0 : 1);
}

async function main(): Promise<void> {
  if (process.argv[2] === '--svg') {
    const url = process.argv[3];
    if (!url) {
      console.error('Usage: npm run bimi:check -- --svg https://…/cove-logo.svg');
      process.exit(1);
    }
    await checkSvg(url);
    report();
  }

  const domain = process.argv[2]?.trim().toLowerCase();
  if (!domain || !domain.includes('.')) {
    console.error('Usage: npm run bimi:check -- mail.covedubai.com   (the domain in EMAIL_FROM)');
    process.exit(1);
  }
  const org = organisationalDomain(domain);

  // Step 1 — DMARC, on the main domain and (if different) the sending domain.
  const orgTags = await checkDmarc(org, `the main domain (${org})`);
  if (org !== domain) await checkDmarc(domain, `the sending domain (${domain})`, orgTags);

  // Step 2 — the BIMI record.
  const bimi = (await txt(`default._bimi.${domain}`)).find((value) => value.toLowerCase().startsWith('v=bimi1'));
  check(Boolean(bimi), 'BIMI record exists', bimi ?? `No TXT record at default._bimi.${domain}`);
  const logo = bimi ? tags(bimi).l : undefined;
  check(Boolean(logo?.startsWith('https://')), 'BIMI record points at an https logo', logo ?? 'no l= tag');

  // Step 3 — the logo itself.
  if (logo?.startsWith('https://')) await checkSvg(logo);
  report();
}

void main();
