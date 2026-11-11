// accept14: a level filled by columns (Settings, "Down, then across"). The cells the flow gives, columns that
// line up, linked groups kept in a column with a line straight down, a group broken across columns tied
// sideways, nothing overlapping, Tab in column order, and a drag into the gap between two linked blocks in a
// column. The same spec filled by rows is the control.
window.__accept = async function () {
  const r = {}, wait = ms => new Promise(f => setTimeout(f, ms));
  const is = (name, got, want) => { r[name] = got === want ? 'pass' : `fail: ${got}`; };
  const until = async (f, ms = 4000) => { for (const t0 = performance.now(); performance.now() - t0 < ms;) { if (f()) return true; await wait(40); } return !!f(); };
  const help = document.getElementById('help'); if (!help.hidden) document.getElementById('helpBtn').click();
  const SPEC = `(block board (~ More blocks than fit on a line. ~)
  (level :name "Plain" (block a (~ 1 ~)) (block b (~ 2 ~)) (block c (~ 3 ~)) (block d (~ 4 ~)) (block e (~ 5 ~)))
  (level :name "Groups"
    (adjacent (block p (~ A finding. ~)) (block p/x (~ Its evidence. ~)))
    (block lone (~ Alone. ~)) (block q (~ Another. ~))
    (adjacent (block r (~ One. ~)) (block r/x (~ Two. ~)) (block r/y (~ Three. ~)))))`;
  const lay = flow => { state.opts.flow = flow; state.opts.width = 860; setSource(SPEC); state.open = new Set(['board']); render(); fit(false); };
  const level = i => state.lay.levels.filter(l => !l.band)[i];
  const cells = i => level(i).items.map(it => `${it.id}:${it.row},${it.col}`).join(' ');
  const box = id => state.lay.blocks.find(b => b.id === id);
  const overlaps = () => { const B = state.lay.blocks.filter(b => b.kind === 'card'); let n = 0; for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) if (B[i].x < B[j].x + B[j].w - 1 && B[j].x < B[i].x + B[i].w - 1 && B[i].y < B[j].y + B[j].h - 1 && B[j].y < B[i].y + B[i].h - 1) n++; return n; };
  const link = (a, b) => state.lay.connectors.find(c => c.a === a && c.b === b);

  lay('rows'); await wait(150);
  is('rowsAsBefore', cells(0), 'a:0,0 b:0,1 c:0,2 d:1,0 e:1,1');
  lay('cols'); await wait(150);
  is('columnsFillDown', cells(0), 'a:0,0 b:1,0 c:0,1 d:1,1 e:0,2');
  is('columnsLineUp', Math.abs(box('a').x - box('b').x) < 1 && Math.abs(box('c').x - box('d').x) < 1 && Math.abs(box('a').y - box('c').y) < 1 && box('c').x > box('a').x + box('a').w, true);
  is('nothingOverlaps', overlaps(), 0);
  is('layoutChecksHold', state.lay.checks.filter(c => c.f.length).map(c => c.k).join(), '');
  is('groupStaysInAColumn', (it => it('p').col === it('p/x').col && it('p/x').row === it('p').row + 1)(id => level(1).items.find(x => x.id === id)), true);
  const down = link('p', 'p/x'); is('linkGoesDown', !!down && down.pts[0][1] < down.pts[down.pts.length - 1][1] && Math.abs(down.pts[0][0] - down.pts[down.pts.length - 1][0]) < 60, true);
  // r, r/x, r/y: three in a group, two rows to a column, so the group is broken and tied sideways.
  const it = id => level(1).items.find(x => x.id === id);
  const broken = ['r', 'r/x', 'r/y'].map(it).some((x, k, a) => k && x.col !== a[k - 1].col);
  const side = state.lay.connectors.find(c => c.b.startsWith('r') && it(c.a).col !== it(c.b).col);
  is('brokenGroupTiedSideways', !broken || (!!side && side.pts[0][0] < side.pts[side.pts.length - 1][0]), true);
  is('everyGroupMemberLinked', state.lay.connectors.length, 3);

  select(null, null); const order = []; for (let i = 0; i < 6; i++) { document.body.dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true })); order.push(state.sel); }
  is('tabReadsDownTheColumns', order.join(' '), 'board a b c d e');

  // The gap between two linked blocks in a column is a drop target that joins the group there.
  select(null, null); fit(false); await wait(120);   // Tab moved the view: bring the whole board back
  const spans = groupSpans().filter(g => g.ids.join() === 'p,p/x');
  is('gapIsBetweenThem', spans.length === 1 && spans[0].h > 0 && spans[0].y >= box('p').y + box('p').h - 1 && spans[0].y + spans[0].h <= box('p/x').y + 30, true);
  const toScreen = (x, y) => [x * state.cam.k + state.cam.x, y * state.cam.k + state.cam.y];
  const ev = (type, x, y) => (document.elementFromPoint(x, y) || document.body).dispatchEvent(new PointerEvent(type, { bubbles:true, cancelable:true, composed:true, clientX:x, clientY:y, pointerId:7, pointerType:'mouse', isPrimary:true, button:0, buttons: type === 'pointerup' ? 0 : 1 }));
  const L = box('lone'), [x0, y0] = toScreen(L.x + 30, L.y + 14), g = spans[0], [x1, y1] = toScreen(g.x + Math.min(g.w / 2, 60), g.y + g.h / 2);
  ev('pointerdown', x0, y0); await wait(30); for (let i = 1; i <= 4; i++) { ev('pointermove', x0 + 3 * i, y0 + 3 * i); await wait(16); }
  is('dragStarts', typeof drag !== 'undefined' && !!drag, true);
  for (let i = 1; i <= 8; i++) { ev('pointermove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); await wait(16); }
  await wait(120); ev('pointerup', x1, y1); await wait(60);
  await until(() => state.lay.loc.get('lone') && state.lay.loc.get('p') && state.lay.loc.get('lone').ui === state.lay.loc.get('p').ui);
  const lp = state.lay.loc.get('p'), ll = state.lay.loc.get('lone');
  is('dropInTheGapJoins', !!lp && !!ll && lp.L === ll.L && lp.ui === ll.ui && ll.bi === 1, true);
  is('stillNoOverlap', overlaps(), 0);

  // An open block that fills the line (Settings, Open block width: Fill the row) takes a line to itself, and
  // the columns start again under it: what follows sits side by side, not stacked below it one by one.
  state.opts.flow = 'cols'; state.opts.expandWidth = 'fill'; state.opts.width = 900;
  setSource(`(block app (~ x ~)
  (level :name "L" (block one (~ 1 ~)) (block wide (~ open ~) (level (block in1 (~ a ~)) (block in2 (~ b ~)))) (block two (~ 2 ~)) (block three (~ 3 ~))))`);
  state.open = new Set(['app', 'wide']); render(); fit(false); await wait(150);
  const li = id => state.lay.levels.find(l => !l.band && l.items.some(x => x.id === id)).items.find(x => x.id === id);
  is('wideBlockHasItsOwnLine', [li('one'), li('wide'), li('two'), li('three')].map(x => `${x.seg}:${x.row},${x.col}`).join(' '), '0:0,0 1:1,0 2:2,0 2:2,1');
  is('checksHoldWithFill', state.lay.checks.filter(c => c.f.length).map(c => c.k).join(), '');
  state.opts.expandWidth = 'fit'; state.opts.flow = 'rows';
  return r;
};
