/**
 * Render every transactional email to HTML files, to look at in a browser.
 *
 *   npm run email:preview
 *
 * Sends nothing and touches no database. Output goes to `email-previews/`,
 * which is gitignored: the files are generated, and regenerate in a second.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { renderSamples } from './email-samples.js';

const out = resolve('email-previews');
mkdirSync(out, { recursive: true });

const samples = renderSamples();
for (const { name, email } of samples) {
  writeFileSync(join(out, `${name}.html`), email.html);
  writeFileSync(join(out, `${name}.txt`), `Subject: ${email.subject}\n\n${email.text}\n`);
}

// An index, so the set can be reviewed from one page.
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Cove Dubai — email previews</title>
<body style="font-family:system-ui;margin:40px;max-width:720px">
<h1>Cove Dubai — email previews</h1>
<ul>${samples
    .map(
      ({ name, email }) =>
        `<li><a href="${name}.html">${name}</a> · <a href="${name}.txt">plain text</a><br><small>${email.subject.replace(/</g, '&lt;')}</small></li>`,
    )
    .join('')}</ul></body>`,
);

console.log(`Wrote ${samples.length} emails to ${out}/ — open index.html.`);
