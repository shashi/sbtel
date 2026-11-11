// Steering with sbtel: the figures. Each <figure class="steer" data-scene="name"> gets a stage that redraws
// a piece of the canvas and plays one scene on it, in a loop, while it is on screen.
//
//   Scene     the kit: a world of cards, a camera that frames what matters, a pointer, a thread, the reply
//             buttons, the key just pressed. Every pause goes through wait(), so a scene stops cleanly.
//   SCENES    one { build, play } per figure. build() draws the first frame; play() is the script.
//             poster() marks the frame that says the most: with reduced motion, that frame is the figure.
//
// Nothing here calls the network. Icons are Lucide (ISC).
(() => {
  'use strict';
  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    bub: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    left: svg('<path d="m15 18-6-6 6-6"/>'), right: svg('<path d="m9 18 6-6-6-6"/>'),
    sent: svg('<path d="M20 6 9 17l-5-5"/>'), seen: svg('<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>'),
    bot: svg('<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>'),
    cur: '<svg viewBox="0 0 22 24" width="22" height="24" aria-hidden="true"><path d="M3 2l15.5 9.6-6.9 1.5 4 7.6-3 1.6-4-7.7L3 19.5z"/></svg>',
    pause: svg('<rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/>'),
    play: svg('<path d="M7 4.6v14.8a1 1 0 0 0 1.5.86l12.3-7.4a1 1 0 0 0 0-1.72L8.5 3.74A1 1 0 0 0 7 4.6z"/>')
  };
  const HUE = { ui:255, service:150, storage:50 };
  const STOP = Symbol('stop');
  const el = (cls, html = '', tag = 'div') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  class Scene {
    constructor(fig, def) {
      this.fig = fig; this.def = def; this.stage = fig.querySelector('.st-stage');
      this.run = 0; this.on = false; this.instant = false; this.held = false;
      new ResizeObserver(() => this.fit(true)).observe(this.stage);
    }
    // ----- time -----
    wait(ms) {
      if (this.instant) return Promise.resolve();
      const my = this.run;
      return new Promise((res, rej) => setTimeout(() => (my === this.run ? res() : rej(STOP)), ms));
    }
    async poster() { if (this.instant) throw STOP; await this.wait(3600); }
    start() { if (this.on) return; this.on = true; this.stage.classList.remove('instant'); this.loop(); }
    stop() { this.on = false; this.run++; }
    async loop() {
      this.run++;
      try {
        for (;;) {
          this.reset(); this.world.classList.add('out'); void this.world.offsetWidth; this.world.classList.remove('out');
          await this.def.play(this);
          await this.wait(500); this.world.classList.add('out'); await this.wait(480);
        }
      } catch (e) { if (e !== STOP) throw e; }
    }
    // The frame that says the most, drawn at once: what is shown before the scene plays and with reduced motion.
    still() {
      this.run++; this.on = false; this.instant = true; this.stage.classList.add('instant'); this.reset();
      const done = () => { this.instant = false; };
      this.def.play(this).then(done, e => { done(); if (e !== STOP) throw e; });
    }
    reset() {
      this.stage.textContent = '';
      this.world = el('st-world'); this.hud = el('st-hud'); this.stage.append(this.world, this.hud);
      this.keyEl = el('st-key'); this.hud.append(this.keyEl);
      this.els = {}; this.camT = null; this.dockEl = null;
      this.narrow = this.stage.clientWidth < 560;
      this.cur = el('st-cur hide', I.cur); this.world.append(this.cur);
      this.def.build(this);
    }
    // ----- the camera: frame these things -----
    async cam(what, opt = {}) {
      this.camT = { els: what.map(w => (typeof w === 'string' ? this.els[w] : w)), pad: opt.pad ?? (this.narrow ? 18 : 30), max: opt.max ?? 1 };
      this.fit(opt.cut);
      if (!opt.cut) await this.wait(opt.ms ?? 950);
    }
    fit(cut) {
      const c = this.camT; if (!c || !this.world) return;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const e of c.els) { if (!e || !e.isConnected) continue; x0 = Math.min(x0, e.offsetLeft); y0 = Math.min(y0, e.offsetTop); x1 = Math.max(x1, e.offsetLeft + e.offsetWidth); y1 = Math.max(y1, e.offsetTop + e.offsetHeight); }
      if (x1 < x0) return;
      const vw = this.stage.clientWidth, vh = this.stage.clientHeight - 54, w = x1 - x0, h = y1 - y0;
      const k = Math.min(c.max, (vw - 2 * c.pad) / w, (vh - 2 * c.pad) / h);
      const t = `translate(${((vw - w * k) / 2 - x0 * k).toFixed(1)}px, ${((vh - h * k) / 2 - y0 * k).toFixed(1)}px) scale(${k.toFixed(4)})`;
      if (cut) { const was = this.world.style.transition; this.world.style.transition = 'none'; this.world.style.transform = t; void this.world.offsetWidth; this.world.style.transition = was; }
      else this.world.style.transform = t;
    }
    // ----- things on the canvas -----
    put(id, e, x, y, w, h) { e.style.left = x + 'px'; e.style.top = y + 'px'; if (w) e.style.width = w + 'px'; if (h) e.style.height = h + 'px'; this.world.append(e); if (id) this.els[id] = e; return e; }
    frame(id, x, y, w, h, name, sk) { return this.put(id, el('st-frame', `<div class="hd"><p class="nm">${esc(name)}</p><p class="sk">${esc(sk)}</p></div>`), x, y, w, h); }
    level(x, y, w, name) { return this.put(null, el('st-lvl', esc(name)), x, y, w); }
    card(id, x, y, name, type, sk, w = 190, cls = '') {
      const e = el('st-card ' + cls, `<p class="nm">${esc(name)}${type ? `<i class="ty" style="--h:${HUE[type]}">${type}</i>` : ''}</p><p class="sk">${esc(sk)}</p>`);
      e.dataset.name = name; return this.put(id, e, x, y, w);
    }
    select(id) { for (const k in this.els) this.els[k].classList.toggle('sel', k === id); }
    bub(id, n) {
      const c = this.els[id]; let b = c.querySelector(':scope > .st-bub');
      if (!b) { b = el('st-bub', '', 'span'); c.append(b); }
      b.innerHTML = I.bub + (n > 1 ? n : ''); return b;
    }
    dot(id, on = true) { const b = this.els[id].querySelector(':scope > .st-bub') || this.bub(id, 1); void b.offsetWidth; b.classList.toggle('unread', on); }
    // ----- the pointer -----
    at(id, fx = .62, fy = .62) { const c = this.els[id]; return [c.offsetLeft + c.offsetWidth * fx, c.offsetTop + c.offsetHeight * fy]; }
    place(x, y) { this.cur.style.transform = `translate(${x}px, ${y}px)`; }
    async point(id, fx, fy) { this.cur.classList.remove('hide'); this.place(...this.at(id, fx, fy)); await this.wait(840); }
    async click() { this.cur.classList.remove('click'); void this.cur.offsetWidth; this.cur.classList.add('click'); await this.wait(190); }
    // ----- the thread on a block -----
    open(id, below) {
      const c = this.els[id], under = below || this.narrow, S = this;
      const t = el('st-thread ' + (under ? 'below' : 'side'), `<p class="chh"><i>block</i>${esc(c.dataset.name)}</p><ul></ul><div class="composer"><p class="me"><span class="tx"></span><span class="caret"></span></p><span class="send">Send</span></div>`);
      if (under) this.put(null, t, c.offsetLeft, c.offsetTop + c.offsetHeight + 15); else this.put(null, t, c.offsetLeft + c.offsetWidth + 17, c.offsetTop - 8);
      const ul = t.querySelector('ul'), box = t.querySelector('.composer'), tx = t.querySelector('.tx'), send = t.querySelector('.send');
      let last = null;
      const row = (text, seen) => { last = el('', `<p class="ct">${esc(text)}</p><p class="cm${seen ? ' seen' : ''}">${seen ? I.seen : I.sent}<span>${seen ? 'Seen by Agent' : 'Sent'}</span></p>`, 'li'); ul.append(last); S.fit(); return last; };
      return {
        el: t,
        async type(text) {
          box.classList.add('on');
          if (S.instant) { tx.textContent = text; return; }
          for (let i = 0; i < text.length; i++) { tx.textContent += text[i]; await S.wait(text[i] === ' ' ? 62 : 24 + (i * 37 % 5) * 9); }
        },
        async send() { send.classList.add('press'); await S.wait(150); send.classList.remove('press'); const text = tx.textContent; tx.textContent = ''; box.classList.remove('on'); row(text, false); },
        you(text) { row(text, true); },
        seen() { const m = last.querySelector('.cm'); m.classList.add('seen'); m.innerHTML = I.seen + '<span>Seen by Agent</span>'; },
        ack(e) { last.querySelector('.cm').append(el('ack', e, 'span')); },
        reply(text, fresh) { last.append(el('re', `<b>${I.bot}Agent${fresh ? '<em>new</em>' : ''}</b>${esc(text)}`)); S.fit(); },
        where(name) { ul.append(el('where', `<span>${esc(name)}</span>`, 'li')); },
        async close() { t.classList.add('shut'); await S.wait(230); t.remove(); }
      };
    }
    // ----- over the canvas -----
    dock(n) {
      if (!this.dockEl) { this.dockEl = el('st-dock', `<span class="pv off">${I.left}</span><span class="n">${I.bub}<b></b></span><span class="nx">${I.right}</span>`); this.hud.append(this.dockEl); void this.dockEl.offsetWidth; }
      const d = this.dockEl; d.querySelector('b').textContent = n || '';
      d.querySelector('.n').classList.toggle('off', !n); d.querySelector('.nx').classList.toggle('off', !n); d.querySelector('.nx').classList.toggle('unread', !!n);
    }
    walked() { this.dockEl.querySelector('.pv').classList.remove('off'); }
    async key(label) {
      if (this.instant) return;
      const k = this.keyEl; k.innerHTML = `<kbd>${esc(label)}</kbd>`; k.classList.remove('hit'); void k.offsetWidth; k.classList.add('on', 'hit');
      clearTimeout(this.keyT); this.keyT = setTimeout(() => k.classList.remove('on'), 1300);
      await this.wait(330);
    }
    async next() {
      if (this.instant) return;
      const nx = this.dockEl.querySelector('.nx'); nx.classList.add('press'); setTimeout(() => nx.classList.remove('press'), 170);
      await this.key(']');
    }
  }

  // ---------- the diagram most scenes play on ----------
  // On a narrow stage it has two columns and no Search, so the cards stay near full size.
  function grid(S) { return S.narrow ? { X: [16, 186], w: 158, fw: 360, lx: 12, lw: 336 } : { X: [28, 245, 462], w: 190, fw: 680, lx: 20, lw: 640 }; }
  function notes(S) {
    const G = S.G = grid(S), [a, b, c] = G.X, card = (id, x, y, name, type, sk) => S.card(id, x, y, name, type, sk, G.w);
    S.frame('frame', 0, 0, G.fw, 426, 'Notes', 'A notes app that syncs.');
    S.level(G.lx, 76, G.lw, 'App');
    card('editor', a, 108, 'Editor', 'ui', 'Type a note.');
    card('preview', b, 108, 'Preview', 'ui', 'See it formatted.');
    if (c) card('search', c, 108, 'Search', 'ui', 'Find a note.');
    S.level(G.lx, 190, G.lw, 'Services');
    card('sync', a, 222, 'Sync', 'service', 'Keeps devices equal.');
    card('formatter', b, 222, 'Formatter', 'service', 'Markdown to HTML.');
    S.level(G.lx, 304, G.lw, 'Storage');
    card('store', a, 336, 'Store', 'storage', 'Notes on disk.');
    card('index', b, 336, 'Index', 'storage', 'Words to notes.');
  }
  const FOCUS = { max: 1.12, pad: 34 };
  // Select a block, press C, write, send.
  async function comment(S, id, text) {
    await S.point(id); await S.click(); S.select(id); await S.wait(380);
    await S.key('C'); const t = S.open(id); await S.cam([id, t.el], FOCUS);
    await t.type(text); await S.wait(420); await t.send(); await S.wait(300);
    return t;
  }
  // One press of ]: leave the open thread, glide to the next block, open its reply.
  async function visit(S, prev, id, said, reply, left, below) {
    await S.next(); if (prev) await prev.close();
    S.select(id); const t = S.open(id, below); t.you(said); t.reply(reply, true);
    S.dot(id, false); S.dock(left); if (prev) S.walked();
    await S.cam([id, t.el], FOCUS); await S.wait(2500);
    return t;
  }

  const SCENES = {
    cycle: {
      build(S) { notes(S); S.bub('store', 1); S.bub('preview', 1); S.dock(0); S.place(S.G.fw - 150, 250); S.cam(['frame'], { cut: true }); },
      async play(S) {
        await S.wait(900);
        const t = await comment(S, 'sync', 'Retry with backoff. Never drop a note.');
        await S.wait(500); await S.key('Esc'); await t.close(); S.bub('sync', 1); S.select(null); S.cur.classList.add('hide');
        await S.cam(['frame']); await S.wait(1300);
        S.dot('preview'); S.dock(1); await S.wait(1700);
        S.dot('sync'); S.dock(2); await S.wait(2000);
        const a = await visit(S, null, 'sync', 'Retry with backoff. Never drop a note.', 'Five tries, doubling from one second. Should a note that still fails show a badge?', 1);
        const b = await visit(S, a, 'preview', 'Should this render while you type?', 'Yes, 150 ms after the last key. Formatter does the work.', 0);
        await S.key('Esc'); await b.close(); S.select(null); await S.cam(['frame']);
        await S.poster();
      }
    },
    say: {
      build(S) { notes(S); S.dock(0); S.place(S.G.fw - 150, 210); S.cam(['frame'], { cut: true }); },
      async play(S) {
        await S.wait(800);
        const t = await comment(S, 'store', 'Write atomically: temp file, then rename.');
        await S.wait(900); t.seen();
        await S.poster();
      }
    },
    wait: {
      build(S) { notes(S); S.bub('preview', 1); S.bub('index', 1); S.bub('sync', 1); S.select('editor'); S.dock(0); S.place(...S.at('editor')); S.cur.classList.remove('hide'); S.cam(['frame'], { cut: true }); },
      async play(S) {
        await S.wait(1900);
        S.dot('preview'); S.dock(1); await S.wait(2400);
        S.dot('index'); S.dock(2); await S.wait(600);
        await S.poster();
      }
    },
    walk: {
      build(S) { notes(S); for (const id of ['sync', 'editor', 'index']) { S.bub(id, 1); S.dot(id); } S.select('formatter'); S.dock(3); S.cam(['frame'], { cut: true }); },
      async play(S) {
        await S.wait(1300);
        const a = await visit(S, null, 'sync', 'Retry with backoff.', 'Done: five tries, doubling each time.', 2);
        const b = await visit(S, a, 'editor', 'Autosave, or a Save button?', 'Autosave, one second after you stop typing.', 1);
        const c = await visit(S, b, 'index', 'Should search ignore case?', 'Yes. Accents too, unless you say otherwise.', 0);
        await S.key('Esc'); await c.close(); S.select(null); await S.cam(['frame']);
        await S.poster();
      }
    },
    ack: {
      build(S) { notes(S); S.dock(0); S.place(S.G.fw - 150, 210); S.cam(['frame'], { cut: true }); },
      async play(S) {
        await S.wait(700);
        const t = await comment(S, 'store', 'Write atomically: temp file, then rename.');
        await S.wait(600); t.seen(); await S.wait(800); t.ack('👍'); await S.wait(1700);
        await S.key('Esc'); await t.close(); S.bub('store', 1);
        const u = await comment(S, 'index', 'Should search ignore case?');
        await S.wait(300); await S.key('Esc'); await u.close(); S.bub('index', 1); S.select(null); S.cur.classList.add('hide');
        await S.cam(['store', 'index'], { max: 1.12, pad: S.narrow ? 22 : 90 }); await S.wait(900);
        S.dot('index'); S.dock(1); await S.wait(500);
        await S.poster();
      }
    },
    close: {
      build(S) {
        const G = S.G = grid(S), n = S.narrow, x = G.X[0], kw = n ? 94 : 124, gap = n ? 8 : 12;
        S.frame('frame', 0, 0, G.fw, 290, 'Notes', 'A notes app that syncs.');
        S.level(G.lx, 76, G.lw, 'Services');
        S.card('sync', x, 108, 'Sync', 'service', 'Keeps devices equal.', 3 * kw + 2 * gap + 32, 'open').style.height = '142px';
        S.card('queue', x + 16, 174, 'Queue', '', 'Changes to send.', kw, 'kid');
        S.card('retry', x + 16 + kw + gap, 174, 'Retry', '', 'Try again later.', kw, 'kid');
        S.card('conflicts', x + 16 + 2 * (kw + gap), 174, 'Conflicts', '', 'Two edits, one note.', kw, 'kid');
        if (!n) S.card('formatter', 476, 108, 'Formatter', 'service', 'Markdown to HTML.', 176);
        S.bub('queue', 1); S.dot('queue'); S.bub('retry', 1); S.dot('retry'); S.dock(2);
        S.place(G.fw - 120, 236); S.cam(['frame'], { cut: true });
      },
      async play(S) {
        await S.wait(1000);
        await S.point('sync', .12, .16); await S.click(); S.select('sync'); await S.wait(600);
        await S.key('Space');
        for (const id of ['queue', 'retry', 'conflicts']) { const k = S.els[id]; k.classList.add('gone'); k.style.left = (S.G.X[0] + 30) + 'px'; k.style.top = '120px'; }
        const s = S.els.sync; s.style.width = S.G.w + 'px'; s.style.height = '67px'; S.els.frame.style.height = '204px'; if (S.els.formatter) { S.els.formatter.style.left = S.G.X[1] + 'px'; S.els.formatter.style.width = S.G.w + 'px'; }
        await S.wait(420); s.classList.remove('open'); await S.wait(260);
        S.bub('sync', 2); S.dot('sync'); S.dock(1); S.cur.classList.add('hide'); await S.wait(1700);
        await S.next(); const t = S.open('sync');
        t.where('Queue'); t.you('Cap it at 1,000 changes.'); t.reply('Capped. The oldest go to disk first.', true);
        t.where('Retry'); t.you('Back off, and stop after five.'); t.reply('Five tries, doubling from one second.', true);
        S.dot('sync', false); S.dock(0);
        await S.cam(['sync', t.el], FOCUS); await S.wait(600);
        await S.poster();
      }
    },
    order: {
      build(S) {
        notes(S); for (const id of ['store', 'index']) { S.bub(id, 1); S.dot(id); } S.dock(2);
        const [a, b] = S.G.X;
        S.ord = { store: S.put(null, el('st-ord', 'first'), a + 8, 306), index: S.put(null, el('st-ord', 'second'), b + 8, 306) };
        S.place(S.G.fw - 150, 250); S.cam(['formatter', 'store', 'index'], { cut: true, max: 1.12, pad: S.narrow ? 22 : 70 });
      },
      async play(S) {
        await S.wait(1400);
        await S.point('index', .5, .5); await S.click();
        const ix = S.els.index, st = S.els.store; ix.classList.add('lift'); await S.wait(260);
        const [a, b] = S.G.X;
        ix.style.left = a + 'px'; S.place(a + S.G.w / 2, ix.offsetTop + 33); await S.wait(330);
        st.style.left = b + 'px'; S.ord.store.classList.add('flip'); S.ord.index.classList.add('flip'); await S.wait(560);
        ix.classList.remove('lift');
        S.ord.index.style.left = (a + 8) + 'px'; S.ord.index.textContent = 'first'; S.ord.store.style.left = (b + 8) + 'px'; S.ord.store.textContent = 'second';
        await S.wait(120); S.ord.store.classList.remove('flip'); S.ord.index.classList.remove('flip');
        await S.wait(1500); S.cur.classList.add('hide');
        await S.next(); S.select('index'); const t = S.open('index', true); t.you('Should search ignore case?'); t.reply('Yes. Accents too, unless you say otherwise.', true);
        S.dot('index', false); S.dock(1);
        await S.cam(['store', 'index', t.el], FOCUS); await S.wait(400);
        await S.poster();
      }
    }
  };

  // ---------- each figure: a poster at once, the scene while it is on screen, and a button to hold it ----------
  for (const fig of document.querySelectorAll('figure.steer[data-scene]')) {
    const def = SCENES[fig.dataset.scene]; if (!def) continue;
    const S = new Scene(fig, def); S.still();
    const cap = fig.querySelector('figcaption'), text = el('', cap.innerHTML, 'span'), btn = el('st-play', '', 'button');
    btn.type = 'button'; cap.textContent = ''; cap.append(text, btn);
    let seen = false;
    const sync = () => { const playing = S.on; btn.innerHTML = playing ? I.pause : I.play; btn.setAttribute('aria-label', playing ? 'Pause the animation' : 'Play the animation'); };
    const want = () => seen && !S.held && !document.hidden;
    const apply = () => { if (want()) S.start(); else if (S.on) S.stop(); sync(); };
    S.held = reduce.matches;
    btn.onclick = () => { S.held = S.on; if (!S.held) seen = true; apply(); };
    new IntersectionObserver(es => { seen = es[es.length - 1].intersectionRatio >= .45; apply(); }, { threshold: [0, .45, 1] }).observe(S.stage);
    document.addEventListener('visibilitychange', apply);
    sync();
  }
})();
