#!/usr/bin/env node
// Diff view (viewer/src/diff.js) in headless Chrome, with Playwright (preinstalled; not a repo dependency).
//   node conformance/diff/viewer.test.mjs [--shots <dir>]
// Uses viewer/dist/index.html (run `make viewer` first). Three ways in, as DESIGN.md §6.4 describes:
//   1. the standalone dev hook `?diff` (and `?diff=none`), file://;
//   2. SBTEL.modes.diff.open(data) with the conformance/diff fixture pairs;
//   3. server mode: a stub server serves the page at /s/<id>/diff, diff.json, log, an SSE stream and the
//      comment route, so boot(), the version toast, Reload and comment posting run without B's server.
// Screenshots (deviceScaleFactor 1, light and dark, desktop and phone) go to --shots (default: a temp dir).
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import http from 'node:http';

const { chromium } = createRequire(import.meta.url)('playwright');
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const page = join(root, 'viewer/dist/index.html'), html = readFileSync(page, 'utf8');
const si = process.argv.indexOf('--shots'), shots = si > 0 ? resolve(process.argv[si + 1]) : join(tmpdir(), 'sbtel-diff-shots');
mkdirSync(shots, { recursive: true });
const fx = n => ({ a: { name: n + '-a.sbtel', label: n + '-a.sbtel', src: readFileSync(join(here, n + '-a.sbtel'), 'utf8') }, b: { name: n + '-b.sbtel', label: n + '-b.sbtel', src: readFileSync(join(here, n + '-b.sbtel'), 'utf8') }, version: 1 });

let pass = 0, fail = 0;
const ok = (cond, what, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', what, extra === undefined ? '' : JSON.stringify(extra)); } };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1500, height: 950 }, deviceScaleFactor: 1, colorScheme: opts.scheme || 'light', hasTouch: !!opts.touch, isMobile: !!opts.touch });
  await ctx.addInitScript(() => { try { localStorage.setItem('sbtel-help-seen', 'true'); } catch (e) {} });
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  return p;
}
const settle = p => p.waitForTimeout(450);
const openFx = async (p, name, data) => { await p.evaluate(d => SBTEL.modes.diff.open(d), data || fx(name)); await settle(p); };
const ids = p => p.evaluate(() => state.lay.blocks.map(b => b.id));
const cls = (p, id) => p.evaluate(id => [...(state.elems.get(id)?.classList || [])], id);
async function shot(p, name, focus, k = 1) {
  if (focus) await p.evaluate(([id, k]) => { const B = state.lay.blocks.find(b => b.id === id); const W = innerWidth - (document.getElementById('dSheet').classList.contains('closed') || innerWidth < 1000 ? 0 : 460);
    state.cam = { k, x: W / 2 - (B.x + B.w / 2) * k, y: innerHeight / 2 - (B.y + B.h / 2) * k }; applyCam(); }, [focus, k]);
  await p.waitForTimeout(200);
  await p.screenshot({ path: join(shots, name + '.png') });
}

