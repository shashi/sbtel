// @sbtel file Viewer.Bindings
// Code bindings in the page (docs/DESIGN.md §6.3, §6.9): an edges file's violations as one more check in
// the pill and a "Bindings" section in the checks popover, and the "uses" outline of a behavior. Inlined
// by viewer/build.mjs after session.js; it defines bindingsView and does nothing at load. Server mode
// calls it with the session's edges (`sbtel open --bindings`), the standalone page with the edges an
// exported file carries (`sbtel export --bindings`). get() returns { edges, invalid } as core.js
// parseBindings makes them (the CLI's own parser), or null for none.
function bindingsView(get) {
  const CSS = `
.sb-viol { list-style:none; margin:6px 0 0; padding:0; max-height:min(320px, 40vh); overflow:auto; font-size:12px; line-height:1.4; }
.sb-viol li { padding:6px 0; border-top:1px solid var(--panel-line); }
.sb-viol code { font-family:var(--ff-mono); font-size:11.5px; color:var(--ink); }
.sb-viol .loc, .sb-viol .rule { color:var(--muted); }
.sb-viol .loc { font-size:11px; }
.sb-viol .why { margin-top:3px; color:var(--ink); }
.sb-viol .why.none { color:var(--warn); }`;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  // One more check in the pill, its violations in the popover. A violation explained in the bindings file
  // (a `# VIOLATION: reason` comment directly above the edge, parseBindings' `note`) is still a violation,
  // and the popover shows the reason beside it.
  const bindCheck = () => {
    const B = get();
    if (!B || !B.edges || !state.model) return null;
    const f = [], viol = [];
    B.edges.forEach(e => {
      const v = bindingVerdict(state.model, e.caller, e.callee);
      if (!v.ok) { f.push(`${e.caller} -> ${e.callee}: ${v.text || v.rule}${e.location ? ' (' + e.location + ')' : ''}`); viol.push({ e, v }); }
    });
    (B.invalid || []).forEach(x => f.push(`line ${x.line}: not an edge: ${x.text.trim()}`));
    const why = viol.filter(x => x.e.note).length, n = B.edges.length;
    return { label: `Code bindings respect the levels (${n} edge${n === 1 ? '' : 's'}${viol.length ? ', ' + why + ' of ' + viol.length + ' violation' + (viol.length === 1 ? '' : 's') + ' explained' : ''})`, f, viol };
  };
  // Hovering a behavior also outlines the blocks whose code binds it ("uses"): edges whose callee names
  // the behavior (core.js bindingTarget, the rule check applies), from a block of the spec.
  behaviorUsers = name => {
    const B = get();
    if (!B || !B.edges || !state.model) return [];
    const out = new Set();
    B.edges.forEach(e => { const T = bindingTarget(state.model, e.callee); if (T && T.form === 'behavior' && T.name === name && state.model.blocks.has(e.caller)) out.add(e.caller); });
    return [...out];
  };
  const violList = viol => !viol.length ? '' : `<ul class="sb-viol">${viol.map(({ e, v }) => `<li><div><code>${esc(e.caller)} -> ${esc(e.callee)}</code>${e.location ? ` <span class="loc">${esc(e.location)}</span>` : ''}</div><div class="rule">${esc(v.text || v.rule)}</div>${e.note ? `<div class="why"><b>Explained:</b> ${esc(e.note)}</div>` : '<div class="why none">Not explained in the bindings file.</div>'}</li>`).join('')}</ul>`;
  const origRender = renderChecks;
  renderChecks = () => {
    origRender();
    const bc = bindCheck(); if (!bc) return;
    const all = [...state.lay.checks, ...state.lay.spec, bc], bad = all.filter(c => c.f.length).length;
    const b = $('chkBtn'); b.className = 'tb chkpill ' + (bad ? 'bad' : 'ok');
    b.innerHTML = pillHTML(all);
  };
  const origShow = showChecks;
  showChecks = () => {
    origShow();
    const bc = bindCheck(); if (!bc || !pops.checks) return;
    pops.checks.insertAdjacentHTML('beforeend', `<h5>Bindings</h5>${chkList([bc])}${violList(bc.viol)}`);
    placeNear(pops.checks, $('chkBtn').getBoundingClientRect());
  };
}
