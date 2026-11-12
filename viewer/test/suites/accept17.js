// accept17: finding your place in a conversation. A block's name in a reply is a link to the block; an open
// block with comments inside it has a button that closes it and reads them together; a thread with a new
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

  // The gather button on an open block.
  state.open = new Set(['app', 'sync']);
  state.comments.push({ id:'d1', target:'block:queue', text:'Cap the queue.', status:'draft', at:Date.now() }, { id:'d2', target:'block:retry', text:'Back off.', status:'draft', at:Date.now() });
  render(); await wait(120);
  const g = state.elems.get('sync').querySelector('.cgather');
  is('openBlockOffersToGather', !!g && g.textContent.trim(), '2');
  is('onlyWhereCommentsAreInside', document.querySelectorAll('.cgather').length, 2); // sync, and app around it
  is('closedBlockHasNone', !state.elems.get('queue').querySelector('.cgather'));
  g.click(); await until(() => pops.thread);
  is('closesTheBlock', state.open.has('sync'), false);
  const text = pops.thread ? pops.thread.textContent : '';
  is('threadReadsBothTogether', /Cap the queue\./.test(text) && /Back off\./.test(text));
  is('countOnTheClosedBlock', (state.elems.get('sync').querySelector('.cbub') || {}).textContent, '2');
  closePop('thread'); state.comments.length = 0;

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
  return r;
};
