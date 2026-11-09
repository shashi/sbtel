#!/usr/bin/env node
// Assembles viewer/dist/index.html, one self-contained page, from viewer/src/index.html.
//   node viewer/build.mjs            write viewer/dist/index.html
//   node viewer/build.mjs --check    exit 1 if viewer/dist/index.html is missing or stale
// Directives in viewer/src/index.html (each alone on its line, or inline):
//   /*@@include <path from repo root>@@*/   replaced by that file's text, verbatim
//   @@VERSION@@                             replaced by the contents of VERSION (trimmed)
//   @@font <path from repo root>@@          replaced by a data:font/woff2;base64 URL of that file
// Also run by `go generate` (see assets.go) and `make viewer`. No dependencies beyond node >= 18.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

export function build() {
  const version = read('VERSION').trim();
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error('VERSION must be a plain version string, got ' + JSON.stringify(version));
  const seen = [];
  let out = read('viewer/src/index.html').replace(/\/\*@@include ([^@*]+)@@\*\//g, (_, p) => {
    p = p.trim(); seen.push(p);
    const text = read(p);
    if (text.includes('</script')) throw new Error(p + ' contains "</script", which would end the inline script');
    return text.replace(/\n$/, '');
  });
  out = out.split('@@VERSION@@').join(version);
  out = out.replace(/@@font ([^@]+)@@/g, (_, p) => {
    p = p.trim();
    if (!p.endsWith('.woff2')) throw new Error('@@font takes a .woff2 file, got ' + p);
    return 'data:font/woff2;base64,' + readFileSync(join(root, p)).toString('base64');
  });
  for (const need of ['core/core.js', 'viewer/src/session.js', 'viewer/src/review.js', 'viewer/src/server.js', 'viewer/src/diff.js'])
    if (!seen.includes(need)) throw new Error('viewer/src/index.html does not include ' + need);
  if (/@@(include|VERSION|font)/.test(out)) throw new Error('unexpanded @@ directive left in output');
  // The page must work offline and never call out (DESIGN.md §6): no remote stylesheet, font or script.
  const remote = /<(?:link|script)\b[^>]*\b(?:href|src)\s*=\s*["']?(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\//i.exec(out);
  if (remote) throw new Error('the page references a remote resource: ' + out.slice(remote.index, remote.index + 120));
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const html = build(), dest = join(root, 'viewer/dist/index.html');
  if (process.argv.includes('--check')) {
    if (!existsSync(dest) || readFileSync(dest, 'utf8') !== html) { console.error('viewer/dist/index.html is stale: run `make viewer`'); process.exit(1); }
    console.log('viewer/dist/index.html is up to date');
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, html);
    console.log('wrote viewer/dist/index.html (' + html.length + ' chars)');
  }
}
