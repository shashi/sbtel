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
  async function drag(from, to, o = {}, beforeUp) {
    const [x0, y0] = from, [x1, y1] = to;
    const downT = document.elementFromPoint(x0, y0);
    ev('pointerdown', x0, y0, o); await wait(30);
    for (let i = 1; i <= 12; i++) { ev('pointermove', x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12, o); await wait(16); }
    await wait(120);
    if (beforeUp) await beforeUp();
    const upT = document.elementFromPoint(x1, y1);
    ev('pointerup', x1, y1, o); await wait(30);
    // Browsers fire click on the nearest common ancestor of the press and release targets, even after a drag.
    let c = downT; while (c && upT && !c.contains(upT)) c = c.parentElement;
    if (c && c.isConnected) c.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, clientX:x1, clientY:y1, shiftKey:!!o.shiftKey }));
    await wait(250);
  }
  const model = () => parse(src());
  const parentOf = n => { const b = model().blocks.get(n); return b && b.parent ? b.parent.name : null; };
  const levelOf = n => { const m = model(), b = m.blocks.get(n); if (!b || !b.parent) return null; return b.parent.levels.findIndex(L => L.units.some(u => u.blocks.some(x => x.name === n))); };
  const orderIn = (n) => { const m = model(), b = m.blocks.get(n); const L = b.parent.levels.find(L => L.units.some(u => u.blocks.some(x => x.name === n))); return L.units.flatMap(u => u.blocks.map(x => x.name)); };
  const checksOk = () => { const m = model(); return !m.warnings.length && !lintSpec(m).some(c => c.f.length); };
  const original = src();
  const reset = async () => { try { closeModal(); } catch (e) {} document.querySelectorAll('.modal').forEach(x => x.remove()); document.querySelectorAll('.scrim').forEach(x => x.remove()); if (src() !== original) setSource(original); try { select(null, null); } catch (e) {} await wait(120); await wait(300); document.body.getBoundingClientRect(); await wait(100); };
  const step = async (name, fn) => { try { r[name] = await fn(); } catch (e) { r[name] = 'ERROR ' + e.message; } await reset(); };
  const btn = re => [...document.querySelectorAll('button')].find(b => re.test(b.textContent.trim()) && b.offsetParent !== null);
  const undoKey = async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'z', metaKey:true, bubbles:true })); await wait(200); };
  try { state.opts.animate = false; } catch (e) {}
  await wait(200); fit(false); await wait(200);

  await step('dragIntoOtherBlock', async () => {
    const sa = rect(blk('Shell.ScrollAnchor'));
    await drag(titlePt('Shell.Theme'), [sa.right + 60 * state.cam.k + 30, sa.top + sa.height / 2]);
    const p = parentOf('Shell.Theme');
    if (p !== 'Shell.SessionView') return 'fail: parent ' + p;
    return levelOf('Shell.Theme') === levelOf('Shell.ScrollAnchor') ? 'pass' : 'partial: moved into SessionView but another level';
  });
  await step('oneUndoRestores', async () => {
    const sa = rect(blk('Shell.ScrollAnchor'));
    await drag(titlePt('Shell.Theme'), [sa.right + 60 * state.cam.k + 30, sa.top + sa.height / 2]);
    if (src() === original) return 'fail: drag did nothing';
    await undoKey(); return src() === original ? 'pass' : 'fail: one undo did not restore';
  });
  await step('reorderSameLevel', async () => {
    const ss = rect(blk('Shell.SessionStore'));
    await drag(titlePt('Shell.LowLevelThing'), [ss.right + 50 * state.cam.k + 20, ss.top + ss.height / 2]);
    const o = orderIn('Shell.LowLevelThing');
    return parentOf('Shell.LowLevelThing') === 'Shell' && o.indexOf('Shell.LowLevelThing') > o.indexOf('Shell.SessionStore') ? 'pass' : 'fail: order ' + o.join(',') + ' parent ' + parentOf('Shell.LowLevelThing');
  });
  await step('leaveGroupStaysValid', async () => {
    const sa = rect(blk('Shell.ScrollAnchor'));
    await drag(titlePt('Shell.Router'), [sa.right + 60 * state.cam.k + 30, sa.top + sa.height / 2]);
    if (parentOf('Shell.Router') === 'Shell') return 'fail: not moved';
    return checksOk() && /\(adjacent\s+(?:\(~[^~]*~\)\s+)?\(block Shell\.Keymap[\s\S]*?\(block Shell\.Clipboard/.test(src()) ? 'pass' : 'fail: group or checks broken';
  });
  await step('noDropIntoSelf', async () => {
    const sa = rect(blk('Shell.ScrollAnchor'));
    const sv = rect(blk('Shell.SessionView'));
    await drag([sv.left + 40, sv.top + 16], [sa.right + 60 * state.cam.k + 30, sa.top + sa.height / 2]);
    return parentOf('Shell.SessionView') === 'Shell' && checksOk() ? 'pass' : 'fail: moved into itself';
  });
  await step('escapeCancels', async () => {
    const sa = rect(blk('Shell.ScrollAnchor'));
    await drag(titlePt('Shell.Theme'), [sa.right + 60 * state.cam.k + 30, sa.top + sa.height / 2], {}, async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); await wait(50); });
    return src() === original ? 'pass' : 'fail: escape did not cancel';
  });
  await step('panStillWorks', async () => {
    let x = 0, y = 0;
    for (let yy = 80; yy < innerHeight - 100 && !x; yy += 20) for (let xx = 20; xx < 300; xx += 20) { const t = document.elementFromPoint(xx, yy); if (t && t.id === 'vp') { x = xx; y = yy; break; } }
    if (!x) return 'fail: no empty canvas found';
    const before = state.cam.x;
    await drag([x, y], [x + 80, y + 10]);
    return Math.abs(state.cam.x - before - 80) < 2 && src() === original ? 'pass' : `fail: cam moved ${state.cam.x - before}`;
  });
  await step('clickSelects', async () => {
    blk('Shell.Theme').querySelector('.ttl').dispatchEvent(new MouseEvent('click', { bubbles:true })); await wait(80);
    return document.querySelectorAll('.blk.sel').length === 1 ? 'pass' : 'fail';
  });
  async function editVia(id, fill) {
    blk(id).querySelector('.ttl').dispatchEvent(new MouseEvent('click', { bubbles:true })); await wait(80);
    const e = btn(/^edit$/i); if (!e) throw new Error('no Edit button');
    e.click(); await wait(100);
    const m = document.querySelector('.modal'); if (!m) throw new Error('no dialog');
    for (const [k, v] of Object.entries(fill)) { const f = m.querySelector(`[name="${k}"]`); if (!f) throw new Error('no field ' + k); f.value = v; f.dispatchEvent(new Event('input', { bubbles:true })); }
    const s = [...m.querySelectorAll('button')].find(b => /^save$/i.test(b.textContent.trim())); if (!s) throw new Error('no Save');
    s.click(); await wait(200);
    return m;
  }
  await step('editBlock', async () => {
    await editVia('Shell.Theme', { name:'Shell.Theming', type:'Service', sketch:'Tokens for both themes.' });
    const b = model().blocks.get('Shell.Theming');
    if (!b) return 'fail: not renamed';
    if (b.type !== 'Service' || b.sketch !== 'Tokens for both themes.') return 'fail: type or sketch';
    await undoKey(); return src() === original ? 'pass' : 'fail: one undo did not restore';
  });
  await step('emptyTypeRemoves', async () => {
    await editVia('Shell.SessionStore', { name:'Shell.SessionStore', type:'', sketch:model().blocks.get('Shell.SessionStore').sketch });
    return model().blocks.get('Shell.SessionStore').type ? 'fail: type kept' : 'pass';
  });
  await step('renameBehaviorUpdatesRefs', async () => {
    await editVia('β:Durable', { name:'Persistent', sketch:model().behaviors.get('Durable').sketch });
    return !/\bDurable\b/.test(src()) && (src().match(/\(implements Persistent\)/g) || []).length === 2 && checksOk() ? 'pass' : 'fail';
  });
  await step('renameMessageUpdatesRefs', async () => {
    await editVia('μ:SessionEvent', { name:'SessionChange', sketch:model().messages.get('SessionEvent').sketch });
    return !/\bSessionEvent\b/.test(src()) && /\(refines SessionChange\)/.test(src()) && checksOk() ? 'pass' : 'fail';
  });
  await step('duplicateRejected', async () => {
    let m; try { m = await editVia('Shell.Theme', { name:'Shell.Router' }); } catch (e) { return 'ERROR ' + e.message; }
    return src() === original ? 'pass' : 'fail: duplicate accepted';
  });
  await step('shiftAttachBehavior', async () => {
    await drag(titlePt('β:Durable'), mid(blk('Shell.Theme')), { shiftKey:true });
    const b = model().blocks.get('Shell.Theme');
    return b.impl.includes('Durable') && checksOk() ? 'pass' : 'fail: impl ' + JSON.stringify(b.impl) + (src() === original ? ' (source unchanged)' : ' (source changed)');
  });
  await step('behaviorOutOfScopeRefused', async () => {
    await drag(titlePt('β:Scrollable'), mid(blk('Shell.Theme')), { shiftKey:true });
    return src() === original ? 'pass' : 'fail: out-of-scope attach accepted';
  });
  await step('shiftAttachMessageTopEar', async () => {
    const ear = blk('Shell.Router').querySelector('.tab.top');
    await drag(titlePt('μ:KeyChord'), mid(ear), { shiftKey:true });
    const b = model().blocks.get('Shell.Router');
    return b.ownPorts.some(p => p.name === 'keyChord' && p.dir === 'in' && p.kind === 'KeyChord') && checksOk() ? 'pass' : 'fail: ports ' + JSON.stringify(b.ownPorts);
  });
  await step('shiftAttachMessageBottomEdge', async () => {
    const t = rect(blk('Shell.Theme'));
    await drag(titlePt('μ:Notice'), [t.left + t.width / 2, t.bottom - 4], { shiftKey:true });
    const b = model().blocks.get('Shell.Theme');
    return b.ownPorts.some(p => p.name === 'notice' && p.dir === 'out' && p.kind === 'Notice') ? 'pass' : 'fail: ports ' + JSON.stringify(b.ownPorts);
  });
  await step('layoutChecksStillPass', async () => (state.lay.checks.some(c => c.f.length) ? 'fail' : 'pass'));
  return r;
};
