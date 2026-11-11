// accept13: the keyboard. Moving by sight (the arrows), Tab in reading order and out of the canvas at
// the end, in and out (Shift+Down, Shift+Up), Space, Enter, the ears, what a focused button keeps, and the pan
// that keeps the selection in view. Keys go through the page's own handler, as real ones do.
window.__accept = async function () {
  const r = {}, wait = ms => new Promise(f => setTimeout(f, ms));
  const key = (k, o = {}) => { const e = new KeyboardEvent('keydown', { key:k, bubbles:true, cancelable:true, ...o }); (o.on || document.body).dispatchEvent(e); return e.defaultPrevented; };
  const NAMES = { l:'ArrowLeft', r:'ArrowRight', u:'ArrowUp', d:'ArrowDown', out:'ArrowUp', in:'ArrowDown' };
  const walk = keys => keys.map(k => { key(NAMES[k], { shiftKey: k === 'out' || k === 'in' }); return state.sel; }).join(' ');
  const is = (name, got, want) => { r[name] = got === want ? 'pass' : `fail: ${got}`; };
  // Wait for something the page does in its own time (a dialog, a pan), however busy the machine is.
  const until = async (f, ms = 4000) => { for (const t0 = performance.now(); performance.now() - t0 < ms;) { if (f()) return true; await wait(40); } return !!f(); };
  const help = document.getElementById('help'); if (!help.hidden) document.getElementById('helpBtn').click();
  setSource(`(block app (~ The app. ~)
  (shape note (~ A note. ~))
  (level :name "Top" (block shell (~ Wires it. ~)))
  (level :name "Middle"
    (adjacent (block editor (gives note) (~ Type. ~)) (block preview (~ See. ~)))
    (block sync (~ Sync. ~)) (block search (~ Find. ~)))
  (level :name "Bottom"
    (block store (takes note) (~ Keep. ~)
      (level (block save (~ Write. ~)) (block load (~ Read. ~)))
      (level (block atomic (~ Rename. ~))))
    (block index (~ Words. ~))))`);
  state.open = new Set(['app']); render(); fit(false); await wait(200);

  select('editor', null);
  is('alongARow', walk(['r', 'r', 'r', 'r', 'l', 'l']), 'preview sync search search sync preview');
  select('editor', null);
  is('upAndDown', walk(['u', 'u', 'd', 'd']), 'shell app shell editor');
  select(null, null); key('ArrowDown'); is('startsNearTheMiddle', !!state.sel, true);

  select('store', null);
  is('inOpensAndEnters', walk(['in', 'r', 'd', 'out', 'out', 'out']), 'save load atomic store app app');
  is('inOpened', state.open.has('store'), true);
  select('store', null); key(' '); is('spaceCloses', state.open.has('store'), false); key(' '); is('spaceOpens', state.open.has('store'), true);
  select('store', null); key('S'); await until(() => document.querySelector('.codep')); is('capsLockIsNotShift', !!document.querySelector('.codep'), true); key('Escape'); await wait(100);   // a capital without Shift is Caps Lock: still S

  select(null, null); const order = []; let left = false;
  for (let i = 0; i < 20; i++) { const took = key('Tab'); if (!state.sel) { left = !took; break; } order.push(state.sel); }
  is('tabReadingOrder', order.join(' '), 'app shell editor preview sync search store save load atomic index μ:note');
  is('tabLeavesAtTheEnd', left, true);
  key('Tab', { shiftKey:true }); is('shiftTabFromTheEnd', state.sel, 'μ:note');

  select('editor', null); key('>', { shiftKey:true }); is('earOpens', await until(() => !!(state.drawers.get('editor') || {}).bot), true); key('>', { shiftKey:true });
  select('sync', null); const btn = document.getElementById('fit'); btn.focus();
  is('buttonKeepsSpace', key(' ', { on:btn }), false); is('arrowsStillMove', (key('ArrowLeft', { on:btn }), state.sel), 'preview'); btn.blur();
  select('search', null); key('Enter');
  const field = () => document.querySelector('.modal input, .modal textarea, .editf input, .editf textarea'); await until(field);
  const dlg = field(); is('enterEdits', !!dlg, true);
  if (dlg) { dlg.focus(); key('ArrowDown', { on:dlg }); key(';', { on:dlg }); is('typingIsLeftAlone', state.sel, 'search'); }
  key('Escape'); await wait(150);

  select('shell', null); zoomAt(2.4, innerWidth / 2, innerHeight / 2); await wait(50);
  walk(['d', 'd', 'r']);
  const seen = () => { const b = state.elems.get(state.sel).getBoundingClientRect(); return b.left >= 0 && b.top >= 0 && b.left < innerWidth - 40 && b.top < innerHeight - 90; };
  is('selectionStaysInView', await until(seen), true);
  is('helpListsTheKeys', document.querySelectorAll('#helpKeys dt').length >= 10, true);
  return r;
};
