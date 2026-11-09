#!/usr/bin/env node
// Tests for plugin/skills/sbtel-recover/scripts/sbtel_refs.mjs (make selfcheck runs them): global
// scripts that share names, an inline <script> in HTML, top-level IIFE units, ES module imports and a
// CommonJS require, --units, and --no-props; and a dependency-inversion fixture (an interface, an
// implementer, a caller and a composition root) through sbtel_owners.py --edges.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const REFS = join(root, 'plugin/skills/sbtel-recover/scripts/sbtel_refs.mjs'), TS = join(here, 'node_modules/typescript');
const d = mkdtempSync(join(tmpdir(), 'sbtel-refs-'));
const files = {
  'lib.js': 'function helper() { return 1; }\nconst conf = { size: 2 };\n',
  'app.js': 'function main() {\n  return helper() + conf.size;\n}\nconst Mod = (() => {\n  const a = () => main();\n  const b = () => a();\n  return { b };\n})();\n',
  'page.html': '<!doctype html>\n<div id="x"></div>\n<script>\nconst page = main();\n</script>\n<script src="other.js"></script>\n',
  'm/a.mjs': 'import { two } from "./b.mjs";\nexport const one = () => two();\n',
  'm/b.mjs': 'export function two() { return 2; }\n',
  'c/x.cjs': 'const y = require("./y.cjs");\nmodule.exports = () => y;\n',
  'c/y.cjs': 'module.exports = 42;\n',
};
['m', 'c'].forEach(x => mkdirSync(join(d, x)));
for (const [f, t] of Object.entries(files)) writeFileSync(join(d, f), t);
const run = (...args) => execFileSync('node', [REFS, '--typescript', TS, ...args], { cwd: d, encoding: 'utf8' }).split('\n').filter(Boolean).sort();

