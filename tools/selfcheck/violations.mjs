#!/usr/bin/env node
// The last step of `make selfcheck`: run `sbtel check --json` on sbtel's own specs and bindings (the
// viewer's, and the Go code's) and fail on any violation that is not explained, on any warning (a
// `# VIOLATION:` note on an allowed edge, or one that explains no edge), on invalid lines and on a spec
// error. A violation is explained by a `# VIOLATION: reason` comment directly above its edge
// (docs/DESIGN.md §2.5); check reports it as the violation's `note`.
//
//   node tools/selfcheck/violations.mjs [path/to/sbtel]      (default bin/sbtel)
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bin = resolve(process.argv[2] || join(root, 'bin/sbtel'));
const TARGETS = [['examples/viewer.sbtel', 'examples/viewer.edges.txt'], ['examples/sbtel.sbtel', 'examples/sbtel.edges.txt']];
const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

let failed = 0;
for (const [SPEC, EDGES] of TARGETS) {
  const r = spawnSync(bin, ['check', SPEC, '--bindings', EDGES, '--json'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1 && r.status !== 2) { process.stderr.write(r.stderr || String(r.error)); console.error(`violations: ${bin} check exited ${r.status}`); process.exit(1); }
  const res = JSON.parse(r.stdout), bad = [];
  if (res.error) bad.push(`${SPEC}: ${res.error.message}`);
  res.invalid.forEach(x => bad.push(`${EDGES}:${x.line}: not an edge: ${x.text}`));
  res.violations.filter(v => v.note === null).forEach(v => bad.push(`${EDGES}:${v.line}: ${v.caller} -> ${v.callee}: ${v.text}  (${v.location}): not explained (add a "# VIOLATION: reason" line above it, or fix the spec)`));
  res.warnings.forEach(w => bad.push(`${EDGES}:${w.line}: ${w.message}: remove the note, or move it above its edge`));
  if (bad.length) { bad.forEach(b => console.error(b)); console.error(`selfcheck: ${pl(bad.length, 'problem')} in ${EDGES}`); failed++; continue; }
  console.log(`${SPEC}: ${pl(res.edges, 'binding')}, ${pl(res.violations.length, 'violation')}, all ${res.explained} explained`);
}
process.exit(failed ? 1 : 0);
