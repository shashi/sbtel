#!/usr/bin/env node
// Tests for plugin/skills/sbtel-recover/scripts/sbtel_refs.mjs (make selfcheck runs them): global
// scripts that share names, an inline <script> in HTML, top-level IIFE units, ES module imports and a
// CommonJS require, --units, and --no-props.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
eq(run('m/a.mjs', 'm/b.mjs', 'c/x.cjs', 'c/y.cjs'), ['m/a.mjs:1 m/b.mjs:1\t./b.mjs', 'm/a.mjs:2 m/b.mjs:1\ttwo', 'c/x.cjs:1 c/y.cjs:1\t./y.cjs', 'c/x.cjs:2 c/y.cjs:1\ty'], 'ES module import and CommonJS require (a required binding names the module)');
rmSync(d, { recursive: true, force: true });
console.log(fail ? `sbtel_refs: ${fail} failed` : 'sbtel_refs: all passed');
process.exit(fail ? 1 : 0);
