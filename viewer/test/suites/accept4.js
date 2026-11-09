// accept4: the canvas as the root block (menu, top-level levels), bounce-back drops, persistent separators.
window.__accept = async function () {
  const r = {}, wait = ms => new Promise(f => setTimeout(f, ms));
  const src = () => document.getElementById('src').value;
  const blk = id => document.querySelector(`.blk[data-id="${CSS.escape(id)}"]`);
  const rect = el => el.getBoundingClientRect();
  const mid = el => { const b = rect(el); return [b.left + b.width / 2, b.top + b.height / 2]; };
  const titlePt = id => mid(blk(id).querySelector('.ttl') || blk(id));
  const ev = (type, x, y, o = {}) => {
    const t = document.elementFromPoint(x, y) || document.body;
    t.dispatchEvent(new PointerEvent(type, { bubbles:true, cancelable:true, composed:true, clientX:x, clientY:y, pointerId:7, pointerType:'mouse', isPrimary:true, button:0, buttons: type === 'pointerup' ? 0 : 1, ...o }));
  };
  const toScreen = (wx, wy) => [wx * state.cam.k + state.cam.x, wy * state.cam.k + state.cam.y];
  // Press on `from`, move a little to start the drag, then go to the centre of the zone `pick` chooses
  // from drag.zones (the declarative drop zones), check it is the previewed one, and release there.
  async function dragToZone(from, pick, o = {}, beforeUp, fy) {
    const [x0, y0] = from, downT = document.elementFromPoint(x0, y0);
    ev('pointerdown', x0, y0, o); await wait(30);
    for (let i = 1; i <= 4; i++) { ev('pointermove', x0 + 3 * i, y0 + 3 * i, o); await wait(16); }
    if (!drag) throw new Error('drag did not start');
    const z = pick(drag.zones); if (!z) { ev('pointerup', x0, y0, o); throw new Error('no such zone'); }
    const [x1, y1] = toScreen(z.x + z.w / 2, z.y + (fy != null ? z.h * fy : Math.min(z.h / 2, 40)));
    for (let i = 1; i <= 8; i++) { ev('pointermove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8, o); await wait(16); }
    await wait(80);
    const chosen = drag.best === z || !!(drag.best && z.bad && drag.best.bad && drag.best.act.dest.block === z.act.dest.block);
    if (beforeUp) await beforeUp();
    const upT = document.elementFromPoint(x1, y1);
    ev('pointerup', x1, y1, o); await wait(30);
    let c = downT; while (c && upT && !c.contains(upT)) c = c.parentElement;
    if (c && c.isConnected) c.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, clientX:x1, clientY:y1, shiftKey:!!o.shiftKey }));
    await wait(250);
    return { chosen, zone:z };
  }
  async function drag2(from, to, o = {}) {
    const [x0, y0] = from, [x1, y1] = to, downT = document.elementFromPoint(x0, y0);
    ev('pointerdown', x0, y0, o); await wait(30);
    for (let i = 1; i <= 12; i++) { ev('pointermove', x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12, o); await wait(16); }
    await wait(120);
    const upT = document.elementFromPoint(x1, y1);
    ev('pointerup', x1, y1, o); await wait(30);
    let c = downT; while (c && upT && !c.contains(upT)) c = c.parentElement;
    if (c && c.isConnected) c.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, clientX:x1, clientY:y1, shiftKey:!!o.shiftKey }));
    await wait(250);
  }
  const model = () => parse(src());
  const checksOk = () => { const m = model(); return !m.warnings.length && !lintSpec(m).some(c => c.f.length) && !state.lay.checks.some(c => c.f.length); };
  const toastText = () => toastEl.hidden ? '' : toastEl.textContent;
  const original = src();
  const reset = async () => { try { closeModal(); } catch (e) {} try { closePop(); } catch (e) {} document.querySelectorAll('.modal, .scrim').forEach(x => x.remove()); if (src() !== original) setSource(original); try { select(null, null); } catch (e) {} toastEl.hidden = true; await wait(400); };
  const step = async (name, fn) => { try { r[name] = await fn(); } catch (e) { r[name] = 'ERROR ' + e.message; } await reset(); };
  const undoKey = async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'z', metaKey:true, bubbles:true })); await wait(200); };
  const rootZone = (bad) => zs => zs.find(z => z.act.dest.block.virtual && !!z.bad === bad && z.act.dest.edge === 'end') || zs.find(z => z.act.dest.block.virtual && !!z.bad === bad);
  const same = (a, b) => Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5;
  try { state.opts.animate = false; } catch (e) {}
  await wait(200); fit(false); await wait(200);

  // (a) Shell.Sidebar to the top level: preview, then bounce back with a toast; no edit, no undo entry.
  await step('sidebarBounces', async () => {
    const before = rect(blk('Shell.Sidebar')), undoN = hist.undo.length, cam = { ...state.cam };
    let preview = null;
    const res = await dragToZone(titlePt('Shell.Sidebar'), rootZone(true), {}, async () => {
      // The preview is the drop's layout, as for any other zone; the landing rect is drawn as a warning.
      preview = { shown: drag.shown === drag.best.lay, warn: !!document.querySelector('#ovl rect.dropz.bad') };
    });
    const t = toastText(), after = rect(blk('Shell.Sidebar'));
    const want = 'Shell.Sidebar depends on behavior Surface (declared in Shell). Move Surface first.';
    const fails = [];
    if (!res.chosen) fails.push('zone not chosen');
    if (!preview.shown || !preview.warn) fails.push('preview ' + JSON.stringify(preview));
    if (src() !== original) fails.push('source changed');
    if (t !== want) fails.push('toast "' + t + '"');
    if (!same(before, after)) fails.push('block not back');
    if (hist.undo.length !== undoN) fails.push('undo entry added');
    if (state.cam.x !== cam.x || state.cam.y !== cam.y || state.cam.k !== cam.k) fails.push('camera moved');
    // The first click after the bounce selects.
    blk('Shell.Theme').querySelector('.ttl').dispatchEvent(new MouseEvent('click', { bubbles:true, clientX:5, clientY:5 })); await wait(80);
    if (state.sel !== 'Shell.Theme') fails.push('first click after drag swallowed');
    return fails.length ? 'fail: ' + fails.join('; ') : 'pass';
  });
  await step('releaseAtStartNoop', async () => {
    const p = titlePt('Shell.Sidebar'), undoN = hist.undo.length;
    await drag2(p, [p[0] + 1, p[1] + 1]);
    await drag2(p, [p[0] + 30, p[1] + 2]);
    return src() === original && hist.undo.length === undoN && !/depends/.test(toastText()) ? 'pass' : 'fail: ' + toastText();
  });
  await step('messageTypeBounce', async () => {
    await dragToZone(titlePt('Shell.CommandPalette'), rootZone(true));
    const t = toastText();
    return src() === original && t === 'Shell.CommandPalette uses message type KeyChord (declared in Shell). Move KeyChord first. (+1 more)' ? 'pass' : 'fail: "' + t + '"';
  });
  await step('descendantBounceCollapsed', async () => {
    // A collapsed block whose only dependency is in a descendant.
    const s2 = original.replace('(block Shell.Sidebar\n        (implements Surface)\n        (sketch "Recent sessions and the project switcher.")))',
      '(block Shell.Sidebar\n        (sketch "Recent sessions and the project switcher.")\n        (level\n          (block Shell.Sidebar.Foo (implements Durable) (port :in SessionEvent :as events)))))');
    if (s2 === original) return 'fail: fixture';
    setSource(s2); state.open.delete('Shell.Sidebar'); render(); await wait(200);
    if (blk('Shell.Sidebar').classList.contains('frame')) return 'fail: not collapsed';
    await dragToZone(titlePt('Shell.Sidebar'), rootZone(true));
    const t = toastText();
    return src() === s2 && t === 'Shell.Sidebar.Foo depends on behavior Durable (declared in Shell). Move Durable first. (+1 more)' ? 'pass' : 'fail: "' + t + '"';
  });
  await step('declarationMoves', async () => {
    // Surface can't go up before the types its ports use; Frame can, and that is one undoable edit.
    await dragToZone(titlePt('β:Surface'), rootZone(true));
    const t = toastText();
    if (src() !== original || t !== 'Surface uses message type Frame (declared in Shell). Move Frame first. (+1 more)') return 'fail: surface "' + t + '"';
    const fr = await dragToZone(titlePt('μ:Frame'), zs => { window.__dbg = zs.map(z => [z.act.dest.block.id, z.act.dest.at, !!z.bad, z.noop, Math.round(z.x), Math.round(z.y)]); return zs.find(z => z.act.dest.block.virtual && !z.bad); }, {}, null, 0.85); window.__dbg.push(fr.chosen, toastText());
    const m = model(), f = m.messages.get('Frame');
    if (!f || f.owner !== null || !checksOk()) return 'fail: Frame owner ' + (f && f.owner && f.owner.name) + ' ' + JSON.stringify(window.__dbg);
    if (!blk('μ:Frame') || !document.querySelector('.cvx .bandlab')) return 'fail: no top-level appendix';
    await undoKey();
    return src() === original ? 'pass' : 'fail: undo';
  });
  await step('declarationBreaksUsers', async () => {
    await dragToZone(titlePt('β:Surface'), zs => zs.find(z => z.act.dest.block.id === 'Shell.SessionView' && z.bad));
    const t = toastText();
    return src() === original && /^Shell\.\S+ depends on behavior Surface, which would be out of its reach in Shell\.SessionView\./.test(t) ? 'pass' : 'fail: "' + t + '"';
  });
  await step('attachOutOfScopeBounces', async () => {
    const before = rect(blk('β:Scrollable'));
    await drag2(titlePt('β:Scrollable'), mid(blk('Shell.Theme')), { shiftKey:true });
    const t = toastText();
    return src() === original && same(before, rect(blk('β:Scrollable'))) && t === "Shell.Theme can't implement Scrollable: Scrollable is declared in Shell.SessionView, and Shell.Theme is outside it." ? 'pass' : 'fail: "' + t + '"';
  });
  await step('escapeStillCancels', async () => {
    await dragToZone(titlePt('Shell.Sidebar'), rootZone(true), {}, async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); await wait(50); });
    return src() === original && !/depends/.test(toastText()) && !drag ? 'pass' : 'fail';
  });

  // (b) A top-level level through the UI, then a block moved into it and reordered there.
  await step('topLevelAddAndMove', async () => {
    const g = document.querySelector('.aff.gutter[data-key="|start"] button'); if (!g) return 'fail: no top gutter';
    g.click(); await wait(200);
    const s1 = src(), m1 = model();
    if (m1.root.levels.length !== 2 || m1.root.levels[0].kind !== 'level' || topBlocks(m1)[0].name !== 'NewBlock1' || !checksOk()) return 'fail: level not added';
    await dragToZone(titlePt('Shell.Theme'), zs => zs.find(z => z.act.dest.block.virtual && z.act.dest.level === 0 && z.act.dest.at === 1 && !z.bad));
    const m2 = model(), th = m2.blocks.get('Shell.Theme');
    if (th.parent !== null || !m2.root.levels[0].units.some(u => u.blocks.includes(th)) || !checksOk()) return 'fail: not moved into top level';
    const s2 = src();
    await dragToZone(titlePt('Shell.Theme'), zs => zs.find(z => z.act.dest.block.virtual && z.act.dest.level === 0 && z.act.dest.at === 0 && !z.bad));
    const order = model().root.levels[0].units.map(u => u.blocks[0].name).join(',');
    if (order !== 'Shell.Theme,NewBlock1' || !checksOk()) return 'fail: reorder ' + order;
    await undoKey(); if (src() !== s2) return 'fail: undo reorder';
    await undoKey(); if (src() !== s1) return 'fail: undo move';
    await undoKey(); return src() === original ? 'pass' : 'fail: undo level';
  });

  // (c) Right-clicking empty canvas offers the root menu.
  const emptyPt = () => { for (let yy = 80; yy < innerHeight - 100; yy += 20) for (let xx = 20; xx < innerWidth - 20; xx += 20) { const t = document.elementFromPoint(xx, yy); if (t && t.id === 'vp') return [xx, yy]; } return null; };
  const ctx = (x, y) => document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, cancelable:true, clientX:x, clientY:y, button:2 }));
  const menuLabels = () => [...document.querySelectorAll('.pop.menu .mi')].map(b => b.textContent);
  await step('canvasRootMenu', async () => {
    const p = emptyPt(); if (!p) return 'fail: no empty canvas';
    ctx(...p); await wait(80);
    const L = menuLabels();
    const want = ['Add a block to this level', 'Insert a level above', 'Insert a level below', 'Add a behavior', 'Add a message type', 'Show source', 'Comment on the file'];
    const missing = want.filter(w => !L.includes(w)), extra = L.filter(l => /^(Edit|Delete|Open|Close)$/.test(l));
    if (missing.length || extra.length) return 'fail: missing ' + missing + ' extra ' + extra;
    [...document.querySelectorAll('.pop.menu .mi')].find(b => b.textContent === 'Add a behavior').click(); await wait(200);
    const bh = model().behaviors.get('NewBehavior1');
    if (!bh || bh.owner !== null || !checksOk() || !blk('β:NewBehavior1') || document.querySelector('.pop.menu')) return 'fail: behavior not added at top level';
    ctx(...emptyPt()); await wait(80);
    [...document.querySelectorAll('.pop.menu .mi')].find(b => b.textContent === 'Insert a level below').click(); await wait(200);
    if (model().root.levels.length !== 2 || !checksOk()) return 'fail: level below';
    await undoKey(); await undoKey();
    return src() === original ? 'pass' : 'fail: undo';
  });
  await step('blockMenuHasNodeItems', async () => {
    ctx(...titlePt('Shell.Theme')); await wait(80);
    const L = menuLabels();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); await wait(50);
    return ['Edit', 'Code', 'Comment', 'Delete', 'Add a behavior'].every(x => L.includes(x)) && !document.querySelector('.pop.menu') ? 'pass' : 'fail: ' + L.join('|');
  });

  // Separators keep their element through relayouts, drag previews and the bounce.
  const sepNodes = () => new Map([...document.querySelectorAll('.lsep')].map(e => [e.dataset.key, e]));
  await step('separatorsPersist', async () => {
    const s0 = sepNodes(); if (!s0.size) return 'fail: no separators';
    const fails = [];
    const check = (what) => { const now = sepNodes(); for (const [k, e] of s0) if (now.get(k) !== e || !e.isConnected) fails.push(what + ':' + k); };
    // A drawer opening relayouts the rows.
    document.querySelector('.blk[data-id="Shell.Router"] > .tab.top').dispatchEvent(new MouseEvent('click', { bubbles:true })); await wait(150);
    if (!drawersOpen('Shell.Router')) fails.push('drawer did not open');
    check('drawer');
    // During a drag preview and after the bounce.
    let moved = false;
    await dragToZone(titlePt('Shell.Sidebar'), rootZone(true), {}, async () => { check('preview'); const e = [...s0.values()][0]; moved = !!e; });
    check('bounce');
    // A real move.
    const sa = rect(blk('Shell.ScrollAnchor'));
    await drag2(titlePt('Shell.Theme'), [sa.right + 60 * state.cam.k + 30, sa.top + sa.height / 2]);
    if (src() === original) fails.push('move did not happen');
    check('move');
    return fails.length ? 'fail: ' + fails.join(', ') : 'pass';
  });
  await step('separatorPreviewMoves', async () => {
    // Moving Theme out of Shell's second level empties nothing, but Sidebar out of the first level moves the separator below it.
    const e = [...document.querySelectorAll('.lsep')].find(x => x.dataset.key === 'Shell|1'); if (!e) return 'fail: no Shell|1 separator';
    const t0 = e.style.transform; let t1 = null, same1 = false;
    await dragToZone(titlePt('Shell.SessionView'), zs => zs.find(z => z.act.dest.block.virtual), {}, async () => { t1 = e.style.transform; same1 = sepNodes().get('Shell|1') === e; });
    return same1 && t1 !== t0 ? 'pass' : `fail: same=${same1} ${t0} -> ${t1}`;
  });
  // Every separator + (and gutter +) is centred on its line, at several zoom levels, including top-level ones.
  await step('separatorPlusAligned', async () => {
    edit({ t:'level', block:state.model.root, at:1 }); await wait(200);
    const worst = {};
    for (const k of [0.5, 1, 2]) {
      state.cam.k = k; applyCam(); render(); await wait(60);
      let w = 0, n = 0, root = 0;
      state.lay.dividers.forEach(v => {
        const el = sepNodes().get(v.key), b = el.querySelector('.plus').getBoundingClientRect(), ly = v.y * k + state.cam.y, lx = (v.x2 - 10) * k + state.cam.x;
        w = Math.max(w, Math.abs(b.top + b.height / 2 - ly), Math.abs(b.left + b.width / 2 - lx)); n++; if (!v.act.block.id) root++;
      });
      state.lay.gutters.forEach(g => {
        const el = document.querySelector(`.aff.gutter[data-key="${CSS.escape(g.key)}"]`), b = el.querySelector('.plus').getBoundingClientRect();
        w = Math.max(w, Math.abs(b.top + b.height / 2 - (g.y * k + state.cam.y))); n++;
      });
      state.lay.plus.forEach(p => {
        const el = [...document.querySelectorAll('.aff:not(.gutter)')].find(a => a.style.transform === `translate(${p.x}px, ${p.y}px)`), b = el.querySelector('.plus').getBoundingClientRect();
        w = Math.max(w, Math.abs(b.top + b.height / 2 - (p.y * k + state.cam.y))); n++;
      });
      worst[k] = { worst: Math.round(w * 100) / 100, n, root };
    }
    fit(false);
    return Object.values(worst).every(x => x.worst < 0.01 && x.root > 0) ? 'pass' : 'fail: ' + JSON.stringify(worst);
  });
  // With animation on: the bounce slides home through the normal transition, separators stay visible
  // (same nodes, full opacity) while they move, and a genuinely new separator fades in.
  await step('animatedBounceAndFade', async () => {
    state.opts.animate = true; fit(false); render(); await wait(400);
    const home = rect(blk('Shell.Sidebar')), s0 = sepNodes(), cam = { ...state.cam }, fails = [];
    let midOpacity = [];
    await dragToZone(titlePt('Shell.Sidebar'), rootZone(true), {}, async () => { midOpacity = [...s0.values()].map(e => getComputedStyle(e).opacity); });
    // dragToZone waits ~280ms after release; the block must be home by now or within the transition.
    await wait(300);
    if (!same(home, rect(blk('Shell.Sidebar')))) fails.push('not home after bounce');
    if (midOpacity.some(o => o !== '1')) fails.push('separator faded during preview ' + midOpacity);
    for (const [k, e] of s0) if (sepNodes().get(k) !== e) fails.push('replaced ' + k);
    if (state.cam.x !== cam.x || state.cam.y !== cam.y) fails.push('camera moved');
    // A real slide happened: sample a bounce mid-flight.
    const p = titlePt('Shell.Sidebar'); let mid = null;
    ev('pointerdown', p[0], p[1]); await wait(20);
    for (let i = 1; i <= 4; i++) { ev('pointermove', p[0] + 3 * i, p[1] + 3 * i); await wait(16); }
    if (!drag) return 'fail: no 2nd drag; ' + fails.join('; ') + ' el=' + document.elementFromPoint(...p).className;
    const z = rootZone(true)(drag.zones); if (!z) return 'fail: no zone for ' + drag.id + '; ' + fails.join('; ');
    const [x1, y1] = toScreen(z.x + z.w / 2, z.y + Math.min(z.h / 2, 40));
    ev('pointermove', x1, y1); await wait(60); ev('pointerup', x1, y1); await wait(90);
    mid = rect(blk('Shell.Sidebar'));
    if (same(mid, home)) fails.push('no slide (snapped)');
    await wait(500);
    if (!same(home, rect(blk('Shell.Sidebar')))) fails.push('not home after slide');
    // A new separator fades in.
    edit({ t:'level', block:state.model.root, at:1 }); await wait(30);
    const fresh = [...document.querySelectorAll('.lsep')].find(e => !s0.has(e.dataset.key));
    const o1 = fresh && +getComputedStyle(fresh).opacity; await wait(450); const o2 = fresh && +getComputedStyle(fresh).opacity;
    if (!fresh || !(o1 < 1) || o2 !== 1) fails.push(`fade-in ${o1} -> ${o2}`);
    state.opts.animate = false;
    return fails.length ? 'fail: ' + fails.join('; ') : 'pass';
  });
  await step('checksStillPass', async () => checksOk() ? 'pass' : 'fail');
  return r;
};
