// @sbtel file Viewer.Server
// Server mode (docs/DESIGN.md §6.3), for pages served by `sbtel open` at /s/<id>/. Inlined into the
// page script by viewer/build.mjs, after the app and before Boot. At load it only registers
// SBTEL.modes.server; everything else happens in boot(), so standalone mode is untouched.
SBTEL.modes.server = (() => {
  const S = {
    // base, version and loaded: the server version this tab's text is based on (its hash, number and
    // text); proposal: { id, src } after a review with edits, until the agent pushes a new version.
    meta: null, base: null, version: 0, loaded: '', dirty: false, saving: false, closed: false, proposal: null,
    es: null, lastSeq: 0, online: true, retryT: null,
    tab: Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join(''),
    edges: null, invalid: [], viol: []
  };
  const url = r => SBTEL.base + r;
  const getJSON = async r => {
    const res = await fetch(url(r), { cache: 'no-store' });
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    return res.json();
  };
  // The server's body limit for browser writes (internal/server/http.go browserBodyLimit, DESIGN §5.2):
  // the same 64 MiB as the control API, so the tab can save any spec the agent could push.
  const SAVE_LIMIT = 64 * 1024 * 1024;
  const post = (r, body) => fetch(url(r), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const mib = n => (n / 1048576).toFixed(n % 1048576 ? 1 : 0);
  const errText = async res => { try { return (await res.json()).error || 'HTTP ' + res.status; } catch (e) { return 'HTTP ' + res.status; } };

  const CSS = `
.sb-bar { position:fixed; left:50%; transform:translateX(-50%); top:max(14px, env(safe-area-inset-top, 0px)); z-index:2900; background:var(--panel); color:var(--muted); border:1px solid var(--panel-line); border-radius:10px; padding:7px 12px; font-size:12.5px; box-shadow:0 8px 28px var(--shadow); max-width:min(520px, calc(100vw - 32px)); box-sizing:border-box; display:flex; align-items:center; gap:8px; }
.sb-bar .dot { width:8px; height:8px; border-radius:50%; background:var(--muted); flex:none; animation:sbPulse 1.6s ease-in-out infinite; }
.sb-bar.closed { color:var(--ink); }
.sb-bar.closed .dot { background:var(--warn); animation:none; }
@keyframes sbPulse { 50% { opacity:.3; } }
.sb-vt { position:fixed; left:50%; transform:translateX(-50%); top:calc(max(14px, env(safe-area-inset-top, 0px)) + 50px); z-index:2950; display:flex; align-items:center; gap:6px 12px; flex-wrap:wrap; background:var(--ink); color:var(--surface); border-radius:13px; padding:8px 8px 8px 14px; font-size:13.5px; line-height:1.4; box-shadow:0 18px 44px rgba(0,0,0,.34), 0 3px 10px rgba(0,0,0,.2); width:max-content; max-width:min(560px, calc(100vw - 24px)); box-sizing:border-box; animation:sbvt-in .45s cubic-bezier(.2, 1.5, .4, 1) both; }
@keyframes sbvt-in { from { opacity:0; transform:translate(-50%, -18px) scale(.95); } to { opacity:1; transform:translate(-50%, 0) scale(1); } }
.sb-vt .dot { width:8px; height:8px; border-radius:50%; background:var(--ok); flex:none; animation:sbvt-ping 1.4s ease-out infinite; }
.sb-vt.warn .dot { background:var(--warn); }
@keyframes sbvt-ping { 0% { box-shadow:0 0 0 0 color-mix(in srgb, currentColor 0%, var(--ok) 70%); } 100% { box-shadow:0 0 0 9px transparent; } }
.sb-vt .txt { flex:1 1 180px; min-width:0; }
.sb-vt .txt:has(small) { flex-basis:calc(100% - 30px); padding:3px 0 2px; }
.sb-vt .txt b { font-weight:600; }
.sb-vt .txt small { display:block; margin-top:1px; font-size:12px; opacity:.72; }
.sb-vt .acts { display:flex; gap:4px; align-items:center; margin-left:auto; }
.sb-vt .b { border:0; cursor:pointer; padding:6px 11px; border-radius:8px; font:600 13px var(--ff-ui); color:inherit; background:color-mix(in srgb, var(--surface) 16%, transparent); white-space:nowrap; }
.sb-vt .b:hover { background:color-mix(in srgb, var(--surface) 26%, transparent); }
.sb-vt .b.primary { background:var(--accent); color:#fff; }
.sb-vt .b.x { background:none; padding:6px 7px; opacity:.7; display:inline-flex; }
.sb-vt .b.x:hover { opacity:1; background:color-mix(in srgb, var(--surface) 16%, transparent); }
.sb-vt .b:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
@media (prefers-reduced-motion: reduce) { .sb-vt, .sb-vt .dot { animation:none; } }
.sb-cmp { position:fixed; inset:0; z-index:2940; background:var(--canvas); display:flex; flex-direction:column; }
.sb-cmp header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 14px; background:var(--panel); border-bottom:1px solid var(--panel-line); font-size:14px; }
.sb-cmp header b { font-weight:600; }
.sb-ref .trail { display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-width:0; }
.sb-ref .trail .sep { color:var(--muted); }
.sb-ref .trail .btn { padding:4px 10px; }
.sb-cmp header .note { color:var(--muted); font-size:12.5px; }
.sb-cmp header .spacer { flex:1; }
.sb-cmp iframe { flex:1; width:100%; border:0; min-height:0; }
.tb.sb-save:disabled { opacity:.55; }
.sb-ow p { margin:0 0 10px; line-height:1.5; }
.sb-ow .muted { color:var(--muted); font-size:13px; }
@media (max-width: 759px) { .sb-bar { top:calc(max(14px, env(safe-area-inset-top, 0px)) + 46px); } .sb-vt { top:calc(max(14px, env(safe-area-inset-top, 0px)) + 92px); } }
@media (prefers-reduced-motion: reduce) { .sb-bar .dot { animation:none; } }`;

  // ---------- small UI pieces ----------
  let barEl = null, vtEl = null, saveBtn = null;
  function bar(text, cls) {
    if (!text) { barEl?.remove(); barEl = null; return; }
    if (!barEl) { barEl = document.createElement('div'); barEl.setAttribute('role', 'status'); document.body.appendChild(barEl); }
    barEl.className = 'sb-bar ' + (cls || '');
    barEl.innerHTML = `<span class="dot"></span><span>${esc(text)}</span>`;
  }
  // The file modal reads through the server, which serves only what the pushed spec names (§5.9).
  // The same cap as the server's (internal/server/ref.go fileMaxBytes).
  saveFile = async f => {
    if (f.size > 16 * 1048576) throw new Error('larger than 16 MB');
    const data = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = () => no(new Error('could not be read')); fr.readAsDataURL(f); });
    const res = await post('file', { name: f.name || 'pasted', data });
    if (!res.ok) throw new Error(await errText(res));
    return (await res.json()).path;
  };
  // Colours chosen for types belong to the spec's file (a stdin spec: to the session), in this browser.
  typeStoreKey = () => 'sbtel-types:' + ((S.meta && S.meta.spec && S.meta.spec.path) || SBTEL.session);
  dotKey = () => 'sbtel-dots:' + ((S.meta && S.meta.spec && S.meta.spec.path) || SBTEL.session);
  // ---------- A ref to another spec: its diagram over this page ----------
  // The frame shows that spec's own session, with ?via= naming the session at the top of the trail, so
  // what is said in it reaches this page's agent. A framed page asks the top page to move on to a spec
  // it refs, so there is one overlay and a trail, never a frame in a frame.
  const framed = !!sentFrom && window.parent !== window;
  specURL = r => location.origin + url('open?path=' + encodeURIComponent(r.file));
  let refEl = null, trail = [];
  const RR = 'sbtel-refread:' + SBTEL.session, refN = new Map(), refRead = store.get(RR, {}) || {};
  refUnread = file => (refN.get(file) || 0) > (refRead[file] || 0);
  const readRef = file => { if (refUnread(file)) { refRead[file] = refN.get(file); store.set(RR, refRead); render(); } };
  function refEvent(e, live) {
    if (!e || e.kind !== 'ref' || !e.ref || e.ref.kind !== 'reply') return;
    refN.set(e.file, (refN.get(e.file) || 0) + 1);
    if (!live) return;
    if (trail.length && trail[trail.length - 1].file === e.file) { refRead[e.file] = refN.get(e.file); store.set(RR, refRead); return; }
    render(); toast(`Agent replied in ${e.file}.`);
  }
  function drawTrail() {
    const h = refEl.querySelector('.trail'), last = trail.length - 1;
    h.innerHTML = `<button class="btn" data-i="-1">${esc(S.meta?.label || 'Back')}</button>` + trail.map((t, i) => `<span class="sep">›</span>` + (i === last ? `<b>${esc(t.name)}</b>` : `<button class="btn" data-i="${i}">${esc(t.name)}</button>`)).join('');
    refEl.querySelector('iframe').src = trail[last].url; refEl.querySelector('iframe').title = trail[last].name;
    if (trail[last].file) readRef(trail[last].file);
  }
  function closeSpec() { refEl?.remove(); refEl = null; trail = []; }
  function showHere(t) {
    if (!refEl) {
      refEl = document.createElement('div'); refEl.className = 'sb-cmp sb-ref'; refEl.setAttribute('role', 'dialog'); refEl.setAttribute('aria-label', 'A diagram this one refers to');
      refEl.innerHTML = `<header><span class="trail"></span><span class="spacer"></span><button class="btn" data-x="tab">Open in a tab</button><button class="btn primary" data-x="close">Close</button></header><iframe></iframe>`;
      refEl.addEventListener('click', e => {
        const x = e.target.closest('[data-x]')?.dataset.x, i = e.target.closest('[data-i]')?.dataset.i;
        if (x === 'close' || i === '-1') closeSpec();
        else if (x === 'tab') { try { window.open(refEl.querySelector('iframe').contentWindow.location.pathname, '_blank', 'noopener'); } catch (err) { window.open(trail[trail.length - 1].url.replace(/&via=.*/, ''), '_blank', 'noopener'); } }
        else if (i != null) { trail.length = +i + 1; drawTrail(); }
      });
      refEl.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeSpec(); } });
      document.body.appendChild(refEl);
    }
    trail.push(t); drawTrail(); refEl.querySelector('[data-x="close"]').focus();
  }
  showSpec = r => {
    const t = { name: r.file.split('/').pop(), url: specURL(r) + '&via=' + (sentFrom || SBTEL.session), file: framed ? null : r.file };
    if (framed) window.parent.postMessage({ sbtel: 'open-spec', name: t.name, url: t.url }, location.origin); else showHere(t);
  };
  // Escape in the diagram shown over this page closes that page's own popovers first; with none open
  // (and nothing selected) it comes up here and closes the overlay.
  if (framed) addEventListener('keydown', e => {
    if (e.key !== 'Escape' || state.sel || state.selLine || document.querySelector('.pop, .modal, .codep, .sb-cmp, .callout:not([hidden]), .sheet:not(.closed)')) return;
    window.parent.postMessage({ sbtel: 'close-spec' }, location.origin);
  }, true);
  addEventListener('message', e => {
    if (e.origin === location.origin && refEl && e.source === refEl.querySelector('iframe').contentWindow && e.data?.sbtel === 'close-spec') { closeSpec(); return; }
    if (e.origin !== location.origin || !refEl || e.source !== refEl.querySelector('iframe').contentWindow || e.data?.sbtel !== 'open-spec') return;
    const u = String(e.data.url || ''); if (!u.startsWith(location.origin + '/s/')) return;
    showHere({ name: String(e.data.name || 'spec').slice(0, 80), url: u, file: null });
  });
  loadRef = async r => { const q = 'ref?path=' + encodeURIComponent(r.file); const d = await getJSON(q); if (d.image) d.src = q + '&raw=1'; return d; };
  function hideVersionToast() { vtEl?.remove(); vtEl = null; }
  // "See changes": the arriving version against the one this tab loaded, in the diff view, over the page.
  // Nothing is replaced until Reload is pressed there; Back returns to the page as it was, with the toast.
  let cmpEl = null;
  function closeChanges() { cmpEl?.remove(); cmpEl = null; }
  async function seeChanges(info) {
    let spec;
    try { spec = await getJSON('spec'); } catch (e) { toast('Could not load the new version: the sbtel server is not answering.'); versionToast(info); return; }
    if (spec.src === S.loaded) { toast(`Version ${spec.version} has the same text as version ${S.version}.`); versionToast(info); return; }
    const a = `version ${S.version} (what you have)`, b = `version ${spec.version} (new)`, dirty = unsent();
    const k = putCompare({ a: { name: a, label: a, src: S.loaded }, b: { name: b, label: b, src: spec.src }, version: spec.version, label: `version ${S.version} → version ${spec.version}` });
    closeChanges();
    cmpEl = document.createElement('div'); cmpEl.className = 'sb-cmp'; cmpEl.setAttribute('role', 'dialog'); cmpEl.setAttribute('aria-label', `Changes in version ${spec.version}`);
    cmpEl.innerHTML = `<header><b>Version ${S.version} → version ${esc(spec.version)}</b>${dirty ? '<span class="note">Your unsent edits are not in this comparison; reloading replaces them (⌘Z brings them back).</span>' : ''}<span class="spacer"></span>
      <button class="btn" data-x="back">Back</button><button class="btn primary" data-x="reload">${dirty ? 'Discard my edits and reload' : 'Reload version ' + esc(spec.version)}</button></header>
      <iframe title="What changed in version ${esc(spec.version)}" src="${location.pathname}?compare=${k}"></iframe>`;
    cmpEl.addEventListener('click', e => {
      const x = e.target.closest('[data-x]')?.dataset.x; if (!x) return;
      closeChanges(); if (x === 'reload') reload(); else versionToast(info);
    });
    cmpEl.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeChanges(); versionToast(info); } });
    document.body.appendChild(cmpEl); cmpEl.querySelector('[data-x="reload"]').focus();
  }
  // The "new version" toast. It never reloads by itself; with unsaved edits it says so and asks.
  function versionToast(info) {
    const { version, by, conflict } = info;
    if (S.closed) return;
    hideVersionToast();
    if (cmpEl) closeChanges(); // a still newer version arrived while the changes were open
    const ver = 'Version' + (version ? ' ' + version : '');
    const msg = conflict ? 'Not saved: the spec changed since this page loaded it.' : by === 'disk' ? `${ver}: the file changed on disk` : by === 'user' ? `${ver}, saved from another tab` : `${ver} from your agent`;
    // Unsent edits: neither saved nor in a sent review. A sent proposal alone is not at risk: it is in the
    // session (proposals/), and reloading keeps it in the undo history.
    const dirty = unsent(), prop = S.proposal && !dirty;
    vtEl = document.createElement('div'); vtEl.className = 'sb-vt' + (conflict || dirty ? ' warn' : ''); vtEl.setAttribute('role', 'alertdialog');
    const more = dirty ? 'You have edits that are not saved or sent; reloading replaces them (' + kb('⌘Z') + ' brings them back).' : prop ? `It may hold the edits you proposed in ${esc(S.proposal.id)}; reloading shows it (${kb('⌘Z')} brings your proposal back).` : '';
    vtEl.innerHTML = `<i class="dot"></i><div class="txt"><b>${esc(msg)}</b>${more ? `<small>${more}</small>` : ''}</div>
      <div class="acts"><button class="b" data-v="diff" title="Look at what changed before you reload">See changes</button><button class="b primary" data-v="reload">${dirty ? 'Discard my edits and reload' : 'Reload'}</button><button class="b x" data-v="later" title="${dirty ? 'Keep editing' : 'Later'}" aria-label="${dirty ? 'Keep editing' : 'Later'}">${ICON.close}</button></div>`;
    vtEl.addEventListener('click', e => {
      const v = e.target.closest('[data-v]')?.dataset.v; if (!v) return;
      hideVersionToast(); if (v === 'reload') reload(); if (v === 'diff') seeChanges(info);
    });
    document.body.appendChild(vtEl);
  }

  // The text the draft's edits are counted from: the proposal of the last review, else the version.
  const draftFrom = () => S.proposal ? S.proposal.src : S.loaded;
  const unsent = () => state.src !== draftFrom();
  function showLabel() {
    if (!S.meta || !state.model) return;
    const n = stats(state.model.root).n;
    const st = S.proposal ? (unsent() ? ` · proposed in ${S.proposal.id}, then edited` : ' · proposed, awaiting agent') : S.dirty ? ' · edited' : '';
    $('specName').textContent = `${S.meta.label} · v${S.version}${st} · ${n} block${n === 1 ? '' : 's'}`;
    $('specName').title = (S.meta.path || S.meta.name || '') + (S.proposal ? `\nYour review ${S.proposal.id} proposed these edits; the file is unchanged until the agent pushes a new version or you save.` : '');
    document.title = (unsent() ? '• ' : '') + S.meta.label + ' · sbtel';
  }
  function syncSave() {
    S.dirty = state.src !== S.loaded;
    if (saveBtn) {
      saveBtn.disabled = !S.dirty || S.saving || S.closed;
      saveBtn.querySelector('.lbl').textContent = S.saving ? 'Saving…' : S.dirty ? 'Save' : 'Saved';
    }
    showLabel();
    R.changed();
  }

  // ---------- loading ----------
  async function loadBindings() {
    S.edges = null; S.invalid = [];
    if (!S.meta.bindings) return;
    let text = '';
    try { const r = await fetch(url('bindings'), { cache: 'no-store' }); if (!r.ok) return; text = await r.text(); } catch (e) { return; }
    // The §2.5 edge syntax, with the core's parser (the same one the CLI's check uses).
    const { edges, invalid } = parseBindings(text);
    S.edges = edges; S.invalid = invalid;
  }
  function adopt(meta, spec) {
    S.meta = meta; S.base = spec.hash; S.version = spec.version; S.loaded = spec.src;
  }
  async function reload() {
    let meta, spec;
    try { [meta, spec] = await Promise.all([getJSON('meta'), getJSON('spec')]); }
    catch (e) { if (e.status === 404) closedState(); else toast('Could not reload: the sbtel server is not answering.'); return; }
    const mine = state.src, wasDirty = S.dirty;
    adopt(meta, spec);
    S.proposal = null; // the agent has answered with a version: what it holds replaces the proposal
    await loadBindings();
    // A load is an ordinary step of the undo history (§6.7): undo goes back past it to the tab's text.
    if (mine !== spec.src) { hist.undo.push(mine); if (hist.undo.length > 200) hist.undo.shift(); hist.redo = []; }
    setSource(spec.src);
    syncUndo();
    toast(`Loaded version ${spec.version}.` + (wasDirty ? ' ' + kb('⌘Z') + ' brings back your edits.' : ''));
  }

  // ---------- comments: shared with diff mode (session.js); the draft review (review.js) ----------
  const SC = sessionComments({ version: () => S.version, closed: () => S.closed });
  const R = sessionReview({
    kind: 'spec', id: SBTEL.session, SC, closed: () => S.closed, version: () => S.version,
    edits: () => ({ from: draftFrom(), fromLabel: S.proposal ? 'your review ' + S.proposal.id : 'version ' + S.version, base: { version: S.version, hash: S.base }, supersedes: S.proposal ? S.proposal.id : null }),
    // What the draft keeps of this mode: the base, the text when it differs from it, and the proposal.
    snapshot: () => ({ version: S.version, base: S.base, src: state.src !== S.loaded ? state.src : null,
      proposal: S.proposal ? { id: S.proposal.id, src: S.proposal.src === state.src ? null : S.proposal.src } : null }),
    onSent: (j, src) => { S.proposal = { id: j.id, src }; syncSave(); }
  });

  // ---------- saving ----------
  // Save writes the tab's text to the spec file (or spec.sbtel), as it did before reviews. It sends no
  // comments. When the spec changed since the tab's base, it asks first (overwritePrompt); force is that
  // answer, and the server records the save as one that overwrote a newer version.
  async function save(force) {
    if (!S.dirty || S.saving || S.closed) return;
    S.saving = true; syncSave();
    const src = state.src;
    // Measure the request in UTF-8 bytes, as the server does, and refuse locally rather than upload a
    // body the server would cut off. The edits stay in the tab (still dirty).
    const body = JSON.stringify({ base: S.base, src, tab: S.tab, force: force === true, from: sentFrom });
    const bytes = new Blob([body]).size;
    if (bytes > SAVE_LIMIT) {
      S.saving = false; syncSave();
      toast(`Not saved: the spec is ${mib(bytes)} MiB, larger than the ${mib(SAVE_LIMIT)} MiB the server accepts.`);
      return;
    }
    let res;
    try { res = await post('save', body); }
    catch (e) { S.saving = false; syncSave(); toast('Not saved: the sbtel server is not answering.'); return; }
    S.saving = false;
    if (res.ok) {
      const j = await res.json();
      S.base = j.hash; S.version = j.version; S.loaded = src; S.proposal = null; syncSave();
      toast(`Saved version ${j.version}.` + (force === true ? ' It replaced the newer version, which stays in the session\'s history.' : ''));
    } else if (res.status === 409) {
      const j = await res.json().catch(() => ({}));
      syncSave(); overwritePrompt(j);
    } else if (res.status === 413) {
      syncSave(); toast(`Not saved: the spec is larger than the ${mib(SAVE_LIMIT)} MiB the server accepts.`);
    } else {
      const m = await errText(res); syncSave(); toast('Not saved: ' + m);
    }
  }

  // The spec changed since this tab's base: never overwrite silently. Overwrite saves with force; View
  // their changes opens a diff of the base and the newer version in a new tab (the prompt stays).
  function overwritePrompt(j) {
    hideVersionToast();
    const why = j.by === 'disk' ? 'the file changed on disk' : j.by === 'user' ? 'it was saved from another tab' : 'agent pushed a new version';
    const m = modal('Overwrite the newer version?', `<div class="sb-ow"><p>The spec changed since you started (${esc(why)}). Overwrite it with yours?</p>
      <p class="muted">Your edits are based on version ${S.version}; the spec is now version ${esc(j.version || '?')}. Overwrite writes your text over it, and the newer version stays in the session's history. To merge instead, cancel, reload the new version and redo your edits, or send them in a review.</p></div>
      <div class="mfoot"><button class="btn" data-m="cancel">Cancel</button><button class="btn" data-m="theirs">View their changes</button><button class="btn danger-solid" data-m="overwrite">Overwrite</button></div>`);
    m.classList.add('sb-owm');
    m.addEventListener('click', async e => {
      const a = e.target.closest('[data-m]')?.dataset.m; if (!a || a === 'close') return;
      if (a === 'cancel') { closeModal(); versionToast({ version: j.version, by: j.by }); return; } // not saved; the toast offers the new version
      if (a === 'overwrite') { closeModal(); save(true); return; }
      if (a === 'theirs') {
        let spec; try { spec = await getJSON('spec'); } catch (x) { toast('Could not load the new version: the sbtel server is not answering.'); return; }
        openCompare({ a: { name: `version ${S.version} (your base)`, label: `version ${S.version} (your base)`, src: S.loaded }, b: { name: `version ${spec.version} (theirs)`, label: `version ${spec.version} (theirs)`, src: spec.src }, version: spec.version, label: `version ${S.version} → version ${spec.version}: their changes` });
      }
    });
    m.querySelector('[data-m="cancel"]').focus();
  }

  // ---------- connection ----------
  function closedState() {
    S.closed = true;
    R.forget(); // `sbtel close`: nothing of this session is kept in the browser
    S.es?.close(); S.es = null; clearTimeout(S.retryT);
    hideVersionToast();
    bar('This session was closed. The page is read-only.', 'closed');
    $('src').readOnly = true;
    syncSave();
  }
  function offline() {
    if (S.closed) return;
    S.online = false;
    bar('Disconnected from the sbtel server. Retrying…');
  }
  function online() {
    if (!S.online) { S.online = true; bar(null); toast('Reconnected.'); }
  }
  function connect() {
    if (S.closed) return;
    const es = S.es = new EventSource(url('events?tab=' + S.tab + '&after=' + S.lastSeq));
    const seq = e => { const n = parseInt(e.lastEventId, 10); if (n > S.lastSeq) S.lastSeq = n; };
    es.addEventListener('hello', e => {
      online();
      const d = JSON.parse(e.data);
      if (d.hash !== S.base && !vtEl) versionToast({ version: d.version });
    });
    es.addEventListener('version', e => {
      seq(e);
      const d = JSON.parse(e.data);
      if (d.label && S.meta) { S.meta.label = d.label; showLabel(); }
      if (d.hash === S.base) { if (d.version > S.version) refreshMeta(d.version); return; } // same text: label or bindings changed
      if (d.version <= S.version) return; // one we already have
      versionToast(d);
    });
    es.addEventListener('reply', e => { seq(e); SC.onReply(JSON.parse(e.data)); });
    es.addEventListener('seen', e => { SC.setSeen(JSON.parse(e.data).ids); });
    es.addEventListener('ref', e => { seq(e); refEvent(JSON.parse(e.data), true); });
    es.addEventListener('closed', () => closedState());
    es.onerror = () => {
      if (S.closed || S.es !== es) return;
      es.close(); S.es = null; offline();
      clearTimeout(S.retryT); S.retryT = setTimeout(retry, 5000);
    };
  }
  // A version with the same text (only the label or the bindings changed): adopt it quietly.
  async function refreshMeta(version) {
    try { const meta = await getJSON('meta'); S.meta = meta; S.version = Math.max(S.version, version || 0); await loadBindings(); render(); showLabel(); } catch (e) {}
  }
  async function retry() {
    if (S.closed) return;
    try {
      const meta = await getJSON('meta');
      S.meta = Object.assign(S.meta || {}, { label: meta.label, bindings: meta.bindings, path: meta.path, name: meta.name });
      showLabel(); connect();
    } catch (e) {
      if (e.status === 404) { closedState(); return; }
      offline(); S.retryT = setTimeout(retry, 5000);
    }
  }

  // ---------- app hooks (§6.5: reassign function declarations) ----------
  function hook() {
    const origSetSource = setSource;
    setSource = (src, o) => { origSetSource(src, o); syncSave(); };
    SC.hook(); // comments: saveComments, openSend, commentCounts, openThread
    const origEdit = edit;
    edit = act => {
      if (S.closed) { toast('This session is closed; the page is read-only.'); return { src: state.src }; }
      return origEdit(act);
    };
    // Bindings from `open --bindings`: one more check in the pill, its violations in the popover, and
    // the "uses" outline of a behavior (bindings.js, shared with an exported page).
    bindingsView(() => S.edges ? { edges: S.edges, invalid: S.invalid } : null);
  }

  async function boot() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    // A Save control in the dock, before the checks pill; ⌘/Ctrl-S saves too.
    saveBtn = document.createElement('button');
    saveBtn.className = 'tb sb-save'; saveBtn.id = 'sbSave'; saveBtn.title = kb('Save to the spec file (⌘S)'); saveBtn.disabled = true;
    saveBtn.innerHTML = '<svg class="i" viewBox="0 0 16 16"><path d="M3 2.5h8l2.5 2.5v8.5h-11z"/><path d="M5 2.5v3.5h5V2.5M5 13.5V9.5h6v4"/></svg><span class="lbl">Saved</span>';
    saveBtn.title = kb('Save: write this text to the spec file now, without a review (⌘S)');
    saveBtn.onclick = () => save();
    $('chkBtn').before(saveBtn);
    addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } }, true);
    // Leaving with a non-empty draft asks first (review.js); the draft itself is kept in localStorage.
    const srcBtns = ['sample', 'random'].map($).filter(Boolean);
    srcBtns.forEach(b => b.title = 'Replaces the source in this tab; Save writes it to the spec');
    hook();
    R.hook(); // the Review button and panel, the composer's Add to review, pending badges
    state.comments = []; // not the playground's localStorage comments: this page's live on the server
    // The draft kept for this session (§6.7): pending comments and the message come back as they were.
    const draft = R.readDraft();
    R.restore(draft);

    // Load: meta, spec and the log. While the server is unreachable, say so and retry every 5 s.
    for (;;) {
      try {
        const [meta, spec, log] = await Promise.all([getJSON('meta'), getJSON('spec'), getJSON('log')]);
        adopt(meta, spec);
        // Edits kept against an older version stay based on it, so Save still asks before overwriting the
        // newer one and the version toast offers it (hello sees the newer hash).
        if (draft && draft.base && draft.base !== spec.hash && (draft.src != null || draft.proposal) && draft.version >= 1) {
          try { const old = await getJSON('versions/' + draft.version); if (old.hash === draft.base) { S.base = old.hash; S.version = old.version; S.loaded = old.src; } } catch (e) {}
        }
        S.lastSeq = Math.max(S.lastSeq, SC.rebuild(log.events || [])); SC.setSeen(log.seen);
        refN.clear(); (log.events || []).forEach(e => refEvent(e, false));
        break;
      } catch (e) {
        if (e.status === 404) { R.forget(); setSource('; This sbtel session no longer exists.\n'); closedState(); return; }
        offline();
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    await loadBindings();
    const mine = draft && (draft.base === S.base || draft.src != null);
    const src = mine && draft.src != null ? draft.src : S.loaded;
    if (mine && draft.base === S.base && draft.proposal && draft.proposal.id) S.proposal = { id: draft.proposal.id, src: draft.proposal.src != null ? draft.proposal.src : src };
    setSource(src);
    if (mine && draft.base !== S.base && draft.src != null) toast(`Your kept edits were made against a version this session no longer has; they are shown as edits of version ${S.version}.`);
    histUse('sbtel-hist:' + SBTEL.session); // undo continues through earlier visits' edits
    online();
    connect();
    R.recount();
    R.prune();
  }
  return { boot, _state: S };
})();
