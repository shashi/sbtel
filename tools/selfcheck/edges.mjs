#!/usr/bin/env node
// Regenerates the bindings of sbtel's own code against its specs (`make edges`), or checks that the
// committed files are current (`make selfcheck`). Two targets:
//   viewer  the viewer page's code against examples/viewer.sbtel, in examples/viewer.edges.txt;
//   go      the Go code (assets.go, cmd/, internal/) against examples/sbtel.sbtel, in
//           examples/sbtel.edges.txt.
//
//   node tools/selfcheck/edges.mjs [viewer|go]...            write the files (default: both)
//   node tools/selfcheck/edges.mjs --check [viewer|go]...    exit 1 if a committed file differs
//
// Dev-only: needs node >= 18, python3, go, and the TypeScript checker installed by `npm ci` in this
// directory (`make selfcheck` does that). The binary and the page do not use any of it.
//
// The pipeline is the sbtel-recover skill's (plugin/skills/sbtel-recover/extracting-bindings.md):
//   1. ownership: sbtel_owners.py checks the @sbtel annotations in the sources against the spec;
//   2. references: for the viewer, sbtel_refs.mjs resolves every identifier with the TypeScript checker
//      (the sources are one page script once viewer/build.mjs inlines them, so there are no imports to
//      follow), plus getElementById / $('id') lookups resolved to the markup line with that id; for Go,
//      sbtel_refs_go resolves every identifier with go/types, for linux, darwin and windows;
//   3. edges: sbtel_owners.py --edges maps both ends to their owners;
//   4. one line per caller, callee and file: the first location, and "(+N more)" for the others.
// A `# VIOLATION: reason` comment above an edge in the committed file is an explanation written by a
// person (DESIGN.md §2.5, §8). A fresh run carries it over to the same caller, callee and file, so the
// explanations survive regeneration. An explanation whose edge is gone is dropped (and --check fails).
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const HTML = 'viewer/src/index.html';
const SKILL = 'plugin/skills/sbtel-recover/scripts';
const TS = join(here, 'node_modules/typescript');
const args = process.argv.slice(2), check = args.includes('--check');
const want = args.filter(a => a !== '--check');
if (want.some(t => t !== 'viewer' && t !== 'go')) { console.error('usage: edges.mjs [--check] [viewer|go]...'); process.exit(2); }

