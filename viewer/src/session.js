// @sbtel file Viewer.Session
// Session comments (docs/DESIGN.md §6.3, §6.4): what server mode and diff mode share. In a session the
// comments live in the session's log on the server, not in localStorage. A sent comment keeps its
// bubble and its thread, the thread shows the agent's replies, and a reply that arrives over SSE goes
// into its thread as well as a toast. Inlined by viewer/build.mjs after the app and before server.js
// and diff.js; at load it only defines sessionComments, so standalone mode is untouched.
function sessionComments({ version, closed }) {
  const C = { read: null, seenReplies: new Set(), seen: new Set(), reviews: [], listeners: [] };
  const changed = () => C.listeners.forEach(f => f());
  const CSS = `
.sb-reply { margin:9px 0 0 2px; padding:1px 0 1px 12px; border-left:2px solid var(--accent); overflow-wrap:anywhere; white-space:pre-wrap; }
.sb-reply .who { display:block; font-size:12px; font-weight:600; color:var(--accent-ink); margin-bottom:1px; }
.sb-reply .who time { font-weight:400; color:var(--muted); margin-left:6px; }`;
  // Replies read so far: { comment id: how many of its replies the reader has seen }, kept per session, so a
  // reply that arrived while its chat was closed puts a dot on the count until the chat is opened.
  const RKEY = SBTEL.session ? 'sbtel-read:' + SBTEL.session : null;
  const unread = c => !!c.sid && (c.replies || []).length > ((C.read || {})[c.sid] || 0);
  function markUnread(root) {
    cmtCount();
    const u = new Set(state.comments.filter(unread).map(c => c.target));
    (root || document).querySelectorAll('.cbub[data-thread]').forEach(b => {
      const on = [...u].some(t => inScope(b.dataset.thread, t)); if (on === b.classList.contains('unread')) return;
      b.classList.toggle('unread', on);
      const l = (b.getAttribute('aria-label') || '').replace(/, new reply$/, ''); if (l) b.setAttribute('aria-label', l + (on ? ', new reply' : ''));
    });
  }
  function markRead(key) {
    if (!C.read) return; // the log has not loaded yet: its first load says what is read
    let ch = false;
    state.comments.forEach(c => { if (inScope(key, c.target) && unread(c)) { C.read[c.sid] = c.replies.length; ch = true; } });
    if (ch) { if (RKEY) store.set(RKEY, C.read); markUnread(); }
  }
  const errText = async res => { try { return (await res.json()).error || 'HTTP ' + res.status; } catch (e) { return 'HTTP ' + res.status; } };

  // state.comments from the log's comment, review and reply events, plus this tab's unsent drafts (the
  // pending comments of its review). A review's comments are sent comments like the others, with the
  // review's id; the reviews themselves (with replies to them as a whole) are listed in reviews().
  // Returns the highest seq seen, for the SSE `after` parameter.
  function rebuild(events) {
    const drafts = state.comments.filter(c => c.status !== 'sent' && !c.sid);
    const list = [], byId = new Map(), revs = new Map();
    let last = 0;
    const sent = (id, target, text, version, at, review) => { const c = { id, sid: id, target, text, status: 'sent', version, at, replies: [], review }; list.push(c); byId.set(id, c); };
    events.forEach(e => {
      if (e.kind === 'comment') sent(e.id, e.target, e.text, e.version, Date.parse(e.at));
      // A thread the agent started (sbtel note): an entry with no words of the human's, whose first reply is the note.
      if (e.kind === 'note') { sent(e.id, e.target, '', e.version, Date.parse(e.at)); const c = byId.get(e.id); c.agent = true; c.replies.push({ text: e.text, at: Date.parse(e.at) }); }
      if (e.kind === 'review') {
        (e.comments || []).forEach(c => sent(c.id, c.target, c.text, e.version, Date.parse(e.at), e.id));
        revs.set(e.id, { id: e.id, message: e.message || '', n: (e.comments || []).length, proposal: !!e.proposal, at: Date.parse(e.at), replies: [] });
      }
      if (e.kind === 'reply' && !C.seenReplies.has(e.seq) && (byId.has(e.to) || revs.has(e.to))) { C.seenReplies.add(e.seq); (byId.get(e.to) || revs.get(e.to)).replies.push({ text: e.text, at: Date.parse(e.at) }); }
      last = Math.max(last, e.seq || 0);
    });
    state.comments = list.concat(drafts);
    // The first load of a session in this browser: what is already there counts as read.
    if (!C.read) { C.read = RKEY ? store.get(RKEY, null) : null; if (!C.read) { C.read = {}; list.forEach(c => { C.read[c.sid] = c.replies.length; }); } }
    C.reviews = [...revs.values()];
    changed();
    return last;
  }
  async function send(list) {
    if (closed()) { toast('This session is closed; comments can no longer be sent.'); return; }
    let sent = 0, failed = '';
    for (const c of list) {
      const was = c.status;
      c.status = 'sending'; refreshChat();
      try {
        const res = await fetch(SBTEL.base + 'comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: c.target, targetLabel: targetLabel(c.target), from: sentFrom, text: c.text, version: version(), source: targetSource(c.target) }) });
        if (!res.ok) throw new Error(await errText(res));
        const j = await res.json();
        c.status = 'sent'; c.sid = c.id = j.id; c.replies = c.replies || []; sent++;
      } catch (e) { c.status = was === 'pending' ? 'pending' : 'saved'; failed = e.message === 'Failed to fetch' ? 'the sbtel server is not answering' : e.message; }
    }
    saveComments(); render(); refreshChat(); renderMsgTableIfOpen();
    if (failed) toast(`Could not send ${list.length - sent} comment${list.length - sent === 1 ? '' : 's'}: ${failed}. ${sent ? sent + ' sent.' : 'They are kept in your review.'}`);
    else if (!(list.length === 1 && chatOpen(list[0].target))) toast(`Sent ${sent} comment${sent === 1 ? '' : 's'} to the agent.`); // an open chat already says so
  }
  // SSE `note`: {seq, id, target, text, at}: the agent started a thread. It is unread until its thread is opened.
  function onNote(d) {
    if (C.seenReplies.has(d.seq) || state.comments.some(c => c.sid === d.id)) return;
    C.seenReplies.add(d.seq);
    const at = Date.parse(d.at) || Date.now();
    state.comments.push({ id: d.id, sid: d.id, target: d.target, text: '', status: 'sent', at, agent: true, replies: [{ text: d.text, at }] });
    render(); refreshChat();
    if (chatShows(d.target)) markRead(chat.key);
    markUnread(); changed();
  }
  // SSE `reply`: {seq, to, text, at}.
  function onReply(d) {
    if (C.seenReplies.has(d.seq)) return;
    C.seenReplies.add(d.seq);
    const rv = C.reviews.find(r => r.id === d.to);
    if (rv) { rv.replies.push({ text: d.text, at: Date.parse(d.at) || Date.now() }); changed(); const rb = $('rvBtn'); if (rb && !rb.classList.contains('on')) rb.classList.add('unread'); return; } // a dot on Review, no announcement
    const c = state.comments.find(x => x.sid === d.to);
    if (!c) return;
    (c.replies = c.replies || []).push({ text: d.text, at: Date.parse(d.at) || Date.now() });
    render(); refreshChat(); // explicitly: diff mode draws with its own render
    if (chatShows(c.target)) markRead(chat.key); // it is being read now: shown from its start, marked new this once
    markUnread(); changed();
    // Nothing is announced: the reply puts a dot on its bubble and on the toolbar's button (markUnread).
  }
  // The app hooks (§6.5). Call once, from the mode's boot().
  function hook() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    saveComments = () => renderSendBtn(); // comments live on the server; drafts stay in this tab
    openSend = list => send(list);
    // Sent comments stay visible (their threads carry the agent's replies).
    commentCounts = () => { const c = {}; state.comments.forEach(x => { c[x.target] = (c[x.target] || 0) + 1; }); return c; };
    // The chat's rows: a sent comment says how it went, cannot be deleted, and carries the agent's replies.
    const status0 = chatStatus, btns0 = chatRowBtns;
    // Sent: the server has it. Seen: `sbtel inbox` has handed it to the agent (the server says which, setSeen).
    chatStatus = c => c.status === 'sent' ? (C.seen.has(c.sid) ? ['st-seen', 'Seen by the agent', (c.review ? 'Sent in review ' + c.review + '. ' : '') + 'The agent has been given this comment'] : ['st-sent', c.review ? 'Sent in review ' + c.review : 'Sent', 'The agent has not read its inbox since']) : c.status === 'sending' ? ['st-sending', 'Sending…'] : status0(c);
    chatRowBtns = c => c.status === 'sent' || c.status === 'sending' ? '' : btns0(c);
    chatReplies = c => (c.replies || []).map((r, i) => `<div class="sb-reply${C.read && i >= (C.read[c.sid] || 0) ? ' unread' : ''}"><span class="who">Agent${r.at ? `<time>${whenText(r.at)}</time>` : ''}</span>${richText(r.text)}</div>`).join('');
    // Unread replies: a dot on the count, drawn with every paint, cleared when the chat opens.
    const paint0 = paint; paint = (lay, keep) => { paint0(lay, keep); if (!keep) markUnread($('world')); };
    const fill0 = fillBlock; fillBlock = (el, B, counts) => { fill0(el, B, counts); markUnread(el); };
    const open0 = openChat; openChat = (key, anchor, focus) => { open0(key, anchor, focus); markRead(key); };
    // Set here, with the rest of what a mode takes over: the page builds one of these for each mode it
    // could be in, and only the one in use may say what is unread.
    chatUnread = c => unread(c);
  }
  // The reviews sent in this session (from the log, and from this tab), and a listener for changes to
  // them or to the comments' threads (the Review panel's "Sent reviews").
  const reviews = () => C.reviews;
  const addReview = r => { C.reviews.push(r); changed(); };
  const onChange = f => { C.listeners.push(f); };
  // What the agent has been given (ids of comments), from the log and from the server's `seen` news.
  function setSeen(ids) { let ch = false; (ids || []).forEach(i => { if (!C.seen.has(i)) { C.seen.add(i); ch = true; } }); if (ch) refreshChat(); }
  return { rebuild, send, onReply, onNote, hook, reviews, addReview, onChange, setSeen, _state: C };
}
