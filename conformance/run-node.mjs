#!/usr/bin/env node
// Conformance, node side. Node is the reference engine: `--update` rewrites expected/ from node.
//   node conformance/run-node.mjs            compare every record with conformance/expected/
//   node conformance/run-node.mjs --update   regenerate conformance/expected/
//   add --only <text> to compare or update only records whose file name contains <text>
// One record per spec: __api.conformance(src, cases) (core/api.js). internal/engine's Go test makes
// the same records in goja and compares them with the same files, byte for byte.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const C = p => join(root, 'conformance', p);
const update = process.argv.includes('--update');

// Text inputs are read with \r\n as \n, so a CRLF checkout gives the same records. The bindings fixtures
// are passed as they are: a-rules.bindings.txt tests CRLF line endings on purpose (.gitattributes keeps it).
const lf = t => t.replace(/\r\n/g, '\n');
const code = lf(readFileSync(join(root, 'core/core.js'), 'utf8')) + '\n' + lf(readFileSync(join(root, 'core/api.js'), 'utf8')) + '\n;__api';
const api = vm.runInContext(code, vm.createContext(Object.create(null)), { filename: 'core+api.js' });

// cases/*.json merged in file-name order: spec cases concatenate, random and diff lists append.
const cases = { specs: {}, random: [], diff: [] };
for (const f of readdirSync(C('cases')).filter(f => f.endsWith('.json')).sort()) {
  const c = JSON.parse(lf(readFileSync(C('cases/' + f), 'utf8')));
  for (const [spec, v] of Object.entries(c.specs || {})) {
    const t = cases.specs[spec] || (cases.specs[spec] = { query: [], check: [], edits: [], carriers: [] });
    t.query.push(...(v.query || [])); t.check.push(...(v.check || [])); t.edits.push(...(v.edits || [])); t.carriers.push(...(v.carriers || []));
  }
  cases.random.push(...(c.random || [])); cases.diff.push(...(c.diff || []));
}
// Records: [output file, () => text]. Bindings files are read here and passed in as text.
const jobs = [];
for (const f of readdirSync(C('specs')).filter(f => f.endsWith('.sbtel')).sort()) {
  const c = cases.specs[f] || { query: [], check: [], edits: [], carriers: [] }, src = lf(readFileSync(C('specs/' + f), 'utf8'));
  const withText = JSON.stringify({ query: c.query, check: c.check.map(k => ({ name: k.name, text: readFileSync(C('specs/' + k.name), 'utf8') })), edits: c.edits, carriers: c.carriers });
  jobs.push([f.replace(/\.sbtel$/, '') + '.json', () => api.conformance(src, withText)]);
}
for (const seed of cases.random) jobs.push(['random-' + seed + '.json', () => api.conformance(api.randomSpec(seed), '{}')]);
for (const d of cases.diff) jobs.push(['diff-' + d.name + '.json', () => api.diff(lf(readFileSync(C(d.a), 'utf8')), lf(readFileSync(C(d.b), 'utf8'))) + '\n']);
const oi = process.argv.indexOf('--only'), only = oi > 0 ? process.argv[oi + 1] || '' : null;
const selected = jobs.filter(j => only === null || j[0].includes(only));

mkdirSync(C('expected'), { recursive: true });
let fail = 0;
for (const [out, make] of selected) {
  const got = make(), path = C('expected/' + out);
  if (update) { writeFileSync(path, got); continue; }
  if (!existsSync(path)) { console.log('MISSING ' + out); fail++; continue; }
  const want = lf(readFileSync(path, 'utf8'));
  if (want !== got) {
    let i = 0; while (i < want.length && want[i] === got[i]) i++;
    console.log('DIFF ' + out + ' at char ' + i + '\n  want …' + want.slice(Math.max(0, i - 60), i + 60) + '\n  got  …' + got.slice(Math.max(0, i - 60), i + 60));
    fail++;
  }
}
if (update) {
  const keep = new Set(jobs.map(j => j[0]));
  if (only === null) for (const f of readdirSync(C('expected'))) if (!keep.has(f)) unlinkSync(C('expected/' + f));
  console.log('node conformance: wrote ' + selected.length + ' records to conformance/expected/');
} else {
  console.log('node conformance: ' + (selected.length - fail) + '/' + selected.length + ' records match');
  process.exit(fail ? 1 : 0);
}
