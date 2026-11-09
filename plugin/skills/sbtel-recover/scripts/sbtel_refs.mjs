#!/usr/bin/env node
// Optional helper for the sbtel-recover skill: symbol references in JavaScript and TypeScript, resolved
// by the TypeScript checker. Use it if Node (>= 18) and the `typescript` package are available. It is
// meant for code where an import graph says little or nothing: one global script, files concatenated
// by a build step, inline <script> in HTML. It works for ES modules and CommonJS as well.
//
//   node sbtel_refs.mjs [options] FILE...
//   node sbtel_refs.mjs [options] -p tsconfig.json          (the project's files and compiler options)
//
// Prints one line per reference that crosses a unit:  from_file:line to_file:line<TAB>name
// which is the input sbtel_owners.py --edges reads. Paths are printed as given (or relative to the
// current directory, for -p), so pass the same paths to sbtel_owners.py.
//
// A unit is a top-level statement of a file, or a statement directly inside a top-level immediately
// invoked function (`(() => { ... })()`, `(function () { ... })()`), so module-pattern code gets
// one unit per inner declaration. A reference counts when the declaration it resolves to is in another
// unit or another file. Also printed: each import or require of a project file (from the module
// specifier's line to line 1 of the file it resolves to).
//
// Options:
//   --typescript DIR   where the typescript package is (default: $SBTEL_TYPESCRIPT, then resolved from
//                      the current directory, then from this script, then `npm root -g`)
//   --no-props         skip property names (obj.prop): count only plain identifiers
//   --units            print unit-to-unit pairs instead (from_file:line to_file:line, the first line of
//                      each unit, once per pair): the declaration graph, for sbtel_sccs.py
//   -p FILE            a tsconfig.json or jsconfig.json; its files are added to FILE...
//
// Files: .js .mjs .cjs .jsx .ts .mts .cts .tsx, and .html/.htm (inline <script> elements without src;
// everything else on the page is blanked, so lines and columns stay as they are). A JS file with no
// import or export is a global script: its top-level names are visible to every other global script,
// which is how concatenated code behaves. What it cannot see: string-keyed dispatch (obj[name](),
// registries, event names), DOM ids and CSS classes, and calls made through untyped values (a JS
// parameter has no type, so `p.run()` resolves to nothing). Find those by reading the code.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = { props: true, units: false, ts: process.env.SBTEL_TYPESCRIPT || '', project: '' };
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--typescript') opt.ts = argv[++i];
  else if (a === '--no-props') opt.props = false;
  else if (a === '--units') opt.units = true;
  else if (a === '-p' || a === '--project') opt.project = argv[++i];
  else if (a === '-h' || a === '--help') { usage(0); }
  else if (a.startsWith('-')) { console.error('sbtel_refs: unknown option ' + a); usage(2); }
  else files.push(a);
}
function usage(code) {
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1), head = [];
  for (const l of lines) { if (!l.startsWith('//')) break; head.push(l.slice(3)); }
  const text = head.join('\n');
  (code ? console.error : console.log)(text); process.exit(code);
}
if (!files.length && !opt.project) usage(2);

function loadTS() {
  const tries = [];
  if (opt.ts) tries.push(() => createRequire(join(resolve(opt.ts), 'package.json'))(resolve(opt.ts)));
  tries.push(() => createRequire(join(process.cwd(), 'noop.js'))('typescript'));
  tries.push(() => createRequire(import.meta.url)('typescript'));
  tries.push(() => { const g = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); return createRequire(join(g, 'noop.js'))(join(g, 'typescript')); });
  for (const t of tries) { try { const ts = t(); if (ts && ts.createProgram) return ts; } catch (e) { /* next */ } }
  console.error('sbtel_refs: the typescript package was not found (pass --typescript DIR, set SBTEL_TYPESCRIPT, or install it where node can find it)');
  process.exit(2);
}
const ts = loadTS();