const run = (cmd, args, input, cwd = root) => {
  try { return execFileSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { process.stderr.write(e.stderr || String(e)); console.error(`edges: ${cmd} ${args.slice(0, 2).join(' ')} … failed`); process.exit(1); }
};
const py = process.platform === 'win32' ? 'python' : 'python3';

// The viewer's references: identifiers, then DOM ids.
function viewerRefs(FILES) {
if (!existsSync(TS)) { console.error('edges: the TypeScript checker is missing: run `npm ci` in tools/selfcheck (make selfcheck does)'); process.exit(1); }
const refs = run('node', [join(SKILL, 'sbtel_refs.mjs'), '--typescript', TS, ...FILES]);
const markup = readFileSync(join(root, HTML), 'utf8').split('\n'), ids = new Map();
for (let i = 0; i < markup.length && !/^<script>/.test(markup[i]); i++)
  for (const m of markup[i].matchAll(/\bid="([^"]+)"/g)) if (!ids.has(m[1])) ids.set(m[1], i + 1);
const dom = [];
for (const f of FILES) {
  let inScript = f !== HTML;
  readFileSync(join(root, f), 'utf8').split('\n').forEach((l, i) => {
    if (f === HTML) { if (/^<script>/.test(l)) inScript = true; if (/^<\/script>/.test(l)) inScript = false; }
    if (!inScript) return;
    const hit = id => { if (ids.has(id)) dom.push(`${f}:${i + 1} ${HTML}:${ids.get(id)}\t#${id}`); };
    for (const m of l.matchAll(/(?:\$|getElementById)\(\s*['"]([^'"]+)['"]\s*\)/g)) hit(m[1]);
    for (const m of l.matchAll(/\[((?:'[^']+',?\s*)+)\]\.map\(\$\)/g)) for (const k of m[1].matchAll(/'([^']+)'/g)) hit(k[1]); // ['a', 'b'].map($)
  });
}
return refs + dom.join('\n') + '\n';
}

// The Go code's non-test files (for every GOOS: all of them), and their references for every GOOS.
const goFiles = () => {
  const walk = d => readdirSync(join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
  return ['assets.go', ...walk('cmd'), ...walk('internal')].filter(f => f.endsWith('.go') && !f.endsWith('_test.go')).sort();
};
const goRefs = () => run('go', ['-C', join(SKILL, 'sbtel_refs_go'), 'run', '.', '--dir', root, '--goos', 'linux,darwin,windows', './...']);

const TARGETS = {
  viewer: {
    SPEC: 'examples/viewer.sbtel', EDGES: 'examples/viewer.edges.txt',
    // In page order: viewer/build.mjs inlines core.js, then session.js, review.js, server.js and diff.js.
    files: () => ['core/core.js', 'viewer/src/index.html', 'viewer/src/session.js', 'viewer/src/review.js', 'viewer/src/server.js', 'viewer/src/diff.js'],
    refs: viewerRefs,
    header: `# Bindings of the viewer's code against examples/viewer.sbtel: who names whom, one line per caller,
# callee and file (the first location; "+N more" counts the others in that file).
#
# Generated by tools/selfcheck/edges.mjs (\`make edges\`); \`make selfcheck\` fails when this file is stale
# and when \`sbtel check\` finds a violation that has no explanation. Do not edit the edge lines by hand.
# The \`# VIOLATION: reason\` comments are written by hand: one directly above an edge explains why the
# code breaks the levels there. A fresh run keeps it with the same caller, callee and file.
#
# How: viewer/build.mjs inlines core.js, session.js, review.js, server.js and diff.js into the one <script> of
# index.html, so every top-level declaration is a global of one page script and there are no imports.
# plugin/skills/sbtel-recover/scripts/sbtel_refs.mjs resolves every identifier with the TypeScript
# checker (a reference counts when its declaration is in another top-level statement), getElementById
# and $('id') lookups are resolved to the markup line with that id, and sbtel_owners.py --edges maps
# both ends to the blocks that own them (the @sbtel annotations).
#
# Not covered: string-keyed dispatch (SBTEL.modes[mode], data-a="..." button actions, CSS classes in
# generated HTML), the HTTP and SSE traffic with the sbtel server (ports in the spec), and core/api.js
# (the CLI side). server.js and diff.js reassign app function declarations (render = dRender, ...);
# the checker sees an assignment as a reference, so those show as downward bindings.
`,
  },
  go: {
    SPEC: 'examples/sbtel.sbtel', EDGES: 'examples/sbtel.edges.txt',
    files: goFiles,
    refs: goRefs,
    header: `# Bindings of sbtel's Go code against examples/sbtel.sbtel: who names whom, one line per caller, callee
# and file (the first location; "+N more" counts the others in that file).
#
# Generated by tools/selfcheck/edges.mjs (\`make edges\`); \`make selfcheck\` fails when this file is stale
# and when \`sbtel check\` finds a violation that has no explanation. Do not edit the edge lines by hand.
# The \`# VIOLATION: reason\` comments are written by hand and kept with the same caller, callee and file.
#
# How: plugin/skills/sbtel-recover/scripts/sbtel_refs_go type-checks the module's non-test files with
# go/types, once per GOOS (linux, darwin, windows, so both detach_*.go files are seen), and keeps every
# identifier that names a declaration, method or struct field of another top-level declaration (calls,
# types and fields alike). sbtel_owners.py --edges maps both ends to the blocks that own them (the
# @sbtel annotations). A Go package has no imports between its files, so this is the no-imports recipe.
#
# Not covered: _test.go files; calls that reach a method only through an interface (net/http calls
# Server.ServeHTTP because Lifecycle passes the Server as an http.Handler: no name, so no edge); the HTTP
# control and browser APIs, which are string-routed (the ControlCall and Event messages); the JS core,
# reached through goja by name; go:embed targets (files, not code).
`,
  },
};

for (const name of want.length ? want : ['viewer', 'go']) {
const { SPEC, EDGES, header } = TARGETS[name], FILES = TARGETS[name].files();
// 1. Ownership (fails on any annotation error).
run(py, ['-I', join(SKILL, 'sbtel_owners.py'), SPEC, ...FILES]);
// 2. References.
const refs = TARGETS[name].refs(FILES);

// 3. Edges, one per caller, callee and location.
const raw = run(py, ['-I', join(SKILL, 'sbtel_owners.py'), SPEC, ...FILES, '--edges'], refs);

// 4. One line per caller, callee and file.
const groups = new Map();
for (const l of raw.split('\n')) {
  const m = /^(\S+) -> (\S+)\s+# (\S+):(\d+)$/.exec(l); if (!m) continue;
  const k = `${m[1]}|${m[2]}|${m[3]}`, n = +m[4];
  if (!groups.has(k)) groups.set(k, { caller: m[1], callee: m[2], file: m[3], lines: new Set() });
  groups.get(k).lines.add(n);
}
const rows = [...groups.values()].map(g => ({ ...g, first: Math.min(...g.lines), more: g.lines.size - 1 }))
  .sort((a, b) => FILES.indexOf(a.file) - FILES.indexOf(b.file) || a.first - b.first || a.caller.localeCompare(b.caller) || a.callee.localeCompare(b.callee));

// Explanations from the committed file: the comment run directly above an edge, from `# VIOLATION:` on.
const notes = new Map();
if (existsSync(join(root, EDGES))) {
  let run = [];
  for (const l of readFileSync(join(root, EDGES), 'utf8').split(/\r\n|\r|\n/)) {
    if (/^\s*#/.test(l)) { run.push(l); continue; }
    const m = /^\s*(\S+?)\s*->\s*(\S+)\s+#\s*(\S+?):\d+/.exec(l);
    if (m) { const i = run.findIndex(c => /^\s*#\s*VIOLATION:/.test(c)); if (i >= 0) notes.set(`${m[1]}|${m[2]}|${m[3]}`, run.slice(i)); }
    run = [];
  }
}

let text = header;
for (const r of rows) {
  const n = notes.get(`${r.caller}|${r.callee}|${r.file}`);
  if (n) text += n.join('\n') + '\n';
  text += `${r.caller} -> ${r.callee}  # ${r.file}:${r.first}${r.more ? ` (+${r.more} more)` : ''}\n`;
}

const dest = join(root, EDGES);
if (check) {
  const old = existsSync(dest) ? readFileSync(dest, 'utf8') : '';
  if (old === text) { console.log(`${EDGES} is up to date (${rows.length} edge${rows.length === 1 ? '' : 's'})`); continue; }
  const a = old.split('\n'), b = text.split('\n'), A = new Set(a), B = new Set(b);
  console.error(`${EDGES} is stale: run \`make edges\`, then explain any new violation (make selfcheck).`);
  a.filter(l => !B.has(l)).slice(0, 20).forEach(l => console.error('- ' + l));
  b.filter(l => !A.has(l)).slice(0, 20).forEach(l => console.error('+ ' + l));
  process.exitCode = 1;
  continue;
}
writeFileSync(dest, text);
console.log(`wrote ${EDGES} (${rows.length} edge${rows.length === 1 ? '' : 's'}, ${[...notes.keys()].filter(k => groups.has(k)).length} explained)`);
}
