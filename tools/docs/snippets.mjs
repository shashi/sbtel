#!/usr/bin/env node
// Checks the code snippets in the docs against the sbtel binary, so the docs cannot drift from it.
//   node tools/docs/snippets.mjs [--bin bin/sbtel] [--fill] [file.md ...]
// With no files it checks README.md, docs/*.md and every .md under plugin/. `make docs-check` runs it
// (after `make build`); it is part of `make test-all` and CI. --fill rewrites each expected-output
// block with what the binary prints (review the diff). Every command runs in a scratch directory where
// the spec is spec.sbtel and the bindings edges.txt, so outputs name those files.
//
// Fenced blocks, by info string:
//   ```sbtel              must lint clean; a ```text block right after it that starts with
//                         "spec.sbtel" must equal `sbtel lint spec.sbtel`
//   ```sbtel fails        must have problems; the ```text block after it must equal the lint output
//   ```lisp               checked like ```sbtel when its paragraph says "as `F.sbtel`" (the README
//                         uses lisp for highlighting); other lisp blocks (grammar, edges) are not specs
//   ```edges              bindings for the last spec; a ```text block after it must equal
//                         `sbtel check spec.sbtel --bindings edges.txt`
//   ```text query <ids> [--with-deps]
//                         must equal `sbtel query spec.sbtel <ids>` on the last spec, and lint clean
//                         on its own unless the query failed
//   ```console            a transcript: `$ cat F` and its output define file F, a spec block whose
//                         paragraph says "as `F`" defines F too, and each `$ sbtel lint|check|query|diff
//                         ...` line must print (stdout, then stderr) exactly the lines under it
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
let bin = join(root, 'bin/sbtel'), fill = false;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--bin') bin = resolve(argv[++i]);
  else if (argv[i] === '--fill') fill = true;
  else if (argv[i].startsWith('-')) { console.error('usage: snippets.mjs [--bin path] [--fill] [file.md ...]'); process.exit(2); }
  else files.push(resolve(argv[i]));
}
if (!files.length) {
  const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : n.endsWith('.md') ? [p] : []; });
  files.push(join(root, 'README.md'), ...walk(join(root, 'docs')), ...walk(join(root, 'plugin')));
}

const work = mkdtempSync(join(tmpdir(), 'sbtel-snippets-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
// Runs the binary in a fresh directory holding `files` ({name: text}); returns {code, out, err}.
function sb(args, files) {
  const dir = mkdtempSync(join(work, 'r-'));
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t);
  const r = spawnSync(bin, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, SBTEL_HOME: join(dir, '.home'), SBTEL_NO_BROWSER: '1' } });
  if (r.error) { console.error(`snippets: cannot run ${bin}: ${r.error.message} (run make build)`); process.exit(2); }
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const lint = src => sb(['lint', 'spec.sbtel'], { 'spec.sbtel': src });
const query = (src, words) => sb(['query', 'spec.sbtel', ...words], { 'spec.sbtel': src });
const check = (src, edges) => sb(['check', 'spec.sbtel', '--bindings', 'edges.txt'], { 'spec.sbtel': src, 'edges.txt': edges });

function fences(md) {
  const out = [], re = /^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm; let m;
  while ((m = re.exec(md))) out.push({ info: m[1].trim(), body: m[2], at: m.index, line: md.slice(0, m.index).split('\n').length });
  return out;
}
// The file a spec block is saved as: "... as `name.sbtel`" in the paragraph just before it.
const savedAs = (md, b) => { const para = md.slice(0, b.at).trimEnd().split(/\n\s*\n/).pop(); const m = /\bas `([^`\s]+\.sbtel)`/.exec(para); return m ? m[1] : null; };
const isSpec = (md, b) => b.info === 'sbtel' || b.info === 'sbtel fails' || (b.info === 'lisp' && !!savedAs(md, b));

let bad = 0, n = 0;
for (const f of files) {
  const md = readFileSync(f, 'utf8'), fs = fences(md), name = relative(root, f) || f, reps = [];
  const defined = {}; let last = null;
  const want = (b, text) => { if (b.body !== text) reps.push({ at: b.at, old: '```' + b.info + '\n' + b.body + '```', neu: '```' + b.info + '\n' + text + '```' }); return b.body === text; };
  for (let i = 0; i < fs.length; i++) {
    const b = fs[i], next = fs[i + 1], where = `${name}:${b.line}`;
    const fail = msg => { bad++; console.log(`FAIL ${where}: ${msg}`); };
    if (isSpec(md, b)) {
      n++; last = b.body; const as = savedAs(md, b); if (as) defined[as] = b.body;
      const r = lint(b.body), fails = b.info === 'sbtel fails';
      if (!fails && r.code !== 0) fail('expected to lint clean, got:\n' + r.out + r.err);
      if (fails && r.code === 0) fail('expected problems, got clean');
      if (fails && (!next || next.info !== 'text')) fail('no ```text block after it');
      else if (next && next.info === 'text' && (fails || next.body.startsWith('spec.sbtel')) && !want(next, r.out)) fail('lint output differs:\n--- binary\n' + r.out + '--- doc\n' + next.body);
    } else if (/^text query\s/.test(b.info)) {
      n++; if (last == null) { fail('query with no spec before it'); continue; }
      const q = query(last, b.info.slice('text query'.length).trim().split(/\s+/));
      if (!want(b, q.out)) fail('query output differs:\n--- binary\n' + q.out + '--- doc\n' + b.body);
      if (q.code === 0 && lint(q.out).code !== 0) fail('query output does not lint clean:\n' + lint(q.out).out);
    } else if (b.info === 'edges') {
      n++; if (last == null) { fail('edges with no spec before them'); continue; }
      const r = check(last, b.body);
      if (next && next.info === 'text') { if (!want(next, r.out)) fail('check output differs:\n--- binary\n' + r.out + '--- doc\n' + next.body); }
      else console.log(`note ${where}: edges block without output`);
    } else if (b.info === 'console') {
      const lines = b.body.split('\n'); lines.pop();
      for (let k = 0; k < lines.length; k++) {
        const m = /^\$ (.*)$/.exec(lines[k]); if (!m) continue;
        let j = k + 1; while (j < lines.length && !lines[j].startsWith('$ ')) j++;
        const shown = lines.slice(k + 1, j).map(l => l + '\n').join(''), words = m[1].replace(/\s+#.*$/, '').trim().split(/\s+/);
        if (words[0] === 'cat' && words.length === 2) defined[words[1]] = shown;
        else if (words[0] === 'sbtel' && ['lint', 'check', 'query', 'diff'].includes(words[1])) {
          n++; const r = sb(words.slice(1), defined), got = r.out + r.err;
          if (got !== shown) fail(`\`${m[1]}\` prints something else:\n--- binary\n${got}--- doc\n${shown}`);
        }
        k = j - 1;
      }
    }
  }
  if (fill && reps.length) {
    let out = md; for (const r of reps.sort((a, b) => b.at - a.at)) { const k = out.indexOf(r.old, r.at); if (k >= 0) out = out.slice(0, k) + r.neu + out.slice(k + r.old.length); }
    writeFileSync(f, out); console.log(`filled ${reps.length} block(s) in ${name}`);
  }
}
console.log(`docs snippets: ${n} checked in ${files.length} file${files.length === 1 ? '' : 's'}, ${bad} failure${bad === 1 ? '' : 's'}`);
process.exit(bad && !fill ? 1 : 0);
