#!/usr/bin/env node
// End-to-end test of the session loop (docs/DESIGN.md §3.7-3.13, §5, §6.3): builds the binary, runs
// `sbtel open --no-browser`, drives the served viewer page in headless Chromium with Playwright,
// and checks comments -> inbox, reply -> page, open --session -> toast -> Reload, dirty edits,
// a save conflict, a save, bindings in the checks pill, kill -9 and reconnect, close, the
// 64 MiB save limit, comments, replies and reloads in an open-diff session, and that no page ever
// makes a request to a host other than 127.0.0.1 (the fonts are embedded; nothing calls out).
//
//   node internal/server/e2e/e2e.js          (from the repo root; needs go, and playwright for node)
//
// Prints one PASS/FAIL line per check and exits 1 on any failure.
'use strict';
const { execFileSync, spawnSync, spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sbtel-e2e-'));
const BIN = path.join(TMP, 'sbtel');
const HOME = path.join(TMP, 'home');
const SPEC = path.join(TMP, 'shell.sbtel');
const ENV = { ...process.env, SBTEL_HOME: HOME, SBTEL_NO_BROWSER: '1', GOPROXY: 'direct', GOSUMDB: 'off' };

let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -- ' + detail)); if (!ok) failed++; };
const sb = (args, input) => {
  const r = spawnSync(BIN, args, { env: ENV, input: input || '', encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The same as sb, without blocking the event loop (for inbox --wait while the page is driven).
const sbAsync = args => new Promise(res => { const c = spawn(BIN, args, { env: ENV }); let out = '', err = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d); c.on('close', code => res({ code, out, err })); });
// An edit through the app (one undo step): delete a visible leaf block, by name if given.
const delLeaf = (pg, name) => pg.evaluate(name => { const id = name || [...state.lay.loc.keys()].find(k => k.startsWith('Shell.') && !state.model.node(k).levels.length); edit({ t: 'delete', node: state.model.node(id), loc: state.lay.loc.get(id) }); return id; }, name);
// Add a comment through the composer: select the block, Comment, type, then the button c.
async function commentVia(pg, id, text, c) {
  await pg.evaluate(id => { const el = state.elems.get(id); if (el.getBoundingClientRect().bottom > innerHeight - 90 || el.getBoundingClientRect().top < 0) centerOn(id); select(id, null); }, id); await sleep(400);
  await pg.click('.strip [data-a="comment"]');
  await pg.fill('#cmtText', text);
  await pg.click(`.pop [data-c="${c}"]`);
}
// --shots <dir>: screenshots of the review UI at deviceScaleFactor 1.
const SHOTS = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
// For a screenshot: no first-visit help, and the canvas at 120% around a block (the badges are legible).
const shotView = (pg, id) => pg.evaluate(id => { document.getElementById('help').hidden = true; [document.scrollingElement, document.getElementById('vp')].forEach(e => { e.scrollTop = 0; e.scrollLeft = 0; }); state.cam.k = 1.2; centerOn(id); }, id).then(() => sleep(450));
// A save is done when the tab is neither saving nor dirty. (Waiting for #sbSave to be disabled is not
// enough: the button is disabled while the request is in flight, so the file may not be written yet.)
const saved = pg => until(() => pg.evaluate(() => { const S = SBTEL.modes.server._state; return !S.saving && !S.dirty; }));
async function until(fn, ms = 8000, step = 100) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(step); }
}

(async () => {
  execFileSync('go', ['build', '-o', BIN, './cmd/sbtel'], { cwd: ROOT, env: ENV, stdio: 'inherit' });
  fs.mkdirSync(HOME, { recursive: true });
  const v1 = fs.readFileSync(path.join(ROOT, 'examples/shell.sbtel'), 'utf8');
  fs.writeFileSync(SPEC, v1);

  // ---- open ----
  const o = sb(['open', SPEC, '--no-browser', '--json', '--label', 'Shell e2e']);
  check('open exits 0', o.code === 0, o.err);
  const opened = JSON.parse(o.out);
  check('open --json has session, url, version 1, created', /^[0-9a-f]{32}$/.test(opened.session) && opened.version === 1 && opened.created === true && opened.url.endsWith('/s/' + opened.session + '/'));
  const id = opened.session, URL0 = opened.url;

  let browser;
  try { browser = await chromium.launch(); } catch (e) { browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }); }
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  // Every request any page makes, other than to the sbtel server and data: URLs (the embedded fonts).
  const outside = [];
  ctx.on('request', rq => { const u = new URL(rq.url()); if (u.protocol !== 'data:' && u.protocol !== 'file:' && u.hostname !== '127.0.0.1') outside.push(rq.url()); });
  const page = await ctx.newPage();
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(String(e)));
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.type()); d.accept().catch(() => {}); }); // beforeunload on reload
  await page.goto(URL0);
  await page.waitForFunction(() => document.getElementById('specName').textContent.includes('Shell e2e'), null, { timeout: 10000 });
  check('label shown in the title area', (await page.textContent('#specName')).startsWith('Shell e2e · v1'));
  check('page is in server mode with the spec loaded', await page.evaluate(src => SBTEL.mode === 'server' && state.src === src, v1));
  check('the embedded fonts are loaded', await page.evaluate(() => [...document.fonts].some(f => f.family.replace(/["']/g, '') === 'Hanken Grotesk' && f.status === 'loaded') && [...document.fonts].some(f => f.family.replace(/["']/g, '') === 'JetBrains Mono' && f.status === 'loaded')));
  check('Save control present and disabled', await page.evaluate(() => { const b = document.getElementById('sbSave'); return !!b && b.disabled; }));
  await until(() => page.evaluate(() => !!SBTEL.modes.server._state.es && SBTEL.modes.server._state.es.readyState === 1));

  // ---- comment through the real UI: Ctrl-click a block, type, Send ----
  const r = await page.evaluate(() => { const el = state.elems.get('Shell.Router'); el.scrollIntoView(); const b = el.getBoundingClientRect(); return { x: b.left + 20, y: b.top + 12 }; });
  await page.mouse.click(r.x, r.y, { modifiers: ['Control'] });
  const composer = await page.waitForSelector('#cmtText', { timeout: 3000 }).catch(() => null);
  if (!composer) await page.evaluate(() => openComposer('block:Shell.Router'));
  const text = 'Split this into routing ✓ and “state”.\nSecond line: ünïcödé 🚀';
  await page.fill('#cmtText', text);
  await page.click('.pop [data-c="send"]');
  await until(() => page.evaluate(() => state.comments.some(c => c.status === 'sent')));
  check('comment marked sent in the page', await page.evaluate(() => state.comments.filter(c => c.status === 'sent').length === 1));

  // ---- inbox ----
  let ib = sb(['inbox', id, '--json', '--peek']);
  const evs = ib.out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const cm = evs.find(e => e.kind === 'comment');
  check('inbox --json prints the comment, unicode and newlines intact', ib.code === 0 && cm && cm.text === text && cm.target === 'block:Shell.Router' && cm.version === 1 && cm.source.startsWith('(block Shell.Router'), ib.out + ib.err);
  ib = sb(['inbox', id]);
  check('inbox (human) prints the comment block', ib.code === 0 && ib.out.startsWith(cm.id + ' comment on block Shell.Router (version 1, ') && ib.out.includes('  > Second line: ünïcödé 🚀') && ib.out.includes('  source:\n    (block Shell.Router'), ib.out);
  ib = sb(['inbox', id]);
  check('inbox is empty after reading', ib.code === 0 && ib.out === '', ib.out);

  // ---- reply ----
  const rp = sb(['reply', id, cm.id, '-'], 'Done: split into Router and RouteState.\nSee v2.\n');
  check('reply exits 0 and prints nothing', rp.code === 0 && rp.out === '', rp.err);
  await until(() => page.evaluate(() => state.comments[0].replies && state.comments[0].replies.length === 1));
  check('page received the reply over SSE', await page.evaluate(() => state.comments[0].replies[0].text === 'Done: split into Router and RouteState.\nSee v2.'));
  check('reply toast shown', (await page.evaluate(() => document.querySelector('.toast').textContent)).startsWith('Agent replied on block Shell.Router'));
  await page.evaluate(() => { const b = document.querySelector('[data-thread="block:Shell.Router"]'); b.scrollIntoView(); });
  await page.click('[data-thread="block:Shell.Router"]');
  const replyText = await page.waitForSelector('.pop .sb-reply', { timeout: 3000 }).then(el => el.textContent()).catch(() => '');
  check('thread shows the agent reply', replyText.includes('Done: split into Router and RouteState.'), replyText);
  await page.keyboard.press('Escape');
  check('reply to an unknown comment is exit 2', sb(['reply', id, 'c999', 'x']).code === 2);

  // ---- open --session pushes a version: toast with Reload; no live reload ----
  const v2 = v1 + '\n; agent edit v2\n';
  fs.writeFileSync(SPEC, v2);
  const o2 = sb(['open', SPEC, '--session', id, '--json']);
  const r2 = JSON.parse(o2.out || '{}');
  check('open --session exits 0 with version 2, created false', o2.code === 0 && r2.version === 2 && r2.created === false, o2.out + o2.err);
  const vt = await page.waitForSelector('.sb-vt', { timeout: 5000 }).catch(() => null);
  check('new-version toast appears', !!vt && (await vt.textContent()).includes('A new version (v2) is available'));
  check('page did not reload by itself', await page.evaluate(src => state.src === src, v1));
  await page.click('.sb-vt [data-v="reload"]');
  await until(() => page.evaluate(src => state.src === src, v2));
  check('Reload applies the new source', await page.evaluate(src => state.src === src, v2));
  check('label shows v2', (await page.textContent('#specName')).startsWith('Shell e2e · v2'));

  // ---- the agent edits while the user has unsaved edits ----
  await page.evaluate(() => { const t = document.getElementById('src'); t.value = t.value + '\n; user edit\n'; t.dispatchEvent(new Event('input')); });
  await until(() => page.evaluate(() => !document.getElementById('sbSave').disabled));
  check('an edit marks the page dirty', await page.evaluate(() => !document.getElementById('sbSave').disabled && document.getElementById('specName').textContent.includes('edited')));
  const v3 = v2 + '\n; agent edit v3\n';
  fs.writeFileSync(SPEC, v3); // no open --session: the server sees the file change on disk
  const vt3 = await page.waitForSelector('.sb-vt', { timeout: 8000 }).catch(() => null);
  const vt3t = vt3 ? await vt3.textContent() : '';
  check('disk change shows the toast and warns about unsaved edits', vt3t.includes('(v3)') && vt3t.includes('changed on disk') && vt3t.includes('not saved or sent') && vt3t.includes('Discard my edits and reload'), vt3t);
  await page.click('.sb-vt [data-v="later"]');
  // Save on the stale base asks before overwriting (never silently): View their changes opens the diff of
  // the base and the newer version in a new tab; Cancel writes nothing and offers the new version again.
  await page.click('#sbSave');
  const ow = await page.waitForSelector('.sb-owm', { timeout: 5000 }).catch(() => null);
  const owT = ow ? await ow.textContent() : '';
  check('save on a stale base asks: overwrite, view their changes or cancel', owT.includes('The spec changed since you started (the file changed on disk). Overwrite it with yours?') && ['Overwrite', 'View their changes', 'Cancel'].every(b => owT.includes(b)), owT);
  const [cmp] = await Promise.all([ctx.waitForEvent('page'), page.click('.sb-owm [data-m="theirs"]')]);
  cmp.on('pageerror', e => pageErrors.push('compare: ' + String(e)));
  await until(() => cmp.evaluate(() => SBTEL.mode === 'diff' && !!SBTEL.modes.diff._state.res).catch(() => false));
  check('View their changes: a diff of your base and their version, in a new tab', await cmp.evaluate(([a, b]) => { const D = SBTEL.modes.diff._state; return SBTEL.compare && !SBTEL.session && D.data.a.src === a && D.data.b.src === b && /their changes/.test(document.title); }, [v2, v3]));
  await cmp.close();
  check('the prompt stays open meanwhile', !!(await page.$('.sb-owm')));
  await page.click('.sb-owm [data-m="cancel"]');
  const vtAgain = await page.waitForSelector('.sb-vt', { timeout: 3000 }).catch(() => null);
  check('Cancel writes nothing and offers the new version again', fs.readFileSync(SPEC, 'utf8') === v3 && !(await page.$('.sb-owm')) && !!vtAgain);
  await page.click('.sb-vt [data-v="reload"]');
  await until(() => page.evaluate(src => state.src === src, v3));
  check('discard and reload loads v3; undo brings the edits back', await page.evaluate(src => state.src === src, v3) && await page.evaluate(() => { undo(); return state.src.includes('; user edit'); }));
  // ---- a save ----
  await page.evaluate(() => { const t = document.getElementById('src'); t.value = t.value.replace('; user edit', '; user edit, saved'); t.dispatchEvent(new Event('input')); });
  await until(() => page.evaluate(() => state.src.includes(', saved') && !document.getElementById('sbSave').disabled));
  await page.keyboard.press('Control+s');
  await saved(page);
  const disk = fs.readFileSync(SPEC, 'utf8');
  check('save writes the file', disk.includes('; user edit, saved') && disk === await page.evaluate(() => state.src));
  ib = sb(['inbox', id]);
  check('inbox shows the save', /^save version 4 by user \(was 3\), \S+, written to /.test(ib.out) && ib.out.trim().endsWith(SPEC), ib.out);
  await sleep(2500);
  check('no toast for our own save', !(await page.$('.sb-vt')));

  // ---- the draft review: Add to review, a pending badge, Review, Send ----
  const vSaved = fs.readFileSync(SPEC, 'utf8');
  check('the composer offers Add to review (primary) and Send now', await (async () => {
    await page.evaluate(() => openComposer('block:Shell.Keymap'));
    const b = await page.evaluate(() => [...document.querySelectorAll('.pop .acts button')].map(x => x.textContent + (x.classList.contains('primary') ? '*' : '')));
    if (SHOTS) { await page.keyboard.press('Escape'); await page.evaluate(() => closePop('composer')); await shotView(page, 'Shell.Keymap'); await page.evaluate(() => openComposer('block:Shell.Keymap')); await page.fill('#cmtText', 'Should the keymap own chords, or the palette?'); await page.screenshot({ path: path.join(SHOTS, 'composer.png') }); }
    await page.keyboard.press('Escape'); await page.evaluate(() => closePop('composer'));
    return JSON.stringify(b) === JSON.stringify(['Cancel', 'Send now', 'Add to review*']);
  })());
  const waiting = sbAsync(['inbox', id, '--wait', '--timeout', '4']); // pending activity must not wake it
  await sleep(300);
  await commentVia(page, 'Shell.Keymap', 'Should the keymap own chords?', 'review');
  await until(() => page.$('[data-thread="block:Shell.Keymap"].pend .pb'));
  check('Add to review: the comment is pending, with a badge on the canvas', await page.evaluate(() => { const b = document.querySelector('[data-thread="block:Shell.Keymap"]'); return b && b.classList.contains('pend') && b.querySelector('.pb').textContent === 'pending' && state.comments.filter(c => c.status === 'pending').length === 1; }));
  check('the comment is not in the inbox', sb(['inbox', id, '--peek']).out === '');
  const gone = await delLeaf(page, 'Shell.Clipboard');
  await until(() => page.evaluate(() => +document.querySelector('#rvBtn .rv-n').textContent >= 2), 3000);
  const rvN = await page.evaluate(() => { const n = document.querySelector('#rvBtn .rv-n'); return n.hidden ? 0 : +n.textContent; });
  check('Review (N) counts the pending comment and the edits', rvN >= 2 && (await page.textContent('#rvBtn')).startsWith('Review'), String(rvN));
  if (SHOTS) {
    await page.evaluate(() => select(null, null)); await shotView(page, 'Shell.Keymap');
    await page.evaluate(() => { const b = document.querySelector('[data-thread="block:Shell.Keymap"]'); openThread(b.dataset.thread, b); }); await page.waitForSelector('.pop .st-pending');
    await page.screenshot({ path: path.join(SHOTS, 'pending-comment.png') });
    await page.keyboard.press('Escape');
  }
  await page.click('#rvBtn');
  await page.waitForSelector('#rvSheet:not(.closed) #rvEdits .d-item');
  check('the Review panel lists the edits and the pending comment', await page.evaluate(g => { const t = document.getElementById('rvSheet').textContent; return t.includes(g) && t.includes('Removed') && document.querySelectorAll('#rvComments .rv-c').length === 1 && !!document.querySelector('[data-rv="diff"]'); }, gone));
  await page.fill('#rvMsg', 'One question and one removal.');
  if (SHOTS) { await sleep(300); await page.screenshot({ path: path.join(SHOTS, 'review-panel.png') }); }
  const w = await waiting;
  check('inbox --wait does not wake on pending activity', w.code === 0 && w.out === '' && w.err.includes('nothing new after 4s'), w.out + w.err);
  const [full] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-rv="diff"]')]);
  await until(() => full.evaluate(() => SBTEL.mode === 'diff' && !!SBTEL.modes.diff._state.res).catch(() => false));
  check('Open the full diff: the visual diff of the base and the edits', await full.evaluate(g => SBTEL.modes.diff._state.res.changes.some(c => c.tags[0] === 'removed' && c.a.name === g), gone));
  await full.close();
  const before = await page.evaluate(() => state.src);
  await page.click('#rvSend');
  await until(() => page.evaluate(() => !state.comments.some(c => c.status === 'pending') && /awaiting agent/.test(document.getElementById('specName').textContent)));
  ib = sb(['inbox', id]);
  const rid = (/^(r\d+) review of version (\d+) by user/.exec(ib.out) || [])[1];
  const propPath = (/\n  proposed spec: (\S+)\n/.exec(ib.out) || [])[1];
  check('inbox prints one review: message, diff, proposed spec, then the comment', !!rid && ib.out.includes('\n  > One question and one removal.\n') && ib.out.includes('  edits against version ') && ib.out.includes('- block ' + gone) &&
    ib.out.indexOf('proposed spec:') < ib.out.indexOf(' comment on block Shell.Keymap') && ib.out.includes(`  ${rid.replace('r', 'c')}.1 comment on block Shell.Keymap\n    > Should the keymap own chords?`) && (ib.out.match(/review of version/g) || []).length === 1, ib.out);
  check('the proposed spec is stored in the session folder; the spec file is unchanged', !!propPath && propPath.startsWith(path.join(HOME, 'sessions', id, 'proposals') + path.sep) && fs.readFileSync(propPath, 'utf8') === before && fs.readFileSync(SPEC, 'utf8') === vSaved);
  check('after sending: the draft is clear, comments are sent, edits stay marked proposed', await page.evaluate(() => document.querySelector('#rvBtn .rv-n').hidden && state.comments.some(c => c.review && c.status === 'sent') && !document.querySelector('.cbub.pend') && /proposed, awaiting agent/.test(document.getElementById('specName').textContent)));
  check('reply to a review comment and to the review', sb(['reply', id, rid.replace('r', 'c') + '.1', 'Yes: chords stay in the keymap.']).code === 0 && sb(['reply', id, rid, 'Thanks, applying.']).code === 0);
  await until(() => page.evaluate(() => /Agent replied to your review/.test(document.querySelector('.toast').textContent)));
  check('the replies reach the comment thread and the review', await page.evaluate(id => state.comments.find(c => c.sid === id + '.1').replies.length === 1 && document.getElementById('rvSent').textContent.includes('Thanks, applying.'), rid.replace('r', 'c')));

  // Editing after a review starts a new draft on top of the proposal; sending it replaces the proposal.
  await delLeaf(page, 'Shell.Theme');
  await until(() => page.evaluate(() => /then edited/.test(document.getElementById('specName').textContent) && !document.getElementById('rvSend').disabled));
  check('edits after a review: a new draft, said so in the title and the panel', await page.evaluate(r => document.querySelector('#rvEdits .rv-prop') && document.getElementById('rvEdits').textContent.includes('Since your review ' + r) && !document.querySelector('#rvBtn .rv-n').hidden, rid));
  await page.click('#rvSend');
  await until(() => page.evaluate(() => /awaiting agent/.test(document.getElementById('specName').textContent)));
  ib = sb(['inbox', id]);
  const rid2 = (/^(r\d+) review/.exec(ib.out) || [])[1];
  check('the second review proposes the whole text and replaces the first proposal', !!rid2 && ib.out.includes(`it replaces the proposed spec of ${rid}`) && ib.out.includes('- block ' + gone) && ib.out.includes('- block Shell.Theme'), ib.out);
  const proposal2 = await page.evaluate(() => state.src);
  // The agent applies the proposal (plus its own change) and pushes it: the usual toast replaces it.
  const vAgent = proposal2 + '\n; merged by the agent\n';
  fs.writeFileSync(SPEC, vAgent);
  sb(['open', SPEC, '--session', id]);
  const vtp = await page.waitForSelector('.sb-vt', { timeout: 8000 }).catch(() => null);
  check('the agent\'s new version: the toast mentions the proposal', !!vtp && (await vtp.textContent()).includes('It may hold the edits you proposed in ' + rid2));
  await page.click('.sb-vt [data-v="reload"]');
  await until(() => page.evaluate(s => state.src === s, vAgent));
  check('Reload replaces the proposal; undo goes back to it', await page.evaluate(() => !/proposed/.test(document.getElementById('specName').textContent)) && await page.evaluate(p => { undo(); const ok = state.src === p; redo(); return ok; }, proposal2));

  // ---- the draft persists across a reload; leaving with a draft asks first ----
  await commentVia(page, 'Shell.Router', 'Keep this comment across a reload.', 'review');
  await delLeaf(page, 'Shell.LowLevelThing');
  await page.fill('#rvMsg', 'A message kept in the draft.');
  const draftSrc = await page.evaluate(() => state.src);
  await page.evaluate(() => localStorage.setItem('sbtel-hist:' + 'f'.repeat(32), '{"v":1,"head":"","undo":[],"redo":[]}')); // a session that does not exist
  await sleep(500);
  await page.reload();
  await page.waitForFunction(() => /v\d+/.test(document.getElementById('specName').textContent) && !!document.getElementById('rvBtn'), null, { timeout: 10000 });
  await until(() => page.evaluate(() => !localStorage.getItem('sbtel-hist:' + 'f'.repeat(32))));
  check('leaving the page with a draft asks first (beforeunload)', dialogs.includes('beforeunload'), JSON.stringify(dialogs));
  check('after a reload: the pending comment, its badge, the message and the edits are back', await page.evaluate(src => state.src === src && state.comments.some(c => c.status === 'pending' && c.text === 'Keep this comment across a reload.') && !!document.querySelector('[data-thread="block:Shell.Router"].pend'), draftSrc) &&
    await (async () => { await page.click('#rvBtn'); return page.evaluate(() => document.getElementById('rvMsg').value === 'A message kept in the draft.'); })());
  check('keys of sessions the server does not know are pruned', await page.evaluate(() => !localStorage.getItem('sbtel-hist:' + 'f'.repeat(32))));
  check('undo history survives the reload', await page.evaluate(() => { const s0 = state.src; undo(); const ok = state.src.includes('(block Shell.LowLevelThing'); redo(); return ok && state.src === s0; }));

  // ---- Save after the agent pushes: the prompt; Overwrite writes; the draft's comments stay pending ----
  const vPush = fs.readFileSync(SPEC, 'utf8') + '\n; agent pushed again\n';
  fs.writeFileSync(SPEC, vPush);
  sb(['open', SPEC, '--session', id]);
  await page.waitForSelector('.sb-vt', { timeout: 8000 });
  await page.click('.sb-vt [data-v="later"]');
  await page.click('#sbSave');
  await page.waitForSelector('.sb-owm', { timeout: 5000 });
  check('the overwrite prompt after an agent push', (await page.textContent('.sb-owm')).includes('The spec changed since you started (agent pushed a new version). Overwrite it with yours?'));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'save-overwrite.png') });
  await page.click('.sb-owm [data-m="overwrite"]');
  await saved(page);
  ib = sb(['inbox', id]);
  check('Overwrite writes the tab\'s text, and inbox says it overwrote', fs.readFileSync(SPEC, 'utf8') === draftSrc && /^save version \d+ by user \(was \d+, which the user overwrote without merging\)/.test(ib.out) && !ib.out.includes('Keep this comment'), ib.out);
  check('Save sends no pending comment', await page.evaluate(() => state.comments.some(c => c.status === 'pending')));

  // ---- bindings ----
  const edges = path.join(TMP, 'edges.txt');
  fs.writeFileSync(edges, '# test edges\nShell.Router -> Shell.Keymap  # src/router.ts:3\n# VIOLATION: the store raises the notification itself\nShell.SessionStore -> Shell.Notification # src/store.ts:9\nnot an edge\n');
  const ob = sb(['open', SPEC, '--session', id, '--bindings', edges]);
  check('open --bindings exits 0', ob.code === 0, ob.err);
  await until(() => page.evaluate(() => SBTEL.modes.server._state.edges && SBTEL.modes.server._state.edges.length === 2));
  check('bindings-only change is adopted without a toast', !(await page.$('.sb-vt')));
  const want = await page.evaluate(() => ['Shell.Router|Shell.Keymap', 'Shell.SessionStore|Shell.Notification'].filter(k => !bindingVerdict(state.model, ...k.split('|')).ok).length);
  await page.click('#chkBtn');
  const chk = await page.waitForSelector('.pop h5:last-of-type', { timeout: 3000 }).then(() => page.evaluate(() => [...document.querySelectorAll('.pop .chklist')].pop().textContent)).catch(() => '');
  check('checks pill fails and the popover lists binding violations', (await page.textContent('#chkBtn')).includes('failing') && chk.includes('Code bindings respect the levels') && chk.includes('not an edge') && want >= 1, chk);
  const viol = await page.evaluate(() => [...document.querySelectorAll('.pop .sb-viol li')].map(li => li.textContent));
  const explained = viol.find(t => t.includes('Shell.SessionStore -> Shell.Notification'));
  check('the popover shows the # VIOLATION: explanation beside its violation', viol.length === want && !!explained && explained.includes('Explained: the store raises the notification itself'), JSON.stringify(viol));
  await page.keyboard.press('Escape');

  // ---- kill -9 the server mid-session; the tab says so and reconnects ----
  const info = JSON.parse(fs.readFileSync(path.join(HOME, 'server.json'), 'utf8'));
  process.kill(info.pid, 'SIGKILL');
  const bar = await page.waitForSelector('.sb-bar', { timeout: 8000 }).catch(() => null);
  check('disconnected banner after kill -9', !!bar && (await bar.textContent()).includes('Disconnected'));
  const waitDown = sb(['inbox', id, '--wait', '--timeout', '0.5']);
  check('inbox --wait works while the server is down', waitDown.code === 0 && waitDown.err.includes('nothing new after 0.5s'), waitDown.err);
  const v5 = fs.readFileSync(SPEC, 'utf8') + '\n; after restart\n';
  fs.writeFileSync(SPEC, v5);
  const o5 = sb(['open', SPEC, '--session', id]);
  const info2 = JSON.parse(fs.readFileSync(path.join(HOME, 'server.json'), 'utf8'));
  check('open restarts the server (stale server.json) on the same port', o5.code === 0 && info2.pid !== info.pid && info2.port === info.port, o5.err);
  await until(() => page.evaluate(() => !document.querySelector('.sb-bar')), 12000);
  check('tab reconnects by itself', await page.evaluate(() => !document.querySelector('.sb-bar')));
  const vt5 = await page.waitForSelector('.sb-vt', { timeout: 5000 }).catch(() => null);
  check('version pushed while disconnected is announced on reconnect', !!vt5);

  // ---- a second tab, a malicious page ----
  const evil = await ctx.newPage();
  await evil.goto('about:blank');
  const port = info2.port;
  const attack = await evil.evaluate(async ({ port, id }) => {
    const out = {};
    try { const r = await fetch(`http://127.0.0.1:${port}/s/${id}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"target":"block:x","text":"evil"}' }); out.json = r.status; } catch (e) { out.json = 'blocked'; }
    try { const r = await fetch(`http://127.0.0.1:${port}/s/${id}/comment`, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: '{"target":"block:x","text":"evil"}' }); out.plain = r.type; } catch (e) { out.plain = 'blocked'; }
    try { const r = await fetch(`http://127.0.0.1:${port}/s/${id}/spec`); out.read = r.status; } catch (e) { out.read = 'blocked'; }
    return out;
  }, { port, id });
  ib = sb(['inbox', id, '--json']);
  check('a cross-origin page cannot post comments or read the spec', attack.json === 'blocked' && attack.read === 'blocked' && !ib.out.includes('evil'), JSON.stringify(attack) + ib.out);
  await evil.close();

  // ---- close while the tab is open ----
  const cl = sb(['close', id]);
  check('close exits 0', cl.code === 0, cl.err);
  const closedBar = await page.waitForSelector('.sb-bar.closed', { timeout: 5000 }).catch(() => null);
  check('tab shows "session closed"', !!closedBar && (await closedBar.textContent()).includes('closed'));
  await sleep(500);
  check('close clears what the page kept: the draft and the undo history', await page.evaluate(id => !localStorage.getItem('sbtel-draft:' + id) && !localStorage.getItem('sbtel-hist:' + id), id));
  check('session directory removed, spec file kept', !fs.existsSync(path.join(HOME, 'sessions', id)) && fs.existsSync(SPEC));
  check('close of an unknown session is exit 2', sb(['close', id]).code === 2);

  // ---- open - from stdin, then a save ----
  const os1 = sb(['open', '-', '--json'], '(block Solo (sketch "from stdin"))\n');
  const sid = JSON.parse(os1.out).session;
  const p2 = await ctx.newPage();
  await p2.goto(JSON.parse(os1.out).url);
  await p2.waitForFunction(() => document.getElementById('specName').textContent.startsWith('stdin'));
  await until(() => p2.evaluate(() => SBTEL.modes.server._state.es && SBTEL.modes.server._state.es.readyState === 1));
  await p2.evaluate(() => { const t = document.getElementById('src'); t.value = '(block Solo (sketch "edited in the tab"))\n'; t.dispatchEvent(new Event('input')); });
  await until(() => p2.evaluate(() => !document.getElementById('sbSave').disabled));
  await p2.click('#sbSave');
  await saved(p2);
  const stdinSpec = path.join(HOME, 'sessions', sid, 'spec.sbtel');
  check('stdin session saves to sessions/<id>/spec.sbtel', fs.readFileSync(stdinSpec, 'utf8').includes('edited in the tab'));
  ib = sb(['inbox', sid]);
  check('inbox shows the stdin save', ib.out.startsWith('save version 2 by user (was 1)') && ib.out.trim().endsWith(stdinSpec), ib.out);

  // ---- save limit: 64 MiB, the same as the control API (DESIGN §5.2) ----
  // 5 MiB (over the old 4 MiB limit) saves; over 64 MiB is refused in the tab, without a request.
  const bigSrc = '(block Solo (sketch "big"))\n; ' + 'x'.repeat(5 << 20) + '\n';
  await p2.evaluate(src => setSource(src), bigSrc);
  await until(() => p2.evaluate(() => !document.getElementById('sbSave').disabled));
  await p2.click('#sbSave');
  await saved(p2);
  check('a 5 MiB spec saves (over the old 4 MiB limit)', fs.readFileSync(stdinSpec, 'utf8') === bigSrc);
  const posts = []; p2.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/save')) posts.push(r.url()); });
  await p2.evaluate(n => setSource('(block Solo (sketch "huge"))\n; ' + 'x'.repeat(n) + '\n'), (64 << 20) + 16);
  await until(() => p2.evaluate(() => !document.getElementById('sbSave').disabled));
  await p2.click('#sbSave');
  const hugeToast = await until(() => p2.evaluate(() => { const t = document.querySelector('.toast'); return t && /larger than the 64 MiB/.test(t.textContent) ? t.textContent : ''; }));
  check('a spec over 64 MiB is refused in the tab and stays dirty', !!hugeToast && posts.length === 0 && await p2.evaluate(() => SBTEL.modes.server._state.dirty) && fs.readFileSync(stdinSpec, 'utf8') === bigSrc, hugeToast + ' posts=' + posts.length);

  // ---- persistent undo: close the browser context, open a new one with the same storage ----
  const SPEC2 = path.join(TMP, 'undo.sbtel');
  fs.writeFileSync(SPEC2, v1);
  const ou = JSON.parse(sb(['open', SPEC2, '--json']).out);
  const ctxA = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const pa = await ctxA.newPage(); pa.on('pageerror', e => pageErrors.push('undo A: ' + String(e)));
  await pa.goto(ou.url); await pa.waitForFunction(() => /· v1/.test(document.getElementById('specName').textContent));
  await until(() => pa.evaluate(() => SBTEL.modes.server._state.es && SBTEL.modes.server._state.es.readyState === 1));
  await delLeaf(pa, 'Shell.Clipboard'); const e1 = await pa.evaluate(() => state.src);
  await delLeaf(pa, 'Shell.Theme'); const e2 = await pa.evaluate(() => state.src);
  const u2 = v1 + '\n; agent v2\n'; fs.writeFileSync(SPEC2, u2); sb(['open', SPEC2, '--session', ou.session]);
  await pa.waitForSelector('.sb-vt', { timeout: 8000 }); await pa.click('.sb-vt [data-v="reload"]');
  await until(() => pa.evaluate(s => state.src === s, u2));
  await sleep(700); // the history is written 300 ms after a change (and on pagehide)
  const storage = await ctxA.storageState();
  await ctxA.close();
  const u3 = u2 + '; agent v3, pushed while the browser was closed\n'; fs.writeFileSync(SPEC2, u3); sb(['open', SPEC2, '--session', ou.session]);
  const ctxB = await browser.newContext({ viewport: { width: 1500, height: 1000 }, storageState: storage });
  const pb = await ctxB.newPage(); pb.on('pageerror', e => pageErrors.push('undo B: ' + String(e)));
  await pb.goto(ou.url); await pb.waitForFunction(() => /· v3/.test(document.getElementById('specName').textContent));
  const steps = [];
  for (let i = 0; i < 4; i++) { steps.push(await pb.evaluate(() => state.src)); await pb.keyboard.press('Control+z'); await sleep(80); }
  steps.push(await pb.evaluate(() => state.src));
  check('reopened: Ctrl-Z goes back past the agent\'s versions to the earlier edits', JSON.stringify(steps.map(x => [u3, u2, e2, e1, v1].indexOf(x))) === '[0,1,2,3,4]', JSON.stringify(steps.map(x => [u3, u2, e2, e1, v1].indexOf(x))));
  check('undone steps are only a draft: the file is not written', fs.readFileSync(SPEC2, 'utf8') === u3 && await pb.evaluate(() => /edited/.test(document.getElementById('specName').textContent)));
  check('the history is stored as patches, not snapshots', await pb.evaluate(id => { const r = JSON.parse(localStorage.getItem('sbtel-hist:' + id)); return r.v === 1 && r.undo.every(p => p.length === 3) && localStorage.getItem('sbtel-hist:' + id).length < 3 * state.src.length; }, ou.session));
  await ctxB.close();

  // ---- a full localStorage never breaks editing: it stops persisting and logs once ----
  const ctxQ = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctxQ.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }; });
  const pq = await ctxQ.newPage(); const qErr = [], qWarn = [];
  pq.on('pageerror', e => qErr.push(String(e))); pq.on('console', m => { if (m.type() === 'warning' && /sbtel: could not write/.test(m.text())) qWarn.push(m.text()); });
  await pq.goto(ou.url); await pq.waitForFunction(() => /· v3/.test(document.getElementById('specName').textContent));
  const q0 = await pq.evaluate(() => state.src);
  await delLeaf(pq, 'Shell.Clipboard'); await sleep(400); await delLeaf(pq, 'Shell.Theme'); await sleep(400);
  await commentVia(pq, 'Shell.Router', 'still works', 'review'); await sleep(400);
  const qOk = await pq.evaluate(s0 => { const a = state.src; undo(); undo(); const b = state.src === s0; redo(); return a !== s0 && b && !state.src.includes('(block Shell.Clipboard') && state.comments.some(c => c.status === 'pending'); }, q0);
  check('quota exhaustion: editing, undo, redo and comments still work; one warning', qOk && qErr.length === 0 && qWarn.length === 1, JSON.stringify({ qOk, qErr, qWarn }));
  await ctxQ.close();
  sb(['close', ou.session]);

  // ---- a diff session (open-diff): comments behave as in a spec session ----
  const specB = path.join(TMP, 'shell-b.sbtel');
  fs.writeFileSync(specB, v1.replace('(block Shell.Router', '(block Shell.Router\n      ; changed in b'));
  const od = sb(['open-diff', SPEC, specB, '--no-browser', '--json']);
  check('open-diff exits 0', od.code === 0, od.err);
  const dOpened = JSON.parse(od.out || '{}'), did = dOpened.session;
  const dp = await ctx.newPage(); dp.on('pageerror', e => pageErrors.push('diff: ' + String(e)));
  await dp.goto(dOpened.url);
  await until(() => dp.evaluate(() => SBTEL.mode === 'diff' && !!state.elems.get('Shell.Router')));
  await dp.evaluate(() => select('Shell.Router', null)); await sleep(200);
  await dp.click('.strip [data-a="comment"]');
  await dp.fill('#cmtText', 'Why does the router change?');
  await dp.click('.pop [data-c="send"]');
  await until(() => dp.evaluate(() => state.comments.some(c => c.status === 'sent')));
  check('diff: a sent comment keeps its bubble', await dp.evaluate(() => !!document.querySelector('[data-thread="block:Shell.Router"]')));
  const dEvs = sb(['inbox', did, '--json']).out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const dcm = dEvs.find(e => e.kind === 'comment');
  check('diff: inbox has the comment on side b', !!dcm && dcm.text === 'Why does the router change?' && dcm.target === 'block:Shell.Router', JSON.stringify(dEvs));
  check('diff: reply exits 0', sb(['reply', did, dcm ? dcm.id : 'c0', 'It got a note.']).code === 0);
  await until(() => dp.evaluate(() => (state.comments[0].replies || []).length === 1));
  check('diff: reply toast names the target', (await dp.evaluate(() => document.querySelector('.toast')?.textContent || '')).startsWith('Agent replied on block Shell.Router'));
  await dp.click('[data-thread="block:Shell.Router"]');
  const dRep = await dp.waitForSelector('.pop .sb-reply', { timeout: 3000 }).then(el => el.textContent()).catch(() => '');
  check('diff: the thread shows the agent reply', dRep.includes('It got a note.'), dRep);
  await dp.reload();
  await until(() => dp.evaluate(() => SBTEL.mode === 'diff' && !!document.querySelector('[data-thread="block:Shell.Router"]')));
  check('diff: after a reload the comment and its reply are still shown', await dp.evaluate(() => !!document.querySelector('[data-thread="block:Shell.Router"]') && (state.comments[0].replies || []).length === 1));
  // A review of a diff: comments and a message, no edits; there is no Save.
  await commentVia(dp, 'Shell.Router', 'Is the note needed?', 'review');
  await dp.click('#rvBtn');
  await dp.fill('#rvMsg', 'Looks right otherwise.');
  check('diff: the Review panel has comments and a message, no edits, and there is no Save', await dp.evaluate(() => document.getElementById('rvEdits').hidden && document.querySelectorAll('#rvComments .rv-c').length === 1 && !document.getElementById('sbSave')));
  await dp.click('#rvSend');
  await until(() => dp.evaluate(() => !state.comments.some(c => c.status === 'pending')));
  const dr = sb(['inbox', did]).out;
  check('diff: inbox prints the review with its comment and message, no proposal', /^r\d+ review of version 1 by user, \S+: a message, 1 comment\n  > Looks right otherwise\.\n  c\d+\.1 comment on block Shell\.Router\n    > Is the note needed\?/.test(dr) && !dr.includes('proposed spec'), dr);
  await dp.close();
  sb(['close', did]);

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('server and diff pages made no request to a host other than 127.0.0.1', outside.length === 0, outside.join(' '));

  // ---- standalone is untouched ----
  const sp = await ctx.newPage();
  await sp.goto('file://' + path.join(ROOT, 'viewer/dist/index.html'));
  await sp.waitForTimeout(800);
  check('standalone page makes no network request', outside.length === 0, outside.join(' '));
  check('standalone page has no server UI', await sp.evaluate(() => SBTEL.mode === 'standalone' && !document.getElementById('sbSave') && !document.querySelector('.sb-bar') && !document.getElementById('rvBtn') && document.title === 'sbtel Playground'));
  check('standalone composer keeps Save and Send', await sp.evaluate(() => { openComposer('block:Shell.Router'); const b = [...document.querySelectorAll('.pop .acts button')].map(x => x.textContent); closePop('composer'); return JSON.stringify(b) === '["Cancel","Save","Send"]'; }));

  await browser.close();
  sb(['serve', '--stop']);
  console.log(failed ? `${failed} FAILED (work dir ${TMP})` : 'ALL PASS');
  if (!failed) fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); sb(['serve', '--stop']); process.exit(1); });
