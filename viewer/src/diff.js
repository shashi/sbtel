// @sbtel file Viewer.Diff
// Diff mode (docs/DESIGN.md §6.4), for pages served by `sbtel open-diff` at /s/<id>/diff. Inlined into the
// page script by viewer/build.mjs, after server.js and before Boot. At load it registers SBTEL.modes.diff,
// and switches a standalone page to diff mode only when its URL has the dev query `?diff` (two built-in
// samples; `?diff=none` gives a pair with no changes). Everything else happens in boot().
//
// One picture: side b's layout, with ghosts. The page lays out a merged spec, side b's source with a
// small ghost block spliced in at each removed (or moved-away) element's old place, so ghosts get room
// of their own. "Before" lays out side a with its ids renamed to the merged ids, so the shared paint
// transitions animate every block between its two places.
SBTEL.modes.diff = (() => {
  // Side b for the dev hook: the playground sample with the edits of conformance/diff/shell-b.sbtel.
  const DEV_EDITS = [
    ['; The Shell from the sketch: one block holding 23 blocks, in three named levels.', '; The Shell, revised: renames, moves, removals and new blocks.'],
    ['    (gives Intent)\n    (sketch "A behavior shared by surfaces.")', '    (gives Intent (~ What the user asked for. ~))\n    (sketch "A behavior shared by surfaces.")'],
    ['(level :name "Services"', '(level :name "Routing"'],
    ['(~ Clipboard and keymap shortcuts route as intents. ~)', '(~ Keymap and search shortcuts route as intents. ~)'],
    ['(~ Knows nothing of surfaces. ~)', '(~ Knows nothing of the levels above. ~)'],
    ['(shape Notice (sketch "A short message for the user, with a severity."))', '(shape Alert (sketch "A short message for the user, with a severity."))'],
    ['(takes Notice)', '(takes Alert :as notice)'],
    ['(shape KeyChord (sketch "A normalized key combination."))', '(shape KeyChord (refines Intent) (sketch "A normalized key combination."))'],
    ['(block Shell.Toast (sketch "One notice with an auto-dismiss timer."))', '(block Shell.Toast\n              (takes Alert :as notice)\n              (sketch "One notice with an auto-dismiss timer."))'],
    ['(block Shell.Banner (sketch "A persistent notice pinned to the top."))', '(block Shell.PinnedBanner (sketch "A persistent notice pinned to the top."))'],
    ['                  (block Shell.TurnActions (sketch "Copy, retry and edit controls.")))))', '                  (block Shell.TurnActions (sketch "Copy, retry and edit controls."))))\n              (level\n                (block Shell.ScrollAnchor\n                  (sketch "Keeps the reading position when content above grows."))))'],
    ['        (level\n          (block Shell.ScrollAnchor\n            (sketch "Keeps the reading position when content above grows."))))\n      (block Shell.Sidebar', '        )\n      (block Shell.Sidebar'],
    ['(sketch "Multiline input with attachments and slash commands.")', '(sketch "Multiline input with attachments, mentions and slash commands.")'],
    ['    (block Shell.CommandPalette\n      (takes KeyChord :as chord (~ Opens the palette. ~))\n      (gives Intent :as run)', '    (block Shell.CommandPalette\n      (gives Intent :as run)'],
    ['      (block Shell.Router\n        (takes Intent)', '      (block Shell.Router\n        :type "Service"\n        (takes Intent)'],
    ['        (gives KeyChord :as chord)', '        (implements Durable)\n        (gives KeyChord :as chord)'],
    ['      (block Shell.Clipboard (sketch "Copy and paste with rich formats."))))', '      (block Shell.Search (sketch "Full-text search across sessions and files."))))'],
    ['    (block Shell.LowLevelThing (sketch "Low level module thing."))\n', ''],
    [':type "Store"', ':type "Database"'],
  ];
  const devB = () => DEV_EDITS.reduce((s, [a, b]) => s.split(a).join(b), SAMPLE);
  const qs = /(?:^\?|&)diff(?:=([^&]*))?(?:&|$)/.exec(location.search);
  const dev = SBTEL.mode === 'standalone' && qs ? (qs[1] || 'sample') : null;
  if (dev) SBTEL.mode = 'diff';

  const STYLE = `
:root { --d-amb:#C27A00; --d-amb-soft:#FBEBCB; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --d-amb:#F0B43C; --d-amb-soft:#3A2E14; } }
:root[data-theme="dark"] { --d-amb:#F0B43C; --d-amb-soft:#3A2E14; }
body.diffmode .aff .plus, body.diffmode .lsep .plus, body.diffmode .gutter, body.diffmode .hdl { display:none !important; }
.blk.d-add { box-shadow:0 0 0 2.5px var(--ok); }
.blk.card.d-add { background:color-mix(in srgb, var(--ok) 13%, var(--card)); }
.blk.card.leaf.d-add { background:color-mix(in srgb, var(--ok) 13%, var(--leaf)); }
.blk.frame.d-add { background:color-mix(in srgb, var(--ok) 6%, var(--surface)); }
.blk.d-mov { box-shadow:0 0 0 2.5px var(--accent); }
.blk.d-ghost { border-style:dashed; box-shadow:none; }
.blk.d-ghost .tab { border-style:dashed; }
.blk.card.d-rem, .blk.card.leaf.d-rem { border-color:var(--warn); background:color-mix(in srgb, var(--warn) 7%, var(--canvas)); }
.blk.d-ghost.d-rem .bd { opacity:.72; }
.blk.d-ghost.d-rem .ttl > span:first-child { text-decoration:line-through; text-decoration-color:var(--warn); }
.blk.card.d-from, .blk.card.leaf.d-from { border-color:var(--accent); background:transparent; opacity:.5; }
.blk.frame.d-rem { border-color:var(--warn); box-shadow:0 0 0 2.5px var(--warn); }
.d-lab { position:absolute; top:-9px; right:30px; z-index:7; height:17px; line-height:17px; padding:0 6px; border-radius:6px; font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#fff; white-space:nowrap; pointer-events:none; }
.d-lab.add { background:var(--ok); } .d-lab.rem { background:var(--warn); } .d-lab.mov, .d-lab.from { background:var(--accent); }
:root[data-theme="dark"] .d-lab { color:#111; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .d-lab { color:#111; } }
.d-dot { position:absolute; top:-7px; left:-7px; z-index:7; width:13px; height:13px; border-radius:50%; background:var(--d-amb); box-shadow:0 0 0 2.5px var(--canvas); pointer-events:auto; }
.d-inner { position:absolute; top:-8px; left:-8px; z-index:7; min-width:16px; height:16px; box-sizing:border-box; padding:0 4px; border-radius:8px; border:1.5px solid var(--d-amb); background:var(--canvas); color:var(--d-amb); font-size:10px; font-weight:700; line-height:13px; text-align:center; }
.blk.d-hasdot .d-inner { left:10px; }
.ttl .d-was { color:var(--muted); font-size:.8em; text-decoration:line-through; text-decoration-color:var(--warn); flex:none; }
.pill.d-was { text-decoration:line-through; color:var(--warn); opacity:.8; }
.pill.d-now { color:var(--ok); font-weight:600; }
.sk .d-ins { background:var(--ok-soft); color:var(--ok); text-decoration:none; border-radius:3px; padding:0 1px; }
.sk .d-del { background:var(--warn-soft); color:var(--warn); text-decoration:line-through; border-radius:3px; padding:0 1px; }
.badge.d-badd { box-shadow:inset 0 0 0 2px var(--ok), inset 0 0 0 3.5px var(--surface); }
.chip.d-badd { border-color:var(--ok); box-shadow:inset 0 0 0 1px var(--ok); }
.badge.d-brem { opacity:.5; box-shadow:inset 0 0 0 2px var(--warn); position:relative; }
.badge.d-brem::after { content:""; position:absolute; left:-3px; right:-3px; top:50%; border-top:2px solid var(--warn); transform:rotate(-35deg); }
.pdot.d-padd { box-shadow:0 0 0 2px var(--tab), 0 0 0 3.5px var(--ok); }
.pdot.d-prem { background:transparent !important; border:1.5px dashed var(--warn); box-sizing:border-box; }
.pdot.d-paff { box-shadow:0 0 0 2px var(--tab), 0 0 0 3.5px var(--d-amb); }
.drow.d-radd { box-shadow:inset 3px 0 0 var(--ok); }
.drow.d-rrem { opacity:.6; text-decoration:line-through; text-decoration-color:var(--warn); }
.drow.d-raff::after { content:"!"; margin-left:auto; color:var(--d-amb); font-weight:700; }
.tab.d-tabghost { border-style:dashed; border-color:var(--warn); }
.rel2 .d-was { text-decoration:line-through; color:var(--warn); margin-right:6px; }
.d-arrows { position:absolute; left:0; top:0; overflow:visible; z-index:1400; pointer-events:none; transition:opacity .2s ease; }
.d-arrows path { fill:none; stroke:var(--accent); stroke-width:2; stroke-dasharray:6 5; opacity:.85; }
.d-arrows .head { fill:var(--accent); stroke:none; stroke-dasharray:none; }
.d-arrows.fading { opacity:0; }
.blk.d-enter { animation:dEnter .32s ease both; }
.blk.d-leave { animation:dLeave .3s ease both; pointer-events:none; }
@keyframes dEnter { from { opacity:0; } }
@keyframes dLeave { to { opacity:0; } }
.d-seg { display:inline-flex; border:1px solid var(--panel-line); border-radius:9px; overflow:hidden; flex:none; margin:0 2px; }
.d-seg button { border:0; background:transparent; height:32px; padding:0 11px; font-size:13px; cursor:pointer; color:var(--muted); }
.d-seg button + button { border-left:1px solid var(--panel-line); }
.d-seg button[aria-pressed="true"] { background:var(--accent-soft); color:var(--accent); font-weight:600; }
.tb .d-n { font-variant-numeric:tabular-nums; color:var(--muted); }
.d-none { position:fixed; left:50%; top:96px; transform:translateX(-50%); z-index:1050; text-align:center; padding:14px 20px; border-radius:14px; max-width:min(420px, calc(100vw - 32px)); box-sizing:border-box; }
.d-none b { display:block; font-size:16px; margin-bottom:4px; }
.d-none span { color:var(--muted); font-size:13px; line-height:1.45; }
.d-err { border-left:3px solid var(--warn); }
.d-vt { position:fixed; left:50%; transform:translateX(-50%); top:calc(max(14px, env(safe-area-inset-top, 0px)) + 46px); z-index:2950; padding:10px 12px; font-size:13px; border-radius:10px; border-left:3px solid var(--accent); display:flex; gap:10px; align-items:center; max-width:min(460px, calc(100vw - 32px)); box-sizing:border-box; }
.d-sheet { z-index:1250; }
@media (max-width: 759px) { .d-none { top:140px; } .d-seg button { padding:0 9px; } .d-lab { right:22px; } }
/* v0.2 sketch marks: a renamed level's old name struck after the new one, a changed level, port or group
   sketch in amber (its callout shows the word diff). */
.llab .d-was { margin-left:8px; color:var(--muted); font-size:.85em; text-decoration:line-through; text-decoration-color:var(--warn); }
.ro .llab.ph.d-show { display:block !important; font-style:normal; opacity:1; }
.llab.d-lchg { color:var(--d-amb); box-shadow:inset 0 -2px 0 var(--d-amb); border-radius:0; }
.drow.d-rsk { box-shadow:inset 3px 0 0 var(--d-amb); }
.pdot.d-psk { box-shadow:0 0 0 2px var(--canvas), 0 0 0 3.5px var(--d-amb); }
.lines path.vis.d-gsk { stroke:var(--d-amb); stroke-width:2.5; }
@media (prefers-reduced-motion: reduce) { .blk.d-enter, .blk.d-leave { animation:none !important; } .d-arrows { transition:none; } }`;

  // ---------- state ----------
  const D = {
    data:null, mA:null, mB:null, mM:null, res:null, err:null, view:'after',
    info:new Map(),        // display id -> { tags, change, ghost, name, inside, fieldsFor }
    toDisp:new Map(),      // side a id -> display id
    dispToA:new Map(),     // display id -> side a id (Before view)
    ghostOf:new Map(),     // side a id -> ghost display id at its old place (removed or moved away)
    aff:new Map(),         // owner display id -> Set of affected port names
    items:[], titleExtra:new Map(), skExtra:new Map(), selItem:null, sheetW:460, width:null,
  };
  let closed = false; // SSE `closed`: the session ended
  // Comments in a diff session behave as in server mode (session.js); their version is diff.json's.
  const SC = sessionComments({ version: () => (D.data && D.data.version) || 0, closed: () => closed });
  // The draft review of a diff session: comments and a message, no edits (review.js).
  const R = sessionReview({ kind: 'diff', id: SBTEL.session, SC, closed: () => closed, version: () => (D.data && D.data.version) || 0 });
  const READONLY = 'This is a diff: it is read-only.', OPEN_BUDGET = 160;
  const narrow = () => innerWidth < 1000;
  const sheet = () => $('dSheet');
  const sheetOpen = () => sheet() && !sheet().classList.contains('closed');
  const viewW = () => innerWidth - (sheetOpen() && !narrow() ? D.sheetW : 0);
  const plain = id => id.replace(/^[βμ]:/, '');

  // ---------- the merged (After) spec: side b plus ghosts ----------
  function build(data) {
    D.data = data; D.err = null;
    D.info = new Map(); D.toDisp = new Map(); D.dispToA = new Map(); D.ghostOf = new Map(); D.aff = new Map(); D.titleExtra = new Map(); D.skExtra = new Map();
    let mA, mB;
    try { mA = parse(data.a.src); } catch (e) { D.err = { side:'a', message:e.message }; }
    try { mB = parse(data.b.src); } catch (e) { D.err = D.err || { side:'b', message:e.message }; }
    D.mA = mA || null; D.mB = mB || null;
    if (D.err) { D.res = null; D.mM = mB || mA || parse(''); return; }
    const res = D.res = diffSpecs(mA, mB);
    // Side a ids -> side b ids for every matched element; identical ids match unless a change says otherwise.
    const a2b = new Map(), gone = new Set();
    [mA.blocks, mA.behaviors, mA.messages].forEach(m => m.forEach(n => { if (mB.node(n.id)) a2b.set(n.id, n.id); }));
    res.changes.forEach(c => { if (c.a && c.b) a2b.set(c.a.id, c.b.id); if (c.a && !c.b) { gone.add(c.a.id); a2b.delete(c.a.id); } });
    // Ids of b that are the target of some other a (a weak id pair broken by the matching) are not identity.
    const targets = new Map(); a2b.forEach((b, a) => { if (!targets.has(b)) targets.set(b, []); targets.get(b).push(a); });
    targets.forEach((as, b) => { if (as.length > 1) as.forEach(a => { if (!res.changes.some(c => c.a && c.a.id === a && c.b)) a2b.delete(a); }); });
    const aToB = n => n === mA.root ? mB.root : (a2b.has(n.id) ? mB.node(a2b.get(n.id)) : null);
    // Ghost names: never a name side b uses.
    const taken = new Set([...mB.blocks.keys(), ...mB.behaviors.keys(), ...mB.messages.keys()]);
    const alloc = base => { let n = base; while (taken.has(n)) n += '~'; taken.add(n); return n; };
    const ghostName = new Map(); // side a id -> name in the merged spec
    const src = mB.src, reps = [];
    const ind0 = (pos, b) => indentAt(src, pos) ?? childIndent(src, b);
    const textOf = (n, name) => n.form === 'block'
      ? `(block ${name}${n.type ? ' :type ' + quoteStr(n.type) : ''}${n.sketch ? ' (sketch ' + quoteStr(n.sketch) + ')' : ''})`
      : `(${n.form === 'message' ? 'shape' : n.form} ${name}${n.sketch ? ' (sketch ' + quoteStr(n.sketch) + ')' : ''})`; // a model node of (shape …) has form 'message'
    const levelOfB = (H, n) => H.levels.findIndex(L => L.units.some(u => u.blocks.includes(n)));
    const unitOfB = (L, n) => L.units.find(u => u.blocks.includes(n));
    const newLevels = new Map();
    // Put ghost text for side a block n at its old place: its old holder (mapped), its old level (the b level
    // that holds its old level-mates, else a new level between the right neighbours), beside its old neighbours.
    function placeBlock(n, text) {
      const aH = holderOf(n), bH = aToB(aH); if (!bH) return false;
      const li = levelOfB(aH, n); if (li < 0) return false;
      const sibs = aH.levels[li].units.flatMap(u => u.blocks), at = sibs.indexOf(n);
      const inB = x => { const b = aToB(x); return b && holderOf(b) === bH ? b : null; };
      const order = [...sibs.slice(0, at).reverse().map(x => [x, 'after']), ...sibs.slice(at + 1).map(x => [x, 'before'])];
      for (const [x, how] of order) {
        const b = inB(x); if (!b) continue;
        const L = bH.levels[levelOfB(bH, b)], U = unitOfB(L, b), ind = indentAt(src, U.node.s) ?? '  ';
        reps.push(how === 'after' ? { s:U.node.e, e:U.node.e, t:'\n' + ind + text } : { s:U.node.s, e:U.node.s, t:text + '\n' + ind });
        return true;
      }
      // No old level-mate in that holder: a new level, after the b level of the nearest old level above, or
      // before the one of the nearest old level below.
      let p = null;
      for (let j = li - 1; j >= 0 && p == null; j--) for (const x of aH.levels[j].units.flatMap(u => u.blocks)) { const b = inB(x); if (b) { p = levelOfB(bH, b) + 1; break; } }
      for (let j = li + 1; j < aH.levels.length && p == null; j++) for (const x of aH.levels[j].units.flatMap(u => u.blocks)) { const b = inB(x); if (b) { p = levelOfB(bH, b); break; } }
      if (p == null) p = li === 0 ? 0 : bH.levels.length;
      const k = bH.id + '|' + p;
      if (!newLevels.has(k)) newLevels.set(k, { H:bH, p, texts:[] });
      newLevels.get(k).texts.push(text);
      return true;
    }
    function placeDecl(n, text) {
      const bH = n.owner ? aToB(n.owner) : mB.root; if (!bH) return false;
      const same = bH.children.filter(c => c.form === n.form), first = bH.children[0];
      if (same.length) { const r = same[same.length - 1], ind = ind0(r.s, bH); reps.push({ s:r.e, e:r.e, t:'\n' + ind + text }); }
      else if (first) { const ind = ind0(first.s, bH); reps.push({ s:first.s, e:first.s, t:text + '\n' + ind }); }
      else { const at = endIn(src, bH); reps.push({ s:at, e:at, t:(at ? '\n' : '') + childIndent(src, bH) + text }); }
      return true;
    }
    const nodeA = r => mA.node(r.id);
    const removedA = new Set(res.changes.filter(c => c.tags[0] === 'removed').map(c => c.a.id));
    const isTop = n => n.form === 'block' ? !(n.parent && removedA.has(n.parent.id)) : !(n.owner && removedA.has(n.owner.id));
    // Display ids for the Before view (and ghosts): matched -> b id; removed -> a ghost name.
    const dispOfName = (n, name) => n.form === 'block' ? name : (n.form === 'behavior' ? 'β:' : 'μ:') + name;
    a2b.forEach((b, a) => D.toDisp.set(a, b));
    // Removed descendants first get names too (only the top removed element is drawn in After).
    res.changes.forEach(c => {
      if (c.tags[0] !== 'removed') return;
      const n = nodeA(c.a), name = alloc('~' + plain(c.a.id)); ghostName.set(c.a.id, name);
      const disp = dispOfName(n, name); D.toDisp.set(c.a.id, disp);
      if (isTop(n)) {
        const ok = n.form === 'block' ? placeBlock(n, textOf(n, name)) : placeDecl(n, textOf(n, name));
        if (ok) D.ghostOf.set(c.a.id, disp);
      }
    });
    res.changes.forEach(c => {
      if (!c.moved) return;
      const n = nodeA(c.a), name = alloc('~>' + plain(c.a.id)), disp = dispOfName(n, name);
      const ok = n.form === 'block' ? placeBlock(n, textOf(n, name)) : placeDecl(n, textOf(n, name));
      if (ok) D.ghostOf.set(c.a.id, disp);
    });
    newLevels.forEach(({ H, p, texts }) => {
      const Ls = H.levels; let pos, pre = '', post = '', ind;
      if (!Ls.length) { ind = childIndent(src, H); pos = endIn(src, H); pre = pos ? '\n' + ind : ind; }
      else if (p < Ls.length) { const s = Ls[p].kind === 'level' ? Ls[p].node.s : unitsSpan(Ls[p]).s; ind = indentAt(src, s) ?? '  '; pos = s; post = '\n' + ind; }
      else { const L = Ls[Ls.length - 1]; const s0 = L.kind === 'level' ? L.node.s : unitsSpan(L).s; ind = indentAt(src, s0) ?? '  '; pos = L.kind === 'level' ? L.node.e : unitsSpan(L).e; pre = '\n' + ind; }
      reps.push({ s:pos, e:pos, t:pre + '(level\n' + ind + '  ' + texts.join('\n' + ind + '  ') + ')' + post });
    });
    let mM = null;
    try { mM = parse(multiSplice(src, reps)); } catch (e) { mM = null; }
    if (!mM || [...D.ghostOf.values()].some(id => !mM.node(id))) { D.ghostOf.clear(); mM = parse(src); }
    D.mM = mM;
    D.toDisp.forEach((d, a) => D.dispToA.set(d, a));
    // ---------- per-element marks ----------
    const info = id => { if (!D.info.has(id)) D.info.set(id, { tags:[], change:null, ghost:null, name:'', inside:0 }); return D.info.get(id); };
    res.changes.forEach(c => {
      if (c.tags[0] === 'added') { Object.assign(info(c.b.id), { tags:['added'], change:c, name:c.b.name }); return; }
      if (c.tags[0] === 'removed') {
        const disp = D.toDisp.get(c.a.id), it = Object.assign(info(disp), { tags:['removed'], change:c, name:c.a.name, ghost: D.ghostOf.get(c.a.id) === disp ? 'removed' : null });
        const n = nodeA(c.a); if (n.form === 'block' && isTop(n)) it.inside = stats(n).n;
        return;
      }
      Object.assign(info(c.b.id), { tags:c.tags.slice(), change:c, name:c.b.name });
      if (c.renamed) D.titleExtra.set(c.b.name, c.a.name);
      if (c.fields && c.fields.sketch) { D.skExtra.set(c.fields.sketch.to, c.fields.sketch.words.map(w => w.text).join(' ')); }
      const g = c.moved && D.ghostOf.get(c.a.id);
      if (g) Object.assign(info(g), { tags:['from'], change:c, name:c.a.name, ghost:'from', to:c.b.id });
    });
    res.affected.forEach(x => { if (!D.aff.has(x.owner)) D.aff.set(x.owner, new Map()); D.aff.get(x.owner).set(x.port, x); });
    D.items = listItems(res);
  }
  // How many marked elements sit inside each block (by display id), in the merged spec or in side a.
  function insideCounts(view) {
    const cnt = new Map(), bump = id => cnt.set(id, (cnt.get(id) || 0) + 1);
    D.info.forEach((it, id) => {
      if (view === 'after') {
        if (it.ghost === null && it.tags[0] === 'removed') return;
        const n = D.mM.node(id); if (!n) return;
        for (let p = n.form === 'block' ? n.parent : n.owner; p; p = p.parent) bump(p.id);
      } else {
        if (it.tags[0] === 'added' || it.ghost === 'from') return;
        const a = D.mA.node(D.dispToA.get(id) || ''); if (!a) return;
        for (let p = a.form === 'block' ? a.parent : a.owner; p; p = p.parent) bump(D.toDisp.get(p.id) || p.id);
      }
    });
    return cnt;
  }

  // ---------- layout of each view ----------
  function optsFor(view) {
    const base = { ...state.opts, width:D.width || state.opts.width, details:new Set(), allDetails:false };
    if (view === 'after') return { ...base, open:state.open, drawers:state.drawers, expanded:state.expanded };
    const tr = s => new Set([...s].map(id => D.dispToA.get(id) ?? id));
    return { ...base, open:tr(state.open), drawers:new Map([...state.drawers].map(([k, v]) => [D.dispToA.get(k) ?? k, v])), expanded:tr(state.expanded) };
  }
  // Rename every id in a layout (side a's) to its display id, so elements are shared with the After view.
  function remap(lay) {
    const f = id => D.toDisp.get(id) ?? id;
    lay.blocks.forEach(B => { B.id = f(B.id); });
    lay.connectors.forEach(c => { c.a = f(c.a); c.b = f(c.b); });
    [...lay.dividers, ...lay.gutters].forEach(v => { const i = v.key.lastIndexOf('|'); v.key = f(v.key.slice(0, i)) + v.key.slice(i); });
    lay.levels.forEach(L => L.items.forEach(it => { it.id = f(it.id); }));
    lay.loc = new Map([...lay.loc].map(([k, v]) => [f(k), v]));
    return lay;
  }
  function viewLayout() {
    const m = D.view === 'before' && D.mA ? D.mA : D.mM;
    const lay = layout(m, optsFor(D.view), M);
    if (m === D.mA) remap(lay);
    lay.spec = lintSpec(D.mB || m);
    return lay;
  }
  // The app's render, for the current view: same camera anchor, transitions and paint, then the marks.
  function dRender(anchorId) {
    if (!D.mM) return;
    closePop('info');
    const world = $('world'), animate = state.opts.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    world.classList.remove('pv');
    const before = anchorId && state.lay && state.lay.blocks.find(b => b.id === anchorId);
    const lay = viewLayout();
    const ids = new Set(lay.blocks.map(B => B.id));
    // Elements of the other view fade out instead of vanishing; new ones fade in.
    for (const [id, el] of state.elems) if (!ids.has(id)) {
      state.elems.delete(id);
      if (animate) { el.classList.add('d-leave'); el.style.pointerEvents = 'none'; setTimeout(() => el.remove(), 320); } else el.remove();
    }
    const fresh = state.elems.size ? new Set(lay.blocks.filter(B => !state.elems.has(B.id)).map(B => B.id)) : new Set();
    state.lay = lay;
    world.classList.toggle('anim', !!(animate && state.elems.size));
    if (before) { const after = lay.blocks.find(b => b.id === anchorId); if (after) { state.cam.x += (before.x - after.x) * state.cam.k; state.cam.y += (before.y - after.y) * state.cam.k; } }
    applyCam();
    const keep = { model:state.model, drawers:state.drawers };
    if (D.view === 'before' && D.mA) { state.model = D.mA; state.drawers = optsFor('before').drawers; }
    try { paint(lay); } finally { state.model = keep.model; state.drawers = keep.drawers; }
    decorate(lay, fresh, animate);
    sketchMarks(lay);
    renderChecks();
    if (world.classList.contains('anim')) setTimeout(() => { world.classList.remove('anim'); placeStrip(); }, 340);
    applySelection(); applyTalk(); refreshCallout();
  }

  // ---------- v0.2: level, port and group sketches ----------
  // The change of the block (or, for '', the file) that holds a level.
  const holderChange = id => { const it = D.info.get(id); return it && it.change && it.change.fields ? it.change : null; };
  // A Fields level entry names side b's level by its number from the bottom (1-based); the page keys levels
  // by their index from the top. These convert between the two through side b's holder.
  const levelsOfB = id => { const H = D.mB && (id ? D.mB.node(id) : D.mB.root); return H && H.levels ? H.levels.length : 0; };
  const levelEntry = (id, at) => { const c = holderChange(id); return c && (c.fields.levels || []).find(e => e.level === levelsOfB(id) - at) || null; };
  // Word runs for a sketch that changed, or null: kind port ({ owner, port }), level ({ b, at }), group ({ U, c }).
  function sketchChange(kind, ref) {
    if (kind === 'port') { const c = holderChange(ref.owner), x = c && c.fields.ports && c.fields.ports.changed.find(y => y.name === ref.port && y.sketch); return x ? x.sketch.words : null; }
    if (kind === 'level') { const e = levelEntry(ref.b.id, ref.at); return e && e.sketch ? e.sketch.words : null; }
    if (kind === 'group') {
      const H = holderOf(ref.U.blocks[0]), at = H ? H.levels.indexOf(ref.c.cut.L) : -1, e = levelEntry(H ? H.id : '', at);
      const g = e && (e.groups || []).find(x => x.blocks.some(id => ref.U.blocks.some(b => b.id === id)));
      return g ? g.sketch.words : null;
    }
    return null;
  }
  // Marks: a renamed level shows its old name struck; changed sketches are amber (rows, dots, labels, lines).
  function sketchMarks(lay) {
    if (D.view !== 'after') return;
    D.info.forEach((it, id) => {
      const c = it.change; if (!c || !c.fields || it.ghost) return;
      (c.fields.levels || []).forEach(e => {
        const lab = document.querySelector(`.llab[data-lvl="${CSS.escape(id + '|' + (levelsOfB(id) - e.level))}"]`); if (!lab) return;
        if (e.name && e.name.from) { if (lab.classList.contains('ph')) { lab.textContent = ''; lab.classList.add('d-show'); } lab.insertAdjacentHTML('beforeend', `<s class="d-was" title="Old name">${esc(e.name.from)}</s>`); }
        if (e.name || e.sketch) { lab.classList.add('d-lchg'); lab.title = [e.name ? 'Renamed' : '', e.sketch ? 'Sketch changed' : ''].filter(Boolean).join('; '); }
        (e.groups || []).forEach(g => lay.connectors.forEach((cn, i) => { if (g.blocks.includes(cn.a) && g.blocks.includes(cn.b)) document.querySelector(`#lines path.vis[data-key="${CSS.escape(cn.a + '|' + cn.b)}"]`)?.classList.add('d-gsk'); }));
      });
      const P = c.fields.ports; if (!P) return;
      const el = state.elems.get(id), n = D.mM.node(id); if (!el || !n) return;
      P.changed.filter(x => x.sketch).forEach(x => ['top', 'bot'].forEach(side => {
        const list = dotsOf(n, state.opts.childDots)[side === 'top' ? 'in' : 'out'], i = list.findIndex(p => !p.child && p.name === x.name && p.dir === x.to.dir); if (i < 0) return;
        el.querySelector(`:scope > .tab.${side} .drow[data-pi="${i}"]`)?.classList.add('d-rsk');
        el.querySelector(`:scope > .tab.${side} .pdot[data-pi="${i}"]`)?.classList.add('d-psk');
      }));
    });
  }

  // ---------- marks on the canvas ----------
  const labHTML = (cls, text) => `<span class="d-lab ${cls}">${esc(text)}</span>`;
  function fieldNames(c) {
    const F = c.fields || {}, out = [];
    if (c.renamed) out.push('renamed from ' + c.renamed.from);
    Object.keys(F).forEach(k => out.push(k === 'drawer' ? 'ports in the drawers' : k));
    return out.join(', ');
  }
  function decorate(lay, fresh, animate) {
    const after = D.view === 'after', inside = insideCounts(D.view), svg = arrowsSvg();
    lay.blocks.forEach(B => {
      const el = state.elems.get(B.id); if (!el) return;
      if (animate && fresh.has(B.id)) { el.classList.remove('d-enter'); void el.offsetWidth; el.classList.add('d-enter'); }
      const it = D.info.get(B.id), c = it && it.change, t = it ? it.tags : [];
      const isCard = B.kind === 'card';
      if (it && it.ghost && after) {
        el.classList.add('d-ghost', it.ghost === 'removed' ? 'd-rem' : 'd-from');
        const ttl = el.querySelector('.ttl > span:last-child'); if (ttl) ttl.textContent = it.name;
        el.insertAdjacentHTML('beforeend', it.ghost === 'removed' ? labHTML('rem', it.inside ? `Removed, with ${it.inside} inside` : 'Removed') : labHTML('from', 'Moved away'));
        el.title = it.ghost === 'removed' ? `${it.name} was removed` : `${it.name} was here; it moved to ${(c.moved.to.in || 'the top level')}`;
      } else if (t[0] === 'added') { el.classList.add('d-add'); el.insertAdjacentHTML('beforeend', labHTML('add', 'New')); }
      else if (t[0] === 'removed') { el.classList.add('d-rem'); el.insertAdjacentHTML('beforeend', labHTML('rem', after ? 'Removed' : 'Removed later')); }
      else if (t.includes('moved')) { el.classList.add('d-mov'); el.insertAdjacentHTML('beforeend', labHTML('mov', 'Moved')); }
      const ghost = after && it && it.ghost;
      if (c && !ghost && (t.includes('changed') || t.includes('renamed'))) {
        el.insertAdjacentHTML('beforeend', `<span class="d-dot" title="${esc('Changed: ' + fieldNames(c))}"></span>`);
        el.classList.add('d-hasdot');
      }
      const n = inside.get(B.id);
      if (n && isCard && hasInside(B.node)) el.insertAdjacentHTML('beforeend', `<span class="d-inner" title="${n} change${n === 1 ? '' : 's'} inside">${n}</span>`);
      if (!(c && !ghost && t[0] !== 'added' && t[0] !== 'removed')) { if (after) markAffected(el, B); return; }
      if (after) fieldMarks(el, B, c);
      if (after) markAffected(el, B);
    });
    // Moves: a dashed arrow from the faint ghost at the old place to the block at the new one.
    let paths = '';
    if (after) D.info.forEach((it, id) => {
      if (it.ghost !== 'from') return;
      const g = lay.blocks.find(b => b.id === id), b = lay.blocks.find(x => x.id === it.to); if (!g || !b) return;
      const p0 = [g.x + g.w / 2, g.y + g.h / 2], q0 = [b.x + b.w / 2, b.y + b.h / 2], dx = q0[0] - p0[0], dy = q0[1] - p0[1];
      // From the ghost's border to the target's border (plus a gap), so neither card's text is crossed.
      const edge = (B, gap) => Math.min(Math.abs(dx) > 1 ? (B.w / 2 + gap) / Math.abs(dx) : 1e9, Math.abs(dy) > 1 ? (B.h / 2 + gap) / Math.abs(dy) : 1e9, .5);
      const sp = edge(g, 4), sq = edge(b, 6), p = [p0[0] + dx * sp, p0[1] + dy * sp], q = [q0[0] - dx * sq, q0[1] - dy * sq];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 24) return;
      const mx = (p[0] + q[0]) / 2 - (q[1] - p[1]) * .15, my = (p[1] + q[1]) / 2 + (q[0] - p[0]) * .15;
      const ang = Math.atan2(q[1] - my, q[0] - mx), h = 11, w = 5.5;
      const hx = q[0] - Math.cos(ang) * h, hy = q[1] - Math.sin(ang) * h;
      paths += `<path d="M${p[0].toFixed(1)} ${p[1].toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${hx.toFixed(1)} ${hy.toFixed(1)}"/>` +
        `<path class="head" d="M${q[0].toFixed(1)} ${q[1].toFixed(1)} L${(hx - Math.sin(ang) * w).toFixed(1)} ${(hy + Math.cos(ang) * w).toFixed(1)} L${(hx + Math.sin(ang) * w).toFixed(1)} ${(hy - Math.cos(ang) * w).toFixed(1)} Z"/>`;
    });
    svg.innerHTML = paths;
    if ($('world').classList.contains('anim')) { svg.classList.add('fading'); clearTimeout(decorate._t); decorate._t = setTimeout(() => svg.classList.remove('fading'), 340); }
  }
  function arrowsSvg() {
    let s = document.querySelector('#world > svg.d-arrows');
    if (!s) { s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'd-arrows'); s.setAttribute('width', '1'); s.setAttribute('height', '1'); $('world').appendChild(s); }
    return s;
  }
  // Field-level marks on a block, behavior or message card of the After view.
  function fieldMarks(el, B, c) {
    const F = c.fields || {}, n = B.node, frame = B.kind === 'frame';
    const head = frame ? el.querySelector(':scope > .fh') : el.querySelector(':scope > .bd');
    if (!head) return;
    if (c.renamed) { const s = [...head.querySelectorAll('.ttl > span:not(.pill)')].pop(); if (s) s.insertAdjacentHTML('afterend', `<s class="d-was" title="Old name">${esc(c.renamed.from)}</s>`); }
    if (F.type) {
      const pill = head.querySelector('.ttl > .pill:not(.d-was)');
      const old = F.type.from ? `<span class="pill d-was" data-k="${esc(F.type.from.toLowerCase())}" title="Old type">${esc(F.type.from)}</span>` : '';
      if (pill) { if (F.type.from) pill.insertAdjacentHTML('beforebegin', old); pill.classList.add('d-now'); }
      else if (old) head.querySelector('.ttl')?.insertAdjacentHTML('beforeend', old);
    }
    if (F.sketch) {
      const sk = head.querySelector('.sk');
      if (sk) { sk.innerHTML = runsHTML(F.sketch.words); sk.title = 'Was: ' + (F.sketch.from || '(no sketch)'); }
      else if (!F.sketch.to) head.querySelector('.ttl')?.insertAdjacentHTML('afterend', `<div class="sk" style="height:18px;-webkit-line-clamp:1"><del class="d-del">${esc(F.sketch.from)}</del></div>`);
    }
    if (F.implements) {
      const behs = head.querySelector('.behs');
      F.implements.added.forEach(x => head.querySelectorAll(`.behs [data-beh="${CSS.escape(x)}"]`).forEach(b => b.classList.add('d-badd')));
      if (F.implements.removed.length) {
        const html = F.implements.removed.map(x => { const g = glyphFor(x); return `<span class="badge d-brem" title="${esc(x)} (no longer implemented)" style="background:${g.c}">${g.g}</span>`; }).join('');
        if (behs) behs.insertAdjacentHTML('beforeend', html); else head.querySelector('.ttl')?.insertAdjacentHTML('beforeend', html);
      }
    }
    if (n.form === 'message' && F.refines) {
      const r = head.querySelector('.rel2'), A = D.mA.node(c.a.id);
      const was = A && A.refines ? 'refines ' + A.refines : '';
      if (r && was) r.insertAdjacentHTML('afterbegin', `<s class="d-was">${esc(was)}</s>`);
    }
    // Carried types: added dots ringed, removed ones hollow, on the card's carries ear.
    if (n.form === 'message' && F.carries) {
      let ear = el.querySelector(':scope > .tab.cry');
      if (!ear && F.carries.removed.length) { el.insertAdjacentHTML('beforeend', '<div class="tab bot cry d-tabghost"></div>'); ear = el.querySelector(':scope > .tab.cry'); }
      if (ear) {
        F.carries.added.forEach(t => ear.querySelector(`[data-carry="${CSS.escape(t)}"]`)?.classList.add('d-padd'));
        F.carries.removed.forEach(t => ear.insertAdjacentHTML('beforeend', `<span class="pdot d-prem" title="${esc(t)} (no longer carried)"></span>`));
      }
    }
    // Port dots and drawer rows: added ones ringed, removed ones as hollow dots or struck rows.
    const rows = portChanges(c, n);
    ['top', 'bot'].forEach(side => {
      const ch = rows[side === 'top' ? 'in' : 'out']; if (!ch.added.length && !ch.removed.length) return;
      const list = dotsOf(n, state.opts.childDots)[side === 'top' ? 'in' : 'out'];
      let tab = el.querySelector(`:scope > .tab.${side}`);
      if (!tab && ch.removed.length) { el.insertAdjacentHTML('beforeend', `<div class="tab ${side} d-tabghost"></div>`); tab = el.querySelector(`:scope > .tab.${side}`); }
      if (!tab) return;
      const open = tab.classList.contains('open');
      const items = open ? [...tab.querySelectorAll('.drow')] : [...tab.querySelectorAll('.pdot')];
      items.forEach((x, i) => { const p = list[i]; if (p && ch.added.includes(portLabel(p))) x.classList.add(open ? 'd-radd' : 'd-padd'); });
      ch.removed.forEach(lab => {
        if (open) {
          const row = `<div class="drow d-rrem" title="Removed"><span class="pdot d-prem"></span><span>${esc(lab)}</span></div>`;
          const mini = tab.querySelector('.dmin'); if (side === 'bot' && mini) mini.insertAdjacentHTML('beforebegin', row); else tab.insertAdjacentHTML('beforeend', row);
          tab.style.height = (parseFloat(tab.style.height) || tab.offsetHeight) + 23 + 'px';
        } else tab.insertAdjacentHTML('beforeend', `<span class="pdot d-prem" title="${esc(lab)} (removed)"></span>`);
      });
    });
  }
  // Ports added and removed, as drawer labels: blocks from fields.drawer, behaviors from fields.ports.
  function portChanges(c, n) {
    const F = c.fields || {}, none = { added:[], removed:[] };
    if (F.drawer) return { in:F.drawer.in, out:F.drawer.out };
    if (n.form === 'behavior' && F.ports) {
      const pick = (list, dir) => list.filter(p => p.dir === dir).map(portLabel);
      const ch = F.ports.changed || [];
      return { in:{ added:[...pick(F.ports.added, 'in'), ...pick(ch.map(x => x.to), 'in')], removed:[...pick(F.ports.removed, 'in'), ...pick(ch.map(x => x.from), 'in')] },
        out:{ added:[...pick(F.ports.added, 'out'), ...pick(ch.map(x => x.to), 'out')], removed:[...pick(F.ports.removed, 'out'), ...pick(ch.map(x => x.from), 'out')] } };
    }
    return { in:none, out:none };
  }
  // Ports whose compatibility changed: own ports (not via behaviors, not children's) get an amber ring.
  function markAffected(el, B) {
    const A = D.aff.get(B.id); if (!A) return;
    ['top', 'bot'].forEach(side => {
      const tab = el.querySelector(`:scope > .tab.${side}`); if (!tab) return;
      const list = dotsOf(B.node, state.opts.childDots)[side === 'top' ? 'in' : 'out'], open = tab.classList.contains('open');
      const items = open ? [...tab.querySelectorAll('.drow:not(.d-rrem)')] : [...tab.querySelectorAll('.pdot:not(.d-prem)')];
      items.forEach((x, i) => {
        const p = list[i]; if (!p || p.child || p.via || !A.has(p.name)) return;
        const a = A.get(p.name), who = l => l.map(q => plain(q.owner) + '.' + q.port).join(', ');
        x.classList.add(open ? 'd-raff' : 'd-paff');
        x.title = `${portLabel(p)}: compatibility changed` + (a.lost.length ? `; no longer accepted with ${who(a.lost)}` : '') + (a.gained.length ? `; now accepted with ${who(a.gained)}` : '');
      });
    });
  }

  // ---------- the change list (its rows: Viewer.Changes, review.js, shared with the Review panel) ----------
  // Removed elements are listed under their ghost's display id, with the number of blocks the ghost holds.
  const listItems = res => changeItems(res, D.mA, { removedId: c => D.toDisp.get(c.a.id), inside: c => (D.info.get(D.toDisp.get(c.a.id)) || {}).inside });
  function renderList() {
    const S = D.res && D.res.summary, body = $('dBody');
    if (D.err) { body.innerHTML = `<div class="d-empty">Side ${D.err.side} (${esc((D.data[D.err.side] || {}).name || '')}) does not parse: ${esc(D.err.message)}</div>`; $('dCount').textContent = ''; return; }
    const n = D.res.changes.length + D.res.affected.length;
    const na = D.res.affected.length;
    $('dCount').textContent = n ? `${D.res.changes.length} change${D.res.changes.length === 1 ? '' : 's'}${na ? `, ${na} affected port${na === 1 ? '' : 's'}` : ''}` : '';
    $('dN').textContent = String(D.res.changes.length);
    if (!n) { body.innerHTML = `<div class="d-empty"><b>No changes.</b><br>Both sides describe the same blocks, behaviors and shapes. Formatting, comments and the order of blocks within a level are not changes.</div>`; return; }
    body.innerHTML = changeSummaryHTML(S) + changeListHTML(D.items);
  }
  function highlightItem(id) {
    document.querySelectorAll('#dBody .d-item').forEach(b => b.classList.toggle('on', !!id && b.dataset.id === id));
    const on = id && document.querySelector(`#dBody .d-item.on`); if (on && sheetOpen()) on.scrollIntoView({ block:'nearest' });
  }
  // Pan to an element of the current view and select it, opening the blocks that hold it.
  function goToDisp(id) {
    const it = D.info.get(id);
    let target = id;
    if (D.view === 'after' && it && it.tags[0] === 'removed' && !it.ghost) { // inside a removed block: its ghost
      let a = D.mA.node(D.dispToA.get(id)); while (a && !D.ghostOf.has(a.id)) a = a.form === 'block' ? a.parent : a.owner;
      if (a) target = D.ghostOf.get(a.id);
    }
    if (D.view === 'before' && it && it.tags[0] === 'added') { toast(`${it.name} is new: switch to After to see it.`); return; }
    if (D.view === 'before') { const a = D.mA.node(D.dispToA.get(target) || ''); for (let p = a && (a.form === 'block' ? a.parent : a.owner); p; p = p.parent) state.open.add(D.toDisp.get(p.id) || p.id); }
    else { const n = D.mM.node(target); for (let p = n && (n.form === 'block' ? n.parent : n.owner); p; p = p.parent) state.open.add(p.id); }
    if (narrow()) toggleSheet(false);
    dRender();
    setTimeout(() => { centerOn(target); select(target, null); }, 30);
  }

  // ---------- chrome: dock controls, sheet, banners ----------
  function setView(v, quiet) {
    if (!D.mA && v === 'before') return;
    if (v === D.view) return;
    D.view = v;
    document.querySelectorAll('#dSeg [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    state.drawers.clear(); state.talk = null;
    dRender();
    showLabel();
    if (!quiet) toast(v === 'before' ? `Before: ${D.data.a.name || 'side a'}.` : `After: ${D.data.b.name || 'side b'}, with what was removed and where things moved from.`);
  }
  function toggleSheet(open) {
    const s = sheet(); const o = open ?? s.classList.contains('closed');
    if (o) closeMessages();
    s.classList.toggle('closed', !o); $('dBtn').classList.toggle('on', o); $('dBtn').setAttribute('aria-expanded', String(o));
  }
  function showLabel() {
    const a = D.data.a.label || D.data.a.name || 'a', b = D.data.b.label || D.data.b.name || 'b';
    $('specName').textContent = `${D.data.label || a + ' → ' + b} · ${D.view === 'before' ? 'before' : 'after'}`;
    document.title = (D.data.label || a + ' → ' + b) + ' · sbtel diff';
  }
  function noneCard() {
    document.querySelector('.d-none')?.remove();
    const empty = D.res && !D.res.changes.length && !D.res.affected.length;
    if (!empty && !D.err) return;
    const el = document.createElement('div'); el.className = 'float d-none' + (D.err ? ' d-err' : ''); el.setAttribute('role', 'status');
    el.innerHTML = D.err ? `<b>Can't compare these specs</b><span>${esc((D.data[D.err.side] || {}).name || 'side ' + D.err.side)} does not parse: ${esc(D.err.message)}</span>`
      : `<b>No changes</b><span>${esc(D.data.a.name || 'a')} and ${esc(D.data.b.name || 'b')} describe the same system. Formatting and comments are ignored.</span>`;
    el.style.left = viewW() / 2 + 'px';
    document.body.appendChild(el);
  }
  let vtEl = null;
  function versionToast(text, reload) {
    vtEl?.remove();
    vtEl = document.createElement('div'); vtEl.className = 'float d-vt'; vtEl.setAttribute('role', 'alertdialog');
    vtEl.innerHTML = `<span>${esc(text)}</span>${reload ? '<button class="btn" data-v="later">Later</button><button class="btn primary" data-v="reload">Reload</button>' : ''}`;
    vtEl.addEventListener('click', e => { const v = e.target.closest('[data-v]')?.dataset.v; if (!v) return; vtEl.remove(); vtEl = null; if (v === 'reload') reload(); });
    document.body.appendChild(vtEl);
  }
  function chrome() {
    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st); changesStyle();
    document.body.classList.add('diffmode');
    const help = document.querySelector('#help ul');
    if (help) help.innerHTML = `<li>This is a <b>diff</b> of two sbtel specs. It is read-only.</li>
      <li><b>After</b> shows the new version: <span style="color:var(--ok)">new</span> blocks are green, <span style="color:var(--warn)">removed</span> ones are dashed ghosts at their old place, <span style="color:var(--accent)">moved</span> ones are blue with an arrow from where they were, and an <span style="color:var(--d-amb)">amber dot</span> marks a changed block (hover it for what changed).</li>
      <li>Renames strike the old name; sketch edits show the words removed and added.</li>
      <li>A changed level name, or port, level or adjacency sketch, is amber: point at it (tap on a touch screen) to see the words removed and added.</li>
      <li><b>Before</b> shows the old version (keys B and A switch).</li>
      <li>Click an entry in the change list to go to it.</li>
      <li>Drag the canvas to pan. Pinch, or ⌘/Ctrl + scroll, to zoom.</li>`;
    ['undo', 'redo', 'srcBtn'].forEach(id => { const b = $(id); if (b) b.hidden = true; });
    const seg = document.createElement('div'); seg.className = 'd-seg'; seg.id = 'dSeg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Version shown');
    seg.innerHTML = '<button data-view="before" aria-pressed="false" title="Show side a (B)">Before</button><button data-view="after" aria-pressed="true" title="Show side b, with ghosts (A)">After</button>';
    seg.addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
    const btn = document.createElement('button'); btn.className = 'tb'; btn.id = 'dBtn'; btn.setAttribute('aria-controls', 'dSheet'); btn.setAttribute('aria-expanded', 'false'); btn.title = 'The list of changes';
    btn.innerHTML = '@@icon diff@@<span class="lbl">Changes</span><span class="d-n" id="dN"></span>';
    btn.onclick = () => toggleSheet();
    const dock = $('dock'); dock.prepend(btn); dock.prepend(seg);
    const sh = document.createElement('aside'); sh.className = 'float sheet right closed d-sheet'; sh.id = 'dSheet'; sh.setAttribute('aria-label', 'Changes');
    sh.innerHTML = `<header><h2>Changes</h2><span class="sub" id="dCount"></span><span class="spacer"></span><button class="xbtn" id="dClose" aria-label="Close the change list">${ICON.close}</button></header><div class="body" id="dBody"></div>`;
    document.body.appendChild(sh);
    $('dClose').onclick = () => toggleSheet(false);
    $('dBody').addEventListener('click', e => { const b = e.target.closest('.d-item'); if (b) goToDisp(b.dataset.id); });
    addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('textarea, input') || modalEl || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'b' || e.key === 'B') setView('before'); else if (e.key === 'a' || e.key === 'A') setView('after');
    });
  }
  // §6.5: reassign the app's function declarations. Everything that edits becomes a no-op.
  function hooks() {
    render = dRender;
    readOnly = () => true; document.body.classList.add('ro');
    // A callout on a changed port, level or group sketch shows the word diff (After view).
    calloutSketch = (kind, ref, text) => { const w = D.view === 'after' && sketchChange(kind, ref); return w ? runsHTML(w) : esc(text); };
    setSource = () => {};
    edit = () => { toast(READONLY); return { src:state.src }; };
    undo = () => {}; redo = () => {};
    pressStart = () => false;
    startLink = e => { e.preventDefault(); e.stopPropagation(); };
    openEdit = () => toast(READONLY);
    askDelete = () => {}; askDeleteMany = () => {}; cutSelected = () => {};
    // The canvas menu: open and close, code, comment (server mode), nothing that edits.
    menuItems = target => {
      const el = target && target.closest && target.closest('.blk'), id = el && el.dataset.id, n = id && D.mM.node(id);
      if (!el || !n || D.view !== 'after') return null;
      const it = D.info.get(id), items = [];
      if (n.form === 'block' && hasInside(n)) items.push({ label: state.open.has(id) ? 'Close' : 'Open', run:() => toggle(id) });
      if (!(it && it.ghost)) { items.push({ label:'Source', run:() => openCode(id) }); if (SBTEL.session) items.push({ label:'Comment', run:() => openComposer(targetKey(id)) }); }
      return items.length ? { title:it ? it.name : n.name, items } : null;
    };
    renderStrip = () => {
      const id = state.sel, it = id && D.info.get(id);
      if (!id || state.multi.size !== 1 || D.view !== 'after' || (it && it.ghost) || !D.mB || !D.mB.node(id)) { strip.hidden = true; return; }
      strip.innerHTML = `<button class="tb" data-a="code" title="Show its text in the spec (side b)">${ICON.code}<span class="lbl">Source</span></button>` +
        (SBTEL.session ? `<button class="tb" data-a="comment" title="${kb('Comment (⌘-click, or C)')}">${ICON.comment}<span class="lbl">Comment</span></button>` : '');
      strip.setAttribute('aria-label', 'Actions for ' + D.mB.node(id).name);
      strip.hidden = false; placeStrip();
    };
    // Code and comments refer to side b, with side b's own text.
    const asB = f => (...a) => { const k = { m:state.model, s:state.src }; state.model = D.mB || state.model; state.src = D.data.b.src; try { return f(...a); } finally { state.model = k.m; state.src = k.s; } };
    openCode = asB(openCode); targetSource = asB(targetSource); renderMsgTable = asB(renderMsgTable);
    const origSelect = select;
    select = (id, line) => { origSelect(id, line); highlightItem(id); };
    const origOpenMessages = openMessages;
    openMessages = o => { if (sheetOpen()) toggleSheet(false); origOpenMessages(o); };
    const origComposer = openComposer;
    openComposer = (key, anchor) => { if (!SBTEL.session) { toast('Comments go to the agent from a diff opened with sbtel open-diff.'); return; } origComposer(key, anchor); };
    // Comments live in the session, as in server mode: sent ones keep their bubble and thread, and
    // the thread shows the agent's replies (session.js).
    SC.hook();
    // Room for the marks: a renamed card measures its old name beside the new one, a changed sketch
    // measures the merged word runs (After view only).
    const tw = M.tw, wrap = M.wrap;
    M.tw = (t, f) => D.view === 'after' && (f === FONT.title || f === FONT.htitle) && D.titleExtra.has(t) ? tw(t, f) + 8 + tw(D.titleExtra.get(t), f) * .8 : tw(t, f);
    M.wrap = (t, f, w) => D.view === 'after' && D.skExtra.has(t) ? wrap(D.skExtra.get(t), f, w) : wrap(t, f, w);
    // The drawing fits beside the change sheet on wide screens.
    fit = animate => {
      if (!state.lay) return;
      const W = viewW(), H = innerHeight, top = 70, bottom = 80;
      const k = Math.min(1.1, (W - 48) / state.lay.size.w, (H - top - bottom) / (state.lay.size.h + 40));
      state.cam = { k, x:(W - state.lay.size.w * k) / 2, y: top + Math.max(0, (H - top - bottom - state.lay.size.h * k) / 2) };
      if (animate) animCam(); applyCam();
    };
    centerOn = id => {
      const B = state.lay.blocks.find(b => b.id === id); if (!B) return;
      const W = viewW(), H = innerHeight;
      // Readable: zoom in when the block is drawn small, out when it does not fit.
      const fitK = Math.max(.2, Math.min(1, (W - 40) / B.w, (H - 180) / B.h));
      let k = state.cam.k; if (k > fitK || k < fitK * .7) k = fitK;
      state.cam = { k, x: W / 2 - (B.x + B.w / 2) * k, y: (H - 10) / 2 - (B.y + B.h / 2) * k };
      animCam(); applyCam();
      const el = state.elems.get(id); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    };
  }
  // The blocks open at first: every block that holds a change, and the top-level blocks.
  // keep: a reload keeps what the reader opened, and opens what the new diff needs.
  function initialOpen(keep) {
    if (!keep) { state.open = new Set(); state.expanded = new Set(); }
    state.drawers = new Map(); state.sel = null; state.multi = new Set();
    // Blocks that hold a change (in either version), by display id, with their depth in the merged spec.
    const want = new Map(), depth = id => { let d = 0; for (let n = D.mM.node(id); n && n.parent; n = n.parent) d++; return d; };
    const add = id => { if (id && !want.has(id)) want.set(id, depth(id)); };
    topBlocks(D.mM).forEach(b => add(b.id));
    if (D.mA) topBlocks(D.mA).forEach(b => add(D.toDisp.get(b.id) || b.id));
    D.info.forEach((it, id) => {
      const n = D.mM.node(id);
      if (n) for (let p = n.form === 'block' ? n.parent : n.owner; p; p = p.parent) add(p.id);
      const a = D.mA && D.mA.node(D.dispToA.get(id) || '');
      if (a && it.tags[0] !== 'added') for (let p = a.form === 'block' ? a.parent : a.owner; p; p = p.parent) add(D.toDisp.get(p.id) || p.id);
      if (it.change && it.change.fields && it.change.fields.sketch) state.expanded.add(id);
    });
    // Open them shallowest first while about OPEN_BUDGET cards are on the canvas; deeper changes then show
    // as "changes inside" counts, and the change list opens whatever it goes to.
    const inside = id => { const n = D.mM.node(id) || (D.mA && D.mA.node(D.dispToA.get(id) || '')); return n && n.form === 'block' ? childBlocks(n).length + n.behaviorDecls.length + n.messageDecls.length : 0; };
    let shown = topBlocks(D.mM).length;
    [...want].sort((p, q) => p[1] - q[1]).forEach(([id, d]) => { if (state.open.has(id)) return;
      const n = D.mM.node(id), up = n && n.parent; if (up && !state.open.has(up.id)) return;
      const k = inside(id); if (d === 0 || shown + k <= OPEN_BUDGET) { state.open.add(id); shown += k; } });
  }
  // The canvas width (for both views) that lets the After picture fit the screen at the largest zoom.
  function pickWidth() {
    D.width = null;
    const W = viewW() - 48, H = innerHeight - 150;
    let best = null;
    [...new Set([state.opts.width, 1500, 1900, 2400])].sort((p, q) => p - q).forEach(w => {
      D.width = w; const L = layout(D.mM, optsFor('after'), M), k = Math.min(W / L.size.w, H / (L.size.h + 40));
      if (!best || k > best.k + 1e-6) best = { w, k };
    });
    D.width = best.w;
  }
  // Show a diff: data is the shape of GET /s/<id>/diff.json, {a: {name, label, src, hash}, b: {…}, version}.
  function open(data, { keepCamera } = {}) {
    const cam = { ...state.cam };
    build(data);
    state.model = D.mM; state.src = D.mM.src;
    initialOpen(keepCamera); if (!keepCamera) pickWidth();
    if (!keepCamera || D.err) D.view = 'after';
    if (D.err && !D.mB) D.view = 'before';
    if (D.view === 'before' && !D.mA) D.view = 'after';
    document.querySelectorAll('#dSeg [data-view]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.view === D.view)); b.disabled = !D.mA || !D.mB; });
    for (const [, el] of state.elems) el.remove(); state.elems.clear();
    dRender();
    renderList(); noneCard(); showLabel();
    if (keepCamera) { state.cam = cam; applyCam(); } else fit(false);
    return D.res;
  }
  async function boot() {
    chrome(); hooks();
    state.comments = [];
    if (!narrow()) toggleSheet(true);
    // A comparison opened from a spec session's tab (?compare=<key>): the pair comes from that tab.
    if (SBTEL.compare) {
      let data = null;
      try { const from = window.opener || (window.parent !== window ? window.parent : null); // the tab that opened this one, or the page that frames it
        const src = from && from.sbtelCompares && from.sbtelCompares[SBTEL.compare]; if (src) data = JSON.parse(JSON.stringify(src)); } catch (e) {}
      if (!data) { versionToast('This comparison was opened from another tab of the session, which has closed or reloaded since. Open it again from there.'); return; }
      open(data);
      return;
    }
    if (dev) {
      const b = dev === 'none' ? SAMPLE.replace(/\n {2}\(level/, '\n\n  ; only formatting differs\n  (level') : devB();
      open({ a:{ name:'shell-a.sbtel', label:'shell-a.sbtel', src:SAMPLE }, b:{ name:'shell-b.sbtel', label:'shell-b.sbtel', src:b }, version:1, label:'shell-a.sbtel → shell-b.sbtel' });
      return;
    }
    const get = async r => { const res = await fetch(SBTEL.base + r, { cache:'no-store' }); if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; } return res.json(); };
    let lastSeq = 0;
    R.hook(); R.restore(R.readDraft());
    const load = async keepCamera => {
      const data = await get('diff.json');
      data.label = data.label || ((data.a && data.a.label) && (data.b && data.b.label) ? data.a.label + ' → ' + data.b.label : '');
      open(data, { keepCamera });
    };
    for (;;) {
      try { await load(false); break; }
      catch (e) {
        if (e.status === 404) { R.forget(); versionToast('This sbtel session no longer exists.'); return; }
        versionToast('Cannot reach the sbtel server. Retrying…'); await new Promise(r => setTimeout(r, 5000));
      }
    }
    vtEl?.remove(); vtEl = null;
    try { const log = await get('log'); lastSeq = Math.max(lastSeq, SC.rebuild(log.events || [])); SC.setSeen(log.seen); dRender(); } catch (e) {}
    R.recount(); R.prune();
    const connect = () => {
      const es = new EventSource(SBTEL.base + 'events?after=' + lastSeq);
      es.addEventListener('version', e => {
        const d = JSON.parse(e.data || '{}'); if (d.version && d.version <= (D.data.version || 0)) return;
        versionToast(`A new version of this diff${d.version ? ' (v' + d.version + ')' : ''} is available.`, () => load(true).catch(() => toast('Could not reload: the sbtel server is not answering.')));
      });
      const seq = e => { const n = parseInt(e.lastEventId, 10); if (n > lastSeq) lastSeq = n; };
      es.addEventListener('version', seq);
      es.addEventListener('reply', e => { seq(e); SC.onReply(JSON.parse(e.data || '{}')); });
      es.addEventListener('closed', () => { closed = true; R.forget(); es.close(); versionToast('This session was closed.'); });
      es.onerror = () => { es.close(); if (!closed) setTimeout(connect, 5000); };
    };
    connect();
  }
  return { boot, open, sample: () => ({ a:SAMPLE, b:devB() }), _state:D };
})();
