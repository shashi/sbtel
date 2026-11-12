// accept18: a block's name may be a phrase. It is written as a string, shown as written, wraps on a card
// when it does not fit, can be typed in the editor, and names the block everywhere a name does.
window.__accept = async function () {
  const r = {}, wait = ms => new Promise(f => setTimeout(f, ms));
  const is = (name, got, want = true) => { r[name] = got === want ? 'pass' : `fail: ${got}`; };
  const until = async (f, ms = 4000) => { for (const t0 = performance.now(); performance.now() - t0 < ms;) { if (f()) return true; await wait(40); } return !!f(); };
  const help = document.getElementById('help'); if (!help.hidden) document.getElementById('helpBtn').click();
  setSource(`(block "Why CI failed" (~ The story. ~)
  (level :name "Evidence"
    (block "Test that times out on CI" :type "Evidence" (~ Slow on CI. ~))
    (block slow-ci-test (~ Old name. ~))
    (block "A long phrase for a name that will need more than one line" (~ x ~))))`);
  state.open = new Set(['Why CI failed']); render(); fit(false); await wait(200);
  const T = 'Test that times out on CI', el = id => state.elems.get(id);

  is('phraseIsTheName', state.model.blocks.has(T) && state.model.blocks.get(T).name, T);
  is('shownAsWritten', el(T).querySelector('.ttl > span').textContent, T);
  is('shortPhraseOnOneLine', el(T).querySelector('.ttl').classList.contains('wraps'), false);
  const L = 'A long phrase for a name that will need more than one line', lt = el(L).querySelector('.ttl');
  is('longPhraseWraps', lt.classList.contains('wraps') && lt.getBoundingClientRect().height > 30 * state.cam.k);
  is('wrappedTitleFitsTheCard', lt.scrollHeight <= lt.clientHeight + 2 && el(L).querySelector('.sk').getBoundingClientRect().top >= lt.getBoundingClientRect().bottom - 1);
  is('oneWordNameNeverWraps', el('slow-ci-test').querySelector('.ttl').classList.contains('wraps'), false);
  is('lintCountsWords', (state.model.warnings || []).filter(w => /is 13 words/.test(w)).length, 1);

  // Rename in the editor: a phrase is written as a string, a single word bare, quotes escaped.
  const rename = (id, name) => applyEdit(state.src, state.model, { t:'props', node:state.model.blocks.get(id), name }).src;
  is('renameToPhraseQuotes', /\(block "Test that fails on slow machines"\n/.test(rename('slow-ci-test', 'Test that  fails on slow machines') + '\n') || /\(block "Test that fails on slow machines" /.test(rename('slow-ci-test', 'Test that  fails on slow machines')));
  is('renameToWordIsBare', /\(block ci-test :type "Evidence"/.test(rename(T, 'ci-test')));
  is('renameEscapesQuotes', rename('slow-ci-test', 'The "slow" test').includes('(block "The \\"slow\\" test"'));
  const n = state.model.blocks.get('slow-ci-test');
  is('phraseIsAllowed', nameClash(state.model, n, 'Two words'), '');
  is('emptyIsNot', /needs a name/.test(nameClash(state.model, n, '  ')));
  is('clashIsFound', /already the name of a block/.test(nameClash(state.model, n, T)));
  is('shapeNameStaysOneWord', /cannot be empty or contain spaces/.test(nameClash(state.model, { form:'message', name:'X' }, 'Two words')));

  // The name works where names are used: selecting, a comment's target, a link in a reply.
  select(T, null); is('selectsByName', state.sel, T);
  is('commentTarget', targetKey(T), 'block:' + T);
  is('labelSaysIt', targetLabel('block:' + T).includes(T));
  const links = s => [...new DOMParser().parseFromString(richText(s), 'text/html').querySelectorAll('a.blink')].map(a => a.dataset.block).join('|');
  is('backticksLinkAPhrase', links('See `Test that times out on CI` for why.'), T);
  is('barePhraseIsNotALink', links('The Test that times out on CI is slow.'), '');

  // An edit through the page keeps the string form and the selection.
  edit({ t:'props', node:state.model.blocks.get('slow-ci-test'), name:'Slow test' }); await wait(150);
  is('editedSourceHasString', state.src.includes('(block "Slow test"'));
  is('editedBlockIsThere', state.model.blocks.has('Slow test') && !!el('Slow test'));
  return r;
};
