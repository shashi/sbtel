#!/usr/bin/env node
// Builds the generated parts of the sbtel site from a checkout of the sbtel repository:
//
//   node build.mjs [path/to/sbtel]        (or $SBTEL_REPO; default ../sbtel, then ..)
//
// 1. play/index.html: the repository's viewer/dist/index.html, with one line inserted after its viewport
//    meta: <meta name="sbtel-home" content="../">, so the playground's "sbtel" chip links to this site's
//    home (README "Embedding the viewer", DESIGN 6.9). Nothing else in the viewer changes.
// 2. docs/reference/index.html: docs/LANGUAGE.md rendered, so the reference stays single-sourced.
// 3. The three documents, from src/: docs/index.html (Core concepts, src/concepts.html), docs/language/
//    (The sbtel language, src/language.html) and docs/using/ (Using sbtel, src/using.html). In those, <sbtel-demo example="name" height="360" [mode="readonly"] [layout="side"]
//    [spec="hide"] [label="Before"]>hint</sbtel-demo> becomes a live embed of play/examples/name.sbtel, and
//    <sbtel-spec example="name"></sbtel-spec> its text, so a shown spec is always the embedded one.
//    <sbtel-code file="path" [label="…"] [lang="edges|sbtel|text"] [fails="1"]></sbtel-code> shows a site file
//    verbatim: edges files, failing specs and command outputs (src/out/; they are real outputs of the binary).
//    Each embed starts at the aspect ratio of its diagram, measured here by running the repository's core
//    layout (core/core.js, contentBox) in node with an approximate text measurer, so the page hardly moves
//    when the viewer reports its real size (sbtel:size; assets/docs.js sets the height). height="…" is the
//    fallback when the core cannot be run. View parameters pass through to the viewer's URL (VIEW, below):
//    focus="Block" adds &focus=Block (the viewer fits that block and opens its parents). label="…" puts a
//    small label over the frame. A <div class="demo-pair"> holding two demos sets them side by side (a
//    before and an after), stacked on narrow screens; their starting size is measured at the half width.
//    The pages take their <title> ("Core concepts · sbtel") and meta description from the source's
//    <!-- title: … --> and <!-- description: … --> comments.
//
// Node 18 or later; no dependencies. The markdown reader covers what LANGUAGE.md uses: headings, paragraphs,
// lists, tables, fenced code, rules, and inline code, links, bold and italics.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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
  write('play/index.html', /^<meta name="sbtel-home"/m.test(viewer) ? viewer : viewer.replace(vp, m => m + '<meta name="sbtel-home" content="../">\n<meta name="sbtel-example" content="notes-tour">\n<meta name="sbtel-example-open" content="Store">\n'));
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
const FORMS = 'block|level|adjacent|takes|gives|shape|port|message|refines|carries|behavior|implements|sketch';
const TOK = new RegExp('(;[^\\n]*)|("(?:\\\\.|[^"\\\\])*")|\\((~+)([\\s\\S]*?)\\3\\)|\\((' + FORMS + ')(?=[\\s()])|(:[^\\s()"]+)', 'g');
function hlSbtel(src) {
  let out = '', last = 0;
  src.replace(TOK, (m, com, str, tl, tx, form, kw, at) => {
    out += esc(src.slice(last, at)); last = at + m.length;
    if (com) out += `<span class="hl-com">${esc(com)}</span>`;
    else if (str) out += `<span class="hl-str">${esc(str)}</span>`;
    else if (tl) out += `(<span class="hl-kw">${tl}</span><span class="hl-str">${esc(tx)}</span><span class="hl-kw">${tl}</span>)`;
    else if (form) out += `(<span class="hl-kw">${form}</span>`;
    else if (kw) out += `<span class="hl-key">${esc(kw)}</span>`;
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
  .replace(/^\$ /gm, '<span class="hl-prompt">$ </span>')
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
// The reference is generated and complete, but it is not one of the three documents: it is linked from the footer.
const NAV = [['Docs', 'docs/'], ['Language', 'docs/language/'], ['Using sbtel', 'docs/using/'], ['Playground', 'play/']];
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
<title>${esc(title)} · sbtel</title>
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
      <a href="${up}docs/">Core concepts</a>
      <a href="${up}docs/language/">Language</a>
      <a href="${up}docs/using/">Using sbtel</a>
      <a href="${up}play/">Playground</a>
      <a href="${up}docs/reference/">Reference</a>
      <a href="https://github.com/shashi/sbtel">GitHub</a>
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
  const body = r.html + `\n    <p class="src">This page is generated from <a href="${REPO}docs/LANGUAGE.md">docs/LANGUAGE.md</a>. For the ideas, with live examples, read <a href="../">Core concepts</a>; for a shorter tour of the forms, <a href="../language/">The sbtel language</a>.</p>`;
  write('docs/reference/index.html', page({ path: 'docs/reference/index.html', title: 'Language reference', kind: 'ref',
    desc: 'The sbtel language reference: every form, every rule and every lint and check message.', toc: r.toc, body, source: 'docs/LANGUAGE.md' }));
}

// ---------- the natural size of an embed ----------
// The viewer's embed mode (viewer/src/play.js) at a desktop docs column (about 780 px): layout width 980
// (1.25 x the frame); on a phone (a frame under 450 px) the layout's least width, 560. Each with
// the file's top-level blocks open, the box from contentBox with 12 px around it and 52 px for the dock.
// Text is measured approximately (an average glyph width per font size), which is close enough for a
// starting height; the viewer's own report replaces it.
const core = (() => {
  const f = join(repo, 'core/core.js');
  if (!existsSync(f)) return null;
  try {
    const api = vm.runInContext(read(f) + '\n;({ parse, layout, topBlocks, contentBox: typeof contentBox === "function" ? contentBox : null })', vm.createContext(Object.create(null)), { filename: 'core.js' });
    return api.contentBox ? api : null;
  } catch (e) { console.error('build.mjs: core/core.js does not run in node (' + e.message + '); embeds use their height'); return null; }
})();
const M = {
  em: f => { const px = +((/([\d.]+)px/.exec(f) || [])[1] || 14); return px * (/Mono/.test(f) ? .6 : .52); },
  tw: (t, f) => t.length * M.em(f),
  wrap(text, f, width) {
    if (text.includes('\n\n')) { const ps = text.split('\n\n').map(p => M.wrap(p, f, width)).filter(Boolean); return ps.length ? ps.reduce((a, b) => a + b, 0) + ps.length - 1 : 0; }
    const words = text.split(/\s+/).filter(Boolean); if (!words.length) return 0;
    const sp = M.em(f); let lines = 1, cur = 0;
    for (const w of words) { const ww = M.tw(w, f); if (!cur) cur = ww; else if (cur + sp + ww <= width) cur += sp + ww; else { lines++; cur = ww; } }
    return lines;
  },
};
function naturalSize(text, { readonly, focus }, width) {
  if (!core) return null;
  try {
    const model = core.parse(text), open = new Set(core.topBlocks(model).map(b => b.id));
    const n = focus ? model.node(focus) || model.blocks.find(b => b.name === focus) : null;
    if (n) for (let p = n.parent; p && !p.virtual; p = p.parent) open.add(p.id);
    const lay = core.layout(model, { wrap: 'keep', vlink: 'same', expandWidth: 'fit', childDots: true, width, animate: false, allDetails: false,
      open, drawers: new Map(), expanded: new Set(), details: new Set() }, M);
    const B = core.contentBox(lay, n ? n.id : null, !readonly);
    return B ? { w: Math.ceil(B.w + 24), h: Math.ceil(B.h + 12 + 52) } : null;
  } catch (e) { console.error('build.mjs: could not lay out an example (' + e.message + ')'); return null; }
}

// ---------- 3. the three documents ----------
// The viewer's framing parameters that a demo may set, as attributes of the same name: each becomes
// &name=value on the embed's URL (comma lists stay as written). v0.3.0 has focus; add the framing
// parameters of a later viewer here (several blocks to focus, a highlight to dim the rest, blocks to open
// or close, collapsed declaration bands) and the pages can use them at once.
const VIEW = ['focus'];
function manual(srcFile, path, kind) {
  let src = read(join(here, 'src', srcFile));
  const metas = Object.fromEntries(['title', 'description'].map(k => [k, (src.match(new RegExp(`<!-- ${k}: (.*?) -->`)) || [])[1] || '']));
  const meta = k => metas[k];
  if (!metas.title || !metas.description) { console.error(`build.mjs: src/${srcFile} needs <!-- title: … --> and <!-- description: … -->`); process.exit(1); }
  const up = '../'.repeat(path.split('/').length - 1);
  const ex = name => { const f = join(here, 'play/examples', name + '.sbtel'); if (!existsSync(f)) { console.error('build.mjs: no example ' + name); process.exit(1); } return read(f).replace(/\n+$/, ''); };
  const attrs = a => Object.fromEntries([...a.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const specHTML = name => `<div class="spec"><div class="cbl">${esc(name)}.sbtel</div><pre class="code" data-lang="sbtel">${hlSbtel(ex(name))}</pre></div>`;
  src = src.replace(/<sbtel-spec ([^>]*)><\/sbtel-spec>/g, (_, a) => specHTML(attrs(a).example));
  src = src.replace(/<sbtel-code ([^>]*)><\/sbtel-code>/g, (_, a) => {
    const o = attrs(a), text = read(join(here, o.file)).replace(/\n+$/, '');
    const h = o.lang === 'edges' ? hlHash(text) : o.lang === 'sbtel' ? hlSbtel(text) : hlText(text);
    return `<div class="spec${o.fails ? ' fails' : ''}"><div class="cbl">${esc(o.label || basename(o.file))}</div><pre class="code" data-lang="${esc(o.lang || 'text')}">${h}</pre></div>`;
  });
  // Demos inside a <div class="demo-pair"> are half as wide on a desktop: mark them before they are expanded.
  src = src.replace(/<div class="demo-pair">([\s\S]*?)<\/div>/g, (m, inner) => m.replace(/<sbtel-demo /g, '<sbtel-demo half="1" '));
  const ids = new Map(); // one figure id per demo: demo-name, then demo-name-2 for a second demo of it
  src = src.replace(/<sbtel-demo ([^>]*)>([\s\S]*?)<\/sbtel-demo>/g, (_, a, hint) => {
    const o = attrs(a), name = o.example, h = +(o.height || 360);
    const how = { readonly: o.mode === 'readonly', focus: o.focus };
    // The viewer's layout width is 1.25 x its frame (viewer/src/play.js), 560 at least: a desktop column
    // (about 780 px) gives 980, half of it (a demo in a pair) 560, as a phone does.
    const nat = naturalSize(ex(name), how, o.half ? 560 : 980), natp = nat && naturalSize(ex(name), how, 560);
    const q = (o.mode === 'readonly' ? '?embed=readonly' : '?embed') + VIEW.filter(k => o[k]).map(k => '&' + k + '=' + encodeURIComponent(o[k])).join('');
    const url = `${up}play/${q}#example=${name}`, open = `${up}play/#example=${name}`;
    // Same rule as assets/docs.js, without the window: room for 60% zoom up to 820 px, else 720 px at most.
    const hmax = nat && Math.max(720, Math.min(820, Math.round(.6 * (nat.h - 64) + 64)));
    const embed = `<div class="embed${nat ? ' ar' : ''}" style="--h:${h}px${nat ? `;--ar:${nat.w}/${nat.h};--nh:${nat.h}px;--hmax:${hmax}px` : ''}${natp ? `;--arp:${natp.w}/${natp.h};--nhp:${natp.h}px` : ''}">
      <iframe data-src="${url}" title="Live diagram of ${esc(name)}.sbtel${o.mode === 'readonly' ? ' (view only)' : ''}" loading="lazy" hidden></iframe>
      <button type="button" class="poster" data-load><span>Load the live diagram</span></button>
      <noscript><a class="poster" href="${open}">Open ${esc(name)}.sbtel in the playground</a></noscript>
    </div>`;
    const cap = hint.trim() ? `<figcaption>${hint.trim()}</figcaption>` : '';
    const label = o.label ? `<div class="cbl demo-label">${esc(o.label)}</div>` : '';
    const spec = o.spec === 'hide' ? '' : specHTML(name);
    const k = (ids.get(name) || 0) + 1; ids.set(name, k);
    return `<figure class="demo${o.layout === 'side' ? ' side' : ''}" id="demo-${name}${k > 1 ? '-' + k : ''}">
    ${o.layout === 'side' ? spec + '<div class="live">' + label + embed + cap + '</div>' : label + embed + cap + spec}
  </figure>`;
  });
  const toc = [...src.matchAll(/<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].map(m => ({ n: +m[1], id: m[2], html: m[3].replace(/<a [^>]*>|<\/a>/g, '') }));
  src = src.replace(/<h([23]) id="([^"]+)">/g, (_, n, id) => `<h${n} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>`);
  src = src.replace(/<!-- (title|description): .*? -->\n?/g, '');
  write(path, page({ path, title: meta('title'), desc: meta('description'), toc, body: src.trim(), source: 'src/' + srcFile, kind }));
}
manual('concepts.html', 'docs/index.html', 'guide concepts');
manual('language.html', 'docs/language/index.html', 'guide language');
manual('using.html', 'docs/using/index.html', 'guide using');