// ---------- 1. the dev hook: the shell sample pair ----------
{
  const p = await newPage();
  await p.goto('file://' + page + '?diff'); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => SBTEL.mode) === 'diff', 'dev hook switches to diff mode');
  ok(await p.evaluate(() => SBTEL.modes.diff.sample().b) === readFileSync(join(here, 'shell-b.sbtel'), 'utf8'), 'dev sample b equals conformance/diff/shell-b.sbtel');
  ok(await p.evaluate(() => SBTEL.modes.diff.sample().a) === readFileSync(join(here, 'shell-a.sbtel'), 'utf8'), 'dev sample a equals conformance/diff/shell-a.sbtel');
  // Ghosts, strikes, dots, the list.
  ok((await cls(p, '~Shell.Clipboard')).includes('d-ghost') && (await cls(p, '~Shell.Clipboard')).includes('d-rem'), 'removed block is a dashed ghost');
  ok((await cls(p, '~Shell.LowLevelThing')).includes('d-rem'), 'second removed ghost');
  ok((await cls(p, '~>Shell.ScrollAnchor')).includes('d-from'), 'moved block leaves a ghost at its old place');
  ok((await cls(p, 'Shell.ScrollAnchor')).includes('d-mov'), 'moved block is blue');
  ok(await p.evaluate(() => document.querySelectorAll('svg.d-arrows path:not(.head)').length) === 1, 'one move arrow');
  ok((await cls(p, 'Shell.Search')).includes('d-add'), 'added block is green');
  ok(await p.evaluate(() => state.elems.get('Shell.PinnedBanner').querySelector('.ttl s.d-was')?.textContent) === 'Shell.Banner', 'rename strikes the old name');
  ok(await p.evaluate(() => !!state.elems.get('Shell.Composer').querySelector(':scope > .d-dot')), 'changed block has an amber dot');
  ok(await p.evaluate(() => state.elems.get('Shell.Composer').querySelector('.sk ins.d-ins')?.textContent) === 'attachments, mentions', 'sketch word diff: inserted run');
  ok(await p.evaluate(() => state.elems.get('Shell.Composer').querySelector('.sk del.d-del')?.textContent) === 'attachments', 'sketch word diff: deleted run');
  ok(await p.evaluate(() => state.elems.get('Shell.SessionStore').querySelector('.pill.d-was')?.textContent) === 'Store', 'old type pill struck');
  ok(await p.evaluate(() => !!state.elems.get('Shell.Keymap').querySelector('.badge.d-badd[data-beh="Durable"]')), 'added behavior badge marked');
  ok(await p.evaluate(() => !!state.elems.get('Shell.Toast').querySelector('.tab.top .pdot.d-padd')), 'added port dot marked');
  ok(await p.evaluate(() => !!state.elems.get('Shell.CommandPalette').querySelector('.tab.top .pdot.d-prem')), 'removed port dot shown hollow');
  ok(await p.evaluate(() => !!state.elems.get('Shell.Router').querySelector('.pdot.d-paff') && !!state.elems.get('Shell.Keymap').querySelector('.pdot.d-paff')), 'affected ports marked');
  ok(await p.evaluate(() => document.querySelectorAll('#dBody .d-item').length) === 17, 'change list: 15 changes + 2 affected ports', await p.evaluate(() => document.querySelectorAll('#dBody .d-item').length));
  // v0.2: a renamed level strikes its old name; changed level, port and group sketches are amber, and their
  // callouts show the word diff; read-only, so a click only pins the callout.
  ok(await p.evaluate(() => { const l = document.querySelector('.llab[data-lvl="Shell|1"]'); return l && l.classList.contains('d-lchg') && l.querySelector('s.d-was')?.textContent === 'Services' && l.firstChild.textContent === 'Routing'; }), 'renamed level: new name, old one struck');
  ok(await p.evaluate(() => [...document.querySelectorAll('#lines path.vis.d-gsk')].length >= 1), 'changed group sketch: amber line');
  ok(await p.evaluate(() => { document.querySelector('.llab[data-lvl="Shell|2"]').click(); return co.mode === 'pin' && !co.el.querySelector('form') && !!co.el.querySelector('ins.d-ins') && co.el.querySelector('ins.d-ins').textContent === 'the levels above.'; }), 'level sketch callout: word diff, pinned, no editor');
  await p.evaluate(() => hideCallout());
  await p.evaluate(() => { state.open.add('β:Surface'); setDrawer('β:Surface', 'bot', true); }); await settle(p);
  ok(await p.evaluate(() => { const r = state.elems.get('β:Surface')?.querySelector('.tab.bot .drow.d-rsk'); if (!r) return false; r.click(); return !!co.el.querySelector('ins.d-ins') && !co.el.querySelector('form'); }), 'changed port sketch: amber row, callout shows the inserted words');
  await p.evaluate(() => { hideCallout(); closeAllDrawers(); }); await settle(p);
  ok(await p.evaluate(() => [...document.querySelectorAll('#dBody .d-item')].some(b => /level 2 name/.test(b.textContent) && /Routing/.test(b.textContent))), 'change list names the level rename');
  ok(await p.evaluate(() => state.lay.checks.every(c => !c.f.length)), 'merged layout passes the layout checks', await p.evaluate(() => state.lay.checks.filter(c => c.f.length)));
  // Drawer rows: open Shell.Toast's input drawer; the added row is marked.
  await p.evaluate(() => setDrawer('Shell.Toast', 'top', true)); await settle(p);
  ok(await p.evaluate(() => !!state.elems.get('Shell.Toast').querySelector('.tab.top .drow.d-radd')), 'added drawer row marked');
  await p.evaluate(() => setDrawer('Shell', 'top', true)); await settle(p);
  ok(await p.evaluate(() => !!state.elems.get('Shell').querySelector('.tab.top .drow.d-rrem')), 'removed drawer row struck');
  await p.evaluate(() => closeAllDrawers()); await settle(p);
  await shot(p, 'shell-after-light');
  await shot(p, 'shell-after-light-zoom', 'Shell.SessionView', .8);
  // Click a list item: pans to it and selects it.
  await p.evaluate(() => fit(false));
  await p.click('#dBody .d-item[data-id="Shell.Search"]'); await p.waitForTimeout(600);
  const c = await p.evaluate(() => { const r = state.elems.get('Shell.Search').getBoundingClientRect(); return { sel: state.sel, cx: r.left + r.width / 2, cy: r.top + r.height / 2, W: innerWidth - 460, H: innerHeight }; });
  ok(c.sel === 'Shell.Search' && Math.abs(c.cx - c.W / 2) < 40 && Math.abs(c.cy - c.H / 2) < 60, 'list click pans to and selects the block', c);
  ok(await p.evaluate(() => document.querySelector('#dBody .d-item.on')?.dataset.id) === 'Shell.Search', 'selected list item highlighted');
  // A removed block's list entry goes to its ghost.
  await p.click('#dBody .d-item[data-id="~Shell.Clipboard"]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => state.sel) === '~Shell.Clipboard', 'list click selects a ghost');
  // Read-only: no + buttons, edits refused, a drag moves nothing, Delete does nothing.
  const src0 = await p.evaluate(() => state.src);
  ok(await p.evaluate(() => [...document.querySelectorAll('.plus')].every(b => getComputedStyle(b).display === 'none' || !b.offsetParent)), 'no + buttons in diff mode');
  ok(await p.evaluate(() => edit({ t: 'delete', node: state.model.node('Shell.Search'), loc: state.lay.loc.get('Shell.Search') }).src === state.src), 'edit() is a no-op');
  await p.evaluate(() => fit(false)); await settle(p);
  const box = await p.evaluate(() => { const r = state.elems.get('Shell.Theme').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; });
  await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.mouse.move(box.x + 120, box.y + 80, { steps: 8 }); await p.mouse.up(); await settle(p);
  await p.evaluate(() => select('Shell.Theme', null)); await p.keyboard.press('Delete'); await settle(p);
  ok(await p.evaluate(() => state.src) === src0 && !(await p.evaluate(() => !!document.querySelector('.modal'))), 'drag and Delete change nothing');
  // Before/After toggle: the same element animates from its new place to its old one.
  await p.evaluate(() => { select(null, null); const B = state.lay.blocks.find(b => b.id === 'Shell.ScrollAnchor'); state.cam = { k:1, x:500 - B.x, y:400 - B.y }; applyCam(); }); await settle(p);
  const el0 = await p.evaluate(() => { window.__sa = state.elems.get('Shell.ScrollAnchor'); const r = __sa.getBoundingClientRect(); return [r.left, r.top]; });
  await p.click('#dSeg [data-view="before"]');
  await p.waitForTimeout(60);
  const mid = await p.evaluate(() => { const r = __sa.getBoundingClientRect(); return [r.left, r.top, document.getElementById('world').classList.contains('anim')]; });
  await p.waitForTimeout(500);
  const end = await p.evaluate(() => { const r = state.elems.get('Shell.ScrollAnchor').getBoundingClientRect(); return [r.left, r.top, state.elems.get('Shell.ScrollAnchor') === __sa]; });
  const between = (a, b, m) => Math.min(a, b) - 1 <= m && m <= Math.max(a, b) + 1;
  ok(end[2], 'toggle reuses the element (transition, not a redraw)');
  ok(mid[2] && Math.hypot(end[0] - el0[0], end[1] - el0[1]) > 40 && between(el0[1], end[1], mid[1]) && Math.abs(mid[1] - el0[1]) > 2 && Math.abs(mid[1] - end[1]) > 2, 'toggle animates through intermediate positions', { el0, mid, end });
  ok(await p.evaluate(() => !state.elems.has('~>Shell.ScrollAnchor') && !state.elems.has('Shell.Search')), 'Before has no move ghost and no added block');
  ok(await p.evaluate(() => state.elems.get('Shell.PinnedBanner')?.querySelector('.ttl span')?.textContent) === 'Shell.Banner', 'Before shows the old name on the same element');
  ok(await p.evaluate(() => (state.elems.get('~Shell.Clipboard')?.classList.contains('d-rem')) && !state.elems.get('~Shell.Clipboard').classList.contains('d-ghost')), 'Before shows a removed block as a real card, marked');
  await shot(p, 'shell-before-light');
  await p.keyboard.press('a'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.querySelector('#dSeg [data-view="after"]').getAttribute('aria-pressed')) === 'true' && await p.evaluate(() => state.elems.has('Shell.Search')), 'key A returns to After');
  ok(p.errors.length === 0, 'no page errors (dev hook)', p.errors);
  await p.context().close();
}

