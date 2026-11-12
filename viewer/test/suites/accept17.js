// accept17: finding your place in a conversation. A block's name in a reply is a link to the block; a block
// that has an inside is opened and closed from its corner, beside its comment count; a thread with a new
// reply opens at the comment the reply answers.
window.__accept = async function () {
  const r = {}, wait = ms => new Promise(f => setTimeout(f, ms));
  const is = (name, got, want = true) => { r[name] = got === want ? 'pass' : `fail: ${got}`; };
  const until = async (f, ms = 4000) => { for (const t0 = performance.now(); performance.now() - t0 < ms;) { if (f()) return true; await wait(40); } return !!f(); };
  const help = document.getElementById('help'); if (!help.hidden) document.getElementById('helpBtn').click();
  setSource(`(block app (~ The app. ~)
  (level :name "Top" (block shell (~ Wires it. ~)) (block slow-ci-test (~ A slow test. ~)) (block Store (~ Keep. ~)))
  (level :name "Bottom" (block sync (~ Keep. ~) (level :name "In" (block queue (~ Waiting. ~)) (block retry (~ Again. ~))))))`);
  state.open = new Set(['app', 'sync']); render(); fit(false); await wait(200);

  // Block names in text.
  const links = s => [...new DOMParser().parseFromString(richText(s), 'text/html').querySelectorAll('a.blink')].map(a => a.dataset.block).join(' ');
  is('bareNameWithHyphen', links('See slow-ci-test for the evidence.'), 'slow-ci-test');
  is('plainWordsAreNotLinks', links('The shell and the sync are fine, and so is the Store.'), '');
  is('backticksLinkAnyName', links('Look at `shell` and `Store`, not `nothing`.'), 'shell Store');
  is('nameEndingASentence', links('It is in slow-ci-test.'), 'slow-ci-test');
  is('insideALinkIsLeft', links('[slow-ci-test](https://example.com/slow-ci-test) and https://example.com/slow-ci-test'), '');
  is('longerNameIsNotCut', links('slow-ci-test-2 is another thing.'), '');
  document.body.insertAdjacentHTML('beforeend', `<p id="t17" style="position:fixed;left:8px;bottom:8px;z-index:9999">${richText('go to `shell`')}</p>`);
  state.open = new Set(); render(); await wait(100);
  document.querySelector('#t17 a.blink').click(); await until(() => state.sel === 'shell');
  is('clickGoesToTheBlock', state.sel === 'shell' && state.open.has('app'));
  document.getElementById('t17').remove();

  // The open/close toggle sits in the block's corner, beside its comment count.
  state.open = new Set(['app', 'sync']);
  state.comments.push({ id:'d1', target:'block:sync', text:'Cap the queue.', status:'draft', at:Date.now() });
  render(); await wait(120);
  const corner = id => state.elems.get(id).querySelector(':scope > .ccorner');
  const tg = id => state.elems.get(id).querySelector(':scope > .ccorner > .ctog');
  is('openBlockHasCloseToggle', tg('sync') && tg('sync').getAttribute('aria-expanded'), 'true');
  is('toggleLeftOfTheCount', !!corner('sync') && corner('sync').firstElementChild === tg('sync') && corner('sync').lastElementChild.classList.contains('cbub'));
  is('cornerIsTopRight', (() => { const c = corner('sync').getBoundingClientRect(), k = state.elems.get('sync').getBoundingClientRect(); return Math.abs(c.right - k.right) < 16 * state.cam.k + 2 && Math.abs(c.top - k.top) < 16 * state.cam.k + 2; })());
  is('noArrowUnderTheTitle', document.querySelectorAll('.blk .foot button').length, 0);
  is('blockWithNothingInsideHasNone', !tg('queue') && !tg('shell'));
  tg('sync').click(); await wait(150);
  is('toggleCloses', state.open.has('sync'), false);
  is('closedBlockHasOpenToggle', tg('sync') && tg('sync').getAttribute('aria-expanded'), 'false');
  is('countStaysBesideIt', !!corner('sync').querySelector('.cbub'));
  tg('sync').click(); await wait(150);
  is('toggleOpens', state.open.has('sync'));
  state.comments.length = 0;

  // A thread with a new reply opens at the comment the reply answers.
  state.open = new Set(['app']);
  const long = 'Takes most of its time limit on a fast machine and tips over on a slow one. '.repeat(6);
  const was = chatReplies; chatReplies = c => (c.replies || []).map(x => `<div class="sb-reply${x.fresh ? ' unread' : ''}">${richText(x.text)}</div>`).join('');
  state.comments.push({ id:'c1', sid:'c1', target:'block:shell', text:'An older question. ' + long, status:'sent', at:Date.now() - 9e5, replies:[{ text:'An older answer. ' + long }] },
    { id:'c2', sid:'c2', target:'block:shell', text:'So it has nothing to do with our change?', status:'sent', at:Date.now(), replies:[{ text:long + long + long, fresh:true }] });
  render(); openThread('block:shell'); await until(() => pops.thread); await wait(120);
  const ul = pops.thread.querySelector('ul.thread'), q2 = ul.querySelector('li[data-id="c2"]'), off = q2.getBoundingClientRect().top - ul.getBoundingClientRect().top;
  is('threadIsScrolled', ul.scrollTop > 40);
  is('opensAtTheQuestion', off >= -1 && off < 24 ? true : 'question at ' + Math.round(off));
  closePop('thread'); state.comments.length = 0; chatReplies = was; render();
  // A file with no blocks says so and offers the first one; the canvas menu calls it a block too.
  setSource('; nothing yet\n'); await wait(120);
  const em = document.getElementById('emptyc');
  is('emptyFileSaysSo', !!em && /no blocks yet/.test(em.textContent));
  is('menuOffersABlock', menuItems(null, 0).items[0].label, 'Add a block');
  em.querySelector('button').click(); await until(() => state.model.blocks.size === 1);
  is('buttonAddsTheFirstBlock', state.model.blocks.size === 1 && !document.getElementById('emptyc'));
  undo(); await wait(120);
  is('undoBringsTheEmptyStateBack', !!document.getElementById('emptyc'));
  return r;
};