let fail = 0;
const eq = (got, want, what) => { const g = JSON.stringify(got), w = JSON.stringify(want.sort()); if (g !== w) { fail++; console.log(`FAIL ${what}\n  got  ${g}\n  want ${w}`); } };
eq(run('lib.js', 'app.js', 'page.html'), [
  'app.js:2 lib.js:1\thelper', 'app.js:2 lib.js:2\tconf', 'app.js:2 lib.js:2\tsize',
  'app.js:5 app.js:1\tmain', 'app.js:6 app.js:5\ta', 'app.js:7 app.js:6\tb', // statements of a top-level IIFE are units of their own
  'page.html:4 app.js:1\tmain',
], 'global scripts, inline <script>, IIFE units, property names');
eq(run('--no-props', 'lib.js', 'app.js'), ['app.js:2 lib.js:1\thelper', 'app.js:2 lib.js:2\tconf', 'app.js:5 app.js:1\tmain', 'app.js:6 app.js:5\ta', 'app.js:7 app.js:6\tb'], '--no-props');
eq(run('--units', 'lib.js', 'app.js'), ['app.js:1 lib.js:1', 'app.js:1 lib.js:2', 'app.js:5 app.js:1', 'app.js:6 app.js:5', 'app.js:7 app.js:6'], '--units');
// Through a symbolic link (macOS's temp dirs are under /var, a link to /private/var): TypeScript resolves
// imports to real paths, which must still count as the project's files.
let viaLink = null;
try { symlinkSync(d, d + '-link', 'dir'); viaLink = d + '-link'; } catch (e) { console.log('skip: no symbolic links here'); }
if (viaLink) {
  const got = execFileSync('node', [REFS, '--typescript', TS, 'm/a.mjs', 'm/b.mjs'], { cwd: viaLink, encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  eq(got, ['m/a.mjs:1 m/b.mjs:1\t./b.mjs', 'm/a.mjs:2 m/b.mjs:1\ttwo'], 'ES module import in a directory reached through a link');
  rmSync(viaLink, { force: true });
}
eq(run('m/a.mjs', 'm/b.mjs', 'c/x.cjs', 'c/y.cjs'), ['m/a.mjs:1 m/b.mjs:1\t./b.mjs', 'm/a.mjs:2 m/b.mjs:1\ttwo', 'c/x.cjs:1 c/y.cjs:1\t./y.cjs', 'c/x.cjs:2 c/y.cjs:1\ty'], 'ES module import and CommonJS require (a required binding names the module)');

// Dependency inversion, end to end (sbtel_refs.mjs, then sbtel_owners.py --edges): an interface owned by a
// behavior, an interface that extends it, an implementer, a caller that calls only through the interface,
// and a composition root. In TypeScript the heritage clauses are tagged `implements`; in plain JS the
// interface is a JSDoc @typedef, a unit of its own, and a @param type names it.
const inv = {
  'spec.sbtel': '(behavior Durable :type "interface")\n(behavior Journaled (implements Durable))\n(behavior Measures :type "JSDoc typedef")\n' +
    '(block Inv\n  (level (block Inv.Root))\n  (level (block Inv.Editor) (block Inv.Layout))\n  (level (block Inv.Disk (implements Journaled)) (block Inv.Meter (implements Measures))))\n',
  'store.ts': '// @sbtel Durable\ninterface Durable { save(s: string): void; }\n// @sbtel Journaled\ninterface Journaled extends Durable { replay(): string[]; }\n' +
    '// @sbtel Inv.Disk\nclass Disk implements Journaled { save(s: string) {} replay() { return []; } }\n',
  'editor.ts': '// @sbtel file Inv.Editor\nfunction type(out: Durable) { out.save("hi"); }\n',
  'main.ts': '// @sbtel file Inv.Root\ntype(new Disk());\nmeasure(Meter);\n',
  'layout.js': '// @sbtel begin Measures\n/** @typedef {{ tw: (text: string) => number }} Measures */\n// @sbtel end Measures\n' +
    '// @sbtel Inv.Layout\n/** @param {Measures} M */\nfunction measure(M) { return M.tw("x"); }\n// @sbtel Inv.Meter\nconst Meter = { tw: t => t.length };\n',
};
const e = mkdtempSync(join(tmpdir(), 'sbtel-inv-'));
for (const [f, t] of Object.entries(inv)) writeFileSync(join(e, f), t);
const SRC = ['store.ts', 'editor.ts', 'main.ts', 'layout.js'];
const pairs = execFileSync('node', [REFS, '--typescript', TS, ...SRC], { cwd: e, encoding: 'utf8' });
eq(pairs.split('\n').filter(l => /implements$/.test(l)).sort(), ['store.ts:4 store.ts:2\tDurable\timplements', 'store.ts:6 store.ts:4\tJournaled\timplements'], 'heritage clauses are tagged implements');
const OWN = join(root, 'plugin/skills/sbtel-recover/scripts/sbtel_owners.py');
const edges = execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', OWN, 'spec.sbtel', ...SRC, '--edges'], { cwd: e, input: pairs, encoding: 'utf8' });
eq(edges.split('\n').filter(Boolean).sort(), [
  'Inv.Editor -> Durable  # editor.ts:2',      // the caller binds only the behavior (abstraction)
  'Inv.Layout -> Measures  # layout.js:5',     // a JSDoc @param type
  'Inv.Layout -> Measures  # layout.js:6',     // M.tw: a call through the typedef
  'Inv.Root -> Inv.Disk  # main.ts:2',         // the composition root binds the implementers
  'Inv.Root -> Inv.Editor  # main.ts:2',
  'Inv.Root -> Inv.Layout  # main.ts:3',
  'Inv.Root -> Inv.Meter  # main.ts:3',
].sort(), 'interface, implementer, caller and composition root: the edges');
rmSync(e, { recursive: true, force: true });
rmSync(d, { recursive: true, force: true });
console.log(fail ? `sbtel_refs: ${fail} failed` : 'sbtel_refs: all passed');
process.exit(fail ? 1 : 0);
