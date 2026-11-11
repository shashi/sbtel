// @sbtel file Viewer.Review
// The draft review (docs/DESIGN.md §6.7), shared by server mode and diff mode. Comments and edits gather
// in the tab as a draft, as on GitHub, and go to the agent together as one `review` event (§4.3): the
// overall message, the comments with their anchors and, in server mode, the edited spec as a proposal.
// A review never writes the spec file; Save does that. The draft (pending comments, the message and, from
// server mode, the edited source) is kept in localStorage per session, so a reload loses nothing.
// Inlined by viewer/build.mjs after session.js and before server.js and diff.js; at load it only defines
// functions, so standalone mode is untouched.

// @sbtel begin Viewer.Changes
// A change list from a DiffResult (§7): its rows and their markup, as the diff view's change sheet shows
// them and the Review panel lists the edits of a draft. Pure but for esc.
const CHANGES_CSS = `
:root { --d-amb:#C27A00; --d-amb-soft:#FBEBCB; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --d-amb:#F0B43C; --d-amb-soft:#3A2E14; } }
:root[data-theme="dark"] { --d-amb:#F0B43C; --d-amb-soft:#3A2E14; }
.d-list .d-ins { background:var(--ok-soft); color:var(--ok); text-decoration:none; border-radius:3px; padding:0 1px; }
.d-list .d-del { background:var(--warn-soft); color:var(--warn); text-decoration:line-through; border-radius:3px; padding:0 1px; }
.d-sum { display:flex; flex-wrap:wrap; gap:6px; margin:2px 0 12px; }
.d-chip { display:inline-flex; align-items:center; gap:5px; font-size:12px; padding:3px 8px; border-radius:10px; background:var(--chip); color:var(--ink); }
.d-chip i { width:8px; height:8px; border-radius:50%; flex:none; }
.d-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
.d-list h4 { margin:14px 0 4px; font-size:12px; color:var(--muted); }
.d-item { display:grid; grid-template-columns:22px 1fr; gap:2px 8px; align-items:start; width:100%; box-sizing:border-box; text-align:left; border:0; background:none; border-radius:9px; padding:7px 8px; cursor:pointer; font-size:13px; color:var(--ink); }
.d-item:hover, .d-item:focus-visible { background:var(--chip); outline:none; }
.d-item.on { background:var(--accent-soft); }
.d-item .ic { width:20px; height:20px; border-radius:6px; display:inline-flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; color:#fff; }
.d-item .ic.add { background:var(--ok); } .d-item .ic.rem { background:var(--warn); } .d-item .ic.mov { background:var(--accent); } .d-item .ic.chg, .d-item .ic.prt { background:var(--d-amb); }
:root[data-theme="dark"] .d-item .ic { color:#111; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .d-item .ic { color:#111; } }
.d-item .nm { font-family:var(--ff-mono); font-weight:500; font-size:12.5px; word-break:break-word; }
.d-item .nm s { color:var(--muted); text-decoration-color:var(--warn); margin-left:6px; }
.d-item .kd { color:var(--muted); font-size:11px; margin-left:6px; font-family:var(--ff-ui); }
.d-item .dl { grid-column:2; color:var(--muted); font-size:12px; line-height:1.45; word-break:break-word; }
.d-item .dl b { color:var(--ink); font-weight:600; }
.d-item code { font-family:var(--ff-mono); font-size:11.5px; }
.d-empty { padding:18px 6px; color:var(--muted); font-size:13.5px; line-height:1.5; }`;
function changesStyle() {
  if (document.getElementById('sbChangesCss')) return;
  const st = document.createElement('style'); st.id = 'sbChangesCss'; st.textContent = CHANGES_CSS; document.head.appendChild(st);
}
// A word diff (§7: [{op: '=' | '+' | '-', text}]) as HTML: inserted runs in <ins>, deleted ones in <del>.
function runsHTML(words) { return words.map(w => w.op === '=' ? esc(w.text) : `<${w.op === '+' ? 'ins' : 'del'} class="d-${w.op === '+' ? 'ins' : 'del'}">${esc(w.text)}</${w.op === '+' ? 'ins' : 'del'}>`).join(' '); }
const changeKind = e => e === 'block' ? 'block' : e === 'behavior' ? 'behavior' : e === 'file' ? 'top level' : 'shape';
const changePlain = id => id.replace(/^[βμ]:/, '');
function changePlace(p) { return (p.in ? changePlain(p.in) : 'the top level') + (p.level != null ? ` level ${p.level}` : ''); }
// What changed in one change, as HTML lines.
function changeLines(c) {
  const F = c.fields || {}, L = [], code = s => `<code>${esc(s)}</code>`, list = (a, pre) => a.map(x => pre + code(x)).join(' ');
  if (c.moved) L.push(`moved from <b>${esc(changePlace(c.moved.from))}</b> to <b>${esc(changePlace(c.moved.to))}</b>`);
  if (F.type) L.push(`type ${F.type.from ? code(F.type.from) : 'none'} → ${F.type.to ? code(F.type.to) : 'none'}`);
  if (F.sketch) L.push('sketch: ' + runsHTML(F.sketch.words));
  if (F.implements) L.push('behaviors ' + [list(F.implements.added, '+'), list(F.implements.removed, '−')].filter(Boolean).join(' '));
  const retyped = x => x.from.dir !== x.to.dir || x.from.kind !== x.to.kind;
  const pp = F.ports ? [list(F.ports.added.map(p => p.dir + ' ' + portLabel(p)), '+'), list(F.ports.removed.map(p => p.dir + ' ' + portLabel(p)), '−'),
    F.ports.changed.filter(retyped).map(x => code(x.name) + ` ${esc(x.from.dir + ' ' + x.from.kind)} → ${esc(x.to.dir + ' ' + x.to.kind)}`).join(' ')].filter(Boolean) : [];
  if (pp.length) L.push('ports ' + pp.join(' '));
  if (F.ports) F.ports.changed.filter(x => x.sketch).forEach(x => L.push(`port ${code(x.name)} sketch: ` + runsHTML(x.sketch.words)));
  if (F.drawer && !F.ports) L.push('drawer rows ' + [list([...F.drawer.in.added, ...F.drawer.out.added], '+'), list([...F.drawer.in.removed, ...F.drawer.out.removed], '−')].filter(Boolean).join(' '));
  if (F.adjacency) L.push('adjacent to ' + [list(F.adjacency.added.map(changePlain), '+'), list(F.adjacency.removed.map(changePlain), '−')].filter(Boolean).join(' '));
  (F.levels || []).forEach(e => {
    const nm = `level ${e.level}`, q = x => x == null ? 'none' : code(x);
    if (e.name) L.push(`${nm} name ${q(e.name.from)} → ${q(e.name.to)}`);
    if (e.sketch) L.push(`${nm} sketch: ` + runsHTML(e.sketch.words));
    (e.groups || []).forEach(g => L.push(`adjacent ${g.blocks.map(b => code(changePlain(b))).join(', ')} sketch: ` + runsHTML(g.sketch.words)));
  });
  if (F.params) L.push(`parameters (${esc(F.params.from.join(' '))}) → (${esc(F.params.to.join(' '))})`);
  if (F.carries) L.push('carries ' + [list(F.carries.added, '+'), list(F.carries.removed, '−')].filter(Boolean).join(' '));
  if (F.refines) L.push(`refines ${F.refines.from ? code(F.refines.from) : 'nothing'} → ${F.refines.to ? code(F.refines.to) : 'nothing'}`);
  return L;
}
// The rows of a change list: { cls, icon, id, c|aff, name (HTML), kind, lines }. mA is side a's model. A
// removed element inside a removed holder is listed with its holder. o.removedId(c) and o.inside(c) give
// a removed row its id and the number of blocks it held (the diff view's ghosts); by default it has none.
function changeItems(res, mA, o = {}) {
  const items = [], removedA = new Set(res.changes.filter(c => c.tags[0] === 'removed').map(c => c.a.id));
  res.changes.forEach(c => {
    const t = c.tags[0];
    if (t === 'removed') {
      const n = mA.node(c.a.id), up = n && (n.form === 'block' ? n.parent : n.owner);
      if (up && removedA.has(up.id)) return;
      const inside = o.inside ? o.inside(c) : 0;
      items.push({ cls:'rem', icon:'−', id:o.removedId ? o.removedId(c) : null, c, name:esc(c.a.name), kind:changeKind(c.element), lines:[`was in <b>${esc(c.a.in ? changePlain(c.a.in) : 'the top level')}</b>${inside ? `, with ${inside} block${inside === 1 ? '' : 's'} inside` : ''}`] });
      return;
    }
    if (t === 'added') { items.push({ cls:'add', icon:'+', id:c.b.id, c, name:esc(c.b.name), kind:changeKind(c.element), lines:[`in <b>${esc(c.b.in ? changePlain(c.b.in) : 'the top level')}</b>`] }); return; }
    const cls = c.tags.includes('moved') ? 'mov' : 'chg', icon = c.tags.includes('moved') ? '→' : c.tags.includes('renamed') ? '✎' : '•';
    items.push({ cls, icon, id:c.b.id, c, name: c.element === 'file' ? 'the file' : esc(c.b.name) + (c.renamed ? `<s>${esc(c.renamed.from)}</s>` : ''), kind:changeKind(c.element), lines:changeLines(c) });
  });
  res.affected.forEach(x => {
    const who = l => l.map(q => `<code>${esc(changePlain(q.owner) + '.' + q.port)}</code>`).join(', ');
    items.push({ cls:'prt', icon:'!', id:x.owner, aff:x, name:esc(changePlain(x.owner) + '.' + x.port), kind:`${x.dir} ${x.kind}`,
      lines:[(x.lost.length ? 'no longer accepted with ' + who(x.lost) : ''), (x.gained.length ? 'now accepted with ' + who(x.gained) : '')].filter(Boolean) });
  });
  return items;
}
function changeSummaryHTML(S) {
  const chip = (cls, k, label) => S[k] ? `<span class="d-chip"><i style="background:var(${cls})"></i>${S[k]} ${label}</span>` : '';
  return `<div class="d-sum">${chip('--ok', 'added', 'added')}${chip('--warn', 'removed', 'removed')}${chip('--accent', 'moved', 'moved')}${chip('--d-amb', 'renamed', 'renamed')}${chip('--d-amb', 'changed', 'changed')}${chip('--d-amb', 'affected', 'affected ports')}</div>`;
}
function changeListHTML(items) {
  const groups = [['add', 'Added'], ['rem', 'Removed'], ['mov', 'Moved'], ['chg', 'Changed'], ['prt', 'Affected ports']];
  return `<ol class="d-list">` + groups.map(([cls, title]) => {
    const its = items.map((it, i) => [it, i]).filter(([it]) => it.cls === cls); if (!its.length) return '';
    return `<li><h4>${title}</h4></li>` + its.map(([it, i]) => `<li><button class="d-item" data-di="${i}" data-id="${esc(it.id)}"><span class="ic ${it.cls}">${it.icon}</span><span class="nm">${it.name}<span class="kd">${esc(it.kind)}</span></span>${it.lines.map(l => `<span class="dl">${l}</span>`).join('')}</button></li>`).join('');
  }).join('') + `</ol>`;
}
// @sbtel end Viewer.Changes

