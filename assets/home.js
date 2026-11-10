// sbtel home page: the diagrams. No dependencies; every figure has a static fallback.
(() => {
'use strict';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- sbtel syntax highlighting (the same rules as docs/build.mjs) ----------
const FORMS = 'block|level|adjacent|port|message|refines|carries|behavior|implements|sketch';
const TOK = new RegExp('(;[^\\n]*)|("(?:\\\\.|[^"\\\\])*")|\\((~+)([\\s\\S]*?)\\3\\)|\\((' + FORMS + ')(?=[\\s()])|(:[^\\s()"]+)|\\b(in|out)\\b', 'g');
function highlight(src) {
  let out = '', last = 0;
  src.replace(TOK, (m, com, str, tl, tx, form, kw, dir, at) => {
    out += esc(src.slice(last, at)); last = at + m.length;
    if (com) out += `<span class="hl-com">${esc(com)}</span>`;
    else if (str) out += `<span class="hl-str">${esc(str)}</span>`;
    else if (tl) out += `(<span class="hl-kw">${tl}</span><span class="hl-str">${esc(tx)}</span><span class="hl-kw">${tl}</span>)`;
    else if (form) out += `(<span class="hl-kw">${form}</span>`;
    else if (kw) out += `<span class="hl-key">${esc(kw)}</span>`;
    else if (dir) out += `<span class="hl-key">${dir}</span>`;
    return m;
  });
  return out + esc(src.slice(last));
}
const paint = pre => { pre.innerHTML = highlight(pre.textContent); };
$$('pre[data-lang="sbtel"]').forEach(paint);

// ---------- geometry ----------
function box(el, ref) {
  const r = el.getBoundingClientRect(), f = ref.getBoundingClientRect();
  const x = r.left - f.left, y = r.top - f.top;
  return { x, y, w: r.width, h: r.height, cx: x + r.width / 2, cy: y + r.height / 2, r: x + r.width, b: y + r.height };
}
const bez = (p0, c1, c2, p3, t) => {
  const u = 1 - t;
  return [u*u*u*p0[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t*t*t*p3[0], u*u*u*p0[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t*t*t*p3[1]];
};
// Where the ray from a box's centre towards (tx, ty) leaves the box, and that side's outward normal.
function exit(b, tx, ty) {
  const dx = tx - b.cx, dy = ty - b.cy;
  const sx = dx ? (b.w / 2) / Math.abs(dx) : Infinity, sy = dy ? (b.h / 2) / Math.abs(dy) : Infinity;
  if (sx < sy) return { p: [b.cx + dx * sx, b.cy + dy * sx], n: [Math.sign(dx), 0] };
  return { p: [b.cx + dx * sy, b.cy + dy * sy], n: [0, Math.sign(dy) || 1] };
}
// A dependency arrow from box a to box b: a curve, an arrowhead, and the curve's midpoint.
// o.off shifts both ends sideways (to keep two arrows between one pair apart); o.ft is how far the
// head leans towards the source.
function arrow(a, b, o = {}) {
  const off = o.off || 0, ft = o.ft == null ? 0.18 : o.ft;
  let p0, c1, c2, tip;
  if (b.y - a.b > 8 || a.y - b.b > 8) {
    const down = b.y - a.b > 8, sgn = down ? 1 : -1;
    p0 = [a.cx + off + clamp((b.cx - a.cx) * 0.3, -(a.w / 2 - 12), a.w / 2 - 12), down ? a.b : a.y];
    tip = [b.cx + off + clamp((a.cx - b.cx) * ft, -(b.w / 2 - 12), b.w / 2 - 12), down ? b.y - 1 : b.b + 1];
    p0[0] = clamp(p0[0], a.x + 8, a.r - 8); tip[0] = clamp(tip[0], b.x + 8, b.r - 8);
    const k = Math.max(16, Math.abs(tip[1] - p0[1]) * 0.5);
    c1 = [p0[0], p0[1] + sgn * k]; c2 = [tip[0], tip[1] - sgn * k];
  } else {
    const ea = exit(a, b.cx, b.cy), eb = exit(b, a.cx, a.cy);
    p0 = ea.p; tip = [eb.p[0] + eb.n[0], eb.p[1] + eb.n[1]];
    if (off) { const dx = tip[0] - p0[0], dy = tip[1] - p0[1], L = Math.hypot(dx, dy) || 1;
      p0 = [p0[0] - dy / L * off, p0[1] + dx / L * off]; tip = [tip[0] - dy / L * off, tip[1] + dx / L * off]; }
    const k = Math.max(18, Math.hypot(tip[0] - p0[0], tip[1] - p0[1]) * 0.33);
    c1 = [p0[0] + ea.n[0] * k, p0[1] + ea.n[1] * k]; c2 = [tip[0] + eb.n[0] * k, tip[1] + eb.n[1] * k];
  }
  return finish(p0, c1, c2, tip);
}
function finish(p0, c1, c2, tip) {
  let dx = tip[0] - c2[0], dy = tip[1] - c2[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  const end = [tip[0] - dx * 7, tip[1] - dy * 7];
  const c2e = [c2[0] - dx * 7, c2[1] - dy * 7];
  const px = -dy, py = dx, bx = tip[0] - dx * 8.5, by = tip[1] - dy * 8.5;
  const f = n => n.toFixed(1);
  return {
    d: `M${f(p0[0])} ${f(p0[1])}C${f(c1[0])} ${f(c1[1])} ${f(c2e[0])} ${f(c2e[1])} ${f(end[0])} ${f(end[1])}`,
    head: `M${f(tip[0])} ${f(tip[1])}L${f(bx + px * 4)} ${f(by + py * 4)}L${f(bx - px * 4)} ${f(by - py * 4)}Z`,
    mid: bez(p0, c1, c2, tip, 0.5),
    at: t => bez(p0, c1, c2, tip, t),
  };
}
const arrowSVG = (a, cls = '', op = 1) => `<g class="${cls}"${op < 1 ? ` opacity="${op.toFixed(2)}"` : ''}><path d="${a.d}"/><path class="head" d="${a.head}"/></g>`;
function tagAt(frame, key, xy, text, cls) {
  let t = frame.querySelector(`.tagl[data-k="${key}"]`);
  if (!text) { if (t) t.remove(); return; }
  if (!t) { t = document.createElement('span'); t.dataset.k = key; frame.appendChild(t); }
  t.className = 'tagl ' + cls; t.textContent = text;
  let x = xy[0];
  if (!/lefty|side/.test(cls)) { const h = t.offsetWidth / 2 + 4; x = clamp(x, h, frame.clientWidth - h); } // keep it inside the frame
  t.style.left = x + 'px'; t.style.top = xy[1] + 'px';
}
// Redraw every frame while CSS transitions run.
function during(ms, fn) {
  const t0 = performance.now();
  const step = t => { fn(); if (t - t0 < ms) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// FLIP: move elements in the DOM, then glide them from where they were.
function flip(els, mutate, after) {
  const before = new Map(els.map(e => [e, e.getBoundingClientRect()]));
  mutate();
  els.forEach(e => { e.classList.remove('fly'); e.style.transform = ''; });
  if (reduce) { after && after(); return; }
  els.forEach(e => {
    const a = before.get(e), b = e.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    e.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  document.body.offsetWidth; // apply the start positions before the transition
  els.forEach(e => { if (e.style.transform) { e.classList.add('fly'); e.style.transform = ''; } });
  setTimeout(() => els.forEach(e => e.classList.remove('fly')), 360);
  after && during(380, after);
}
function observeResize(el, fn) {
  if ('ResizeObserver' in window) new ResizeObserver(() => fn()).observe(el);
  else addEventListener('resize', fn);
}

// ---------- install: two tabs, each with a copy box ----------
$$('.install .copy').forEach(btn => btn.addEventListener('click', async () => {
  const code = $('code', btn.parentElement), text = code.textContent.trim();
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
    const r = document.createRange(); r.selectNodeContents(code);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    try { ok = document.execCommand('copy'); } catch (_) {}
  }
  btn.textContent = ok ? 'Copied' : 'Press ⌘C';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
}));
(() => {
  const tabs = $$('.inst-tabs [role="tab"]'); if (!tabs.length) return;
  const KEY = 'sbtel-install-tab';
  const pick = (t, focus) => {
    tabs.forEach(x => {
      const on = x === t;
      x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1;
      $('#' + x.getAttribute('aria-controls')).hidden = !on;
    });
    try { localStorage.setItem(KEY, t.dataset.k); } catch (_) {}
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pick(t));
    t.addEventListener('keydown', e => {
      const n = tabs.length;
      const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (j < 0) return; e.preventDefault(); pick(tabs[j], true);
    });
  });
})();

// ---------- hero: the code as a tangle, and the same parts as a design in levels ----------
(() => {
  const fr = $('#hero'), demo = $('#demo'); if (!fr) return;
  const svg = $('svg.edges', fr);
  const B = Object.fromEntries($$('.blk', fr).map(e => [e.dataset.id, e]));
  // Who calls whom in the code. The design keeps E. It replaces SIDE with adjacency and UP with a message.
  const E = [['Shell','Editor',{ ft: 0, off: -26 }],['Shell','Preview',{ ft: 0 }],['Shell','Sync'],['Shell','Search'],
    ['Editor','Store',{ off: 6 }],['Preview','Markdown'],['Sync','Store'],['Search','Index']];
  const SIDE = ['Preview','Editor'], UP = ['Store','Editor',{ off: -14 }];
  // Where each block sits in the tangle, as fractions of the frame, and its tilt.
  const T = { Shell:[.52,.80,-3], Editor:[.80,.26,4], Preview:[.20,.58,-2], Sync:[.70,.58,3], Search:[.16,.24,-4],
              Store:[.46,.20,2], Markdown:[.84,.84,-3], Index:[.30,.88,3] };
  // Three progress values, 0 to 1: red marks the two calls the levels forbid, fix replaces them (an adjacency
  // line; the ports' dots), thin fades the calls the levels already say. Timers belong to the current state.
  const P = { red: 0, thin: 0, fix: 0 };
  let state = 'tangle', timers = [], tws = {};
  const blks = Object.values(B);
  // A block's level, top first, and its place in it: the design arrives top-down.
  const order = new Map(); $$('.lvl', fr).forEach((l, li) => $$('.blk', l).forEach((b, bi) => order.set(b, li * 300 + bi * 45)));

  function draw() {
    const bx = id => box(B[id], svg), { red, thin, fix } = P;
    let s = '';
    if (thin < 1) s += E.map(([a, b, o]) => arrowSVG(arrow(bx(a), bx(b), o), '', 1 - thin)).join('');
    if (fix < 1) { const bad = red > 0.5 ? 'bad' : ''; s += arrowSVG(arrow(bx(SIDE[0]), bx(SIDE[1])), bad, 1 - fix) + arrowSVG(arrow(bx(UP[0]), bx(UP[1]), UP[2]), bad, 1 - fix); }
    if (fix > 0) { // the viewer's adjacency line: one plain line between the two cards, at their middle
      const e = bx('Editor'), p = bx('Preview');
      s = `<line class="adj" x1="${e.r}" y1="${e.cy}" x2="${p.x}" y2="${p.cy}" opacity="${fix.toFixed(2)}"/>` + s;
    }
    svg.innerHTML = s;
  }
  function placeTangle(animate) {
    if (!animate) blks.forEach(b => { b.style.transition = 'none'; });
    blks.forEach(b => { b.style.transform = ''; });
    const f = box(svg, svg);
    blks.forEach((b, i) => {
      const k = box(b, svg), t = T[b.dataset.id];
      b.style.transitionDelay = animate ? (i * 30) + 'ms' : '0ms';
      b.style.transform = `translate(${(t[0] * f.w - k.cx).toFixed(1)}px, ${(t[1] * f.h - k.cy).toFixed(1)}px) rotate(${t[2]}deg)`;
    });
    if (!animate) { fr.offsetWidth; blks.forEach(b => { b.style.transition = ''; }); }
  }
  // Tween one progress value, redrawing as it goes; tweens of different values run side by side.
  function tween(key, to, ms) {
    if (tws[key]) cancelAnimationFrame(tws[key]);
    const from = P[key];
    if (reduce || !ms) { P[key] = to; draw(); return; }
    const t0 = performance.now();
    const step = t => {
      const k = clamp((t - t0) / ms, 0, 1), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      P[key] = from + (to - from) * e; draw();
      tws[key] = k < 1 ? requestAnimationFrame(step) : null;
    };
    tws[key] = requestAnimationFrame(step);
  }
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  // The viewer's port highlight, for a moment: Store's port is the source (dashed) and Editor can take it.
  function partner(on) {
    B.Store.classList.toggle('talk-src', on); B.Editor.classList.toggle('talk', on);
    $$('.ear .pdot', fr).forEach(d => d.classList.toggle('hot', on));
  }
  const gasp = $('#hero-gasp');
  const clearPending = () => { timers.forEach(clearTimeout); timers = []; Object.values(tws).forEach(r => r && cancelAnimationFrame(r)); tws = {}; partner(false); gasp.classList.remove('on'); };
  function go(s, animate = !reduce) {
    state = s; clearPending();
    demo.dataset.state = s;
    $$('.seg button', demo).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === s)));
    $$('[data-for]', demo).forEach(e => { e.hidden = e.dataset.for !== s; });
    fr.classList.toggle('tangled', s === 'tangle'); fr.classList.toggle('fixed', s === 'design');
    if (s === 'tangle') {
      placeTangle(animate);
      if (!animate) { P.red = P.thin = P.fix = 0; draw(); return; }
      P.red = 0; tween('fix', 0, 350); tween('thin', 0, 600); during(1500, draw);
      return;
    }
    blks.forEach(b => { b.style.transitionDelay = animate ? order.get(b) + 'ms' : '0ms'; if (!animate) b.style.transition = 'none'; b.style.transform = ''; });
    if (!animate) { fr.offsetWidth; blks.forEach(b => { b.style.transition = ''; }); P.red = 0; P.thin = P.fix = 1; draw(); return; }
    // The blocks settle level by level with every call still drawn: most point down, two do not. Those two
    // turn red, then give way to the adjacency line and the message's ports; last, the calls the levels
    // already say fade out.
    during(2200, draw);
    at(1900, () => tween('red', 1, 250));
    at(2700, () => tween('fix', 1, 800));
    at(3300, () => partner(true)); at(4900, () => partner(false));
    at(4300, () => tween('thin', 1, 900));
    at(5400, () => gasp.classList.add('on')); at(6400, () => gasp.classList.remove('on')); // everything has settled: one second of relief
  }
  // It goes back and forth by itself while it is on screen, waits while it is pointed at or has the focus,
  // and stops for good once a picture is chosen by hand.
  const HOLD = { tangle: 3000, design: 10500 };
  let loop = null, seen = false, held = false, manual = false;
  function schedule() {
    clearTimeout(loop); if (manual || reduce) return;
    loop = setTimeout(() => { if (seen && !held) go(state === 'tangle' ? 'design' : 'tangle'); schedule(); }, HOLD[state]);
  }
  $$('.seg button', demo).forEach(b => b.addEventListener('click', () => { manual = true; clearTimeout(loop); if (b.dataset.s !== state) go(b.dataset.s); }));
  demo.addEventListener('pointerenter', () => { held = true; }); demo.addEventListener('pointerleave', () => { held = false; });
  demo.addEventListener('focusin', () => { held = true; }); demo.addEventListener('focusout', () => { held = false; });
  observeResize(fr, () => { if (state === 'tangle') placeTangle(false); draw(); });
  if (reduce) { go('design', false); return; } // no motion: the design, and the switch still works
  go('tangle', false);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    placeTangle(false); draw();
    if (!('IntersectionObserver' in window)) { seen = true; return schedule(); }
    let started = false;
    const io = new IntersectionObserver(es => { seen = es[es.length - 1].isIntersecting; if (seen && !started) { started = true; schedule(); } }, { threshold: .25 });
    io.observe(fr);
  });
})();

// ---------- why: the agent's text and your picture, and one turn of the loop between them ----------
(() => {
  const fig = $('#flow'); if (!fig) return;
  const el = id => $('#flow-' + id), on = (id, v = true) => el(id).classList.toggle('on', v);
  const frame = el('frame'), target = el('target'), chat = el('chat'), cur = el('cur');
  const TEXT = 'Editor formats Markdown too. Share it.';
  const OLD = 'Stored notes', NEW = 'Stored and formatted notes';
  // The level's new name: as a word diff while it is a proposal, plain once accepted or undone.
  const rename = how => {
    el('lname').innerHTML = how === 'diff' ? `<del>${OLD}</del> <ins>${NEW}</ins>` : how === 'new' ? NEW : OLD;
    el('lvl').textContent = `  (level :name "${how ? NEW : OLD}"`; el('lvl').classList.toggle('new', how === 'diff');
  };
  const CAP = ['One design, two views of it.', 'You click a block and say what you want.', 'Your agent reads the comment and thinks.',
    'It edits the text, answers you, and proposes the change.', 'You look at what changed and accept it.'];
  let timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const cap = i => { el('cap').textContent = CAP[i]; };
  // The pointer's tip at a point of an element (fractions of its box), or resting in the frame's corner.
  function point(e, fx = .5, fy = .5) {
    const f = frame.getBoundingClientRect(), r = e ? e.getBoundingClientRect() : null;
    const x = r ? r.left - f.left + r.width * fx : f.width - 60, y = r ? r.top - f.top + r.height * fy : f.height - 70;
    cur.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
  const click = () => { cur.classList.remove('click'); cur.offsetWidth; cur.classList.add('click'); };
  // The callout sits beside the block when the frame has room, and under it otherwise; its tail points at the block.
  function placeChat() {
    const f = frame.getBoundingClientRect(), r = target.getBoundingClientRect(), w = chat.offsetWidth;
    const side = f.right - r.right > w + 30;
    chat.classList.toggle('side', side); chat.classList.toggle('below', !side);
    if (side) { chat.style.left = (r.right - f.left + 16) + 'px'; chat.style.top = (r.top - f.top - 14) + 'px'; chat.style.setProperty('--tail', (14 + r.height / 2 - 6) + 'px'); }
    else { const left = clamp(r.left - f.left + r.width / 2 - 60, 8, f.width - w - 8); chat.style.left = left + 'px'; chat.style.top = (r.bottom - f.top + 14) + 'px'; chat.style.setProperty('--tail', (r.left - f.left + r.width / 2 - left - 6) + 'px'); }
  }
  function reset() {
    timers.forEach(clearTimeout); timers = [];
    ['cb', 'hist', 'chat', 'sent', 'bar', 'think'].forEach(k => on(k, false)); el('reply').hidden = true;
    el('typed').textContent = ''; chat.classList.remove('done'); target.classList.remove('sel');
    el('new').hidden = true; el('new').classList.remove('kept'); el('hist').classList.remove('kept');
    el('last').textContent = '    (block Store)))'; el('accept').classList.remove('press'); rename();
    cur.style.opacity = reduce ? 0 : 1; point(null); placeChat(); cap(0);
  }
  // The proposal as it stands before Accept: also what is shown when motion is off.
  function proposed() {
    target.classList.add('sel'); on('chat'); chat.classList.add('done'); el('typed').textContent = TEXT; on('sent'); on('cb'); el('reply').hidden = false;
    el('last').textContent = '    (block Store)'; el('new').hidden = false; on('hist'); on('bar'); rename('diff');
  }
  function play() {
    reset();
    at(500, () => { cap(1); point(target, .62, .6); });                        // the pointer goes to Preview
    at(1350, () => { click(); target.classList.add('sel'); });
    at(1600, () => { placeChat(); on('chat'); });                              // its chat opens, as a callout on it
    [...TEXT].forEach((_, i) => at(2100 + i * 42, () => { el('typed').textContent = TEXT.slice(0, i + 1); }));
    const sent = 2100 + TEXT.length * 42 + 450;
    at(sent, () => { chat.classList.add('done'); on('sent'); on('cb'); });
    at(sent + 700, () => { cap(2); on('think'); });                            // the agent thinks
    at(sent + 3000, () => { cap(3); on('think', false); el('last').textContent = '    (block Store)'; el('new').hidden = false; el('lvl').textContent = `  (level :name "${NEW}"`; el('lvl').classList.add('new'); });
    at(sent + 3400, () => { el('reply').hidden = false; });
    at(sent + 5600, () => { on('chat', false); target.classList.remove('sel'); });
    at(sent + 5900, () => { on('hist'); on('bar'); rename('diff'); });                         // the proposal: a new block, and a notification
    at(sent + 7300, () => { cap(4); point(el('accept'), .55, .6); });          // the pointer goes to Accept
    at(sent + 8300, () => { click(); el('accept').classList.add('press'); });
    at(sent + 8650, () => { el('accept').classList.remove('press'); on('bar', false); el('hist').classList.add('kept'); el('new').classList.add('kept'); rename('new'); });
    at(sent + 9300, () => point(null));
    at(sent + 12600, play);
  }
  if (reduce) { reset(); proposed(); cap(3); return; }
  reset();
  if (!('IntersectionObserver' in window)) { play(); return; }
  // Play while it is on screen; start over when it comes back.
  let running = false;
  new IntersectionObserver(es => {
    const vis = es[es.length - 1].isIntersecting;
    if (vis && !running) { running = true; play(); }
    if (!vis && running) { running = false; reset(); }
  }, { threshold: .35 }).observe(fig);
})();

// ---------- blocks: one block opens into its levels, and one of those into its functions ----------
(() => {
  const fig = $('#bk'); if (!fig) return;
  const notes = $('#bk-notes'), store = $('#bk-store'), cur = $('#bk-cur'), capEl = $('#bk-cap');
  const CAP = ['A block can be a whole app.', 'Open it: its levels, and the blocks in them.', 'Open one of those: a module, down to its functions.'];
  let timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  function point(e, fx = .5, fy = .5) {
    const f = fig.getBoundingClientRect(), r = e ? e.getBoundingClientRect() : null;
    const x = r ? r.left - f.left + r.width * fx : f.width - 50, y = r ? r.top - f.top + r.height * fy : f.height - 40;
    cur.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
  const click = e => { cur.classList.remove('click'); cur.offsetWidth; cur.classList.add('click'); e.classList.add('sel'); at(450, () => e.classList.remove('sel')); };
  function reset() {
    timers.forEach(clearTimeout); timers = [];
    [notes, store].forEach(e => e.classList.remove('open', 'sel')); capEl.textContent = CAP[0]; point(null);
  }
  function play() {
    reset();
    at(900, () => point($('.bt', notes), .6, .7));
    at(1750, () => { click(notes); notes.classList.add('open'); capEl.textContent = CAP[1]; });
    at(3600, () => point($('.bt', store), .7, .7));
    at(4450, () => { click(store); store.classList.add('open'); capEl.textContent = CAP[2]; });
    at(5300, () => point(null));
    at(9400, () => { store.classList.remove('open'); });
    at(9800, () => { notes.classList.remove('open'); capEl.textContent = CAP[0]; });
    at(11400, play);
  }
  if (reduce) { notes.classList.add('open'); store.classList.add('open'); capEl.textContent = CAP[2]; cur.style.opacity = 0; return; }
  reset();
  if (!('IntersectionObserver' in window)) { play(); return; }
  let running = false;
  new IntersectionObserver(es => {
    const vis = es[es.length - 1].isIntersecting;
    if (vis && !running) { running = true; play(); }
    if (!vis && running) { running = false; reset(); }
  }, { threshold: .4 }).observe(fig);
})();

// ---------- levels: move a block and a dependency that breaks the order turns red ----------
(() => {
  const fr = $('#lv'); if (!fr) return;
  const svg = $('svg.edges', fr), out = $('#lv-out');
  const rows = $$('.row', fr), blks = $$('.blk', fr);
  const B = Object.fromEntries(blks.map(e => [e.dataset.id, e]));
  blks.forEach(b => { b.dataset.home = rows.indexOf(b.parentElement); });
  // edges.txt, in its order: who uses whom in the shop's code.
  const E = [['Storefront','Cart'],['Storefront','Checkout'],['Cart','Pricing'],['Checkout','Tax'],['Pricing','Database'],['Tax','Database']];
  const say = $('#lv-say');
  const names = rows.map(r => r.parentElement.querySelector('.lname span').textContent);
  let drag = null; // { el, row }
  const rowOf = id => drag && drag.el === B[id] ? drag.row : rows.indexOf(B[id].parentElement);
  const rule = (a, b) => { const ra = rowOf(a), rb = rowOf(b); return ra < rb ? 'ok' : ra === rb ? 'same-level' : 'upward'; };
  function draw() {
    let s = '';
    const broken = rows.map(() => ({ rules: new Set(), src: new Set() })); // per row: the rules its blocks break
    E.forEach(([a, b]) => {
      const r = rule(a, b), A = box(B[a], svg), Z = box(B[b], svg);
      let ar;
      if (Math.abs(A.cy - Z.cy) < 8) {
        // Two cards in one row: arc over the top, so the arrow never runs through a card between them.
        const dir = Z.cx > A.cx ? 1 : -1, h = 24 + Math.min(26, Math.abs(Z.cx - A.cx) * 0.1);
        const s0 = [A.cx + dir * Math.min(14, A.w / 4), A.y], t0 = [Z.cx - dir * Math.min(14, Z.w / 4), Z.y - 1];
        ar = finish(s0, [s0[0], s0[1] - h], [t0[0], t0[1] - h], t0);
      } else ar = arrow(A, Z);
      s += arrowSVG(ar, r === 'ok' ? '' : 'bad');
      if (r !== 'ok') { const k = broken[rowOf(a)]; k.rules.add(r); k.src.add(a); }
    });
    svg.innerHTML = s;
    // One tag per level whose blocks break a rule, under those blocks and below every card in the row,
    // so it never meets a level's name, a card or another tag.
    broken.forEach((k, ri) => {
      let xy = [0, 0];
      if (k.src.size) {
        const xs = [...k.src].map(id => box(B[id], svg).cx);
        const bottom = Math.max(...blks.filter(x => rowOf(x.dataset.id) === ri).map(x => box(x, svg).b));
        xy = [xs.reduce((u, v) => u + v, 0) / xs.length, bottom + 16];
      }
      tagAt(fr, 'r' + ri, xy, k.src.size ? [...k.rules].join(', ') + ': not allowed' : '', 'bad');
    });
  }
  function report() {
    // Exactly what `sbtel check` prints for this arrangement: empty levels are not numbered.
    const used = rows.map((r, i) => r.querySelector('.blk') ? i : -1).filter(i => i >= 0);
    const num = i => used.length - used.indexOf(i);
    const lines = []; let bad = 0;
    const plain = [];
    E.forEach(([a, b], k) => {
      const ra = rowOf(a), rb = rowOf(b), r = rule(a, b), n = `edges.txt:${k + 1}: ${a} -&gt; ${b}: `;
      if (r === 'upward') { bad++; lines.push(`${n}<span class="hl-warn">upward</span>: ${a} (level ${num(ra)} "${names[ra]}" of Shop) binds upward to ${b} (level ${num(rb)} "${names[rb]}")`);
        plain.push(`<p><b>${a} reaches up into ${b}.</b> Lower levels can\u2019t know about higher ones.</p>`); }
      if (r === 'same-level') { bad++; lines.push(`${n}<span class="hl-warn">same-level</span>: ${a} and ${b} share level ${num(ra)} "${names[ra]}" of Shop but are not adjacent`);
        plain.push(`<p><b>${a} uses ${b}, but they\u2019re on the same level.</b> Move ${b} below ${a}, or declare them adjacent.</p>`); }
    });
    out.innerHTML = `<span class="hl-prompt">$ </span>sbtel check shop.sbtel --bindings edges.txt\n` + lines.map(l => l + '\n').join('') +
      `shop.sbtel: ${E.length} bindings, ${bad ? `<span class="hl-warn">${bad} not allowed</span>, 0 explained` : '<span class="hl-ok">0 not allowed</span>'}`;
    say.innerHTML = plain.length ? plain.join('') : '<p class="fine">Every arrow points down. <code>sbtel check</code> finds nothing to fix.</p>';
  }
  // A level left with no block leaves the spec (sbtel numbers only the levels that hold blocks), so it
  // leaves the picture too: the diagram and the check output always describe the same spec.
  const prune = () => rows.forEach(r => { r.parentElement.hidden = !r.querySelector('.blk'); });
  function moveTo(el, ri, focus) {
    flip(blks, () => { rows[ri].appendChild(el); prune(); if (focus) el.focus({ preventScroll: true }); }, draw);
    draw(); report();
  }
  function rowAt(y) {
    const vis = rows.map((r, i) => i).filter(i => !rows[i].parentElement.hidden);
    for (const i of vis) if (y < rows[i].parentElement.getBoundingClientRect().bottom) return i;
    return vis[vis.length - 1];
  }
  blks.forEach(el => {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const sx = e.clientX, sy = e.clientY; let moved = false;
      el.setPointerCapture(e.pointerId);
      const move = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        if (!moved) { moved = true; el.classList.add('drag'); drag = { el, row: rows.indexOf(el.parentElement) }; }
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        drag.row = rowAt(ev.clientY);
        rows.forEach((r, i) => { r.classList.toggle('over', i === drag.row); r.classList.remove('no'); });
        const bad = E.some(([a, b]) => (a === el.dataset.id || b === el.dataset.id) && rule(a, b) !== 'ok');
        rows[drag.row].classList.toggle('no', bad);
        draw();
      };
      const up = () => {
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        if (!moved) return;
        const ri = drag.row; drag = null;
        el.classList.remove('drag');
        rows.forEach(r => r.classList.remove('over', 'no'));
        moveTo(el, ri, false);
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('keydown', e => {
      const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      if (!d) return; e.preventDefault();
      const here = rows.indexOf(el.parentElement);
      let ri = here + d;
      while (ri >= 0 && ri < rows.length && rows[ri].parentElement.hidden) ri += d;
      if (ri >= 0 && ri < rows.length) moveTo(el, ri, true);
    });
  });
  $('#lv-reset').addEventListener('click', () => {
    flip(blks, () => { blks.forEach(b => rows[+b.dataset.home].appendChild(b)); prune(); }, draw);
    draw(); report();
  });
  observeResize(fr, draw);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(draw);
  draw(); report();
})();

// ---------- adjacency: a declared link, drawn as the viewer draws it (one plain line) ----------
(() => {
  const fr = $('#adj'); if (!fr) return;
  const svg = $('svg.edges', fr), btn = $('#adj-btn'), why = $('#adj-why'), cap = $('#adj-cap');
  const ed = $('[data-id="Editor"]', fr), pv = $('[data-id="Preview"]', fr);
  let braided = true;
  function draw() {
    const e = box(ed, svg), p = box(pv, svg);
    const s0 = [p.x + Math.min(22, p.w / 3), p.y], t0 = [e.r - Math.min(22, e.w / 3), p.y - 1];
    const ar = finish(s0, [s0[0], s0[1] - 50], [t0[0], t0[1] - 50], t0);
    svg.innerHTML = (braided ? `<line class="adj" x1="${e.r}" y1="${e.cy}" x2="${p.x}" y2="${p.cy}"/>` : '') + arrowSVG(ar, braided ? '' : 'bad');
    tagAt(fr, 'a', [ar.mid[0], ar.mid[1] - 2], braided ? 'adjacent: allowed' : 'same-level: not allowed', braided ? 'ok' : 'bad');
    why.style.left = ((e.r + p.x) / 2) + 'px'; why.style.top = (e.b + 14) + 'px';
  }
  btn.addEventListener('click', () => {
    braided = !braided;
    fr.classList.toggle('unbraided', !braided);
    btn.setAttribute('aria-pressed', String(!braided));
    btn.textContent = braided ? 'Remove the link' : 'Restore the link';
    cap.textContent = braided ? 'Preview calls into Editor. Being adjacent allows it.'
                              : 'Without the link, Preview calling Editor is a sideways dependency.';
    draw();
  });
  observeResize(fr, draw);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(draw);
  draw();
})();

// ---------- messages: a typed port, and no names ----------
(() => {
  const fr = $('#msg'); if (!fr) return;
  const svg = $('svg.edges', fr), btn = $('#msg-btn');
  const inEar = $('.ear.top', fr), outEar = $('.ear.bot', fr), pal = $('[data-id="Palette"]', fr);
  const labIn = $('#msg-in'), labOut = $('#msg-out');
  let route = null;
  function draw() {
    const o = box(outEar, svg), i = box(inEar, svg), f = box(svg, svg);
    labOut.style.left = (o.r + 8) + 'px'; labOut.style.top = (o.cy + 1) + 'px';
    labIn.style.left = (i.r + 8) + 'px'; labIn.style.top = (i.cy) + 'px';
    const k1 = box($('[data-id="Keymap"]', fr), svg), k2 = box(pal, svg);
    const lr = Math.max(box(labIn, svg).r, box(labOut, svg).r);
    const X = Math.min(f.w - 24, Math.max(k1.r, k2.r, lr) + 36), r = 12;
    const sx = o.cx, sy = o.b, yb = sy + 22, yt = i.y - 22, tx = i.cx, ty = i.y - 1;
    const d = `M${sx} ${sy}V${yb - r}Q${sx} ${yb} ${sx + r} ${yb}H${X - r}Q${X} ${yb} ${X} ${yb - r}V${yt + r}Q${X} ${yt} ${X - r} ${yt}H${tx + r}Q${tx} ${yt} ${tx} ${yt + r}V${ty - 8}`;
    const head = `M${tx} ${ty}L${tx - 4} ${ty - 8.5}L${tx + 4} ${ty - 8.5}Z`;
    svg.innerHTML = `<g class="route" style="--c:var(--m4)"><path d="${d}" style="stroke:var(--m4)"/><path class="head" d="${head}" style="fill:var(--m4)"/></g>` +
      `<text x="${X + 8}" y="${(yb + yt) / 2}" style="font:500 12px var(--ff-mono);fill:var(--muted)" transform="rotate(90 ${X + 8} ${(yb + yt) / 2})" text-anchor="middle" dy="-2">KeyChord</text>` +
      `<circle class="pkt" r="6" cx="${sx}" cy="${sy}" style="fill:var(--m4);opacity:0"/>`;
    route = svg.querySelector('.route path');
  }
  let running = false;
  function send() {
    if (running) return; running = true;
    const pkt = () => svg.querySelector('.pkt'); // a redraw replaces the circle and the route
    const done = () => {
      pal.style.outline = '3px solid var(--m4)'; pal.style.outlineOffset = '5px';
      setTimeout(() => { pal.style.outline = ''; pal.style.outlineOffset = ''; running = false; }, 900);
    };
    if (reduce) { done(); return; }
    const t0 = performance.now(), D = 1500;
    const step = t => {
      const k = Math.min(1, (t - t0) / D), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, c = pkt();
      const p = route.getPointAtLength(e * route.getTotalLength()); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
      c.style.opacity = k < 1 ? 1 : 0;
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  }
  btn.addEventListener('click', send);
  observeResize(fr, draw);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(draw);
  draw();
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); setTimeout(send, 500); } }, { threshold: .7 });
    io.observe(fr);
  }
})();

