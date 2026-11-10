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
// Two strands twisted around the segment p-q: adjacency is a declared braid.
function braid(p, q) {
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const twists = Math.max(2, Math.round(L / 13)), A = 3.2, N = 48;
  const strand = s => {
    let d = '';
    for (let i = 0; i <= N; i++) {
      const t = i / N, e = Math.sin(Math.PI * t); // the strands meet at both ends
      const o = s * A * Math.sin(Math.PI * twists * t) * Math.min(1, e * 3);
      d += (i ? 'L' : 'M') + (p[0] + dx * t + nx * o).toFixed(1) + ' ' + (p[1] + dy * t + ny * o).toFixed(1);
    }
    return `<path d="${d}"/>`;
  };
  return `<g class="braid">${strand(1)}${strand(-1)}</g>`;
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

// ---------- hero: a tangle, then levels that expose two problems, then the fix ----------
(() => {
  const fr = $('#hero'), demo = $('#demo'); if (!fr) return;
  const svg = $('svg.edges', fr), next = $('#hero-next'), reset = $('#hero-reset');
  const B = Object.fromEntries($$('.blk', fr).map(e => [e.dataset.id, e]));
  const inEar = $('[data-id="Editor"] .ear', fr), outEar = $('[data-id="Store"] .ear', fr);
  // The bindings in edges.txt, in its order. Two are problems: Preview -> Editor and Store -> Editor.
  const E = [['Shell','Editor',{ ft: 0, off: -26 }],['Shell','Preview',{ ft: 0 }],['Shell','Sync'],['Shell','Search'],
    ['Editor','Store',{ off: 6 }],['Preview','Markdown'],['Sync','Store'],['Search','Index']];
  const SIDE = ['Preview','Editor'], UP = ['Store','Editor',{ off: -14 }];
  // Where each block sits in the tangle, as fractions of the frame, and its tilt.
  const T = { Shell:[.52,.80,-3], Editor:[.80,.26,4], Preview:[.20,.58,-2], Sync:[.70,.58,3], Search:[.16,.24,-4],
              Store:[.46,.20,2], Markdown:[.84,.84,-3], Index:[.30,.88,3] };
  // Three progress values, 0 to 1: red marks the two problems, thin fades the allowed arrows (the levels say
  // them now), fix applies the fix. Pending timers belong to the current beat and are cleared on a change.
  const P = { red: 0, thin: 0, fix: 0 };
  let beat = 1, auto = null, timers = [], tws = {};
  const blks = Object.values(B);
  const later = $('#hero-cap .later');

  function draw() {
    const bx = id => box(B[id], svg), { red, thin, fix } = P;
    let s = '';
    // The allowed bindings: the raw edges file in the tangle; once levels say it, they fade.
    if (thin < 1) s += E.map(([a, b, o]) => arrowSVG(arrow(bx(a), bx(b), o), '', 1 - thin)).join('');
    const bad = red > 0.5 ? 'bad' : '';
    const side = arrow(bx(SIDE[0]), bx(SIDE[1])), up = arrow(bx(UP[0]), bx(UP[1]), UP[2]);
    if (fix < 1) s += arrowSVG(side, bad, 1 - fix) + arrowSVG(up, bad, 1 - fix);
    if (fix > 0) {
      // The viewer's adjacency line: one plain line between the two cards, at their middle.
      const e = bx('Editor'), p = bx('Preview');
      s = `<line class="adj" x1="${e.r}" y1="${e.cy}" x2="${p.x}" y2="${p.cy}" opacity="${fix.toFixed(2)}"/>` + s;
    }
    svg.innerHTML = s;
    const showTags = red > 0.5 && fix < 0.5;
    const e = bx('Editor'), p = bx('Preview');
    tagAt(fr, 'side', [(e.r + p.x) / 2, Math.min(e.y, p.y) - 13], showTags ? (fr.clientWidth < 520 ? 'same-level' : 'same-level: not adjacent') : '', 'bad');
    tagAt(fr, 'up', up.at(0.12), showTags ? 'upward' : '', 'bad lefty');
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
  function tween(key, to, ms, delay = 0) {
    if (tws[key]) cancelAnimationFrame(tws[key]);
    const from = P[key];
    if (reduce || !ms) { P[key] = to; draw(); return; }
    const t0 = performance.now() + delay;
    const step = t => {
      const k = clamp((t - t0) / ms, 0, 1), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      P[key] = from + (to - from) * e; draw();
      tws[key] = k < 1 ? requestAnimationFrame(step) : null;
    };
    tws[key] = requestAnimationFrame(step);
  }
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const clearPending = () => { timers.forEach(clearTimeout); timers = []; Object.values(tws).forEach(r => r && cancelAnimationFrame(r)); tws = {}; partner(false); };
  // The viewer's port-hover partner highlight: Store's NoteSaved port is the source (dashed), Editor, which
  // can take it, the partner (solid), and both dots ringed. Shown once when the fix lands, then it settles.
  function partner(on) {
    B.Store.classList.toggle('talk-src', on); B.Editor.classList.toggle('talk', on);
    $$('.ear .pdot', fr).forEach(d => d.classList.toggle('hot', on));
  }
  const LABEL = { 1: 'Arrange into levels', 2: 'Fix it', 3: 'Start over' };
  function go(n, animate = !reduce) {
    const prev = beat; beat = n;
    clearPending();
    demo.dataset.beat = n;
    $$('.beats button', demo).forEach(b => { if (+b.dataset.b === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    $$('[data-for]', demo).forEach(e => { e.hidden = +e.dataset.for !== n; });
    next.textContent = LABEL[n]; reset.hidden = n === 1 || n === 3;
    fr.classList.toggle('tangled', n === 1);
    fr.classList.toggle('fixed', n === 3);
    if (later) later.hidden = !(n === 2 && !animate);
    if (n === 1) {
      P.fix = 0; P.red = 0; P.thin = 0; placeTangle(animate);
      animate ? during(1500, draw) : draw();
      return;
    }
    const arranging = animate && prev === 1;
    blks.forEach((b, i) => { b.style.transitionDelay = arranging ? (i * 45) + 'ms' : '0ms'; if (!animate) b.style.transition = 'none'; b.style.transform = ''; });
    if (!animate) { fr.offsetWidth; blks.forEach(b => { b.style.transition = ''; }); }
    if (!animate) { P.red = 1; P.thin = 1; P.fix = n === 3 ? 1 : 0; draw(); return; }
    if (n === 2) {
      // The blocks settle with every arrow still drawn, so most visibly point down and two turn red. After a
      // pause the allowed ones fade, since the levels already say them, and the caption says so.
      P.fix = 0;
      if (arranging) { P.red = 0; P.thin = 0; during(1500, draw); at(1400, () => tween('red', 1, 500)); }
      else tween('fix', 0, 400);
      if (P.thin < 1) at(arranging ? 3400 : 1500, () => { if (later) later.hidden = false; tween('thin', 1, 700); });
      else if (later) later.hidden = false;
    }
    if (n === 3) {
      const d = arranging ? 1300 : 0;
      if (arranging) during(1500, draw);
      P.red = 1; tween('thin', 1, 500, d); tween('fix', 1, 900, d);
      at(d + 900, () => partner(true)); at(d + 2700, () => partner(false));
    }
  }
  const stopAuto = () => { if (auto) { clearTimeout(auto); auto = null; } };
  next.addEventListener('click', () => { stopAuto(); go(beat === 3 ? 1 : beat + 1); });
  reset.addEventListener('click', () => { stopAuto(); go(1); });
  $$('.beats button', demo).forEach(b => b.addEventListener('click', () => { stopAuto(); if (+b.dataset.b !== beat) go(+b.dataset.b); }));
  demo.addEventListener('pointerdown', stopAuto); demo.addEventListener('keydown', stopAuto);
  observeResize(fr, () => { if (beat === 1) placeTangle(false); draw(); });
  if (reduce) { go(1, false); return; }
  go(1, false);
  // Gentle autoplay: once a quarter of the tangle is in view, arrange it after a beat, then show the fix if
  // the picture is still on screen. It plays once and any interaction stops it.
  let seen = false;
  const step = (ms, from) => { auto = setTimeout(() => { auto = null; if (beat !== from || !seen) return; go(from + 1); if (from === 1) step(8000, 2); }, ms); };
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    placeTangle(false); draw();
    if (!('IntersectionObserver' in window)) { seen = true; return step(2600, 1); }
    let started = false;
    const io = new IntersectionObserver(es => { seen = es[es.length - 1].isIntersecting; if (seen && !started) { started = true; step(2600, 1); } }, { threshold: .25 });
    io.observe(fr);
  });
})();

// ---------- blocks: :type grounds a block ----------
(() => {
  const g = $('#bk .seg'); if (!g) return;
  const pill = $('#bk-pill'), src = $('#bk-src'), btns = $$('button', g);
  const pick = (b, focus) => {
    btns.forEach(x => { const on = x === b; x.setAttribute('aria-checked', on); x.tabIndex = on ? 0 : -1; });
    const t = b.dataset.t;
    pill.textContent = t; pill.dataset.k = t === 'Module' ? 'module' : 'other';
    src.textContent = `(block Store :type "${t}"\n  (~ Keeps notes on disk, so they survive a restart. ~))`; paint(src);
    if (focus) b.focus();
  };
  btns.forEach((b, i) => {
    b.tabIndex = i ? -1 : 0;
    b.addEventListener('click', () => pick(b));
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return; e.preventDefault(); pick(btns[(i + d + btns.length) % btns.length], true);
    });
  });
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

// ---------- adjacency: a declared braid ----------
(() => {
  const fr = $('#adj'); if (!fr) return;
  const svg = $('svg.edges', fr), btn = $('#adj-btn'), why = $('#adj-why'), cap = $('#adj-cap');
  const ed = $('[data-id="Editor"]', fr), pv = $('[data-id="Preview"]', fr);
  let braided = true;
  function draw() {
    const e = box(ed, svg), p = box(pv, svg);
    const s0 = [p.x + Math.min(22, p.w / 3), p.y], t0 = [e.r - Math.min(22, e.w / 3), p.y - 1];
    const ar = finish(s0, [s0[0], s0[1] - 50], [t0[0], t0[1] - 50], t0);
    svg.innerHTML = (braided ? braid([e.r, e.cy], [p.x, p.cy]) : '') + arrowSVG(ar, braided ? '' : 'bad');
    tagAt(fr, 'a', [ar.mid[0], ar.mid[1] - 2], braided ? 'adjacent: allowed' : 'same-level: not allowed', braided ? 'ok' : 'bad');
    why.style.left = ((e.r + p.x) / 2) + 'px'; why.style.top = (e.b + 14) + 'px';
  }
  btn.addEventListener('click', () => {
    braided = !braided;
    fr.classList.toggle('unbraided', !braided);
    btn.setAttribute('aria-pressed', String(!braided));
    btn.textContent = braided ? 'Remove the braid' : 'Restore the braid';
    cap.textContent = braided ? 'Preview calls into Editor. The braid allows it.'
                              : 'Without the braid, Preview calling Editor is a sideways dependency.';
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