// A comparison in a new tab of this page, in diff mode (the page at ?compare=<key>). data has the shape
// of diff.json, {a: {name, label, src}, b: {…}, label}; the new tab reads it from this one (its opener).
function putCompare(data) {
  const k = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  SBTEL.compares[k] = data;
  window.sbtelCompares = SBTEL.compares; // the other view reads it here: a top-level const is not a window property
  return k;
}
function openCompare(data) {
  const k = putCompare(data);
  const w = window.open(location.pathname + '?compare=' + k, '_blank');
  if (!w) toast('The browser blocked the new tab. Allow pop-ups for this page to see the diff.');
  return w;
}

// o: { kind: 'spec' | 'diff', id (the session id), SC (sessionComments), closed(), version(), and in
//   server mode: edits() -> { from, fromLabel, base: { version, hash }, supersedes } (the text the draft's
//   edits are counted from, and the version a proposal is made against), snapshot() -> what server mode
//   keeps in the draft, onSent(result, src) after a review with a proposal }.
function sessionReview(o) {
  const R = { message: '', count: 0, edits: null, t: 0, ct: 0, off: false, open: false, sending: false };
  const KEY = 'sbtel-draft:' + o.id, HKEY = 'sbtel-hist:' + o.id;
  const pending = () => state.comments.filter(c => c.status === 'pending');
  const CSS = `
.tb.rv-btn { position:relative; } .tb.rv-btn.unread::after { content:""; position:absolute; top:3px; right:3px; width:9px; height:9px; border-radius:50%; background:var(--warn); box-shadow:0 0 0 2px var(--panel); }
.tb.rv-btn .rv-n { min-width:18px; height:18px; padding:0 5px; box-sizing:border-box; border-radius:9px; background:var(--accent); color:#fff; font-size:11.5px; font-weight:600; line-height:18px; text-align:center; font-variant-numeric:tabular-nums; }
.cbub.pend { background:var(--surface); color:var(--accent); box-shadow:inset 0 0 0 1.5px var(--accent); }
.cbub .pb { margin-left:3px; padding:0 5px; border-radius:7px; background:var(--accent); color:#fff; font-size:10.5px; font-weight:600; line-height:14px; }
.st-pending { color:var(--accent-ink); font-weight:600; }
.thread .cm .tiny { white-space:nowrap; }
.rv-sheet { z-index:1260; }
.rv-sheet .body { display:flex; flex-direction:column; gap:4px; }
.rv-sec h4 { display:flex; align-items:center; gap:8px; margin:12px 0 6px; font-size:12px; color:var(--muted); }
.rv-sec h4 .spacer { flex:1; }
.rv-sec h4 .btn { text-transform:none; letter-spacing:0; font-size:12px; padding:4px 10px; color:var(--ink); font-weight:500; }
.rv-note { font-size:12.5px; line-height:1.5; color:var(--muted); margin:2px 0 6px; }
.rv-prop { border-left:3px solid var(--accent); background:var(--accent-soft); color:var(--ink); border-radius:8px; padding:8px 10px; font-size:12.5px; line-height:1.5; margin-top:6px; }
.rv-c { border:1px solid var(--panel-line); border-radius:9px; padding:8px 10px; background:var(--surface); margin-bottom:8px; }
.rv-c .rv-h { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); margin-bottom:6px; }
.rv-c .rv-h .spacer { flex:1; }
.rv-c .rv-h .go { border:0; background:none; padding:0; color:var(--accent); cursor:pointer; font:inherit; font-weight:600; text-align:left; }
.rv-sheet textarea { width:100%; box-sizing:border-box; border:1px solid var(--panel-line); border-radius:8px; padding:7px 9px; font:inherit; font-size:13px; line-height:1.45; background:var(--canvas); color:var(--ink); resize:vertical; display:block; }
.rv-c textarea { min-height:52px; }
#rvMsg { min-height:70px; }
.rv-foot { position:sticky; bottom:0; display:flex; align-items:center; gap:10px; padding:12px 0 2px; margin-top:6px; background:var(--panel); border-top:1px solid var(--panel-line); }
.rv-foot .rv-sum { flex:1; font-size:12px; color:var(--muted); line-height:1.4; }
.rv-sent { font-size:12.5px; line-height:1.45; border-top:1px solid var(--panel-line); padding:8px 0; }
.rv-sent .who { font-weight:600; }
.rv-sent .msg { white-space:pre-wrap; margin-top:3px; }
@media (max-width: 760px) { .tb.rv-btn .rv-l { display:none; } }
body.sb-rsheet .dock { left:calc((100vw - min(460px, 100vw)) / 2); max-width:calc(100vw - min(460px, 100vw) - 24px); }`;

  // ---------- the draft on disk ----------
  function readDraft() {
    const raw = store.raw(KEY); if (!raw) return null;
    try { const d = JSON.parse(raw); if (!d || d.v !== 1) throw new Error('bad'); return d; } catch (e) { store.del(KEY); return null; }
  }
  function empty() { return !pending().length && !R.message.trim() && !(o.edits && state.src !== o.edits().from); }
  function persistSoon() { clearTimeout(R.t); R.t = setTimeout(persist, 300); }
  function persist() {
    clearTimeout(R.t); if (R.off || o.closed()) return;
    const snap = o.snapshot ? o.snapshot() : {};
    const comments = pending().map(c => ({ id:c.id, target:c.target, text:c.text, version:c.version, at:c.at }));
    if (!comments.length && !R.message && !snap.src && !snap.proposal) { store.del(KEY); return; }
    if (!store.put(KEY, JSON.stringify({ v:1, ...snap, message:R.message, comments, at:Date.now() }))) R.off = true;
  }
  // Pending comments and the message from a kept draft (server mode restores the source itself).
  function restore(d) {
    if (!d) return;
    R.message = typeof d.message === 'string' ? d.message : '';
    (Array.isArray(d.comments) ? d.comments : []).forEach(c => { if (c && c.target && c.text && !state.comments.some(x => x.id === c.id)) state.comments.push({ id:String(c.id), target:c.target, text:c.text, status:'pending', version:c.version, at:c.at || Date.now() }); });
  }
  // The session is gone (closed, or unknown to the server): drop what this page kept for it.
  function forget() { R.off = true; clearTimeout(R.t); store.del(KEY); store.del('sbtel-read:' + o.id); histForget(HKEY); }
  // Drop the kept drafts and histories of sessions the server says do not exist (404 on meta).
  async function prune() {
    const ids = new Set();
    ['sbtel-draft:', 'sbtel-hist:', 'sbtel-read:'].forEach(p => store.keys(p).forEach(k => { const id = k.slice(p.length); if (/^[0-9a-f]{32}$/.test(id) && id !== o.id) ids.add(id); }));
    for (const id of [...ids].slice(0, 64)) {
      try { const r = await fetch('/s/' + id + '/meta', { cache:'no-store' }); if (r.status === 404) { store.del('sbtel-draft:' + id); store.del('sbtel-hist:' + id); store.del('sbtel-read:' + id); } } catch (e) { return; } // server unreachable: keep everything
    }
  }

  // ---------- counting: pending comments plus the edits since the draft's base ----------
  function computeEdits() {
    if (!o.edits) { R.edits = null; return; }
    const E = o.edits(), cur = state.src;
    const out = { ...E, has: cur !== E.from, n: 0, items: [], summary: null, err: null };
    if (out.has) {
      let mA, mB;
      try { mA = parse(E.from); } catch (e) { out.err = `${E.fromLabel} does not parse (${e.message}); the proposal is sent as written.`; }
      try { mB = parse(cur); } catch (e) { out.err = out.err || `Your text does not parse (${e.message}); the proposal is sent as written.`; }
      if (mA && mB) { const res = diffSpecs(mA, mB); out.items = changeItems(res, mA); out.summary = res.summary; out.n = res.changes.length; }
      if (!out.n) out.n = 1; // text changed but no element did (formatting, comments), or it does not parse
    }
    R.edits = out;
  }
  function recount() { computeEdits(); R.count = pending().length + (R.edits ? R.edits.n : 0); renderBtn(); if (R.open) { renderEdits(); renderFoot(); } }
  // Something changed (an edit, a comment, a version): count again soon, and keep the draft.
  function changed() { clearTimeout(R.ct); R.ct = setTimeout(recount, 200); persistSoon(); }

  // ---------- the toolbar button and the panel ----------
  let btn = null;
  function renderBtn() {
    if (!btn) return;
    btn.querySelector('.rv-n').hidden = !R.count; btn.querySelector('.rv-n').textContent = R.count;
    btn.title = R.count ? `Your review: ${R.count} pending (${pending().length} comment${pending().length === 1 ? '' : 's'}${R.edits && R.edits.has ? ', edits' : ''})` : 'Your review: comments and edits you send to the agent together';
    btn.setAttribute('aria-label', R.count ? `Review, ${R.count} pending` : 'Review');
  }
  const sheet = () => $('rvSheet');
  function toggle(open) {
    const o2 = open ?? !R.open; R.open = o2;
    if (o2) { closeMessages(); const ds = $('dSheet'); if (ds && !ds.classList.contains('closed')) $('dClose').click(); recount(); renderPanel(); }
    sheet().classList.toggle('closed', !o2); btn.setAttribute('aria-expanded', String(o2)); btn.classList.toggle('on', o2); if (o2) btn.classList.remove('unread');
  }
  const goTarget = key => {
    const kind = key.slice(0, key.indexOf(':')), rest = key.slice(key.indexOf(':') + 1);
    if (innerWidth < 760) toggle(false);
    if (kind === 'block' && rest) goTo(rest); else if (kind === 'beh') goTo('β:' + rest);
    else if (kind === 'msg') openMessages({ open:rest }); else if (kind === 'line') goTo(rest.split('|')[0]);
  };
  function renderEdits() {
    const el = $('rvEdits'); if (!el) return;
    const E = R.edits; if (!E) { el.hidden = true; return; }
    el.hidden = false;
    const head = `<h4>Edits${E.has ? ` <span>(${E.n})</span>` : ''}<span class="spacer"></span>${E.has ? '<button class="btn" data-rv="diff">Open the full diff</button>' : ''}</h4>`;
    const prop = E.supersedes ? `<div class="rv-prop">Review <b>${esc(E.supersedes)}</b> proposed edits that the agent has not pushed yet; they are in the diagram, marked proposed. The edits below are on top of them: sending them replaces ${esc(E.supersedes)}'s proposal with the whole of your text.</div>` : '';
    const body = !E.has ? `<p class="rv-note">No edits since ${esc(E.fromLabel)}. Edit the diagram and the changes are listed here; they go to the agent as a proposed spec, and the file is not written.</p>`
      : E.err ? `<p class="rv-note">${esc(E.err)}</p>`
      : E.items.length ? changeSummaryHTML(E.summary) + changeListHTML(E.items)
      : `<p class="rv-note">The text changed, but no element did (formatting or comments). It is sent as a proposed spec all the same.</p>`;
    el.innerHTML = head + prop + (E.has ? `<p class="rv-note">Since ${esc(E.fromLabel)}.</p>` : '') + body;
  }
  function renderComments() {
    const el = $('rvComments'); if (!el) return;
    const list = pending();
    el.innerHTML = `<h4>Comments${list.length ? ` <span>(${list.length})</span>` : ''}</h4>` + (list.length ? list.map(c => `<div class="rv-c" data-cid="${esc(c.id)}"><div class="rv-h"><button class="go" data-rv="go" title="Show it">${esc(targetLabel(c.target))}</button><span class="spacer"></span><button class="tiny" data-rv="send" title="Send this comment to the agent now, on its own">Send now</button><button class="tiny" data-rv="del">Delete</button></div><textarea aria-label="Comment on ${esc(targetLabel(c.target))}">${esc(c.text)}</textarea></div>`).join('')
      : `<p class="rv-note">No pending comments. Select something on the canvas, press Comment and choose <b>Add to review</b> (Shift+Enter).</p>`);
  }
  function renderSent() {
    const el = $('rvSent'); if (!el) return;
    const list = o.SC.reviews().slice().reverse();
    el.hidden = !list.length;
    el.innerHTML = list.length ? `<h4>Sent reviews</h4>` + list.map(r => `<div class="rv-sent"><span class="who">${esc(r.id)}</span> <span style="color:var(--muted)">${new Date(r.at).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })} · ${[r.n ? r.n + ' comment' + (r.n === 1 ? '' : 's') : '', r.proposal ? 'proposed edits' : ''].filter(Boolean).join(', ') || 'a message'}</span>${r.message ? `<div class="msg">${esc(r.message)}</div>` : ''}${r.replies.map(x => `<div class="sb-reply"><span class="who">Agent</span>${esc(x.text)}</div>`).join('')}</div>`).join('') : '';
  }
  function renderFoot() {
    const el = $('rvSum'); if (!el) return;
    const n = pending().length, E = R.edits, parts = [n ? n + ' comment' + (n === 1 ? '' : 's') : '', E && E.has ? 'your edits as a proposed spec' : '', R.message.trim() ? 'your message' : ''].filter(Boolean);
    el.textContent = parts.length ? `Sends ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')} to the agent.${E ? ' The spec file is not written.' : ''}` : 'Nothing to send yet.';
    $('rvSend').disabled = !parts.length || R.sending || o.closed();
  }
  function renderPanel() {
    if (!sheet()) return;
    renderEdits(); renderComments(); renderSent();
    const m = $('rvMsg'); if (m && m.value !== R.message) m.value = R.message;
    renderFoot();
  }

  // ---------- sending ----------
  async function send() {
    if (R.sending) return;
    if (o.closed()) { toast('This session is closed; the review can no longer be sent.'); return; }
    computeEdits();
    const list = pending(), E = R.edits, edits = !!(E && E.has), msg = R.message.replace(/\s+$/, '');
    if (!list.length && !edits && !msg.trim()) { toast('Nothing to send: add comments, edits or a message.'); return; }
    const body = { from: sentFrom, message:msg, version:o.version(), comments:list.map(c => ({ target:c.target, targetLabel:targetLabel(c.target), text:c.text, source:targetSource(c.target) })),
      proposal: edits ? { src:state.src, base:E.base.hash, baseVersion:E.base.version } : null, supersedes: edits && E.supersedes ? E.supersedes : '' };
    const json = JSON.stringify(body), src = state.src;
    if (new Blob([json]).size > 64 * 1024 * 1024) { toast('Not sent: the review is larger than the 64 MiB the server accepts.'); return; }
    R.sending = true; renderFoot();
    let res, j;
    try { res = await fetch(SBTEL.base + 'review', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:json }); j = await res.json().catch(() => ({})); }
    catch (e) { R.sending = false; renderFoot(); toast('Not sent: the sbtel server is not answering. Your review is kept.'); return; }
    R.sending = false;
    if (!res.ok) { renderFoot(); toast('Not sent: ' + (j.error || 'HTTP ' + res.status) + '. Your review is kept.'); return; }
    list.forEach((c, i) => { c.status = 'sent'; c.sid = c.id = j.comments[i]; c.review = j.id; c.replies = []; });
    o.SC.addReview({ id:j.id, message:msg, n:list.length, proposal:!!j.proposal, at:Date.now(), replies:[] });
    R.message = '';
    if (j.proposal && o.onSent) o.onSent(j, src);
    computeEdits(); persist();
    saveComments(); render(); renderMsgTableIfOpen(); recount(); renderPanel();
    toast(`Sent review ${j.id} to the agent` + (j.proposal ? ': your edits are proposed, the file is not written.' : '.'));
  }

  // ---------- app hooks (§6.5) ----------
  function markPending(root) {
    const n = {}, all = {};
    state.comments.forEach(c => { all[c.target] = (all[c.target] || 0) + 1; if (c.status === 'pending') n[c.target] = (n[c.target] || 0) + 1; });
    (root || document).querySelectorAll('.cbub[data-thread]').forEach(b => {
      const key = b.dataset.thread, k = n[key] || 0; b.classList.toggle('pend', !!k);
      let pb = b.querySelector('.pb'); if (!k) { pb?.remove(); return; }
      if (!pb) { pb = document.createElement('span'); pb.className = 'pb'; b.appendChild(pb); }
      pb.textContent = k === all[key] ? 'in review' : k + ' in review';
      b.title = `${all[key]} comment${all[key] === 1 ? '' : 's'}, ${k} pending in your review`;
    });
  }
  function addPending(key, text) {
    const cm = { id:'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), target:key, text, status:'pending', version:o.version(), at:Date.now() };
    state.comments.push(cm); saveComments(); render(); renderMsgTableIfOpen();
    return cm;
  }
  function hook() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); changesStyle();
    saveComments = () => { renderSendBtn(); changed(); if (R.open) { renderComments(); renderFoot(); } };
    renderSendBtn = () => { $('sendBtn').hidden = true; }; // a session has no "saved" comments: they are pending in the review
    const origPaint = paint; paint = (lay, keep) => { origPaint(lay, keep); if (!keep) markPending($('world')); };
    const origFill = fillBlock; fillBlock = (el, B, counts) => { origFill(el, B, counts); markPending(el); };
    // The chat: Send is the primary action (the agent starts on it while you look at something else), and
    // Add to review keeps the comment for the review. A pending comment says so, with Edit and Send now.
    const keep0 = chatKeep, add0 = chatAdd, status0 = chatStatus, btns0 = chatRowBtns, composer0 = openComposer;
    chatKeep = () => SBTEL.session ? { c:'review', label:'Add to review', title:'Keep it in your review and send it with the rest (Shift+Enter)' } : keep0();
    chatAdd = (key, text, how) => {
      if (!SBTEL.session) return add0(key, text, how);
      if (o.closed()) { toast('This session is closed; comments can no longer be sent.'); return; }
      const cm = addPending(key, text);
      if (how === 'send') openSend([cm]);
      else if (!chatOpen(key)) toast(`Added to your review (${pending().length} comment${pending().length === 1 ? '' : 's'}). Send it with Review.`);
    };
    chatStatus = c => c.status === 'pending' ? ['st-pending', 'In your review', 'It goes to the agent when you send the review'] : status0(c);
    chatRowBtns = c => c.status === 'pending' ? `<button class="tiny" data-t="rvedit" data-id="${esc(c.id)}">Edit</button><button class="tiny" data-t="send" data-id="${esc(c.id)}">Send now</button><button class="tiny" data-t="del" data-id="${esc(c.id)}">Delete</button>` : btns0(c);
    openComposer = (key, anchor) => { if (SBTEL.session && o.closed()) { toast('This session is closed; comments can no longer be sent.'); return; } composer0(key, anchor); };
    document.addEventListener('click', e => {
      const b = e.target.closest('.pop.chat [data-t="rvedit"]'); if (!b) return;
      closePop('thread'); toggle(true);
      setTimeout(() => { const ta = document.querySelector(`#rvComments [data-cid="${CSS.escape(b.dataset.id)}"] textarea`); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollIntoView({ block:'nearest' }); } }, 60);
    });
    // The dock: Review sits at the end, a button like the others (the toolbar has no primary action); a count
    // shows what waits in the review.
    btn = document.createElement('button'); btn.className = 'tb rv-btn'; btn.id = 'rvBtn'; btn.setAttribute('aria-controls', 'rvSheet'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '@@icon message-square-check@@<span class="rv-l">Review</span><span class="rv-n" hidden></span>';
    btn.onclick = () => toggle();
    $('dock').appendChild(btn);
    const sh = document.createElement('aside'); sh.className = 'float sheet right closed rv-sheet'; sh.id = 'rvSheet'; sh.setAttribute('aria-label', 'Review');
    sh.innerHTML = `<header><h2>Review</h2><span class="sub" id="rvSub">${o.kind === 'diff' ? 'comments on this diff' : 'comments and edits, sent together'}</span><span class="spacer"></span><button class="xbtn" id="rvClose" aria-label="Close the review">${ICON.close}</button></header>
      <div class="body"><div class="rv-sec" id="rvEdits" hidden></div><div class="rv-sec" id="rvComments"></div>
      <div class="rv-sec"><h4>Message</h4><textarea id="rvMsg" placeholder="An overall message for the agent (optional)" aria-label="Overall message"></textarea></div>
      <div class="rv-foot"><span class="rv-sum" id="rvSum"></span><button class="btn primary" id="rvSend">Send review</button></div>
      <div class="rv-sec" id="rvSent" hidden></div></div>`;
    document.body.appendChild(sh);
    $('rvClose').onclick = () => toggle(false);
    // With a sheet open on the right of a wide screen, the dock centres in the room left of it, so the
    // Review button is never under the sheet (the diff view's change list is open by default).
    const room = () => document.body.classList.toggle('sb-rsheet', innerWidth >= 1000 && [...document.querySelectorAll('.sheet.right')].some(x => !x.classList.contains('closed')));
    const mo = new MutationObserver(room);
    document.querySelectorAll('.sheet.right').forEach(x => mo.observe(x, { attributes:true, attributeFilter:['class'] }));
    addEventListener('resize', room); room();
    $('rvSend').onclick = send;
    $('rvMsg').addEventListener('input', e => { R.message = e.target.value; persistSoon(); renderFoot(); });
    sh.addEventListener('input', e => {
      const box = e.target.closest('.rv-c'); if (!box) return;
      const c = state.comments.find(x => x.id === box.dataset.cid); if (c) { c.text = e.target.value; persistSoon(); }
    });
    sh.addEventListener('click', e => {
      const b = e.target.closest('[data-rv]'), item = e.target.closest('.d-item');
      if (item && item.dataset.id && state.model.node(item.dataset.id)) { if (innerWidth < 760) toggle(false); goTo(item.dataset.id); return; }
      if (!b) return;
      const box = b.closest('.rv-c'), c = box && state.comments.find(x => x.id === box.dataset.cid);
      if (b.dataset.rv === 'diff' && R.edits) openCompare({ a:{ name:R.edits.fromLabel, label:R.edits.fromLabel, src:R.edits.from }, b:{ name:'your edits', label:'your edits', src:state.src }, version:0, label:`${R.edits.fromLabel} → your edits` });
      if (b.dataset.rv === 'go' && c) goTarget(c.target);
      if (b.dataset.rv === 'del' && c) { state.comments = state.comments.filter(x => x !== c); saveComments(); render(); renderMsgTableIfOpen(); }
      if (b.dataset.rv === 'send' && c) { if (!c.text.trim()) { toast('The comment is empty.'); return; } openSend([c]); }
    });
    o.SC.onChange(() => { if (R.open) { renderComments(); renderSent(); renderFoot(); } renderBtn(); });
    addEventListener('beforeunload', e => { if (!o.closed() && !empty()) { persist(); e.preventDefault(); e.returnValue = ''; } });
    addEventListener('pagehide', () => { if (!o.closed()) persist(); });
  }
  return { hook, readDraft, restore, persist, changed, recount, forget, prune, toggle, send, empty, openCompare, pending, _state:R };
}
