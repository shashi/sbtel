// @sbtel file Viewer.Session
// Session comments (docs/DESIGN.md §6.3, §6.4): what server mode and diff mode share. In a session the
// comments live in the session's log on the server, not in localStorage. A sent comment keeps its
// bubble and its thread, the thread shows the agent's replies, and a reply that arrives over SSE goes
// into its thread as well as a toast. Inlined by viewer/build.mjs after the app and before server.js
// and diff.js; at load it only defines sessionComments, so standalone mode is untouched.
function sessionComments({ version, closed }) {
  const C = { thread: null, seenReplies: new Set(), reviews: [], listeners: [] };
  const changed = () => C.listeners.forEach(f => f());
  const CSS = `
.sb-reply { margin-top:7px; padding:6px 8px; border-radius:7px; background:var(--accent-soft); white-space:pre-wrap; }
.sb-reply .who { display:block; font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); font-weight:600; margin-bottom:2px; }`;
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
      if (e.kind === 'review') {
        (e.comments || []).forEach(c => sent(c.id, c.target, c.text, e.version, Date.parse(e.at), e.id));
        revs.set(e.id, { id: e.id, message: e.message || '', n: (e.comments || []).length, proposal: !!e.proposal, at: Date.parse(e.at), replies: [] });
      }
      if (e.kind === 'reply' && !C.seenReplies.has(e.seq) && (byId.has(e.to) || revs.has(e.to))) { C.seenReplies.add(e.seq); (byId.get(e.to) || revs.get(e.to)).replies.push({ text: e.text, at: Date.parse(e.at) }); }
      last = Math.max(last, e.seq || 0);
    });
    state.comments = list.concat(drafts);
    C.reviews = [...revs.values()];
    changed();
    return last;
  }
  async function send(list) {
    if (closed()) { toast('This session is closed; comments can no longer be sent.'); return; }
    let sent = 0, failed = '';
    for (const c of list) {
      const was = c.status;
      c.status = 'sending';
      try {
        const res = await fetch(SBTEL.base + 'comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: c.target, targetLabel: targetLabel(c.target), text: c.text, version: version(), source: targetSource(c.target) }) });
        if (!res.ok) throw new Error(await errText(res));
        const j = await res.json();
        c.status = 'sent'; c.sid = c.id = j.id; c.replies = c.replies || []; sent++;
      } catch (e) { c.status = was === 'pending' ? 'pending' : 'saved'; failed = e.message === 'Failed to fetch' ? 'the sbtel server is not answering' : e.message; }
    }
    saveComments(); render(); renderMsgTableIfOpen();
    if (failed) toast(`Could not send ${list.length - sent} comment${list.length - sent === 1 ? '' : 's'}: ${failed}. ${sent ? sent + ' sent.' : 'They are kept in your review.'}`);
    else toast(`Sent ${sent} comment${sent === 1 ? '' : 's'} to the agent.`);
  }
  // SSE `reply`: {seq, to, text, at}.
  function onReply(d) {
    if (C.seenReplies.has(d.seq)) return;
    C.seenReplies.add(d.seq);
    const one = String(d.text || '').replace(/\s+/g, ' '), short = one.length > 120 ? one.slice(0, 119) + '…' : one;
    const rv = C.reviews.find(r => r.id === d.to);
    if (rv) { rv.replies.push({ text: d.text, at: Date.parse(d.at) || Date.now() }); changed(); toast(`Agent replied to your review ${rv.id}: ${short}`); return; }
    const c = state.comments.find(x => x.sid === d.to);
    if (!c) return;
    (c.replies = c.replies || []).push({ text: d.text, at: Date.parse(d.at) || Date.now() });
    render(); changed();
    toast(`Agent replied on ${targetLabel(c.target)}: ${short}`);
    if (pops.thread && C.thread && C.thread.key === c.target) {
      const { left, top } = pops.thread.style;
      openThread(c.target, C.thread.anchor);
      if (pops.thread) { pops.thread.style.left = left; pops.thread.style.top = top; }
    }
  }
  // The app hooks (§6.5). Call once, from the mode's boot().
  function hook() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    saveComments = () => renderSendBtn(); // comments live on the server; drafts stay in this tab
    openSend = list => send(list);
    // Sent comments stay visible (their threads carry the agent's replies).
    commentCounts = () => { const c = {}; state.comments.forEach(x => { c[x.target] = (c[x.target] || 0) + 1; }); return c; };
    const origThread = openThread;
    openThread = (key, anchor) => {
      C.thread = { key, anchor };
      origThread(key, anchor);
      const el = pops.thread; if (!el) return;
      const list = state.comments.filter(c => c.target === key);
      el.querySelectorAll('ul.thread > li').forEach((li, i) => {
        const c = list[i]; if (!c) return;
        if (c.status === 'sent') { li.querySelector('[data-t="del"]')?.remove(); const s = li.querySelector('.st-sent'); if (s) s.textContent = c.review ? 'Sent in review ' + c.review : 'Sent to the agent'; }
        if (c.status === 'sending') { const s = li.querySelector('.st-sending'); if (s) s.textContent = 'Sending…'; }
        (c.replies || []).forEach(r => li.insertAdjacentHTML('beforeend', `<div class="sb-reply"><span class="who">Agent</span>${esc(r.text)}</div>`));
      });
      placeNear(el, anchor && anchor.isConnected !== false && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : el.getBoundingClientRect());
    };
  }
  // The reviews sent in this session (from the log, and from this tab), and a listener for changes to
  // them or to the comments' threads (the Review panel's "Sent reviews").
  const reviews = () => C.reviews;
  const addReview = r => { C.reviews.push(r); changed(); };
  const onChange = f => { C.listeners.push(f); };
  return { rebuild, send, onReply, hook, reviews, addReview, onChange, _state: C };
}
