// accept13: the keyboard. Moving by sight (H J K L, arrows), Tab in reading order and out of the canvas at
// the end, in and out (Shift+L, Shift+H), Space, Enter, the ears, what a focused button keeps, and the pan
// that keeps the selection in view. Keys go through the page's own handler, as real ones do.
window.__accept = async function () {
  const r = {}, wait = ms => new Promise(f => setTimeout(f, ms));
  const key = (k, o = {}) => { const e = new KeyboardEvent('keydown', { key:k, bubbles:true, cancelable:true, ...o }); (o.on || document.body).dispatchEvent(e); return e.defaultPrevented; };
  const walk = keys => keys.map(k => { k.length > 1 && k[0] === '^' ? key(k.slice(1).toLowerCase(), { shiftKey:true }) : key(k); return state.sel; }).join(' ');
  const is = (name, got, want) => { r[name] = got === want ? 'pass' : `fail: ${got}`; };
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
  is('alongARow', walk(['l', 'l', 'l', 'l', 'h', 'ArrowLeft']), 'preview sync search search sync preview');
  select('editor', null);
  is('upAndDown', walk(['k', 'k', 'j', 'ArrowDown']), 'shell app shell editor');
  select(null, null); key('j'); is('startsNearTheMiddle', !!state.sel, true);

  select('store', null);
  is('inOpensAndEnters', walk(['^L', 'l', 'j', '^H', '^H', '^H']), 'save load atomic store app app');
  is('inOpened', state.open.has('store'), true);
  select('store', null); key(' '); is('spaceCloses', state.open.has('store'), false); key(' '); is('spaceOpens', state.open.has('store'), true);
  select('preview', null); key('H'); is('capsLockIsNotShift', state.sel, 'editor');   // a capital without Shift is Caps Lock: still "left"

  select(null, null); const order = []; let left = false;
  for (let i = 0; i < 20; i++) { const took = key('Tab'); if (!state.sel) { left = !took; break; } order.push(state.sel); }
  is('tabReadingOrder', order.join(' '), 'app shell editor preview sync search store save load atomic index μ:note');
  is('tabLeavesAtTheEnd', left, true);
  key('Tab', { shiftKey:true }); is('shiftTabFromTheEnd', state.sel, 'μ:note');

  select('editor', null); key(']'); await wait(50); is('earOpens', !!(state.drawers.get('editor') || {}).bot, true); key(']');
  select('sync', null); const btn = document.getElementById('fit'); btn.focus();
  is('buttonKeepsSpace', key(' ', { on:btn }), false); is('lettersStillMove', (key('h', { on:btn }), state.sel), 'preview'); btn.blur();
  select('search', null); key('Enter'); await wait(200);
  const dlg = document.querySelector('.modal input, .modal textarea, .editf input, .editf textarea'); is('enterEdits', !!dlg, true);
  if (dlg) { dlg.focus(); key('j', { on:dlg }); is('typingIsLeftAlone', state.sel, 'search'); }
  key('Escape'); await wait(150);

  select('shell', null); zoomAt(2.4, innerWidth / 2, innerHeight / 2); await wait(50);
  walk(['j', 'j', 'l']); await wait(450);
  const b = state.elems.get(state.sel).getBoundingClientRect();
  is('selectionStaysInView', b.left >= 0 && b.top >= 0 && b.left < innerWidth - 40 && b.top < innerHeight - 90, true);
  is('helpListsTheKeys', document.querySelectorAll('#helpKeys dt').length >= 10, true);
  return r;
};
