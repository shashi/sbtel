#!/usr/bin/env node
// Builds the generated parts of the sbtel site from a checkout of the sbtel repository:
//
//   node build.mjs [path/to/sbtel]        (or $SBTEL_REPO; default ../sbtel, then ..)
//
// 1. play/index.html: the repository's viewer/dist/index.html, with one line inserted after its viewport
//    meta: <meta name="sbtel-home" content="../">, so the playground's "sbtel" chip links to this site's
//    home (README "Embedding the viewer", DESIGN 6.9). Nothing else in the viewer changes.
// 2. docs/reference/index.html: docs/LANGUAGE.md rendered, so the reference stays single-sourced.
// 3. docs/index.html (the Guide) and docs/viewer/index.html (the Viewer manual), from src/guide.html and
//    src/viewer.html. In those, <sbtel-demo example="name" height="360" [mode="readonly"] [layout="side"]
//    [spec="hide"]>hint</sbtel-demo> becomes a live embed of play/examples/name.sbtel, and
//    <sbtel-spec example="name"></sbtel-spec> its text, so a shown spec is always the embedded one.
//    <sbtel-code file="path">…</sbtel-code> shows a site file verbatim (edges files, outputs).
//
// Node 18 or later; no dependencies. The markdown reader covers what LANGUAGE.md uses: headings, paragraphs,
// lists, tables, fenced code, rules, and inline code, links, bold and italics.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let arg = process.argv[2] || process.env.SBTEL_REPO;
if (arg && arg.endsWith('.md')) arg = resolve(dirname(arg), '..'); // the old form: path/to/docs/LANGUAGE.md
const repo = [arg, join(here, '../sbtel'), join(here, '..')].filter(Boolean).find(p => existsSync(join(p, 'docs/LANGUAGE.md')));
if (!repo) { console.error('build.mjs: no sbtel checkout found; pass its path: node build.mjs path/to/sbtel'); process.exit(2); }
const read = p => readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
const write = (p, s) => { mkdirSync(dirname(join(here, p)), { recursive: true }); writeFileSync(join(here, p), s); console.log('build.mjs: wrote ' + p); };
const verFile = join(repo, 'VERSION');
const version = existsSync(verFile) ? read(verFile).trim() : '';
const REPO = 'https://github.com/shashi/sbtel/blob/main/';

// ---------- 1. the playground ----------
{
  const viewer = read(join(repo, 'viewer/dist/index.html'));
  const vp = /<meta name="viewport"[^>]*>\n/;
  if (!vp.test(viewer)) { console.error('build.mjs: the viewer has no viewport meta to insert the home link after'); process.exit(1); }
  write('play/index.html', viewer.includes('name="sbtel-home"') ? viewer : viewer.replace(vp, m => m + '<meta name="sbtel-home" content="../">\n'));
}

