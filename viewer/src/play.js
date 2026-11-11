// @sbtel file Viewer.Play
// The standalone playground's own mode (docs/DESIGN.md §6.9). Inlined into the page script by
// viewer/build.mjs, after diff.js and before Boot. At load it only registers SBTEL.modes.standalone;
// everything happens in boot(), which Boot runs for a standalone page (not for ?diff, which diff.js
// turns into diff mode first). Without URL parameters boot() does exactly what Boot used to do, plus
// the home link on "sbtel" in the brand chip.
//   #src=<base64url of UTF-8 spec text>   that spec instead of the sample
//   #example=<name>                        fetches examples/<name>.sbtel, relative to the page
//   ?embed, ?embed=readonly                 a chrome-less frame for docs pages (combines with the hash)
//   &theme=light|dark                      a fixed theme (otherwise the system's)
//   &focus=<Block>                         embed mode fits that block (an id or a name) instead of the file
//   ?embed=off                              no embed mode, even where an exported file bakes one in
// An exported file (`sbtel export`, v0.2.5) carries its spec, options and bindings in inert blocks the
// boot reads first: <script type="application/json" id="sbtel-export"> ({ title, readonly, embed }),
// <script type="text/sbtel" id="sbtel-spec"> and, with --bindings, <script type="text/plain"
// id="sbtel-bindings">. Their text is escaped by the CLI (& as &amp;, < as &lt;, CR and NUL as &#13;
// and &#0;), so no spec text can end the block, and unescaped here. The URL still wins: #src or #example
// over the baked spec, ?embed=… over the baked layout; read-only stays.
// In a frame, embed mode posts { type:'sbtel:size', width, height } to the parent after the first layout
// and after any relayout that changes the fitted box: its natural size in CSS pixels at zoom 1, with the
// padding and the dock's room. The target origin is '/' (this page's own origin), so only a same-origin
// docs page hears it; a page on another origin gets nothing and keeps its own frame height.
// A spec from the URL, and any embed, keeps its settings, comments and undo history under keys with
// a hash of its initial text, so demos share nothing with each other or with the playground.
SBTEL.modes.standalone = (() => {
  const DEFAULT_HOME = 'https://shashi.biz/sbtel/';
  const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  const query = name => { const m = new RegExp('(?:^\\?|&)' + name + '(?:=([^&]*))?(?:&|$)').exec(location.search); return m ? dec(m[1] || '') : null; };
  const fragment = name => { const m = new RegExp('(?:^#|&)' + name + '=([^&]*)').exec(location.hash); return m ? m[1] : null; };
  // &amp; &lt; and numeric references: the escapes `sbtel export` writes (cmd/sbtel/cmd_export.go).
  const unescape = s => s.replace(/&(?:lt|amp|#(\d+));/g, (m, n) => n ? String.fromCodePoint(+n) : m === '&lt;' ? '<' : '&');
  const X = (() => {
    const el = id => document.getElementById(id), cfg = el('sbtel-export'), spec = el('sbtel-spec');
    if (!cfg || !spec) return null;
    let o; try { o = JSON.parse(cfg.textContent); } catch (e) { return null; }
    const b = el('sbtel-bindings');
    return { title: String(o.title || ''), readonly: o.readonly === true, embed: o.embed === true, spec: unescape(spec.textContent), bindings: b ? unescape(b.textContent) : null };
  })();
  const P = (() => {
    const e = query('embed'), t = query('theme');
    const embed = e === 'off' ? null : e !== null ? (e === 'readonly' ? 'readonly' : 'interactive') : X && X.embed ? (X.readonly ? 'readonly' : 'interactive') : null;
    return { embed, readonly: embed === 'readonly' || !!(X && X.readonly), theme: t === 'light' || t === 'dark' ? t : null,
      src: fragment('src'), example: fragment('example'), focus: query('focus') };
  })();

  // base64url (RFC 4648 §5) of the UTF-8 bytes; the decoder also takes the standard alphabet and padding.
  function encode(text) {
    const b = new TextEncoder().encode(text); let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(s) {
    const t = dec(s).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    if (/[^A-Za-z0-9+/]/.test(t) || t.length % 4 === 1) throw new Error('not base64url');
    const bin = atob(t + '='.repeat((4 - t.length % 4) % 4));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }
  // 64 bits of hash (cyrb53's mixing, both halves) for the storage keys: hash() in App.Kit has 32.
  function digest(s) {
    let a = 0xdeadbeef, b = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0');
  }

  // The spec the URL asks for, else an exported file's: { text, exported? } or { text:'', error, raw };
  // null for none (the sample).
  async function fromURL() {
    if (P.src !== null) {
      try { return { text: decode(P.src) }; }
      catch (e) { return { text: '', raw: 'src:' + P.src, error: 'The spec in the URL (#src=…) is not base64url-encoded UTF-8 text.' }; }
    }
    // A hosted page may name the example it starts with (<meta name="sbtel-example">), where the built-in
    // sample would be; if it cannot be fetched, the sample is.
    const start = P.example === null ? (document.querySelector('meta[name="sbtel-example"]')?.getAttribute('content') || '').trim() : '';
    if (start && /^[\w-]+(?:\/[\w-]+)*$/.test(start)) {
      try { const r = await fetch('examples/' + start + '.sbtel'); if (r.ok) return { text: await r.text(), start: true }; } catch (e) {}
    }
    if (P.example !== null) {
      const name = dec(P.example), path = 'examples/' + name + '.sbtel';
      if (!/^[\w-]+(?:\/[\w-]+)*$/.test(name)) return { text: '', raw: 'example:' + name, error: `#example=${name} is not an example name: letters, digits, - and _, with / between folders.` };
      try {
        const r = await fetch(path);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return { text: await r.text() };
      } catch (e) { return { text: '', raw: 'example:' + name, error: `Could not load ${path} (${e.message}).` }; }
    }
    if (X) return { text: X.spec, exported: true };
    return null;
  }

  const CSS = `
.brand a.home { position:relative; color:inherit; font-weight:700; text-decoration:none; border-radius:4px; padding-right:9px; margin-right:-3px; }
.brand a.home::after { content:"↗"; position:absolute; right:0; top:-1px; font-size:9px; font-weight:600; color:var(--muted); opacity:0; transition:opacity .15s ease; pointer-events:none; }
.brand a.home:hover { text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:3px; text-decoration-color:var(--frame-line); }
.brand a.home:hover::after, .brand a.home:focus-visible::after { opacity:1; }
@media (hover: none) { .brand a.home::after { opacity:.7; } }
body.embed #brand, body.embed #help, body.embed .sheet, body.embed #expAll, body.embed #colAll, body.embed #msgBtn, body.embed #srcBtn,
body.embed #chkBtn, body.embed #sendBtn, body.embed #setBtn, body.embed .dock .sep.pl-gone { display:none !important; }
body.embed .dock { padding:4px; border-radius:12px; bottom:10px; box-shadow:0 4px 16px var(--shadow); }
body.embed .dock .tb { height:30px; min-width:30px; border-radius:8px; }
body.embed .dock .tb.hide-sm { display:inline-flex; }
body.embed .dock .zv.hide-sm { display:inline-block; min-width:36px; }
body.embed .dock .sep { margin:0 3px; height:18px; }
body.embed .pl-open { text-decoration:none; color:inherit; padding:0 9px; gap:4px; }
body.embed .pl-open .lbl { display:inline; }
@media (max-width: 479px) { body.embed .pl-open .lbl { display:none; } }
body.embed-ro .aff .plus, body.embed-ro .lsep .plus, body.embed-ro .gutter, body.embed-ro .hdl, body.embed-ro #undo, body.embed-ro #redo, body.embed-ro .dock .sep.pl-ro { display:none !important; }
body.pl-ro .aff .plus, body.pl-ro .lsep .plus, body.pl-ro .gutter, body.pl-ro .hdl, body.pl-ro #undo, body.pl-ro #redo, body.pl-ro .dock .sep.pl-ro { display:none !important; }
body.pl-export #srcSheet .row2 { display:none; }
html.embed-clear, body.embed-clear, body.embed-clear .viewport { background-color:transparent; }
body.embed:not(.pl-live) .viewport { touch-action:pan-x pan-y; }
.pl-hint { position:fixed; left:50%; top:10px; transform:translateX(-50%); z-index:2900; background:var(--ink); color:var(--canvas); font-size:12px; line-height:1;
  padding:6px 10px; border-radius:999px; pointer-events:none; white-space:nowrap; opacity:.88; }
.pl-err { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:1500; width:min(420px, calc(100vw - 24px)); box-sizing:border-box; max-height:calc(100vh - 80px); overflow:auto;
  background:var(--panel); border:1px solid var(--panel-line); border-left:3px solid var(--warn); border-radius:10px; padding:10px 12px; font-size:13px; line-height:1.45; box-shadow:0 8px 28px var(--shadow); }
.pl-err b { display:block; margin-bottom:4px; }
.pl-err pre { margin:0; font-family:var(--ff-mono); font-size:11.5px; color:var(--warn); white-space:pre-wrap; word-break:break-word; }
`;

  // "sbtel" in the brand chip links home: <meta name="sbtel-home" content="…"> if the page has one
  // (the website's copy at /sbtel/play/ says "../"), else the project's home page. In an exported file
  // it is the project's page, in a new tab, so the reader keeps the diagram and learns what it is.
  function homeLink() {
    const meta = document.querySelector('meta[name="sbtel-home"]'), b = $('brand').querySelector('b');
    if (!b) return;
    const a = document.createElement('a');
    a.className = 'home'; a.href = (meta && meta.getAttribute('content') || '').trim() || DEFAULT_HOME;
    a.textContent = b.textContent; a.title = 'sbtel home page';
    let framed = true; try { framed = window.top !== window; } catch (e) {}
    if (framed || X) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } // in a frame (a published artifact) or from a shared file: a new tab
    b.replaceWith(a);
  }

  function showError(msg) {
    const box = document.createElement('div'); box.className = 'pl-err'; box.setAttribute('role', 'alert');
    box.innerHTML = `<b>This spec cannot be drawn</b><pre>${esc(msg)}</pre>`;
    document.body.appendChild(box);
  }

  // A docs page's frame: no brand chip, help or sheets; a small dock (undo, redo, zoom, fit and
  // "Open in playground ↗"); the diagram fitted to the frame; wheel zoom and pan only once the frame
  // is clicked or focused, so the outer page scrolls over it.
  function embed(initial, readonly) {
    const body = document.body;
    body.classList.add('embed'); if (readonly) body.classList.add('embed-ro');
    if (!P.theme) { document.documentElement.classList.add('embed-clear'); body.classList.add('embed-clear'); }
    Object.assign(fitPad, { top: 12, bottom: 52, side: 24 });
    sizeTo();
    const seps = $('dock').querySelectorAll('.sep');
    if (seps[0]) seps[0].classList.add('pl-ro'); if (seps[2]) seps[2].classList.add('pl-gone');
    // An exported file has no playground beside it: the link opens the file itself in full view (?embed=off,
    // read-only if it was exported so), with nothing sent anywhere.
    const label = X ? 'Open full view' : 'Open in playground';
    const open = document.createElement('a');
    open.className = 'tb pl-open'; open.target = '_blank'; open.rel = 'noopener'; open.title = label;
    open.innerHTML = `<span class="lbl">${label}</span><span aria-hidden="true">↗</span>`;
    open.setAttribute('aria-label', label + ' (new tab)');
    // The playground is this page without the query: the same hash, or the edited text as #src.
    const target = () => location.pathname + (X ? '?embed=off' : '') + (state.src === initial ? location.hash : '#src=' + encode(state.src));
    const refresh = () => { open.href = target(); };
    ['pointerenter', 'pointerdown', 'focus', 'click'].forEach(t => open.addEventListener(t, refresh));
    $('dock').appendChild(open);

    // The layout's width follows the frame (within the settings' range), so a small frame wraps its rows.
    const width = () => Math.max(560, Math.min(1180, Math.round(innerWidth * 1.25 / 20) * 20));
    state.opts.width = width();
    let rt = 0;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { const w = width(); if (w !== state.opts.width) { state.opts.width = w; render(); } fit(false); }, 120); });

    // Only what fits a frame: no comments, message table or source sheet (they are in the playground).
    const elsewhere = what => toast(`${what} ${what.endsWith('s') ? 'are' : 'is'} in the ${X ? 'full view' : 'playground'}: ${label} ↗.`);
    openComposer = () => elsewhere('Comments');
    openMessages = () => elsewhere('The message table');
    const origSource = toggleSource;
    toggleSource = o => { if (o === false) origSource(false); else elsewhere('The source'); };
    const drop = new Set(['Source', 'Chat about the whole file', 'Comment', 'Open in the shape table']);
    const origMenu = menuItems, origStrip = renderStrip;
    menuItems = (t, wy) => { const m = origMenu(t, wy); if (!m) return m; const items = m.items.filter(x => x === '-' || !drop.has(x.label)); while (items[items.length - 1] === '-') items.pop(); return { ...m, items }; };
    renderStrip = () => { origStrip(); strip.querySelectorAll('[data-a="comment"], [data-a="table"]').forEach(b => b.remove()); if (!strip.hidden && !strip.children.length) strip.hidden = true; };
    if (readonly) readonlyMode();

    // Live: the frame was clicked, tapped or focused. Until then the wheel and a touch swipe go to the
    // outer page, and a hint says how to start. A page that is not in a frame is live from the start.
    let live = false, hintT = 0;
    try { live = window.top === window; } catch (e) {}
    const hint = document.createElement('div'); hint.className = 'pl-hint'; hint.textContent = 'Click to interact'; hint.hidden = true; hint.setAttribute('aria-hidden', 'true');
    body.appendChild(hint);
    const showHint = ms => { if (live) return; hint.hidden = false; clearTimeout(hintT); hintT = setTimeout(() => { hint.hidden = true; }, ms); };
    const setLive = v => { live = v; body.classList.toggle('pl-live', v); if (v) { hint.hidden = true; clearTimeout(hintT); } };
    setLive(live);
    let hinted = false;
    document.addEventListener('pointerover', e => { if (!live && !hinted && e.pointerType === 'mouse') { hinted = true; showHint(2600); } });
    document.addEventListener('pointerleave', () => { hint.hidden = true; });
    // A press on a card prevents mousedown's default (no text selection), which would also keep the frame
    // from taking focus, so it would never blur and stay live: take focus here (v0.2.4).
    addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') { setLive(true); if (!document.hasFocus()) try { window.focus(); } catch (_) {} } }, true);
    addEventListener('click', () => setLive(true), true);
    addEventListener('focus', () => setLive(true));
    addEventListener('blur', () => setLive(false));
    // Capture on window runs before the canvas's own wheel handler, which zooms and pans.
    addEventListener('wheel', e => { if (!live) { e.stopPropagation(); showHint(1800); } }, { capture: true });
    return refresh;
  }

  // Read-only (?embed=readonly, or a file exported with --readonly, in either layout): nothing edits, as in
  // diff mode (§6.5). The menu and the strip keep what only looks (Open or Close, Code, the message table)
  // and, where the layout has them, comments: they are the reader's own notes, not edits.
  function readonlyMode() {
    document.body.classList.add('pl-ro');
    const sep = $('dock').querySelector('.sep'); if (sep) sep.classList.add('pl-ro');
    readOnly = () => true;
    edit = () => ({ src: state.src }); undo = () => {}; redo = () => {};
    pressStart = () => false;
    startLink = e => { e.preventDefault(); e.stopPropagation(); };
    openEdit = () => {}; askDelete = () => {}; askDeleteMany = () => {}; cutSelected = () => {};
    $('src').readOnly = true;
    const origMenu = menuItems, origStrip = renderStrip;
    menuItems = (t, wy) => {
      const m = origMenu(t, wy); if (!m) return m;
      const items = [];
      m.items.forEach(x => { if (x === '-' ? items.length && items[items.length - 1] !== '-' : !(x.act || x.danger || x.label === 'Edit')) items.push(x); });
      while (items[items.length - 1] === '-') items.pop();
      return items.length ? { ...m, items } : null;
    };
    renderStrip = () => {
      origStrip();
      strip.querySelectorAll('[data-a="edit"], [data-a="delete"], [data-a="cut"]').forEach(b => b.remove());
      if (!strip.hidden && !strip.children.length) strip.hidden = true;
    };
  }

  // Embed mode fits the frame to what is drawn (contentBox, Core.Layout), or to the &focus block, with
  // EDGE px around it and the dock's room below; no zoom past 1. It tells a same-origin parent the box's
  // natural size, so the host page can size the frame to the diagram (sbtel:size, above).
  const EDGE = 12, DOCK = 52;
  function sizeTo() {
    const focusId = () => {
      if (!P.focus || !state.model) return null;
      const n = state.model.node(P.focus) || state.model.blocks.find(b => b.name === P.focus);
      return n && state.lay && state.lay.blocks.some(B => B.id === n.id) ? n.id : null;
    };
    const box = () => contentBox(state.lay, focusId(), !readOnly());
    fit = animate => {
      const B = box(); if (!B) return;
      const aw = Math.max(40, innerWidth - 2 * EDGE), ah = Math.max(40, innerHeight - EDGE - DOCK);
      const k = Math.max(.12, Math.min(1, aw / B.w, ah / B.h));
      state.cam = { k, x: EDGE + (aw - B.w * k) / 2 - B.x * k, y: EDGE + Math.max(0, (ah - B.h * k) / 2) - B.y * k };
      if (animate) animCam();
      applyCam();
    };
    let framed = false; try { framed = window.parent !== window; } catch (e) {}
    let last = '';
    const report = () => {
      const B = box(); if (!B || !framed) return;
      const size = { type: 'sbtel:size', width: Math.ceil(B.w + 2 * EDGE), height: Math.ceil(B.h + EDGE + DOCK) };
      const key = size.width + 'x' + size.height; if (key === last) return; last = key;
      try { window.parent.postMessage(size, '/'); } catch (e) {}
    };
    // A drag preview (pv) is not a relayout of the spec: it reports nothing.
    const origRender = render;
    render = (anchorId, pv) => { origRender(anchorId, pv); if (!pv) report(); };
    // The ancestors of a &focus block open, so it is drawn.
    if (P.focus) {
      const origSet = setSource;
      setSource = (src, o) => {
        const n = (() => { try { const m = parse(src); return m.node(P.focus) || m.blocks.find(b => b.name === P.focus); } catch (e) { return null; } })();
        if (n && !state.model) for (let p = n.parent; p && !p.virtual; p = p.parent) state.open.add(p.id);
        origSet(src, o);
      };
    }
  }

  async function boot() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    let got = await fromURL(); const text = got ? got.text : SAMPLE, exported = !!(got && got.exported);
    // The page may also name the blocks its example starts with open (<meta name="sbtel-example-open">, ids separated by spaces).
    const startOpen = () => new Set((document.querySelector('meta[name="sbtel-example-open"]')?.getAttribute('content') || '').split(/\s+/).filter(Boolean));
    if (got && got.start) { got = null; state.open = startOpen(); $('sample').onclick = () => { state.open = startOpen(); state.seenTop = new Set(); setSource(text); fit(true); }; } // the page's own sample: handled as the built-in one is
    const key = got || P.embed ? ':' + (P.embed ? 'embed-' : 'spec-') + digest(got && got.error ? got.raw : text) : '';
    if (key) loadPrefs(key);
    if (P.theme) state.opts.theme = P.theme; else if (P.embed) state.opts.theme = 'system';
    applyTheme();
    const embedded = P.embed && embed(text, P.readonly);
    if (!P.embed && P.readonly) readonlyMode();
    if (X) exportView(exported);
    if (got) state.open = new Set();
    let error = got && got.error;
    if (error) { setSource(''); $('err').hidden = false; $('err').textContent = error; }
    else {
      setSource(text);
      // A spec that does not parse keeps its text in the source sheet with the error, over an empty diagram.
      if (!state.model) { const msg = $('err').textContent; setSource(''); setSource(text); error = msg; }
    }
    if (error) { $('specName').textContent = got.error ? 'the spec could not be loaded' : 'the spec does not parse'; if (P.embed) showError(error); else toggleSource(true); }
    if (!P.readonly) histUse('sbtel-hist' + key);
    if (embedded) embedded(); else homeLink();
    // A link to another spec of this page changes only the hash: load it as if opened.
    addEventListener('hashchange', () => location.reload());
  }
  // An exported file: no sample or random spec to replace its spec with; the chip and the tab say its
  // title (`sbtel export --title`, else the top block's name or the file's), "read-only" when it is; the
  // bindings it carries show as in server mode (bindings.js).
  function exportView(exported) {
    document.body.classList.add('pl-export');
    if (X.bindings !== null) { const B = parseBindings(X.bindings); bindingsView(() => B); }
    if (!exported) return; // #src or #example: the URL's spec, under its own name
    const orig = setSource;
    setSource = (src, o) => {
      const before = state.model; orig(src, o);
      if (state.model === before || !X.title) return; // did not parse: the error UI says so
      const n = stats(state.model.root).n;
      $('specName').textContent = `${X.title} · ${n} block${n === 1 ? '' : 's'}${P.readonly ? ' · read-only' : ''}`;
    };
  }
  return { boot, encode, decode, digest, params: P, exported: X };
})();