// ---------- the program ----------
const options = { allowJs: true, checkJs: false, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], skipLibCheck: true, jsx: ts.JsxEmit.Preserve };
if (opt.project) {
  const cfg = ts.getParsedCommandLineOfConfigFile(resolve(opt.project), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); process.exit(2); } });
  Object.assign(options, cfg.options, { noEmit: true, allowJs: true });
  cfg.fileNames.forEach(f => files.push(relative(process.cwd(), f)));
}
// Real path -> { shown: the path as printed, text }. HTML pages are presented to TypeScript as .js.
const virt = new Map(), shownOf = new Map();
const isHTML = f => /\.html?$/i.test(f);
function blankOutsideScripts(text) {
  let out = '', at = 0;
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const blank = s => s.replace(/[^\n]/g, ' ');
  for (let m; (m = re.exec(text));) {
    const attrs = m[1], start = m.index + m[0].indexOf('>') + 1, body = m[2];
    const js = !/\bsrc\s*=/i.test(attrs) && (!/\btype\s*=/i.test(attrs) || /\btype\s*=\s*["']?(module|text\/javascript|application\/javascript)/i.test(attrs));
    out += blank(text.slice(at, start)) + (js ? body : blank(body));
    at = start + body.length;
  }
  return out + blank(text.slice(at));
}
for (const f of [...new Set(files)]) {
  const real = resolve(f);
  if (!existsSync(real)) { console.error('sbtel_refs: no such file: ' + f); process.exit(2); }
  const raw = readFileSync(real, 'utf8');
  const name = isHTML(f) ? real + '.js' : real;
  virt.set(name, isHTML(f) ? blankOutsideScripts(raw) : raw);
  shownOf.set(name, f);
}
const host = ts.createCompilerHost(options, true);
const base = { getSourceFile: host.getSourceFile, fileExists: host.fileExists, readFile: host.readFile };
host.getSourceFile = (n, v, onErr, create) => virt.has(resolve(n)) ? ts.createSourceFile(n, virt.get(resolve(n)), v, true) : base.getSourceFile.call(host, n, v, onErr, create);
host.fileExists = n => virt.has(resolve(n)) || base.fileExists.call(host, n);
host.readFile = n => virt.has(resolve(n)) ? virt.get(resolve(n)) : base.readFile.call(host, n);
const prog = ts.createProgram([...virt.keys()], options, host);
const tc = prog.getTypeChecker();

// ---------- units ----------
const isIIFE = fn => {
  let p = fn.parent; while (p && ts.isParenthesizedExpression(p)) p = p.parent;
  if (p && ts.isCallExpression(p)) { let e = p.expression; while (ts.isParenthesizedExpression(e)) e = e.expression; return e === fn || (ts.isPropertyAccessExpression(e) && e.expression && unparen(e.expression) === fn); } // fn() or fn.call()
  return false;
};
const unparen = e => { while (e && ts.isParenthesizedExpression(e)) e = e.expression; return e; };
// The top-level statement holding n, or the statement directly inside a top-level IIFE body.
function unitOf(n) {
  if (ts.isSourceFile(n)) return n;
  let top = n; while (top.parent && !ts.isSourceFile(top.parent)) top = top.parent;
  let unit = top;
  // Walk down from the top-level statement: a top-level IIFE's body statements are units of their own.
  for (let x = n; x && x !== top; x = x.parent) {
    if (x.parent && ts.isBlock(x.parent) && x.parent.parent && (ts.isArrowFunction(x.parent.parent) || ts.isFunctionExpression(x.parent.parent)) && isIIFE(x.parent.parent)) {
      // Only when no other function lies between that IIFE and the top-level statement.
      let ok = true; for (let y = x.parent.parent.parent; y && y !== top; y = y.parent) if (ts.isFunctionLike(y)) { ok = false; break; }
      if (ok) unit = x;
    }
  }
  return unit;
}

// ---------- references ----------
const out = new Set();
const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
function emit(sf, node, decl, name) {
  const dsf = decl.getSourceFile(); if (!virt.has(resolve(dsf.fileName))) return; // a library, not the project
  if (dsf === sf && unitOf(decl) === unitOf(node)) return;
  const at = (f, n) => ts.isSourceFile(n) ? 1 : lineOf(f, n.getStart(f));
  const from = shownOf.get(resolve(sf.fileName)), to = shownOf.get(resolve(dsf.fileName));
  if (opt.units) out.add(`${from}:${at(sf, unitOf(node))} ${to}:${at(dsf, unitOf(decl))}`);
  else out.add(`${from}:${lineOf(sf, node.getStart(sf))} ${to}:${at(dsf, decl)}\t${name}`);
}
const isModuleSpecifier = n => ts.isStringLiteralLike(n) && n.parent && (
  ((ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent)) && n.parent.moduleSpecifier === n) ||
  (ts.isExternalModuleReference(n.parent)) ||
  (ts.isCallExpression(n.parent) && n.parent.arguments[0] === n && (n.parent.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.parent.expression) && n.parent.expression.text === 'require'))));
for (const sf of prog.getSourceFiles()) {
  if (!virt.has(resolve(sf.fileName))) continue;
  const visit = node => {
    if (isModuleSpecifier(node)) {
      const sym = tc.getSymbolAtLocation(node), d = sym && sym.declarations && sym.declarations[0];
      if (d) emit(sf, node, d.getSourceFile(), node.text);
    } else if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      const p = node.parent;
      const prop = p && ((ts.isPropertyAccessExpression(p) && p.name === node) || (ts.isQualifiedName(p) && p.right === node));
      if (!prop || opt.props) {
        let sym = p && ts.isShorthandPropertyAssignment(p) && p.name === node ? tc.getShorthandAssignmentValueSymbol(p) : tc.getSymbolAtLocation(node);
        // Skip a declaration's own name (function f, const x, a parameter, an import specifier...).
        if (sym && !(sym.declarations || []).some(d => d.name === node)) {
          if (sym.flags & ts.SymbolFlags.Alias) { try { sym = tc.getAliasedSymbol(sym); } catch (e) { /* unresolved */ } }
          const d = sym && sym.declarations && sym.declarations[0];
          if (d) emit(sf, node, d, node.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
process.stdout.write([...out].join('\n') + (out.size ? '\n' : ''));
