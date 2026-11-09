// Docs pages: the contents list, and the live embeds.
(() => {
  'use strict';
  // Contents: open on wide screens, closed on narrow ones; mark the section in view.
  const d = document.getElementById('tocd');
  if (d) {
    const wide = matchMedia('(min-width: 1000px)');
    const sync = () => { d.open = wide.matches; }; sync(); wide.addEventListener('change', sync);
    const links = new Map([...d.querySelectorAll('a')].map(a => [a.getAttribute('href').slice(1), a]));
    const hs = [...document.querySelectorAll('.doc h2[id], .doc h3[id]')];
    let cur = null, queued = false;
    const spy = () => {
      queued = false; let best = hs[0];
      for (const h of hs) { if (h.getBoundingClientRect().top < 140) best = h; else break; }
      if (best && best !== cur) { if (cur) links.get(cur.id)?.removeAttribute('aria-current'); cur = best; links.get(cur.id)?.setAttribute('aria-current', 'true'); }
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(spy); } }, { passive: true });
    spy();
  }
  // Embeds: each is the real viewer in an iframe. It loads when it comes near the screen, or at once when its
  // poster is pressed, so a page of many demos stays light until you read it.
  const load = box => {
    const f = box.querySelector('iframe'); if (!f || f.src) return;
    f.src = f.dataset.src; f.hidden = false;
    f.addEventListener('load', () => box.classList.add('ready'), { once: true });
    box.querySelector('.poster')?.remove();
  };
  const boxes = [...document.querySelectorAll('.embed')];
  // Each viewer reports its diagram's natural size (DESIGN §6.9: { type:'sbtel:size', width, height }, CSS px
  // at zoom 1, with its padding and dock). The frame keeps its width; its height follows the diagram's aspect
  // ratio, no taller than at zoom 1, between 220 and 720 px (200-560 on a phone). A very tall diagram may
  // grow to 820 px (90% of the window at most) so it still shows at 60%. 64 px of the report is the
  // viewer's own chrome (padding and dock), which does not scale. The same rule, without the window, gives
  // the starting height (build.mjs, docs.css), so the page hardly moves. Changes under 5 px are ignored and
  // each frame's updates are debounced, so a frame and its viewer cannot chase each other.
  const nat = new Map(), timers = new Map();
  const target = (f, n) => {
    const phone = innerWidth < 720, W = f.clientWidth || f.parentElement.clientWidth;
    const lo = phone ? 200 : 220;
    const hi = phone ? 560 : Math.max(720, Math.min(820, Math.round(innerHeight * .9), Math.round(.6 * (n.height - 64) + 64)));
    return Math.round(Math.max(lo, Math.min(W * n.height / n.width, n.height, hi)));
  };
  const apply = f => {
    const n = nat.get(f), box = f.closest('.embed'); if (!n || !box || !f.clientWidth) return;
    const h = target(f, n);
    if (Math.abs(h - f.clientHeight) <= 4) return;
    const border = box.offsetHeight - box.clientHeight;
    box.style.minHeight = box.style.maxHeight = 'none';
    box.style.height = (h + border) + 'px';
  };
  const later = f => { clearTimeout(timers.get(f)); timers.set(f, setTimeout(() => apply(f), 80)); };
  addEventListener('message', e => {
    const d = e.data;
    if (e.origin !== location.origin || !d || d.type !== 'sbtel:size' || !(d.width > 0) || !(d.height > 0)) return;
    const f = boxes.map(b => b.querySelector('iframe')).find(f => f && f.contentWindow === e.source); if (!f) return;
    nat.set(f, { width: +d.width, height: +d.height }); later(f);
  });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => nat.forEach((_, f) => apply(f)), 150); });
  boxes.forEach(b => b.querySelector('[data-load]')?.addEventListener('click', () => load(b)));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: '300px 0px' });
    boxes.forEach(b => io.observe(b));
  } else boxes.forEach(load);
})();
