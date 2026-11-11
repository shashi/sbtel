// accept15: Escape closes what opened last, through one list (Kit's opened/closed/dismiss), wherever the
// focus is. And the level name: on the right by default, and only the name itself opens its editor.
window.__accept = async function () {
  const r = {}, wait = ms => new Promise(f => setTimeout(f, ms));
  const esc = (on) => { const e = new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }); (on || document.body).dispatchEvent(e); };
  const is = (name, got, want = true) => { r[name] = got === want ? 'pass' : `fail: ${got}`; };
  const until = async (f, ms = 4000) => { for (const t0 = performance.now(); performance.now() - t0 < ms;) { if (f()) return true; await wait(40); } return !!f(); };
  const ids = () => surfaces.map(s => s.id).join(' ');
  const help = document.getElementById('help'); if (!help.hidden) document.getElementById('helpBtn').click();
  setSource(`(block app (~ The app. ~)
  (level :name "Top" (block shell (~ Wires it. ~)))
  (level :name "Bottom" (block store (~ Keep. ~)) (block index (~ Words. ~))))`);
  state.open = new Set(['app']); render(); fit(false); await wait(200);
  is('nothingOpenAtFirst', ids(), '');

  // The level name.
  const lab = document.querySelector('.llab[data-lvl="app|1"]'), sep = lab.closest('.lsep'), line = sep.querySelector('.lline');
  is('nameRightOfLine', lab.getBoundingClientRect().left > line.getBoundingClientRect().right - 1);
  const hit = sep.querySelector('.lhit'), hr = hit.getBoundingClientRect();
  const at = document.elementFromPoint(hr.left + 30, hr.top + hr.height / 2);
  at.dispatchEvent(new MouseEvent('click', { bubbles:true, clientX:hr.left + 30, clientY:hr.top + hr.height / 2 })); await wait(80);
  is('lineDoesNotEdit', !co.el || co.el.hidden);
  lab.click(); await until(() => co.mode === 'edit');
  is('nameEdits', co.mode, 'edit');
  const inp = co.el.querySelector('input[name=name]'); inp.focus(); inp.value = 'Changed';
  esc(inp); await wait(40);
  is('escCancelsFromTheField', (!co.el || co.el.hidden) && state.model.blocks.get('app').levels[1].name === 'Bottom');

  // The one opened last goes first: settings over an open sheet and the help panel.
  document.getElementById('helpBtn').click(); toggleSource(true); document.getElementById('setBtn').click(); await wait(60);
  is('listInOrder', ids(), 'help source modal');
  const field = modalEl.querySelector('input:not([type=radio]):not([type=checkbox])'); field.focus();
  esc(field); is('modalFirstEvenWhileTyping', !modalEl && ids() === 'help source');
  esc(); is('thenTheSheet', document.getElementById('srcSheet').classList.contains('closed') && ids() === 'help');
  esc(); is('thenHelp', help.hidden && ids() === '');

  // A thing closed by its own button leaves the list, so Escape is not spent on it.
  document.getElementById('setBtn').click(); await wait(40); modalEl.querySelector('[data-m="close"]').click();
  is('closedByButtonLeavesList', ids(), '');
  select('store', null); esc(); is('nothingOpenClearsSelection', state.sel, null);

  // A thread: large, then small, then gone, with the focus in its text box.
  select('store', null); document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'c', bubbles:true, cancelable:true }));
  if (await until(() => pops.thread)) {
    chatBig(true); const ta = pops.thread.querySelector('textarea'); ta.focus();
    is('threadListed', ids(), 'pop:thread chat-big');
    esc(ta); is('largeBecomesSmall', !!pops.thread && !pops.thread.classList.contains('big'));
    esc(ta); is('thenTheThreadCloses', !pops.thread && ids() === '');
  } else r.threadListed = 'fail: no thread opened';

  // A hover tip does not cost a press: it goes with the thing under it.
  document.getElementById('setBtn').click(); await wait(40);
  showCallout('t', () => new DOMRect(200, 200, 20, 20), 'tip', 'hover');
  esc(); is('tipGoesWithTheDialog', !modalEl && co.el.hidden && ids() === '');

  // The tour.
  startTour(0); await wait(80); is('tourListed', ids(), 'tour'); esc(); await wait(40); is('tourEnds', !document.querySelector('.tour') && ids() === '');
  return r;
};