// ---------- inline ----------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function href(u) {
  if (/^(https?:|mailto:|#)/.test(u)) return u;
  const [path, frag] = u.split('#');
  const abs = resolve('/docs', path).slice(1); // relative to docs/ in the repository
  return REPO + abs + (frag ? '#' + frag : '');
}
function inline(t) {
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = esc(t);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, u) => `<a href="${esc(href(u.replace(/&amp;/g, '&')))}">${txt}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}
const plain = t => t.replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*+/g, '');
const slugs = new Map();
function slug(t) {
  let s = plain(t).toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
  const n = slugs.get(s) || 0; slugs.set(s, n + 1);
  return n ? `${s}-${n}` : s;
}

// ---------- code ----------
const FORMS = 'block|level|adjacent|port|message|refines|carries|behavior|implements|sketch';
const TOK = new RegExp('(;[^\\n]*)|("(?:\\\\.|[^"\\\\])*")|\\((~+)([\\s\\S]*?)\\3\\)|\\((' + FORMS + ')(?=[\\s()])|(:[^\\s()"]+)|\\b(in|out)\\b', 'g');
function hlSbtel(src) {
  let out = '', last = 0;
  src.replace(TOK, (m, com, str, tl, tx, form, kw, dir, at) => {
    out += esc(src.slice(last, at)); last = at + m.length;
    if (com) out += `<span class="hl-com">${esc(com)}</span>`;
    else if (str) out += `<span class="hl-str">${esc(str)}</span>`;
    else if (tl) out += `(<span class="hl-kw">${tl}</span><span class="hl-str">${esc(tx)}</span><span class="hl-kw">${tl}</span>)`;
    else if (form) out += `(<span class="hl-kw">${form}</span>`;
    else if (kw) out += `<span class="hl-key">${esc(kw)}</span>`;
    else if (dir) out += `<span class="hl-key">${dir}</span>`;
    return m;
  });
  return out + esc(src.slice(last));
}
const hlHash = src => src.split('\n').map(l => {
  const i = l.search(/(^|\s)#/);
  return i < 0 ? esc(l) : esc(l.slice(0, i)) + `<span class="hl-com">${esc(l.slice(i))}</span>`;
}).join('\n');
const hlSlash = src => src.split('\n').map(l => {
  const i = l.indexOf('//');
  return i < 0 ? esc(l) : esc(l.slice(0, i)) + `<span class="hl-com">${esc(l.slice(i))}</span>`;
}).join('\n');
const hlText = src => esc(src)
  .replace(/\b(error|warning)(?=:)/g, '<span class="hl-warn">$1</span>')
  .replace(/\b(info)(?=:)/g, '<span class="hl-com">$1</span>')
  .replace(/: (upward|same-level|ancestor|unknown)(?=:)/g, ': <span class="hl-warn">$1</span>')
  .replace(/: ok \(/g, ': <span class="hl-ok">ok</span> (');
function codeBlock(info, body) {
  const [lang = '', ...rest] = info.trim().split(/\s+/);
  const fails = rest.includes('fails');
  // Edge lines (Caller -> Callee  # where) are fenced as lisp in places; they take # comments.
  const edges = lang === 'edges' || (lang === 'lisp' && /^\s*[^\s(;]+\s*->/m.test(body));
  const h = edges ? hlHash(body)
    : lang === 'sbtel' || lang === 'lisp' ? hlSbtel(body)
    : lang === 'python' ? hlHash(body)
    : lang === 'js' || lang === 'go' ? hlSlash(body)
    : lang === 'text' ? hlText(body) : esc(body);
  const label = fails ? 'lint reports problems' : lang === 'edges' ? 'edges.txt' : lang === 'text' ? 'output' : '';
  return `<div class="cb${fails ? ' fails' : ''}">${label ? `<div class="cbl">${label}</div>` : ''}<pre class="code" data-lang="${esc(lang)}">${h}</pre></div>`;
}


// ---------- blocks ----------
function markdown(md) {
  slugs.clear();
  const lines = md.split('\n');
  const out = [], toc = [];
  let title = '';
  const isList = l => /^\s*(?:[-*]|\d+\.)\s+/.test(l);
  const isTable = (l, n) => /^\s*\|/.test(l) && n !== undefined && /^\s*\|?\s*:?-{3,}/.test(n);
  const cells = r => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^```(.*)$/))) {
      const body = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; out.push(codeBlock(m[1], body.join('\n'))); continue;
    }
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
      const n = m[1].length, txt = m[2]; i++;
      if (n === 1) { title = plain(txt); out.push(`<h1>${inline(txt)}</h1>`); continue; }
      const id = slug(txt);
      if (n <= 3) toc.push({ n, id, html: inline(txt) });
      out.push(`<h${n} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inline(txt)}</h${n}>`);
      continue;
    }
    if (/^-{3,}\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (isTable(l, lines[i + 1])) {
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="tbl"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
        rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>');
      continue;
    }
    if (isList(l)) {
      const ordered = /^\s*\d+\./.test(l), items = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (isList(cur) && /^\s*\d+\./.test(cur) === ordered) { items.push(cur.replace(/^\s*(?:[-*]|\d+\.)\s+/, '')); i++; }
        else if (cur.trim() && /^\s+/.test(cur) && items.length) { items[items.length - 1] += ' ' + cur.trim(); i++; }
        else if (!cur.trim() && i + 1 < lines.length && isList(lines[i + 1]) && /^\s*\d+\./.test(lines[i + 1]) === ordered) i++;
        else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      // The page's own contents list duplicates the sidebar; keep it, marked, for narrow screens.
      const local = !ordered && items.every(it => /^\[[^\]]+\]\(#/.test(it));
      out.push(`<${tag}${local ? ' class="inpage"' : ''}>${items.map(it => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|-{3,}\s*$)/.test(lines[i]) && !isList(lines[i]) && !isTable(lines[i], lines[i + 1])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return { title, html: out.join('\n'), toc };
}

// ---------- the page frame ----------
const MARK = `<svg viewBox="0 0 26 26" aria-hidden="true"><path d="M2 12a4 4 0 0 1 4-4h3V5.5A3.5 3.5 0 0 1 12.5 2h1A3.5 3.5 0 0 1 17 5.5V8h3a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="var(--leaf)" stroke="var(--frame-line)" stroke-width="1.5"/><circle cx="11.2" cy="5.6" r="1.35" fill="var(--m3)"/><circle cx="14.8" cy="5.6" r="1.35" fill="var(--m6)"/><path d="M6.5 16h13" stroke="var(--frame-line)" stroke-width="1.2" opacity=".7"/></svg>`;
const NAV = [['Guide', 'docs/'], ['Viewer', 'docs/viewer/'], ['Reference', 'docs/reference/'], ['Playground', 'play/']];
function page({ path, title, desc, toc, body, source, kind }) {
  const up = '../'.repeat(path.split('/').length - 1);
  const here = path.replace(/index\.html$/, '');
  const nav = NAV.map(([n, h]) => `<a href="${up}${h}"${h === here ? ' aria-current="page"' : ''}>${n}</a>`).join('\n    ');
  const tocHTML = '<ol>' + toc.map(t => `<li class="t${t.n}"><a href="#${t.id}">${t.html}</a></li>`).join('') + '</ol>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}: sbtel</title>
<meta name="description" content="${esc(desc)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${up}assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${up}assets/fonts/hanken-grotesk-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${up}assets/site.css">
<link rel="stylesheet" href="${up}assets/docs.css">
</head>
<body class="${kind}">
<!-- Generated by build.mjs from ${source}${version ? ` (sbtel ${esc(version)})` : ''}. Edit that, not this file. -->
<a class="skip" href="#doc">Skip to content</a>
<div class="wrap">
<header class="top">
  <a class="mark" href="${up}" aria-label="sbtel home">${MARK}sbtel</a>
  <nav aria-label="Site">
    ${nav}
    <a href="https://github.com/shashi/sbtel">GitHub</a>
  </nav>
</header>
<div class="docs">
  <aside class="toc" aria-label="On this page">
    <details open id="tocd"><summary>On this page${version ? ` <span class="ver">sbtel ${esc(version)}</span>` : ''}</summary>
    <nav>${tocHTML}</nav></details>
  </aside>
  <article id="doc" class="doc">
${body}
  </article>
</div>
<footer class="foot">
  <div class="cols">
    <a class="mark" href="${up}" aria-label="sbtel home">${MARK}sbtel</a>
    <nav class="links" aria-label="Footer">
      <a href="https://github.com/shashi/sbtel">GitHub</a>
      <a href="${up}docs/">Guide</a>
      <a href="${up}docs/viewer/">Viewer</a>
      <a href="${up}docs/reference/">Reference</a>
      <a href="${up}play/">Playground</a>
      <a href="https://github.com/shashi/sbtel/blob/main/CHANGELOG.md">Changelog</a>
    </nav>
  </div>
  <p class="wink">The name means &ldquo;slightly better than the English language&rdquo;. Or, recursively: sbtel is Better Than English Language.</p>
  <p>MIT licensed. Set in Hanken Grotesk and JetBrains Mono, under the <a href="${up}assets/fonts/hanken-grotesk-OFL.txt">SIL Open Font License</a> (<a href="${up}assets/fonts/jetbrains-mono-OFL.txt">JetBrains Mono</a>).</p>
</footer>
</div>
<script src="${up}assets/docs.js" defer></script>
</body>
</html>
`;
}

// ---------- 2. the reference ----------
{
  const r = markdown(read(join(repo, 'docs/LANGUAGE.md')));
  const body = r.html + `\n    <p class="src">This page is generated from <a href="${REPO}docs/LANGUAGE.md">docs/LANGUAGE.md</a>. For the ideas, with live examples, read <a href="../">the Guide</a>.</p>`;
  write('docs/reference/index.html', page({ path: 'docs/reference/index.html', title: 'Language reference', kind: 'ref',
    desc: 'The sbtel language reference: every form, every rule and every lint and check message.', toc: r.toc, body, source: 'docs/LANGUAGE.md' }));
}

// ---------- 3. the Guide and the Viewer manual ----------
function manual(srcFile, path, kind) {
  let src = read(join(here, 'src', srcFile));
  const meta = k => (src.match(new RegExp(`<!-- ${k}: (.*?) -->`)) || [])[1] || '';
  const up = '../'.repeat(path.split('/').length - 1);
  const ex = name => { const f = join(here, 'play/examples', name + '.sbtel'); if (!existsSync(f)) { console.error('build.mjs: no example ' + name); process.exit(1); } return read(f).replace(/\n+$/, ''); };
  const attrs = a => Object.fromEntries([...a.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const specHTML = name => `<div class="spec"><div class="cbl">${esc(name)}.sbtel</div><pre class="code" data-lang="sbtel">${hlSbtel(ex(name))}</pre></div>`;
  src = src.replace(/<sbtel-spec ([^>]*)><\/sbtel-spec>/g, (_, a) => specHTML(attrs(a).example));
  src = src.replace(/<sbtel-code ([^>]*)><\/sbtel-code>/g, (_, a) => {
    const o = attrs(a), text = read(join(here, o.file)).replace(/\n+$/, '');
    return `<div class="spec"><div class="cbl">${esc(o.label || basename(o.file))}</div><pre class="code" data-lang="${esc(o.lang || 'text')}">${o.lang === 'edges' ? hlHash(text) : hlText(text)}</pre></div>`;
  });
  src = src.replace(/<sbtel-demo ([^>]*)>([\s\S]*?)<\/sbtel-demo>/g, (_, a, hint) => {
    const o = attrs(a), name = o.example, h = +(o.height || 360);
    ex(name); // must exist
    const q = o.mode === 'readonly' ? '?embed=readonly' : '?embed';
    const url = `${up}play/${q}#example=${name}`, open = `${up}play/#example=${name}`;
    const embed = `<div class="embed" style="--h:${h}px">
      <iframe data-src="${url}" title="Live diagram of ${esc(name)}.sbtel${o.mode === 'readonly' ? ' (view only)' : ''}" loading="lazy" hidden></iframe>
      <button type="button" class="poster" data-load><span>Load the live diagram</span></button>
      <noscript><a class="poster" href="${open}">Open ${esc(name)}.sbtel in the playground</a></noscript>
    </div>`;
    const cap = hint.trim() ? `<figcaption>${hint.trim()}</figcaption>` : '';
    const spec = o.spec === 'hide' ? '' : specHTML(name);
    return `<figure class="demo${o.layout === 'side' ? ' side' : ''}" id="demo-${name}">
    ${o.layout === 'side' ? spec + '<div class="live">' + embed + cap + '</div>' : embed + cap + spec}
  </figure>`;
  });
  const toc = [...src.matchAll(/<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].map(m => ({ n: +m[1], id: m[2], html: m[3].replace(/<a [^>]*>|<\/a>/g, '') }));
  src = src.replace(/<h([23]) id="([^"]+)">/g, (_, n, id) => `<h${n} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>`);
  src = src.replace(/<!-- (title|description): .*? -->\n?/g, '');
  write(path, page({ path, title: meta('title'), desc: meta('description'), toc, body: src.trim(), source: 'src/' + srcFile, kind }));
}
manual('guide.html', 'docs/index.html', 'guide');
manual('viewer.html', 'docs/viewer/index.html', 'manual');
