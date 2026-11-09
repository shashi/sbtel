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
  boxes.forEach(b => b.querySelector('[data-load]')?.addEventListener('click', () => load(b)));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: '300px 0px' });
    boxes.forEach(b => io.observe(b));
  } else boxes.forEach(load);
})();
