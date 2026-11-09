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

  const unitOf = n => { const m = model(), b = m.blocks.get(n); const L = b.parent.levels.find(L => L.units.some(u => u.blocks.some(x => x.name === n))); return L.units.find(u => u.blocks.some(x => x.name === n)).blocks.map(x => x.name); };
  const gap = (a, b) => { const A = rect(blk(a)), B = rect(blk(b)); return [(A.right + B.left) / 2, A.top + Math.min(A.height, B.height) / 2]; };
  await step('joinBetweenLinked', async () => {
    await drag(titlePt('Shell.Theme'), gap('Shell.Router', 'Shell.Keymap'));
    const u = unitOf('Shell.Theme');
    return u.join(',') === 'Shell.Router,Shell.Theme,Shell.Keymap,Shell.Clipboard' && checksOk() ? 'pass' : 'fail: unit ' + u.join(',');
  });
  await step('reorderInsideGroup', async () => {
    await drag(titlePt('Shell.Clipboard'), gap('Shell.Router', 'Shell.Keymap'));
    const u = unitOf('Shell.Clipboard');
    return u.join(',') === 'Shell.Router,Shell.Clipboard,Shell.Keymap' && checksOk() ? 'pass' : 'fail: unit ' + u.join(',');
  });
  await step('sketchExpands', async () => {
    const sk = document.querySelector('.sk.more'); if (!sk) return 'fail: no clipped sketch';
    const card = sk.closest('.blk'), id = card.dataset.id, h0 = card.getBoundingClientRect().height;
    sk.dispatchEvent(new MouseEvent('click', { bubbles:true })); await wait(250);
    const h1 = blk(id).getBoundingClientRect().height, sel = document.querySelectorAll('.blk.sel').length;
    const sk2 = blk(id).querySelector('.sk'); sk2.dispatchEvent(new MouseEvent('click', { bubbles:true })); await wait(250);
    const h2 = blk(id).getBoundingClientRect().height;
    return h1 > h0 && Math.abs(h2 - h0) < 1 && sel === 0 && src() === original ? 'pass' : `fail: ${h0}->${h1}->${h2} sel=${sel}`;
  });
  return r;
};