// ---------- 2. fixture pairs (red team) ----------
{
  const p = await newPage();
  await p.goto('file://' + page + '?diff'); await p.waitForTimeout(1000);
  // Nested moves: the parent moved to another block, a child moved to another level inside it.
  await openFx(p, 'nested');
  let L = await ids(p);
  ok(L.includes('~>Editor') && L.includes('~>Canvas'), 'nested moves: a ghost for each', L.filter(x => x.startsWith('~')));
  ok(await p.evaluate(() => document.querySelectorAll('svg.d-arrows path:not(.head)').length) === 2, 'nested moves: two arrows');
  ok(await p.evaluate(() => state.model.node('~>Canvas').parent.id) === 'Editor', 'nested moves: the child ghost sits inside the moved parent');
  await shot(p, 'nested-after-light');
  // A removed block whose children were removed too: one ghost.
  await openFx(p, 'removed-parent');
  L = await ids(p);
  ok(L.filter(x => x.startsWith('~')).length === 1 && L.includes('~Legacy'), 'removed parent: one ghost, not four', L);
  ok(await p.evaluate(() => state.elems.get('~Legacy').querySelector('.d-lab').textContent) === 'Removed, with 3 inside', 'removed parent: label counts the blocks inside');
  ok(await p.evaluate(() => document.querySelectorAll('#dBody .d-item').length) === 1, 'removed parent: one list entry');
  await p.click('#dSeg [data-view="before"]'); await p.waitForTimeout(500);
  ok((await ids(p)).includes('~Sax'), 'removed parent: Before shows the removed children');
  await p.click('#dSeg [data-view="after"]'); await p.waitForTimeout(400);
  // Ambiguous rename: two identical look-alikes; the first in side b wins.
  await openFx(p, 'ambiguous');
  ok(await p.evaluate(() => state.elems.get('WorkerA').querySelector('.ttl s.d-was')?.textContent) === 'Worker' && (await cls(p, 'WorkerB')).includes('d-add'), 'ambiguous rename: deterministic tie-break');
  // Swap: both renamed; Before swaps the names back on the same elements.
  await openFx(p, 'swap');
  ok(await p.evaluate(() => state.elems.get('Back').querySelector('.ttl s.d-was')?.textContent) === 'Front', 'swap: Back was Front');
  await p.click('#dSeg [data-view="before"]'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => state.elems.get('Back').querySelector('.ttl span').textContent) === 'Front', 'swap: Before shows the old name');
  await p.click('#dSeg [data-view="after"]'); await p.waitForTimeout(400);
  // Unicode names.
  await openFx(p, 'unicode');
  ok(await p.evaluate(() => state.elems.get('🛰Orbit').querySelector('.ttl s.d-was')?.textContent) === '🚀Launch', 'unicode rename');
  await shot(p, 'unicode-after-light', 'Système', .9);
  // Every Fields key on one page.
  await openFx(p, 'fields');
  ok(await p.evaluate(() => !!state.elems.get('Panel').querySelector('.pill.d-was')), 'fields: type');
  ok(await p.evaluate(() => !!state.elems.get('μ:Click').querySelector('.rel2 s.d-was')), 'fields: refines shows the old relation');
  ok((await cls(p, 'β:~>Focusable')).includes('d-from') && (await cls(p, 'β:Focusable')).includes('d-mov'), 'fields: a moved behavior has a ghost in its old band');
  await shot(p, 'fields-after-light', 'Panel', .9);
  // No changes: formatting only.
  await openFx(p, 'whitespace');
  ok(await p.evaluate(() => document.querySelector('.d-none')?.textContent.startsWith('No changes')), 'no changes: banner');
  ok(await p.evaluate(() => document.querySelector('#dBody .d-empty')?.textContent.startsWith('No changes')), 'no changes: list says so');
  ok(await p.evaluate(() => document.querySelectorAll('.d-dot, .d-ghost, .d-add').length) === 0, 'no changes: no marks');
  await shot(p, 'none-light');
  // A side that does not parse.
  const bad = fx('swap'); bad.b.src = bad.b.src + ')';
  await openFx(p, null, bad);
  ok(await p.evaluate(() => document.querySelector('.d-none.d-err')?.textContent.includes('does not parse')), 'parse error: banner');
  // 600+ blocks: time to diff, lay out and paint; then a toggle.
  const t = await p.evaluate(d => { const t0 = performance.now(); SBTEL.modes.diff.open(d); const t1 = performance.now(); document.querySelector('#dSeg [data-view="before"]').click(); const t2 = performance.now();
    return { open: Math.round(t1 - t0), toggle: Math.round(t2 - t1), blocks: state.model.blocks.size }; }, fx('big'));
  ok(t.open < 4000 && t.toggle < 2500, 'big: open and toggle are fast enough', t);
  console.log('big (' + t.blocks + ' blocks in the merged spec): open ' + t.open + ' ms, toggle ' + t.toggle + ' ms');
  await p.waitForTimeout(600);
  await p.click('#dSeg [data-view="after"]'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => state.lay.checks.every(c => !c.f.length)), 'big: merged layout passes the layout checks', await p.evaluate(() => state.lay.checks.filter(c => c.f.length).map(c => c.k + ' ' + c.f.slice(0, 3))));
  await shot(p, 'big-after-light');
  ok(p.errors.length === 0, 'no page errors (fixtures)', p.errors);
  await p.context().close();
}
// ?diff=none: the dev hook's no-change pair.
{
  const p = await newPage();
  await p.goto('file://' + page + '?diff=none'); await p.waitForTimeout(1000);
  ok(await p.evaluate(() => !!document.querySelector('.d-none')), '?diff=none shows No changes');
  await p.context().close();
}
// Standalone without the query is untouched.
{
  const p = await newPage();
  await p.goto('file://' + page); await p.waitForTimeout(1000);
  ok(await p.evaluate(() => SBTEL.mode === 'standalone' && !document.body.classList.contains('diffmode') && !document.getElementById('dSheet')), 'standalone page has no diff chrome');
  await p.context().close();
}

