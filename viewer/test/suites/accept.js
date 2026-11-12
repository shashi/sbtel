// Acceptance test injected into a copy of each result. Drives the real UI with DOM events.
window.__accept = async function () {
  const r = {}, wait = ms => new Promise(f => setTimeout(f, ms));
  const src = () => document.getElementById('src').value;
  const blk = id => document.querySelector(`.blk[data-id="${CSS.escape(id)}"]`);
  const click = (el, opts = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...opts }));
  const key = (k, opts = {}) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const has = name => new RegExp('\\(block ' + name.replace(/\./g, '\\.') + '\\b').test(src());
  const step = async (name, fn) => { try { r[name] = await fn(); } catch (e) { r[name] = 'ERROR ' + e.message; } };
  try { state.opts.animate = false; } catch (e) {}
  await wait(300);
  const original = src();
  const ids = ['Shell.Theme', 'Shell.LowLevelThing', 'Shell.Clipboard'];

  await step('multiSelectOutlines', async () => {
    // Under load the page may not be ready for the first click: make each one, then wait until it shows.
    const sel = () => document.querySelectorAll('.blk.sel').length;
    const until = async f => { for (const t0 = performance.now(); performance.now() - t0 < 3000;) { if (f()) return true; await wait(40); } return f(); };
    for (let i = 0; i < 3; i++) {
      for (let tries = 0; tries < 3 && sel() !== i + 1; tries++) { if (!blk(ids[i]).classList.contains('sel')) click(blk(ids[i]).querySelector('.ttl'), i ? { shiftKey: true } : {}); await until(() => sel() === i + 1); }
    }
    return document.querySelectorAll('.blk.sel').length === 3 ? 'pass' : 'fail: ' + document.querySelectorAll('.blk.sel').length + ' outlined';
  });
  await step('noHandlesWhenMany', async () => document.querySelectorAll('.hdl').length === 0 ? 'pass' : 'fail: ' + document.querySelectorAll('.hdl').length + ' handles');
  await step('shiftToggleOff', async () => {
    click(blk(ids[2]).querySelector('.ttl'), { shiftKey: true }); await wait(60);
    const n = document.querySelectorAll('.blk.sel').length;
    click(blk(ids[2]).querySelector('.ttl'), { shiftKey: true }); await wait(60);
    return n === 2 && document.querySelectorAll('.blk.sel').length === 3 ? 'pass' : 'fail: after toggle ' + n;
  });
  await step('oneDialogListsAll', async () => {
    key('Delete'); await wait(80);
    const m = document.querySelectorAll('.modal');
    if (m.length !== 1) return 'fail: ' + m.length + ' dialogs';
    const t = m[0].textContent;
    const missing = ids.filter(i => !t.includes(i));
    return missing.length ? 'fail: dialog missing ' + missing.join(', ') : 'pass';
  });
  await step('confirmDeletesAll', async () => {
    const m = document.querySelector('.modal'); if (!m) return 'fail: no dialog';
    const b = [...m.querySelectorAll('button')].find(x => /delete/i.test(x.textContent) && !/cancel/i.test(x.textContent));
    if (!b) return 'fail: no confirm button';
    click(b); await wait(150);
    const left = ids.filter(has);
    const keep = ['Shell.Router', 'Shell.Keymap', 'Shell.SurfaceKit', 'Shell.SessionStore'].filter(x => !has(x));
    let parses = 'yes'; try { parse(src()); } catch (e) { parses = e.message; }
    const groupKept = /\(adjacent\s+(?:\(~[^~]*~\)\s+)?\(block Shell\.Router[\s\S]*?\(block Shell\.Keymap/.test(src());
    return !left.length && !keep.length && parses === 'yes' && groupKept ? 'pass' : `fail: left=${left} lost=${keep} parses=${parses} routerKeymapGroup=${groupKept}`;
  });
  await step('checksStillPass', async () => {
    const all = [...state.lay.checks, ...(state.lay.spec || [])].filter(c => c.f.length);
    return all.length ? 'fail: ' + all.map(c => c.k).join(',') : 'pass';
  });
  await step('singleUndoRestoresAll', async () => {
    key('z', { metaKey: true }); await wait(150);
    return src() === original ? 'pass' : 'fail: source differs after one undo';
  });
  await step('singleSelectStillWorks', async () => {
    click(blk('Shell.Router').querySelector('.ttl')); await wait(60);
    const sel = document.querySelectorAll('.blk.sel').length, h = document.querySelectorAll('.hdl').length;
    return sel === 1 && h === 4 ? 'pass' : `fail: ${sel} selected, ${h} handles`;
  });
  await step('singleDeleteDialog', async () => {
    key('Delete'); await wait(80);
    const m = document.querySelector('.modal');
    const ok = m && m.textContent.includes('Shell.Router');
    key('Escape'); await wait(60);
    if (document.querySelector('.modal')) { const c = [...document.querySelectorAll('.modal button')].find(x => /cancel/i.test(x.textContent)); c && click(c); await wait(60); }
    return ok && src() === original ? 'pass' : 'fail: dialog=' + !!m;
  });
  await step('lineCutStillWorks', async () => {
    key('Escape'); await wait(40);
    const p = document.querySelector('#lines path.hit'); if (!p) return 'fail: no line';
    click(p); await wait(60);
    key('Delete'); await wait(150);
    const changed = src() !== original;
    key('z', { metaKey: true }); await wait(150);
    return changed && src() === original ? 'pass' : `fail: changed=${changed}`;
  });
  return r;
};
