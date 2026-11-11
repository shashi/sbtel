// accept16: a closed block takes a drop. Rest a dragged block on the middle of a closed block and, after a
// wait, it opens for the drop; passing over it, or pausing briefly, does nothing; leaving it closes it again.
window.__accept = async function () {
  const r = {}, wait = ms => new Promise(f => setTimeout(f, ms));
  const is = (name, got, want = true) => { r[name] = got === want ? 'pass' : `fail: ${got}`; };
  const until = async (f, ms = 4000) => { for (const t0 = performance.now(); performance.now() - t0 < ms;) { if (f()) return true; await wait(40); } return !!f(); };
  const ev = (type, x, y) => (document.elementFromPoint(x, y) || document.body).dispatchEvent(new PointerEvent(type, { bubbles:true, cancelable:true, composed:true, clientX:x, clientY:y, pointerId:7, pointerType:'mouse', isPrimary:true, button:0, buttons: type === 'pointerup' ? 0 : 1 }));
  const mid = id => { const q = state.elems.get(id).getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; };
  const glide = async (a, b, n = 8) => { for (let i = 1; i <= n; i++) { ev('pointermove', a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n); await wait(16); } };
  const grab = async id => { const a = mid(id); ev('pointerdown', a[0], a[1]); await wait(30); await glide(a, [a[0] + 12, a[1] + 12], 4); return [a[0] + 12, a[1] + 12]; };
  const parentOf = id => { const p = state.model.blocks.get(id).parent; return p ? p.name : ''; };
  const SRC = `(block app (~ The app. ~)
  (level :name "Top" (block shell (~ Wires it. ~)) (block other (~ Else. ~)))
  (level :name "Bottom" (block store (~ Keep. ~) (level :name "In" (block inner (~ Inside. ~)))) (block leafy (~ Nothing inside. ~)) (block far (~ Away. ~))))`;
  const fresh = async () => { const h = document.getElementById('help'); if (!h.hidden) document.getElementById('helpBtn').click(); setSource(SRC); state.open = new Set(['app']); render(); fit(false); await wait(250); };

  // Passing over a closed block, and pausing on it for less than the wait, opens nothing.
  await fresh();
  let at = await grab('shell'); const s0 = mid('store');
  await glide(at, s0); await wait(SPRING.dwell * .45);
  is('briefPauseOpensNothing', state.open.has('store'), false);
  const f0 = mid('far'); await glide(s0, f0, 10); await wait(60);
  is('passingOverOpensNothing', state.open.has('store') || state.open.has('leafy'), false);
  ev('pointerup', f0[0], f0[1]); await wait(80);

  // Resting on it opens it; the drop lands inside, and it stays open.
  await fresh();
  at = await grab('shell'); let s1 = mid('store'); await glide(at, s1);
  is('cueWhileWaiting', !!document.getElementById('springcue'));
  is('opensAfterTheWait', await until(() => state.open.has('store'), SPRING.dwell + 1500));
  is('cueGone', !document.getElementById('springcue'));
  await wait(120); ev('pointermove', s1[0] + 2, s1[1] + 2); await wait(120);
  is('landingIsInside', drag && drag.best && drag.best.act.dest.block.name, 'store');
  ev('pointerup', s1[0] + 2, s1[1] + 2); await wait(150);
  is('droppedInside', parentOf('shell'), 'store');
  is('staysOpenAfterDrop', state.open.has('store'));
  is('oneUndoStep', (undo(), parentOf('shell')), 'app');

  // Leaving a sprung block without dropping closes it again; the drag goes on as usual.
  await fresh();
  at = await grab('shell'); s1 = mid('store'); await glide(at, s1); await until(() => state.open.has('store'), SPRING.dwell + 1500);
  const away = [s1[0], s1[1] - 260]; await glide(s1, away, 10);
  is('closesAfterLeaving', await until(() => !state.open.has('store'), SPRING.leave + 1500));
  ev('pointerup', away[0], away[1]); await wait(120);
  is('nothingLeftOpen', [...state.open].join(' '), 'app');

  // Escape while it is sprung open puts everything back.
  await fresh();
  at = await grab('shell'); s1 = mid('store'); await glide(at, s1); await until(() => state.open.has('store'), SPRING.dwell + 1500);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true })); await wait(120);
  is('escapeClosesItAgain', !state.open.has('store') && parentOf('shell') === 'app' && !drag);
  ev('pointerup', s1[0], s1[1]); await wait(60);

  // A card with nothing inside takes the block as its first.
  await fresh();
  at = await grab('shell'); const l1 = mid('leafy'); await glide(at, l1); await until(() => drag && drag.spring.open.has('leafy'), SPRING.dwell + 1500);
  await wait(100); ev('pointermove', l1[0] + 2, l1[1] + 2); await wait(120); ev('pointerup', l1[0] + 2, l1[1] + 2); await wait(150);
  is('emptyCardTakesIt', parentOf('shell'), 'leafy');
  is('emptyCardShownOpen', state.open.has('leafy') && state.lay.blocks.find(b => b.id === 'leafy').kind, 'frame');

  // The edge of a closed block still means "beside it".
  await fresh();
  at = await grab('other'); const q = state.elems.get('leafy').getBoundingClientRect(), edge = [q.left + 6, q.top + q.height / 2];
  await glide(at, edge); await wait(SPRING.dwell + 300);
  is('edgeDoesNotOpen', state.open.has('leafy'), false);
  is('edgeStillInserts', !!(drag && drag.best && !drag.best.noop && drag.best.act.dest.block.name === 'app'));
  ev('pointerup', edge[0], edge[1]); await wait(100);
  return r;
};