// ---------- 3. dark theme and phone ----------
{
  const p = await newPage({ scheme: 'dark' });
  await p.goto('file://' + page + '?diff'); await p.waitForTimeout(1200);
  await shot(p, 'shell-after-dark');
  await shot(p, 'shell-after-dark-zoom', 'Shell.SessionView', .8);
  await p.click('#dSeg [data-view="before"]'); await p.waitForTimeout(600);
  await shot(p, 'shell-before-dark');
  ok(p.errors.length === 0, 'no page errors (dark)', p.errors);
  await p.context().close();
}
// The page carries its own device-width viewport (v0.2.3), so the phone runs load it as it is.
const phonePage = page;
for (const scheme of ['light', 'dark']) {
  const p = await newPage({ scheme, viewport: { width: 390, height: 844 }, touch: true });
  await p.goto('file://' + phonePage + '?diff'); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => document.getElementById('dSheet').classList.contains('closed')), `phone ${scheme}: change list starts closed`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `phone ${scheme}: no horizontal page scroll`);
  await shot(p, 'phone-after-' + scheme);
  await p.tap('#dBtn'); await p.waitForTimeout(400);
  await shot(p, 'phone-list-' + scheme);
  await p.tap('#dBody .d-item[data-id="Shell.Composer"]'); await p.waitForTimeout(700);
  ok(await p.evaluate(() => document.getElementById('dSheet').classList.contains('closed') && state.sel === 'Shell.Composer'), `phone ${scheme}: list tap closes the sheet and selects`);
  await shot(p, 'phone-composer-' + scheme);
  ok(p.errors.length === 0, `no page errors (phone ${scheme})`, p.errors);
  await p.context().close();
}