// ---------- carries: hover a type, see everything that touches it ----------
(() => {
  const fr = $('#car'); if (!fr) return;
  const cap = $('#car-cap'), types = $$('[data-type]', fr), blks = $$('[data-ports]', fr);
  const carries = Object.fromEntries(types.map(t => [t.dataset.type, (t.dataset.carries || '').split(' ').filter(Boolean)]));
  if (matchMedia('(hover: none)').matches) cap.textContent = 'Tap a type.';
  const idle = cap.textContent;
  // Every type that holds t, directly or through another type.
  const carriers = t => { const s = new Set(); let grew = true;
    while (grew) { grew = false; for (const [x, cs] of Object.entries(carries)) if (!s.has(x) && cs.some(c => c === t || s.has(c))) { s.add(x); grew = true; } }
    return [...s]; };
  const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  let pinned = null;
  function show(t) {
    if (!t) { fr.classList.remove('lit'); $$('.on, .src, .hot', fr).forEach(e => e.classList.remove('on', 'src', 'hot')); cap.textContent = idle; return; }
    const via = carriers(t), all = new Set([t, ...via]), el = types.find(x => x.dataset.type === t);
    fr.style.setProperty('--talk', el.dataset.c);
    fr.classList.add('lit');
    // As in the viewer: the type itself dashed, its carriers and users solid, and the dot for it on each
    // carrier's ear ringed, so the chain reads type, dot in the carrier, the carrier's ports.
    types.forEach(x => { x.classList.toggle('on', via.includes(x.dataset.type)); x.classList.toggle('src', x.dataset.type === t); });
    $$('[data-carry]', fr).forEach(d => d.classList.toggle('hot', d.dataset.carry === t));
    blks.forEach(b => b.classList.toggle('on', b.dataset.ports.split(' ').some(p => all.has(p))));
    const direct = blks.filter(b => b.dataset.ports.split(' ').includes(t)).map(b => b.dataset.id);
    const indirect = blks.filter(b => !direct.includes(b.dataset.id) && b.dataset.ports.split(' ').some(p => via.includes(p))).map(b => b.dataset.id);
    cap.textContent = `${list(direct)} ${direct.length > 1 ? 'use' : 'uses'} ${t} directly` +
      (indirect.length ? `; ${list(indirect)} through ${list(via)}.` : '. Nothing carries it.');
  }
  types.forEach(t => {
    t.addEventListener('mouseenter', () => show(t.dataset.type));
    t.addEventListener('mouseleave', () => show(pinned));
    t.addEventListener('focus', () => { pinned = t.dataset.type; show(pinned); });
    t.addEventListener('blur', () => { pinned = null; show(null); });
    t.addEventListener('click', () => { pinned = t.dataset.type; show(pinned); });
  });
})();
})();