// ---------- 4. server mode against a stub server ----------
{
  const id = '0123456789abcdef0123456789abcdef', posts = [];
  let data = { ...fx('shell'), version: 1 }, sse = null;
  // The log already holds a sent comment with an agent reply: after a (re)load it must show as a bubble
  // and a thread with the reply, as in a spec session.
  const log = [{ seq: 1, kind: 'version', version: 1 },
    { seq: 2, kind: 'comment', id: 'c2', target: 'block:Shell.Router', text: 'Earlier comment', version: 1, at: '2026-11-08T09:00:00Z' },
    { seq: 3, kind: 'reply', to: 'c2', text: 'Earlier answer', at: '2026-11-08T09:01:00Z' }];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === `/s/${id}/diff`) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    if (u.pathname === `/s/${id}/diff.json`) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); return; }
    if (u.pathname === `/s/${id}/log`) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ events: log })); return; }
    if (u.pathname === `/s/${id}/events`) { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }); res.write('event: hello\ndata: {"version":1}\n\n'); sse = res; return; }
    if (u.pathname === `/s/${id}/comment` && req.method === 'POST') { let b = ''; req.on('data', c => b += c); req.on('end', () => { posts.push({ body: JSON.parse(b), type: req.headers['content-type'] }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"c9","seq":9}'); }); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port, p = await newPage();
  await p.goto(`http://127.0.0.1:${port}/s/${id}/diff`); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => SBTEL.mode === 'diff' && !!state.elems.get('~Shell.Clipboard')), 'server: boot fetches diff.json and renders');
  // Comments from the log: a sent comment keeps its bubble, and its thread shows the agent's reply.
  ok(await p.evaluate(() => !!document.querySelector('[data-thread="block:Shell.Router"]')), 'server: a sent comment from the log has a bubble');
  await p.evaluate(() => { const b = document.querySelector('[data-thread="block:Shell.Router"]'); openThread(b.dataset.thread, b); });
  ok(await p.evaluate(() => { const t = pops.thread; return !!t && t.textContent.includes('Earlier comment') && t.querySelector('.sb-reply')?.textContent.includes('Earlier answer') && !t.querySelector('[data-t="del"]'); }), 'server: the thread shows the logged reply, and no Delete for a sent comment');
  await p.keyboard.press('Escape');
  // A new version: toast with Reload; Reload refetches diff.json and keeps the camera.
  data = { ...fx('swap'), version: 2 };
  for (let i = 0; i < 20 && !sse; i++) await p.waitForTimeout(100);
  sse.write('id: 2\nevent: version\ndata: {"version":2,"hash":"x","by":"agent"}\n\n');
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => !!document.querySelector('.d-vt [data-v="reload"]')), 'server: version toast with Reload');
  ok(await p.evaluate(() => !!state.elems.get('~Shell.Clipboard')), 'server: no reload by itself');
  await p.click('.d-vt [data-v="reload"]'); await p.waitForTimeout(800);
  ok(await p.evaluate(() => !!state.elems.get('Back') && !state.elems.get('~Shell.Clipboard')), 'server: Reload shows the new diff');
  // A comment on side b's block posts to the session.
  await p.evaluate(() => select('Back', null)); await p.waitForTimeout(200);
  await p.click('.strip [data-a="comment"]'); await p.fill('#cmtText', 'Why swap these?'); await p.click('.pop [data-c="send"]'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => { const c = document.querySelector('.pop.chat'); const had = !!c && c.textContent.includes('Why swap these?'); closePop('thread'); return had; }), 'server: the chat stays open after Send, with the comment in it');
  const c0 = posts[0] && posts[0].body;
  ok(c0 && c0.target === 'block:Back' && c0.text === 'Why swap these?' && c0.version === 2 && c0.source.startsWith('(block Back') && posts[0].type === 'application/json', 'server: comment posted with side b source', posts);
  // The sent comment keeps its bubble (it is not dropped because it is sent), and an agent reply over
  // SSE goes into its thread as well as a toast.
  ok(await p.evaluate(() => { const c = state.comments.find(x => x.sid === 'c9'); return !!c && c.status === 'sent' && !!document.querySelector('[data-thread="block:Back"]'); }), 'server: a comment sent from the diff keeps its bubble');
  sse.write('id: 10\nevent: reply\ndata: {"seq":10,"to":"c9","text":"Because Back depends on Front.","at":"2026-11-08T09:30:00Z"}\n\n');
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => !/Agent replied/.test(document.querySelector('.toast')?.textContent || '')), 'server: a reply is not announced', await p.evaluate(() => document.querySelector('.toast')?.textContent));
  await p.click('[data-thread="block:Back"]');
  const rep = await p.waitForSelector('.pop .sb-reply', { timeout: 3000 }).then(el => el.textContent()).catch(() => '');
  ok(rep.includes('Because Back depends on Front.'), 'server: the thread shows the agent reply', rep);
  await p.keyboard.press('Escape');
  // After a reload of the page the comment and its reply are still there (rebuilt from the log).
  log.push({ seq: 9, kind: 'comment', id: 'c9', target: 'block:Back', text: 'Why swap these?', version: 2, at: '2026-11-08T09:29:00Z' }, { seq: 10, kind: 'reply', to: 'c9', text: 'Because Back depends on Front.', at: '2026-11-08T09:30:00Z' });
  sse = null; await p.reload(); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => !!document.querySelector('[data-thread="block:Back"]') && state.comments.find(c => c.sid === 'c9')?.replies.length === 1), 'server: after a reload the sent comment keeps its bubble and reply');
  ok(p.errors.length === 0, 'no page errors (server)', p.errors);
  await p.context().close(); sse && sse.end(); srv.close();
}

await browser.close();
console.log(`diff viewer: ${pass} passed, ${fail} failed; screenshots in ${shots}`);
process.exit(fail ? 1 : 0);
