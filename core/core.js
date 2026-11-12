// @sbtel begin Core.Constants
/*CORE-START*/
const K = { PAD:22, GAPX:56, ROWGAP:30, TAB:20, LEVELGAP:44, NAMEGAP:10, BANDGAP:34, BANDLAB:22, MIN_EXP:320, CARD_MIN:220, CARD_MAX:340, DETAIL_MAX:440, LABEL:52 };
// How much room the layout leaves between things (opts.space): the gaps between blocks in a row, between
// rows, between levels and bands, and inside an open block's edge. "balanced" is K as written. A level's
// gap never goes under two ears' height, since an ear of the row above and one of the row below share it.
const SPACE = {
  compact:  { PAD:16, GAPX:34, ROWGAP:24, LEVELGAP:42, BANDGAP:26 },
  balanced: { PAD:K.PAD, GAPX:K.GAPX, ROWGAP:K.ROWGAP, LEVELGAP:K.LEVELGAP, BANDGAP:K.BANDGAP },
  relaxed:  { PAD:32, GAPX:88, ROWGAP:48, LEVELGAP:74, BANDGAP:54 },
};
// With more room between blocks a row also gets more width, so the same blocks still fit on it.
const SPACE_WIDTH = { relaxed:1.3 };
// K is the one table everything reads (the layout here, drop zones in the viewer), so the choice is written into it.
function setSpace(name) { Object.assign(K, SPACE[name] || SPACE.balanced); }
const FONT = {
  title:'600 17px "Commissioner"', sketch:'400 13.5px "Commissioner"',
  htitle:'600 20px "Commissioner"', hsketch:'400 14.5px "Commissioner"',
  chip:'500 12px "JetBrains Mono"', pill:'400 12.5px "Commissioner"', foot:'400 12.5px "Commissioner"'
};
// The twelve forms. A model node of (takes …) or (gives …) has form 'port', and one of (shape …) has form
// 'message': the names the model has always used for them.
const FORMS = new Set(['block','level','adjacent','takes','gives','shape','behavior','implements','sketch','refines','carries','ref']);
// Forms a behavior does not contain (it is a set of ports, not a part of the system), and what to declare instead.
const NOT_IN_BEHAVIOR = { block:'the block', level:'the level', adjacent:'the adjacent group', shape:'the shape', behavior:'the behavior' };

// @sbtel end Core.Constants
// @sbtel begin Core.Reader
// ---------- Parser ----------
function lineCol(src, pos) { const pre = src.slice(0, pos); const line = pre.split('\n').length; return line + ':' + (pos - pre.lastIndexOf('\n')); }
// The text of a (~ … ~) sketch: trimmed, every run of whitespace one space, except that a run holding two
// or more line breaks (a blank line between paragraphs) is one paragraph break, \n\n. \r\n and \r count as
// one line break each. (sketch "…") strings keep their own rule: every whitespace run is one space.
// Paragraph breaks in a sketch's text (M.wrap counts each as one line; a card draws each half a line tall).
function paraGaps(text) { return Math.max(0, text.split('\n\n').filter(p => p.trim()).length - 1); }
function tildeText(raw) { return raw.replace(/\r\n?/g, '\n').replace(/\s+/g, w => w.indexOf('\n') !== w.lastIndexOf('\n') ? '\n\n' : ' ').trim(); }
function tokenize(src) {
  const t = [], n = src.length, NONWS = /\S/g, STOP = /[\s()";]/g; let i = 0;
  while (i < n) {
    NONWS.lastIndex = i; const w = NONWS.exec(src); if (!w) break; i = w.index;
    const c = src.charCodeAt(i);
    if (c === 59) { const k = src.indexOf('\n', i); i = k < 0 ? n : k; continue; }
    // (~ text ~) is (sketch "text"): `(` and a run of k tildes open it, and the first k tildes followed by
    // `)` close it. Nothing inside is special. One token, read as a two-item sketch list.
    if (c === 40 && src.charCodeAt(i + 1) === 126) {
      let k = 1; while (src.charCodeAt(i + 1 + k) === 126) k++;
      const close = '~'.repeat(k) + ')', j = src.indexOf(close, i + 1 + k);
      if (j < 0) throw new Error('Unterminated (' + '~'.repeat(k) + ': no closing ' + close + ' at ' + lineCol(src, i));
      t.push({ t:'tilde', k, raw:src.slice(i + 1 + k, j), s:i, e:j + k + 1 }); i = j + k + 1; continue;
    }
    if (c === 40 || c === 41) { t.push({ t:src[i], s:i, e:i+1 }); i++; continue; }
    if (c === 34) {
      let j = i + 1, v = '', a = j;
      while (j < n) { const d = src.charCodeAt(j); if (d === 34) break; if (d === 92 && j + 1 < n) { v += src.slice(a, j) + src[j+1]; j += 2; a = j; } else j++; }
      if (j >= n) throw new Error('Unclosed string at ' + lineCol(src, i));
      v += src.slice(a, j);
      t.push({ t:'str', v, s:i, e:j+1 }); i = j + 1; continue;
    }
    STOP.lastIndex = i; const m = STOP.exec(src), j = m ? m.index : n;
    t.push({ t:'sym', v:src.slice(i, j), s:i, e:j }); i = j;
  }
  return t;
}
function readAll(src) {
  const toks = tokenize(src); let p = 0;
  function read() {
    const tk = toks[p++];
    if (tk.t === 'tilde') return { list:[{ t:'sym', v:'sketch', s:tk.s, e:tk.s + 1 + tk.k }, { t:'str', v:tildeText(tk.raw), s:tk.s + 1 + tk.k, e:tk.e - tk.k - 1 }], s:tk.s, e:tk.e, tilde:tk.k };
    if (tk.t === '(') {
      const items = [];
      while (p < toks.length && toks[p].t !== ')') items.push(read());
      if (p >= toks.length) throw new Error('Missing ")" for "(" at ' + lineCol(src, tk.s));
      const end = toks[p++];
      return { list:items, s:tk.s, e:end.e };
    }
    if (tk.t === ')') throw new Error('Unexpected ")" at ' + lineCol(src, tk.s));
    return tk;
  }
  const out = []; while (p < toks.length) out.push(read()); return out;
}
// @sbtel end Core.Reader
// @sbtel begin Core.Model
// The head of a declaration, one grammar for (block Name …), (behavior Name|(Name P …) …) and (message Name …):
// the name, then keywords. :type is the one keyword: what the element is in code (a module, a trait, a
// struct…). Lint reports any other, which is dropped. Returns the index of the first body item.
function declHead(node, items) {
  let i = 1;
  while (i < items.length && items[i].t === 'sym' && items[i].v.startsWith(':')) {
    const k = items[i].v.slice(1), v = items[i+1]; if (k === 'type' && node.type === undefined) node.type = v ? v.v : ''; i += 2;
  }
  return i;
}
// A port's name when it has no :as: the type's name with its first letter lowercased (NoteSaved ->
// noteSaved, URL -> uRL). A qualified type gives its last component (shell.Intent and pkg::Intent ->
// intent); type arguments are dropped first (List<Item> and Map[K,V] -> list, map). A behavior's port
// typed with a parameter takes the parameter's name (T -> t), whatever the implementer passes.
function defaultPortName(kind) {
  if (!kind) return '';
  let t = String(kind); const g = t.search(/[<\[]/); if (g > 0) t = t.slice(0, g);
  const parts = t.split(/[.:]+/).filter(Boolean); t = parts.length ? parts[parts.length - 1] : String(kind);
  const c = String.fromCodePoint(t.codePointAt(0)); return c.toLowerCase() + t.slice(c.length);
}
// The source text of a port: :as only when the name is not the default one.
function portForm(name, dir, kind) { return `(${dir === 'in' ? 'takes' : 'gives'} ${kind}${name && name !== defaultPortName(kind) ? ' :as ' + name : ''})`; }
// A port's reader items after its direction: { dir, kind, as, name, body (index of the first item after
// the head) }. items[0] is the direction (:in for takes, :out for gives), put there by the parser.
function portParts(items) {
  const sym = x => x && x.t === 'sym' ? x.v : null, kw = x => { const v = sym(x); return v !== null && v.startsWith(':'); };
  const a = sym(items[0]);
  const dir = a === ':in' || a === ':out' ? a.slice(1) : null;
  const kind = items[1] && !kw(items[1]) ? (items[1].list ? sym(items[1].list[0]) : sym(items[1])) : null;
  let i = kind !== null || (items[1] && !kw(items[1])) ? 2 : 1, as = null;
  for (; i < items.length && kw(items[i]); ) {
    const v = items[i + 1], ok = v && v.t === 'sym' && !kw(v);
    if (items[i].v === ':as' && as === null && ok) as = v.v;
    i += ok || (v && v.t === 'str') ? 2 : 1;
  }
  return { dir, kind, as, name: as || defaultPortName(kind) || null, body:i };
}
// A ref's path, taken apart: { file, from, to, anchor, url }. A URL is kept whole. `path:40-60` names lines
// (a Windows drive letter is not a line number), and `path#heading` a place in a document.
function refParts(path) {
  if (!path) return { file:null, from:0, to:0, anchor:'', url:false };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return { file:path, from:0, to:0, anchor:'', url:true };
  let file = path, anchor = ''; const h = file.indexOf('#'); if (h > 0) { anchor = file.slice(h + 1); file = file.slice(0, h); }
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(file);
  return m ? { file:m[1], from:+m[2], to:+(m[3] || m[2]), anchor, url:false } : { file, from:0, to:0, anchor, url:false };
}
// The refs of a block, behavior or shape, in the order written.
const refsOf = n => n.children.filter(c => c.form === 'ref' && c.path).map(r => ({ path:r.path, file:r.file, from:r.from, to:r.to, anchor:r.anchor, url:r.url, sketch:r.sketch }));
function parse(src) {
  const forms = readAll(src);
  const ctx = { warnings:[], behaviors:new Map(), messages:new Map(), blocks:new Map(), behaviorOrder:[] };
  const symOf = x => x && (x.t === 'sym' ? x.v : (x.list && x.list[0] && x.list[0].t === 'sym' ? x.list[0].v : null));
  // `where` names the enclosing form for messages, as lint's form warnings do ("block A", "a level").
  function conv(sx, owner, where) {
    if (!sx.list) return null;
    const head = sx.list[0]; const h = head && head.t === 'sym' ? head.v : null;
    const node = { form: FORMS.has(h) ? (h === 'takes' || h === 'gives' ? 'port' : h === 'shape' ? 'message' : h) : 'raw', s:sx.s, e:sx.e, children:[] };
    let items = sx.list.slice(1);
    const at = { toString: () => ' (line ' + lineCol(src, sx.s) + ')' };
    switch (h) {
      case 'block': {
        // A block's name is a symbol, or a string when it is a phrase: (block "Test that times out on CI" …).
        // Either way it is the block's identity. A phrase's runs of whitespace are one space each.
        const nm = items[0]; node.name = (nm && nm.t === 'str' ? nm.v.replace(/\s+/g, ' ').trim() : symOf(nm)) || '?'; node.parent = owner || null;
        if (nm && nm.t === 'str' && node.name.split(' ').length > 6) ctx.warnings.push('Block name "' + node.name + '" is ' + node.name.split(' ').length + ' words: a name is a short phrase (six words or fewer); say the rest in the sketch' + at);
        const i = declHead(node, items);
        let id = node.name, n = 2; if (ctx.blocks.has(id)) { ctx.warnings.push('Duplicate block name ' + node.name + ': a name identifies a block wherever it moves, so each needs its own (a more specific name, or parent/' + node.name + ')' + at); while (ctx.blocks.has(node.name + '#' + n)) n++; id = node.name + '#' + n; }
        node.id = id; ctx.blocks.set(id, node);
        node.children = items.slice(i).map(x => conv(x, node, 'block ' + node.name)).filter(Boolean);
        break;
      }
      case 'level': case 'adjacent': {
        // A level's keywords come right after `level`; only :name is kept, and only as a non-empty string
        // (lint reports the rest). The name is a label: never referenced, not unique, spaces allowed.
        let i = 0;
        if (h === 'level') for (; i < items.length && items[i].t === 'sym' && items[i].v.startsWith(':'); i += 2) {
          const v = items[i + 1], key = items[i].v;
          // A keyword without a value (the end, a form or another keyword next) takes nothing, unlike a block's.
          if (!v || v.list || (v.t === 'sym' && v.v.startsWith(':'))) { i--; continue; }
          if (key === ':name' && !('name' in node)) node.name = v.t === 'str' && v.v.trim() ? v.v : null;
        }
        if (h === 'level') node.name = node.name ?? null;
        node.children = items.slice(i).map(x => conv(x, owner, h === 'level' ? 'a level' : 'an adjacent group')).filter(Boolean);
        node.sketch = sketchOf(node);
        if (h === 'adjacent') node.children.forEach(c => { if (c.form === 'block') c.adj = node; }); // shownName reads a block's group
        if (h === 'adjacent' && node.children.filter(c => c.form === 'block' || c.form === 'adjacent').length < 2) ctx.warnings.push('adjacent needs two or more members' + at);
        if (h === 'level' && !node.children.some(c => c.form === 'block' || c.form === 'adjacent')) ctx.warnings.push('level needs at least one block' + at);
        break;
      }
      case 'takes': case 'gives': {
        // (takes Shape [:as name] [sketch]) and (gives Shape …): the shape, an optional name, a sketch last.
        // Without :as the name is defaultPortName(Shape). node.as is the name as written (or null); node.name
        // is the effective name, the one everything else uses.
        items = [{ t:'sym', v: h === 'takes' ? ':in' : ':out', s:sx.s, e:sx.s }, ...items];
        const p = portParts(items);
        node.dir = p.dir; node.kind = p.kind; node.as = p.as; node.name = p.name;
        node.children = items.slice(p.body).map(x => conv(x, owner, 'port ' + (node.name || '?'))).filter(Boolean); node.sketch = sketchOf(node);
        break;
      }
      case 'shape':
        node.name = symOf(items[0]); node.owner = owner || null; node.children = items.slice(declHead(node, items)).map(x => conv(x, owner, 'shape ' + node.name)).filter(Boolean);
        if (ctx.messages.has(node.name)) ctx.warnings.push('Duplicate shape ' + node.name + at);
        ctx.messages.set(node.name, node); break;
      case 'behavior': {
        // A behavior is read with a block's grammar (declHead: name, :type), and its body takes what has a
        // meaning there: sketch, ports, implements. Blocks, levels and declarations do not nest in it: each
        // is reported here (so the viewer shows it too) and left out of the model.
        node.name = symOf(items[0]); node.id = 'β:' + node.name; node.owner = owner || null;
        node.params = items[0] && items[0].list ? items[0].list.slice(1).map(symOf) : [];
        node.children = items.slice(declHead(node, items)).map(x => {
          const k = x.list && x.list[0] && x.list[0].t === 'sym' ? x.list[0].v : null;
          if (!NOT_IN_BEHAVIOR[k]) return conv(x, owner, 'behavior ' + node.name);
          const nm = k === 'level' || k === 'adjacent' ? '' : symOf(x.list[1]);
          ctx.warnings.push(`behavior ${node.name || '?'}: behaviors don't contain blocks, levels or declarations; declare ${nm ? k + ' ' + nm : NOT_IN_BEHAVIOR[k]} beside the behavior instead (line ${lineCol(src, x.s)})`);
          return null;
        }).filter(Boolean);
        if (ctx.behaviors.has(node.name)) ctx.warnings.push('Duplicate behavior ' + node.name + at);
        else ctx.behaviorOrder.push(node.name);
        ctx.behaviors.set(node.name, node); break;
      }
      // (implements Name) or, for a behavior with parameters, (implements (Name Arg …)): the arguments take
      // the parameters' places, in order, in the ports that come through it.
      case 'implements': node.name = symOf(items[0]); if (items[0] && items[0].list) node.args = items[0].list.slice(1).map(symOf); break;
      // (~ … ~) arrives already normalized (tildeText) and keeps its tilde count, so edits can keep the form.
      case 'sketch': if (sx.tilde) { node.text = items[0].v; node.tilde = sx.tilde; } else node.text = items.map(x => x.v || '').join(' ').replace(/\s+/g, ' ').trim(); break;
      case 'refines': case 'carries': node.names = items.map(symOf); break;
      // (ref path [sketch]): a file the declaration stands for or rests on. The path is a name or a "string",
      // as written (path, path:40 or path:40-60, path#heading, or a URL); node.file is the path alone.
      case 'ref': {
        const p0 = items[0]; node.path = p0 && !p0.list && !(p0.t === 'sym' && p0.v.startsWith(':')) ? p0.v : null;
        Object.assign(node, refParts(node.path));
        node.children = items.slice(1).map(x => conv(x, owner, 'ref ' + (node.path || '?'))).filter(Boolean); node.sketch = sketchOf(node);
        break;
      }
    }
    return node;
  }
  // The file itself is the root: a virtual block with no name, card or parens. Its children are the
  // top-level forms; bare top-level blocks form an implicit level, as inside any block. Top-level
  // blocks keep parent = null and top-level declarations owner = null (in scope everywhere).
  const top = forms.map(x => conv(x, null, 'the file')).filter(Boolean);
  const root = { form:'block', virtual:true, id:'', name:'', s:0, e:src.length, children:top, parent:null };
  prepBlock(root, ctx);
  for (const b of ctx.blocks.values()) prepBlock(b, ctx);
  for (const bh of ctx.behaviors.values()) prepBehavior(bh, ctx);
  for (const m of ctx.messages.values()) prepMessage(m, ctx);
  // Arguments, when given, fill every parameter: (implements (Store Event)) for (behavior (Store T) …).
  const arity = n => n.children.forEach(c => {
    const bh = c.form === 'implements' && c.args && c.args.length ? ctx.behaviors.get(c.name) : null;
    if (bh && c.args.length !== bh.params.length) ctx.warnings.push(`(implements (${c.name} ${c.args.map(x => x || '?').join(' ')})) passes ${c.args.length} argument${c.args.length === 1 ? '' : 's'}, but ${c.name} takes ${bh.params.length || 'none'} (line ${lineCol(src, c.s)})`);
  });
  [...ctx.blocks.values(), ...ctx.behaviors.values()].sort((p, q) => p.s - q.s).forEach(arity);
  [...ctx.blocks.values(), ...ctx.behaviors.values()].sort((p, q) => p.s - q.s).forEach(n => portClashes(n, src, ctx));
  const model = { root, ...ctx, src }; ctx.root = root;
  model.node = id => !id ? null : id.startsWith('β:') ? ctx.behaviors.get(id.slice(2)) : id.startsWith('μ:') ? ctx.messages.get(id.slice(2)) : ctx.blocks.get(id);
  return model;
}
// Two ports of one block or behavior with the same (effective) name, its own or from the behaviors it
// implements (a port without a name or a direction is reported already, and left out). Each clash is
// reported where it first appears: a clash inside a behavior is reported on the behavior, not again on
// every block that implements it.
function portClashes(n, src, ctx) {
  const what = (n.form === 'block' ? 'block ' : 'behavior ') + n.name, at = pos => ' (line ' + lineCol(src, pos) + ')';
  const ok = p => p.name && (p.dir === 'in' || p.dir === 'out'), own = n.children.filter(c => c.form === 'port' && ok(c)), seen = new Map();
  own.forEach(c => { if (seen.has(c.name)) ctx.warnings.push(`${what} has two ports named ${c.name}; tell them apart with :as` + at(c.s)); else seen.set(c.name, c); });
  const closure = name => { const out = new Set([name]), walk = x => (x ? x.impl : []).forEach(y => { if (!out.has(y)) { out.add(y); walk(ctx.behaviors.get(y)); } }); walk(ctx.behaviors.get(name)); return out; };
  const groups = new Map();
  inheritedVia(ctx, n).forEach(p => { if (!ok(p)) return; if (!groups.has(p.name)) groups.set(p.name, []); groups.get(p.name).push(p.via); });
  const list = vs => { const u = [...new Set(vs)]; return (u.length > 1 ? 'behaviors ' : 'behavior ') + (u.length > 1 ? u.slice(0, -1).join(', ') + ' and ' + u[u.length - 1] : u[0]); };
  groups.forEach((vias, name) => {
    if (seen.has(name)) { ctx.warnings.push(`${what} has two ports named ${name}: its own and one from ${list(vias)}; tell them apart with :as` + at(seen.get(name).s)); return; }
    if (vias.length < 2) return;
    // Already a clash inside one behavior that n implements directly: reported there.
    if (n.impl.some(d => ctx.behaviors.has(d) && vias.every(v => closure(d).has(v)))) return;
    const last = vias[vias.length - 1], imp = n.children.find(c => c.form === 'implements' && c.name && closure(c.name).has(last));
    ctx.warnings.push(`${what} has two ports named ${name}, from ${list(vias)}; tell them apart with :as` + at(imp ? imp.s : n.s));
  });
}
function flatAdj(a) { return a.children.flatMap(x => x.form === 'block' ? [x] : x.form === 'adjacent' ? flatAdj(x) : []); }
// An adjacent group's sketch is its outermost (adjacent …)'s; lint reports one on a nested group.
function unitOf(c) { return { node:c, blocks: c.form === 'block' ? [c] : flatAdj(c), sketch: c.form === 'adjacent' ? c.sketch : '' }; }
function sketchOf(n) { const sk = n.children.find(c => c.form === 'sketch'); return sk ? sk.text : ''; }
function prepBlock(b, ctx) {
  const levels = []; let run = null;
  b.children.forEach(c => {
    if (c.form === 'level') { run = null; levels.push({ kind:'level', node:c, parent:b, name:c.name, sketch:c.sketch, units: c.children.filter(x => x.form === 'block' || x.form === 'adjacent').map(unitOf) }); }
    else if (c.form === 'block' || c.form === 'adjacent') { if (!run) { run = { kind:'implicit', parent:b, name:null, sketch:'', units:[] }; levels.push(run); } run.units.push(unitOf(c)); }
  });
  levels.forEach((L, i) => L.key = b.id + ':' + i);
  b.levels = levels.filter(L => L.units.length);
  b.sketch = sketchOf(b);
  b.ownPorts = b.children.filter(c => c.form === 'port').map(p => ({ name:p.name, dir:p.dir, kind:p.kind, sketch:p.sketch }));
  implOf(b);
  b.behaviorDecls = b.children.filter(c => c.form === 'behavior');
  b.messageDecls = b.children.filter(c => c.form === 'message');
  b.refs = refsOf(b);
  b._ctx = ctx;
}
function prepBehavior(bh, ctx) {
  bh.sketch = sketchOf(bh); bh.refs = refsOf(bh);
  bh.ports = bh.children.filter(c => c.form === 'port').map(p => ({ name:p.name, dir:p.dir, kind:p.kind, sketch:p.sketch }));
  bh.levels = []; implOf(bh); bh._ctx = ctx;
}
// A block's or a behavior's (implements …): impl, the names, in order; implArgs, the arguments of each name
// that has some (the first (implements …) of a name counts).
function implOf(n) {
  n.impl = []; n.implArgs = Object.create(null); const seen = new Set();
  n.children.forEach(c => { if (c.form !== 'implements') return; n.impl.push(c.name); if (c.name && !seen.has(c.name) && c.args && c.args.length) n.implArgs[c.name] = c.args.slice(); seen.add(c.name); });
}
function prepMessage(m, ctx) {
  m.sketch = sketchOf(m); m.id = 'μ:' + m.name; m.levels = []; m.impl = []; m.ports = []; m._ctx = ctx; m.refs = refsOf(m);
  const r = m.children.find(c => c.form === 'refines'), k = m.children.find(c => c.form === 'carries');
  m.refines = r ? r.names[0] : null;
  // has-a: the types a value of m holds (only the first (carries …) counts; lint reports a second).
  m.carries = k ? [...new Set(k.names.filter(Boolean))] : [];
}
// A block's ports, or a behavior's: its own, then those of every behavior it implements, directly or
// through behaviors that implement others (each behavior once, depth first), with `via` the behavior that
// declares the port. Arguments flow down: (implements (Store Event)) gives Store's ports typed T the type
// Event, and a behavior's own parameter passed on, (behavior (Cache K) (implements (Store K))), is
// replaced in turn by what Cache's implementer passes. A parameter left without an argument stays itself.
function portsOf(b) {
  if (b.form === 'message') return [];
  return [...(b.form === 'block' ? b.ownPorts : b.ports), ...inheritedVia(b._ctx, b)];
}
function inheritedVia(model, n) {
  const out = [], seen = new Set(n.form === 'behavior' ? [n.name] : []);
  const walk = (x, env) => x.impl.forEach(name => {
    const bh = model.behaviors.get(name); if (!bh || seen.has(name)) return; seen.add(name);
    const args = (x.implArgs[name] || []).map(a => env.has(a) ? env.get(a) : a), sub = new Map();
    if (args.length) bh.params.forEach((p, i) => { if (p && i < args.length && args[i]) sub.set(p, args[i]); });
    bh.ports.forEach(p => out.push({ ...p, kind: sub.has(p.kind) ? sub.get(p.kind) : p.kind, via:name }));
    walk(bh, sub);
  });
  walk(n, new Map());
  return out;
}
// The behaviors n (a block or a behavior) implements, directly or through others, each once, depth first,
// declared ones only. A behavior on a cycle (A implements B implements A) lists itself; lint reports it.
function behaviorsOf(n) {
  const model = n._ctx, out = [], seen = new Set();
  const walk = x => x.impl.forEach(name => { const bh = model.behaviors.get(name); if (!bh || seen.has(name)) return; seen.add(name); out.push(name); walk(bh); });
  if (n.form !== 'message') walk(n);
  return out;
}
// Every block that implements behavior `name`, directly or through a behavior that implements it, in
// source order. The one "implementers of": scope and placement, the viewer's outline and its info cards.
function implementersOf(model, name) { return [...model.blocks.values()].filter(b => behaviorsOf(b).includes(name)).sort((p, q) => p.s - q.s); }
function childBlocks(b) { return b.levels.flatMap(L => L.units.flatMap(u => u.blocks)); }
function stats(b) {
  if (b._stats) return b._stats;
  let n = 0, d = 0; for (const c of childBlocks(b)) { const s = stats(c); n += 1 + s.n; d = Math.max(d, 1 + s.d); }
  return b._stats = { n, d };
}
function dotsOf(b, withChildren) {
  const seen = new Set(), res = { in:[], out:[] };
  // `at` is the id of the block or behavior that has the port (b itself, or a child for child dots).
  const add = (p, child, at) => { const k = p.dir + ':' + p.name + ':' + p.kind; if (seen.has(k) || !res[p.dir]) return; seen.add(k); res[p.dir].push({ ...p, child, at }); };
  portsOf(b).forEach(p => add(p, false, b.id));
  if (withChildren && b.form === 'block') { const walk = x => childBlocks(x).forEach(c => { portsOf(c).forEach(p => add(p, true, c.id)); walk(c); }); walk(b); }
  return res;
}
// Height of an open port drawer with n rows; layout and CSS both use it.
function drawerH(n) { return 32 + n * 23; }
// Can an input port of kind U accept values from an output port of kind T? The same kind, or T refines U
// (directly or through a chain).
function accepts(model, U, T) {
  if (!U || !T) return false;
  if (U === T) return true;
  for (let x = model.messages.get(T), i = 0; x && x.refines && i < 24; x = model.messages.get(x.refines), i++) if (x.refines === U) return true;
  return false;
}
// What a value of message m holds: its own (carries …) and, transitively, its supertypes' (a subtype
// carries what its supertype carries). Cycle-safe.
function carriedBy(model, m) {
  const out = new Set(), seen = new Set();
  for (let x = m; x && !seen.has(x); x = model.messages.get(x.refines)) { seen.add(x); x.carries.forEach(t => out.add(t)); }
  return [...out];
}
// Every message type that carries T, directly or through others (A carries B, B carries T), counting what
// subtypes inherit; T itself only when a cycle leads back to it. Then every port typed with one of them
// (own ports of blocks and behaviors, and the ports blocks get from behaviors) and the blocks with such a
// port. Cycle-safe. Returns { messages: names, ports: [{ owner, port }], blocks: ids }, in source order.
function carriers(model, T) {
  const all = [...model.messages.values()], hit = new Set(), queue = [T];
  while (queue.length) { const t = queue.shift(); all.forEach(m => { if (!hit.has(m.name) && carriedBy(model, m).includes(t)) { hit.add(m.name); queue.push(m.name); } }); }
  const msgs = all.filter(m => hit.has(m.name)).sort((a, b) => a.s - b.s), ports = [], blocks = [];
  model.behaviors.forEach(bh => bh.ports.forEach(p => { if (hit.has(p.kind)) ports.push({ owner:bh.id, port:p.name }); }));
  [...model.blocks.values()].sort((a, b) => a.s - b.s).forEach(b => { const ps = portsOf(b).filter(p => hit.has(p.kind)); ps.forEach(p => { if (!p.via) ports.push({ owner:b.id, port:p.name }); }); if (ps.length) blocks.push(b.id); });
  return { shapes:msgs.map(m => m.name), ports, blocks };
}
function portLabel(p) { return p.name && p.kind && p.name.toLowerCase() !== p.kind.toLowerCase() && p.name !== defaultPortName(p.kind) ? p.name + ': ' + p.kind : (p.kind || p.name || '?'); }
// The behavior badges of a card: a block's behaviors, or a behavior's (the ones it extends); direct ones only.
function behsOf(n) { return n.form === 'message' ? [] : n.impl.filter(x => n._ctx.behaviors.has(x)); }
// The count line in a collapsed card's footer (pure; layout measures it).
function countText(b) {
  const s = stats(b), parts = [];
  // Every block inside, at any depth: how much the block holds. Nesting depth says little, so it is not shown.
  if (s.n) parts.push(`${s.n} block${s.n === 1 ? '' : 's'}`);
  if (b.behaviorDecls.length) parts.push(`${b.behaviorDecls.length} behavior${b.behaviorDecls.length === 1 ? '' : 's'}`);
  if (b.messageDecls.length) parts.push(`${b.messageDecls.length} shape${b.messageDecls.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
// The name a card shows. A block's name is its identity and is unique in a spec, so a name is often
// written with what it belongs to in front: store/index inside store, slow-login/evidence beside
// slow-login. Where the picture already says that (the block is inside, or adjacent to, the block the
// prefix names), the card shows the rest. Moved elsewhere, it shows the whole name again.
function shownName(b) {
  if (!b || b.form !== 'block' || !b.name) return b ? b.name : '';
  let best = '';
  const near = c => { if (c && c !== b && c.name && c.name.length > best.length && b.name.length > c.name.length + 1 && b.name.startsWith(c.name + '/')) best = c.name; };
  for (let p = b.parent; p; p = p.parent) near(p);
  if (b.adj) b.adj.children.forEach(c => { if (c.form === 'block') near(c); });
  return best ? b.name.slice(best.length + 1) : b.name;
}
function hasInside(b) { return b.form === 'block' && (b.levels.length > 0 || b.behaviorDecls.length > 0 || b.messageDecls.length > 0); }
function ancestorsOrSelf(b) { const a = []; for (let x = b; x; x = x.parent) a.push(x); return a; }
// The block that holds b in its levels: its parent, or the file (model.root) for a top-level block.
function holderOf(b) { return b.parent || (b._ctx && b._ctx.root) || null; }
// Top-level blocks of a model, in source order.
function topBlocks(model) { return childBlocks(model.root); }
// @sbtel end Core.Model
// @sbtel begin Core.Bindings
// May code in block a bind (call, reference) code in block b? Ids are block ids. Allowed: the same block;
// b inside a (descendant). Forbidden: a inside b (ancestor: a part binding its whole). Else, with c the nearest common holder (a block or the
// file) and a2, b2 the children of c on the way down to a and b: a2's level is above b2's in c, or a2 and
// b2 are in the same adjacent group. Returns { ok, rule, text }; docs/DESIGN.md §3 lists the rules.
// A callee may also name a behavior: code that calls through an abstraction (an interface, a trait) binds
// the behavior, not its implementers. That is allowed when the behavior is in the caller's scope (declared
// in the caller, an ancestor, or the file): rule `abstraction`; out of scope it is `scope`.
function bindingVerdict(model, a, b) {
  const A = model.blocks.get(a), T = bindingTarget(model, b), B = T && T.form === 'block' ? T : null;
  const sees = d => { for (let x = A; x; x = x.parent) if (x === d) return true; return !d; };  // d's scope holds A
  if (A && T && T.form === 'behavior') return sees(T.owner) ? { ok:true, rule:'abstraction', text:'' }
    : { ok:false, rule:'scope', text:`${A.name} binds ${T.name}, declared in ${T.owner.name}: a behavior is used only inside the block that declares it` };
  if (!A || !B) return { ok:false, rule:'unknown', text: !A ? `${a} is not a block in the spec` : `${b} is not a block or a behavior in the spec` };
  if (A === B) return { ok:true, rule:'same', text:'' };
  const up = x => { const r = []; for (let y = x; y; y = y.parent) r.push(y); r.push(model.root); return r; };
  const PA = up(A), PB = up(B);
  if (PB.includes(A)) return { ok:true, rule:'descendant', text:'' };
  if (PA.includes(B)) return { ok:false, rule:'ancestor', text:`${A.name} is inside ${B.name}: a part may not bind to the block that encloses it` };
  const c = PA.find(x => PB.includes(x)), a2 = PA[PA.indexOf(c) - 1], b2 = PB[PB.indexOf(c) - 1];
  const where = x => { for (let li = 0; li < c.levels.length; li++) { const ui = c.levels[li].units.findIndex(u => u.blocks.includes(x)); if (ui >= 0) return { li, ui }; } return null; };
  const wa = where(a2), wb = where(b2), inC = c.virtual ? 'the file' : c.name;
  if (!wa || !wb) return { ok:false, rule:'unknown', text:`${(!wa ? a2 : b2).name} is not in a level of ${inC}` };
  if (wa.li < wb.li) return { ok:true, rule:'lower-level', text:'' };
  if (wa.li === wb.li && wa.ui === wb.ui) return { ok:true, rule:'adjacent', text:'' };
  // A level is named by its number, counted from the bottom (level 1 is the lowest, so a lower level has
  // a lower number), and by its :name when it has one: level 2 "Routing".
  const lv = li => 'level ' + (c.levels.length - li) + (c.levels[li].name ? ' ' + JSON.stringify(c.levels[li].name) : '');
  return wa.li === wb.li
    ? { ok:false, rule:'same-level', text:`${a2.name} and ${b2.name} share ${lv(wa.li)} of ${inC} but are not adjacent` }
    : { ok:false, rule:'upward', text:`${a2.name} (${lv(wa.li)} of ${inC}) binds upward to ${b2.name} (${lv(wb.li)})` };
}
// What a binding's callee names. Blocks and behaviors are separate namespaces: a block id first (exactly
// as written), then beh:Name or β:Name for a behavior, then a bare behavior name. So a name that is both a
// block's and a behavior's binds the block (check warns), and beh:Name binds the behavior.
function bindingTarget(model, name) {
  if (model.blocks.has(name)) return model.blocks.get(name);
  const m = /^(?:β|beh):(.+)$/.exec(name);
  return (m ? model.behaviors.get(m[1]) : model.behaviors.get(name)) || null;
}
// The bindings text (docs/DESIGN.md §2.5), shared by the CLI (api.js check) and the viewer (server mode).
// One edge per line: `Caller -> Callee`, then optionally whitespace, `#` and a free-text location. Blank
// lines and lines whose first non-blank character is `#` are ignored. Lines end in \n, \r\n or \r; a
// leading BOM is dropped. The location starts at the first `#` preceded by whitespace, so it may contain
// `->` and `#`; the edge part before it holds exactly one `->` (A -> B -> C is invalid).
// An explanation: a comment line `# VIOLATION: reason` in the run of comment lines directly above an
// edge (no blank line or edge between) is that edge's note; the comment lines after it in the run
// continue it. A note that reaches a blank line, a line that is not an edge, another note or the end of
// the file explains nothing: it is listed in `orphans`, with the line of its `# VIOLATION:` and why
// ('blank', 'note', 'invalid' or 'end').
// Returns { edges: [{ line, caller, callee, location|null, note|null }], invalid: [{ line, text }],
// orphans: [{ line, note, why }] }.
function parseBindings(text) {
  const edges = [], invalid = [], orphans = [];
  let note = null, noteLine = 0;
  const drop = why => { if (note !== null) orphans.push({ line: noteLine, note, why }); note = null; };
  String(text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).forEach((l, i, all) => {
    if (/^\s*$/.test(l)) { drop(all.slice(i).every(x => /^\s*$/.test(x)) ? 'end' : 'blank'); return; }
    const c = /^\s*#(.*)$/.exec(l);
    if (c) {
      const v = /^\s*VIOLATION:\s*(.*)$/.exec(c[1]);
      if (v) { drop('note'); note = v[1].trim(); noteLine = i + 1; } else if (note !== null) note = (note + ' ' + c[1].trim()).trim();
      return;
    }
    const h = /\s#/.exec(l), edge = (h ? l.slice(0, h.index) : l).trim(), loc = h ? l.slice(h.index + 2).trim() : '';
    const m = /^(\S+?)\s*->\s*(\S+)$/.exec(edge);
    if (!m || m[2].includes('->')) { invalid.push({ line: i + 1, text: l }); drop('invalid'); return; }
    edges.push({ line: i + 1, caller: m[1], callee: m[2], location: loc || null, note });
    note = null;
  });
  drop('end');
  return { edges, invalid, orphans };
}
// @sbtel end Core.Bindings
// @sbtel begin Core.Model

// Message index: who declares each type and which ports use it.
function messageIndex(model) {
  const uses = new Map(); const add = (k, u) => { if (!uses.has(k)) uses.set(k, []); uses.get(k).push(u); };
  model.blocks.forEach(b => b.ownPorts.forEach(p => add(p.kind, { id:b.id, name:b.name, port:p.name, dir:p.dir })));
  model.behaviors.forEach(bh => bh.ports.forEach(p => add(p.kind, { id:bh.id, name:bh.name, port:p.name, dir:p.dir, beh:true })));
  return [...model.messages.values()].map(m => ({ name:m.name, node:m, owner:m.owner, sketch:m.sketch, refines:m.refines,
    uses: uses.get(m.name) || [],
    refinedBy: [...model.messages.values()].filter(x => x.refines === m.name).map(x => x.name) }));
}

// @sbtel end Core.Model
// @sbtel begin Core.Lint
// ---------- Spec checks (language rules, independent of layout) ----------
// Uses of a behavior or message type outside the block that declares it (a declaration's owner, or the
// file for owner = null, which every node is inside). Each: { k, who, kind, name, owner, text }; `who` is
// the block or behavior that depends on it. lintSpec reports them; drags compare them before and after.
function scopeFailures(model) {
  const out = [], inScope = (d, where) => !d.owner || (where && ancestorsOrSelf(where).includes(d.owner));
  const add = (k, who, kind, name, owner, text) => out.push({ k, who, kind, name, owner, text });
  // What a block or behavior implements must be visible where it is (a behavior: where it is declared),
  // and so must the message types it passes as arguments.
  const impls = (n, who, where) => n.impl.forEach(x => { const bh = model.behaviors.get(x); if (!bh) return;
    if (!inScope(bh, where)) add('scope', who, 'behavior', x, bh.owner.name, `${who} uses ${x}, declared in ${bh.owner.name}`);
    (n.implArgs[x] || []).forEach(t => { const m = n.form === 'behavior' && n.params.includes(t) ? null : model.messages.get(t);
      if (m && !inScope(m, where)) add('mscope', who, 'shape', t, m.owner.name, `${who} passes ${t} to ${x}, declared in ${m.owner.name}`); }); });
  model.blocks.forEach(b => {
    impls(b, b.name, b);
    b.ownPorts.forEach(p => { const m = model.messages.get(p.kind); if (m && !inScope(m, b)) add('mscope', b.name, 'shape', p.kind, m.owner.name, `${b.name}.${p.name} uses ${p.kind}, declared in ${m.owner.name}`); });
  });
  model.behaviors.forEach(bh => bh.ports.forEach(p => { const m = bh.params.includes(p.kind) ? null : model.messages.get(p.kind);
    if (m && !inScope(m, bh.owner)) add('mscope', bh.name, 'shape', p.kind, m.owner.name, `${bh.name}.${p.name} uses ${p.kind}, declared in ${m.owner.name}`); }));
  model.behaviors.forEach(bh => impls(bh, bh.name, bh.owner));
  // A carried type must be visible where the carrying message is declared, as a port's type must.
  model.messages.forEach(m => m.carries.forEach(t => { const d = model.messages.get(t);
    if (d && !inScope(d, m.owner)) add('mscope', m.name, 'shape', t, d.owner.name, `${m.name} carries ${t}, declared in ${d.owner.name}`); }));
  return out;
}
// Why an edit that turns src0's model into m1 would break the spec, or '' if it breaks nothing new.
// `moved` is the node being moved: its own (and its descendants') dependencies say "move X first";
// a moved declaration that others depend on says it would leave their reach.
function newFailureText(m0, m1, moved) {
  const old = new Set(scopeFailures(m0).map(f => f.text)), seen = new Set(), fresh = [];
  scopeFailures(m1).forEach(f => { const key = f.who + '|' + f.kind + '|' + f.name; if (!old.has(f.text) && !seen.has(key)) { seen.add(key); fresh.push(f); } });
  if (!fresh.length) {
    const before = new Set(lintSpec(m0).flatMap(c => c.f)), added = lintSpec(m1).flatMap(c => c.f).filter(t => !before.has(t));
    return added.length ? `That would break a spec check: ${added[0]}.${added.length > 1 ? ` (+${added.length - 1} more)` : ''}` : '';
  }
  const f = fresh[0], dep = f.kind === 'behavior' ? `depends on behavior ${f.name}` : `uses shape ${f.name}`;
  const isDecl = moved && moved.form !== 'block' && moved.name === f.name && (moved.form === 'behavior') === (f.kind === 'behavior');
  const text = isDecl ? `${f.who} ${dep}, which would be out of its reach in ${f.owner}. Keep ${f.name} in a block that holds ${f.who}.`
    : `${f.who} ${dep} (declared in ${f.owner}). Move ${f.name} first.`;
  return text + (fresh.length > 1 ? ` (+${fresh.length - 1} more)` : '');
}
function lintSpec(model) {
  const unknownBeh = [], unknownMsg = [], badRel = [], cycles = [];
  // An argument names a message type, or (in a behavior) one of its own parameters.
  const args = (n, who) => n.impl.forEach(x => (n.implArgs[x] || []).forEach(t => {
    if (t && !model.messages.get(t) && !(n.form === 'behavior' && n.params.includes(t))) unknownMsg.push(`${who} (implements (${x} ${n.implArgs[x].join(' ')})): ${t}`); }));
  model.blocks.forEach(b => {
    b.impl.forEach(n => { if (!model.behaviors.get(n)) unknownBeh.push(b.name + ' → ' + n); });
    b.ownPorts.forEach(p => { if (p.kind && !model.messages.get(p.kind)) unknownMsg.push(`${b.name}.${p.name}: ${p.kind}`); });
    args(b, b.name);
  });
  model.behaviors.forEach(bh => bh.ports.forEach(p => { if (p.kind && !model.messages.get(p.kind) && !bh.params.includes(p.kind)) unknownMsg.push(`${bh.name}.${p.name}: ${p.kind}`); }));
  model.behaviors.forEach(bh => { bh.impl.forEach(n => { if (!model.behaviors.get(n)) unknownBeh.push(bh.name + ' → ' + n); }); args(bh, bh.name); });
  // A behavior that implements itself, through any chain: one failure per cycle, from its first behavior
  // in source order (A → B → A).
  const onCycle = new Set();
  [...model.behaviors.values()].sort((p, q) => p.s - q.s).forEach(bh => {
    if (onCycle.has(bh.name) || !behaviorsOf(bh).includes(bh.name)) return;
    const path = [bh.name], find = (x, seen) => { for (const n of x.impl) { if (n === bh.name) return true; const y = model.behaviors.get(n); if (!y || seen.has(n)) continue; seen.add(n); path.push(n); if (find(y, seen)) return true; path.pop(); } return false; };
    find(bh, new Set([bh.name])); path.forEach(n => onCycle.add(n)); cycles.push([...path, bh.name].join(' → '));
  });
  const sf = scopeFailures(model), scope = sf.filter(f => f.k === 'scope').map(f => f.text), mscope = sf.filter(f => f.k === 'mscope').map(f => f.text);
  model.messages.forEach(m => { [m.refines, ...m.carries].filter(Boolean).forEach(n => { if (!model.messages.has(n)) badRel.push(`${m.name} → ${n}`); }); });
  return [
    { k:'beh', label:'Every implemented behavior is declared', f:unknownBeh },
    { k:'scope', label:'Behaviors are used only inside the block that declares them', f:scope },
    { k:'msg', label:'Every port uses a declared shape', f:unknownMsg },
    { k:'mscope', label:'Shapes are used only inside the block that declares them', f:mscope },
    { k:'rel', label:'refines and carries name declared types', f:badRel },
    { k:'cycle', label:'No behavior implements itself', f:cycles },
  ];
}

// Placement (informational): vocabulary belongs at the lowest common ancestor (LCA) of what uses it.
// Users of a message type T: blocks with a port of type T (inherited ones too); blocks with a port of a
// message that carries T (carriers) or that refines T; and the places that must see T: where each such
// message, and each behavior with a port of one of them, is declared. Users of a behavior: the blocks that implement it.
// The file (model.root) is the top. A declaration strictly above the LCA could move down to it; one with
// no users is never used. Below the LCA is a scope failure, reported by lintSpec, so never suggested here.
// Returns [{ kind: 'shape'|'behavior', name, id, s (offset of the declaration), in (block id, '' for the
// file), home (block id, '' for the file) | null, text }] in source order.
function placementFindings(model) {
  const root = model.root, at = n => n || root, out = [];
  const chain = b => { const r = []; for (let x = b; x; x = x.parent) r.unshift(x); if (r[0] !== root) r.unshift(root); return r; };
  const lca = users => { let c = null; users.forEach(u => { const ch = chain(u); if (!c) c = ch; else { let i = 0; while (i < c.length && i < ch.length && c[i] === ch[i]) i++; c = c.slice(0, i); } }); return c ? c[c.length - 1] : null; };
  const where = n => n === root ? 'the top level' : n.name;
  const judge = (d, kind, users) => {
    if (!d.name) return;
    const D = at(d.owner), L = lca(users), id = kind === 'shape' ? 'μ:' + d.name : 'β:' + d.name;
    if (!users.length) { out.push({ s:d.s, kind, name:d.name, id, in:D.id, home:null, text:`${d.name} is never used.` }); return; }
    if (L !== D && chain(L).includes(D)) out.push({ s:d.s, kind, name:d.name, id, in:D.id, home:L.id, text:`${d.name} is declared ${D === root ? 'at the top level' : 'in ' + D.name} but only used within ${where(L)}; it could live there.` });
  };
  // A subtype stands for its supertype (a port of the subtype uses the supertype's vocabulary), so the
  // subtypes of T and what carries them count as T too.
  const subs = name => { const out = new Set([name]); let grow = true; while (grow) { grow = false; model.messages.forEach(x => { if (x.refines && out.has(x.refines) && !out.has(x.name)) { out.add(x.name); grow = true; } }); } return out; };
  model.messages.forEach(m => {
    const kinds = new Set(); subs(m.name).forEach(t => { kinds.add(t); carriers(model, t).shapes.forEach(c => kinds.add(c)); });
    const users = [];
    model.blocks.forEach(b => { if (portsOf(b).some(p => kinds.has(p.kind))) users.push(b); });
    model.messages.forEach(x => { if (x !== m && kinds.has(x.name)) users.push(at(x.owner)); });
    model.behaviors.forEach(bh => { if (bh.ports.some(p => kinds.has(p.kind) && !bh.params.includes(p.kind)) || bh.impl.some(x => (bh.implArgs[x] || []).some(t => kinds.has(t)))) users.push(at(bh.owner)); });
    judge(m, 'shape', users);
  });
  // Users of a behavior B: its implementers, through other behaviors too, and the places where each
  // behavior that implements B directly is declared (B must be visible there).
  model.behaviors.forEach(bh => judge(bh, 'behavior', [...implementersOf(model, bh.name),
    ...[...model.behaviors.values()].filter(x => x !== bh && x.impl.includes(bh.name)).map(x => at(x.owner))]));
  return out.sort((p, q) => p.s - q.s);
}
// @sbtel end Core.Lint
// @sbtel begin Core.Layout
// ---------- Layout (pure: tree + open/detail sets + rules + text measure -> geometry) ----------
// The text measurer layout calls through: the abstraction the page's measurer implements (the page passes
// its M; diff mode wraps it). The core never names an implementation, so it stays free of the DOM.
// @sbtel begin MeasuresText
/** @typedef {{ tw: (text: string, font: string) => number, wrap: (text: string, font: string, width: number) => number }} MeasuresText */
// @sbtel end MeasuresText
/** @param {MeasuresText} M  how wide a text is (tw) and how many lines it wraps to (wrap), in a CSS font */
function layout(model, opts, M) {
  setSpace(opts.space);
  if (SPACE_WIDTH[opts.space] && opts.width) opts = { ...opts, width: opts.width * SPACE_WIDTH[opts.space] };
  const out = { blocks:[], connectors:[], dividers:[], bands:[], gutters:[], plus:[], levels:[], loc:new Map() };
  const isOpen = b => opts.open.has(b.id) && hasInside(b);
  const det = n => opts.allDetails || opts.details.has(n.id);
  const memo = new Map();
  const chipW = t => Math.ceil(M.tw(t, FONT.chip)) + 34;
  const bchipW = t => Math.ceil(M.tw(t, FONT.chip)) + 40;
  const line = ws => ws.reduce((s, x) => s + x, 0) + 6 * Math.max(0, ws.length - 1);
  const rowsOf = (ws, avail) => { if (!ws.length) return 1; let r = 1, x = 0; ws.forEach((w, i) => { if (!i) x = w; else if (x + 6 + w > avail) { r++; x = w; } else x += 6 + w; }); return r; };
  const rowsH = r => r * 24 + (r - 1) * 5;
  const portsFor = n => dotsOf(n, opts.childDots);
  const ext = n => {
    // A message card's only ear is below it: one dot per carried type, when it carries any.
    if (n.form === 'message') return { t:0, b:carriedBy(n._ctx, n).length ? K.TAB : 0 };
    const dr = opts.drawers && opts.drawers.get(n.id); if (!dr) return { t:K.TAB, b:K.TAB };
    const d = dotsOf(n, opts.childDots);
    return { t: dr.top && d.in.length ? drawerH(d.in.length) : K.TAB, b: dr.bot && d.out.length ? drawerH(d.out.length) : K.TAB };
  };

  function topRow(n, inner, detailed) {
    // The row above the title holds the behaviors a block implements. Its :type stands beside its name.
    const bs = behsOf(n);
    if (!bs.length) return { h:0 };
    if (!detailed) return { h:26 };
    const bw = bs.map(bchipW);
    if (line(bw) <= inner) return { h:30 };
    return { h:rowsH(rowsOf(bw, inner)) + 6 };
  }
  function cardMetrics(n, availW) {
    const isB = n.form === 'behavior', isM = n.form === 'message', d = det(n);
    const pillW = n.type ? M.tw(n.type, FONT.pill) + 21 : 0, bs = behsOf(n); // the type, its dot and the gap before them
    const tW = M.tw(shownName(n) || n.name, FONT.title) + (isB ? 27 : isM ? 20 : 0) + pillW;
    // The collapsed footer (open arrow plus counts) also asks for room, within the card maximum.
    const footText = hasInside(n) ? countText(n) : isM && n.refines ? 'refines ' + n.refines : '';
    const footW = footText ? M.tw(footText, isM ? FONT.chip : FONT.foot) + (isM ? 0 : 24) : 0;
    let w = Math.min(K.CARD_MAX, Math.max(K.CARD_MIN, Math.ceil(Math.max(tW, bs.length * 26 + 10, footW) + 54)));
    const P = d ? portsFor(n) : null;
    let iw = [], ow = [];
    if (d) {
      iw = P.in.map(p => chipW(portLabel(p))); ow = P.out.map(p => chipW(portLabel(p)));
      const want = 36 + K.LABEL + Math.max(line(iw), line(ow));
      const wantTop = 36 + line(bs.map(bchipW));
      w = Math.min(K.DETAIL_MAX, Math.max(w, 300, want, wantTop));
    }
    w = Math.min(w, availW);
    const inner = w - 36;
    const top = topRow(n, inner, d);
    // A clipped sketch shows all its lines while its id is in opts.expanded.
    // A phrase for a name wraps when it does not fit on one line, to three lines at most; a one-word
    // name never wraps (it is cut with an ellipsis, as before).
    const phrase = !isB && !isM && /\s/.test(n.name) && tW > inner;
    const tl = phrase ? Math.min(3, Math.max(1, M.wrap((shownName(n) || n.name) + (n.type ? ' ' + n.type + ' ·' : ''), FONT.title, inner))) : 1;
    const full = n.sketch ? M.wrap(n.sketch, FONT.sketch, inner - 4) : 0, clip = d ? 4 : 2;
    // A paragraph break is drawn half a line tall. A sketch too long for the card is clipped to whole lines, without breaks.
    const gapsAll = n.sketch ? paraGaps(n.sketch) : 0, tight = full - gapsAll;
    const whole = (opts.expanded && opts.expanded.has(n.id)) || tight <= clip;
    const lines = whole ? tight : clip, gaps = whole ? gapsAll : 0;
    const inH = d ? rowsH(rowsOf(iw, inner - K.LABEL)) : 0, outH = d ? rowsH(rowsOf(ow, inner - K.LABEL)) : 0;
    // A footer that still does not fit wraps to a second line, and the card grows to show it.
    const footLines = footText ? (isM ? M.wrap(footText, FONT.chip, inner - 4) : M.wrap(footText, FONT.foot, inner - 24 - 4)) : 0;
    const foot = footText ? 26 + Math.max(0, footLines - 1) * 17 : 0;
    const h = 14 + top.h + 24 + (tl - 1) * 22 + (d ? inH + 6 : 0) + (lines ? lines * 18 + gaps * 9 + 4 : 0) + (d ? outH + 6 : 0) + (foot ? foot + 4 : 0) + 12;
    return { w, h:Math.max(h, 84), lines, gaps, more: tight > clip, top, inH, outH, foot, d, tl };
  }
  function headerMetrics(b, inner) {
    const top = topRow(b, inner, true), P = portsFor(b);
    let y = 18 + top.h + 30;
    const full = b.sketch ? M.wrap(b.sketch, FONT.hsketch, Math.min(inner, 640) - 4) : 0, gapsAll = b.sketch ? paraGaps(b.sketch) : 0;
    const whole = full - gapsAll <= 4, lines = whole ? full - gapsAll : 4, gaps = whole ? gapsAll : 0;
    if (lines) y += lines * 20 + gaps * 10 + 6;
    y += 24 + 16;
    return { h:y, top, lines, gaps };
  }
  function maxContent(b) {
    if (memo.has(b)) return memo.get(b);
    let v;
    if (!isOpen(b)) v = cardMetrics(b, 1e9).w;
    else {
      let best = Math.max(M.tw(shownName(b), FONT.htitle) + 90, K.MIN_EXP);
      [...b.behaviorDecls, ...b.messageDecls].forEach(x => best = Math.max(best, cardMetrics(x, 1e9).w));
      b.levels.forEach(L => { const items = L.units.flatMap(u => u.blocks); best = Math.max(best, items.reduce((s, c) => s + maxContent(c), 0) + K.GAPX * (items.length - 1)); });
      v = 2 * K.PAD + best;
    }
    memo.set(b, v); return v;
  }
  function card(n, availW, depth) {
    const m = cardMetrics(n, availW);
    return { w:m.w, h:m.h, emit(ox, oy) { out.blocks.push({ id:n.id, node:n, kind:'card', depth, x:ox, y:oy, w:m.w, h:m.h, m }); } };
  }
  // Rows of items placed left to right, wrapping at `inner`. Shared by levels and the behaviors band.
  // ---------- A level's grid ----------
  // A level is laid out in three steps, each resting on the one before:
  //   a flow gives every item a cell (it.row, it.col) and its x, and says how many rows there are;
  //   gridTracks turns the rows into tops and heights;
  //   the level (layoutLevel) emits the boxes and the lines between linked items (its link()).
  // The two flows keep one contract, so everything after them is shared. flowRows goes across and wraps
  // down, as text does; flowCols goes down and wraps across, like a newspaper's columns.
  const unitWidth = U => U.items.reduce((s, it) => s + it.ow, 0) + K.GAPX * (U.items.length - 1);
  function flowRows(units, inner, wrapRule) {
    let row = 0, col = 0, rw = 0;
    const wrap = () => { row++; col = 0; rw = 0; };
    units.forEach(U => {
      // keep: a linked group that fits on a row is not broken across two.
      if (wrapRule === 'keep' && U.items.length > 1) { const uw = unitWidth(U); if (col && rw + K.GAPX + uw > inner && uw <= inner) wrap(); }
      U.items.forEach(it => {
        if (col && rw + K.GAPX + it.ow > inner) wrap();
        it.x = col ? rw + K.GAPX : 0; rw = it.x + it.ow; it.row = row; it.col = col++; it.seg = 0;
      });
    });
    return row + 1;
  }
  // Down, then across. The level is cut into stretches at every item too wide to have anything beside it
  // (an open block that fills the line): such an item takes a line to itself, and the columns start again
  // under it. Within a stretch: as many rows as flowRows needs at this width, filled a column at a time, and
  // one more row, and again, while the columns are wider than the room. A column is as wide as its widest
  // item. Each item gets its stretch (it.seg) with its cell; rows count on from one stretch to the next.
  function flowCols(units, inner, wrapRule) {
    const items = units.flatMap(U => U.items), n = items.length; if (!n) return 1;
    const alone = it => items.every(o => o === it || it.ow + K.GAPX + o.ow > inner);
    const stretches = []; let open = null;
    units.forEach(U => { let part = null;
      U.items.forEach(it => {
        if (alone(it)) { stretches.push([{ items:[it] }]); open = part = null; return; }
        if (!open) stretches.push(open = []);
        if (!part) open.push(part = { items:[] });
        part.items.push(it);
      });
    });
    let rowBase = 0;
    stretches.forEach((us, seg) => {
      const its = us.flatMap(U => U.items);
      const fill = R => {
        let col = 0, row = 0; const next = () => { col++; row = 0; };
        us.forEach(U => {
          // keep: a linked group that fits in a column is not broken across two.
          if (wrapRule === 'keep' && U.items.length > 1 && row && row + U.items.length > R && U.items.length <= R) next();
          U.items.forEach(it => { if (row >= R) next(); it.col = col; it.row = rowBase + row++; it.seg = seg; });
        });
        const colW = []; its.forEach(it => { colW[it.col] = Math.max(colW[it.col] || 0, it.ow); });
        let x = 0; const colX = colW.map(w => { const at = x; x += w + K.GAPX; return at; });
        its.forEach(it => { it.x = colX[it.col]; });
        return x - K.GAPX;
      };
      let R = Math.min(its.length, flowRows(us, inner, wrapRule));
      while (fill(R) > inner && R < its.length) R++;
      rowBase = Math.max(...its.map(it => it.row)) + 1;
    });
    return rowBase;
  }
  // Each row's top and height, from its tallest item and the ears that stick out of it; rows are aligned
  // across the level, whichever flow filled them.
  function gridTracks(items, nRows) {
    const rows = Array.from({ length:nRows }, () => []); items.forEach(it => rows[it.row].push(it));
    const borrow = K.ROWGAP - 12;
    const rowTop = rows.map((r, i) => Math.max(...r.map(it => it.t), 0) - (i ? borrow : 0)).map((v, i) => Math.max(v, Math.max(...rows[i].map(it => Math.min(it.t, K.TAB)))));
    const rowH = rows.map((r, i) => rowTop[i] + Math.max(...r.map(it => it.ch + it.be)));
    const rowY = []; let y = 0; rowH.forEach((h, i) => { rowY.push(y); y += h + (i < rowH.length - 1 ? K.ROWGAP : 0); });
    return { rowH, rowY, rowTop, h:y };
  }
  function placeItems(units, inner, wrapRule, flow) {
    return gridTracks(units.flatMap(U => U.items), (flow === 'cols' ? flowCols : flowRows)(units, inner, wrapRule));
  }

  // Behaviors and message types sit in bands below the levels: they are the vocabulary the levels are written in.
  function bandOf(list, inner, depth, label) {
    if (!list.length) return null;
    const items = list.map(n => { const sub = card(n, inner, depth), e = ext(n); return { n, sub, t:e.t, be:e.b, ch:sub.h, ow:sub.w }; });
    const r = placeItems(items.map(it => ({ items:[it] })), inner, 'free', 'rows');
    return { items, r, label, h:K.BANDLAB + r.h };
  }
  function layoutBlock(b, availW, depth) {
    if (!b.virtual && !isOpen(b)) return card(b, availW, depth);
    // The file (virtual root): no frame, header or padding; its levels sit on the canvas at the origin.
    const pad = b.virtual ? 0 : K.PAD;
    const desired = opts.expandWidth === 'fill' || b.virtual ? availW : maxContent(b);
    const W = b.virtual ? availW : Math.min(availW, Math.max(K.MIN_EXP, desired));
    const inner = W - 2 * pad;
    const hdr = b.virtual ? { h:16, top:{ h:0 }, lines:0 } : headerMetrics(b, inner);
    // A named first level gets a header row of its own (its label and line), so it starts a little lower.
    let y = hdr.h + (b.levels.length && b.levels[0].name ? K.NAMEGAP : 0);
    const placed = [];
    b.levels.forEach((L, i) => { const r = layoutLevel(L, inner, depth + 1); placed.push({ L, r, y }); y += r.h; if (i < b.levels.length - 1) y += K.LEVELGAP; });
    const levelsEnd = y;
    const bands = [bandOf(b.behaviorDecls, inner, depth + 1, 'Behaviors'), bandOf(b.messageDecls, inner, depth + 1, 'Shapes')].filter(Boolean);
    if (bands.length) { if (placed.length) y += K.BANDGAP; bands.forEach((bd, i) => { bd.y = y; y += bd.h + (i < bands.length - 1 ? 24 : 0); }); }
    y += 6; const outY = y;
    const H = y + (b.virtual ? 16 : K.PAD);
    return { w:W, h:H, emit(ox, oy) {
      const appendixY = bands.length ? (placed.length ? levelsEnd + K.BANDGAP / 2 + 4 : bands[0].y - 14) : null;
      if (!b.virtual) out.blocks.push({ id:b.id, node:b, kind:'frame', depth, x:ox, y:oy, w:W, h:H, hdr, outY, bandLabs: bands.map(bd => ({ y:bd.y, text:bd.label })), appendixY });
      else out.canvas = { w:W, h:H, appendixY, bandLabs: bands.map(bd => ({ y:bd.y, text:bd.label })) };
      const x1 = ox + pad, x2 = ox + W - pad;
      // Separators are keyed by their block and position, so each keeps its element across relayouts and
      // slides to its new place; inserting a level adds one at the end, which fades in.
      // Separators carry the level below them (act.at), whose :name labels the line. The first level has no
      // line unless it is named: then its header row is a separator keyed '|0'; otherwise a hover gutter.
      if (placed.length && b.levels[0].name) out.dividers.push({ key:b.id + '|0', top:true, x1, x2, y: oy + placed[0].y - 12, act:{ t:'level', block:b, at:0 } });
      else if (placed.length) out.gutters.push({ key:b.id + '|start', x1, x2, y: oy + placed[0].y - 12, act:{ t:'level', block:b, at:0 } });
      placed.forEach((p, i) => {
        p.r.emit(x1, oy + p.y, b);
        if (i < placed.length - 1) out.dividers.push({ key:b.id + '|' + (i + 1), x1, x2, y: oy + p.y + p.r.h + K.LEVELGAP / 2, act:{ t:'level', block:b, at:i + 1 } });
      });
      out.gutters.push({ key:b.id + '|end', x1, x2, y: placed.length ? oy + levelsEnd + 8 : oy + hdr.h - 6, act:{ t:'level', block:b, at:placed.length } });
      bands.forEach(bd => {
        const its = bd.items.map((it, i) => { const bx = x1 + it.x, by = oy + bd.y + K.BANDLAB + bd.r.rowY[it.row] + bd.r.rowTop[it.row]; it.sub.emit(bx, by);
          return { id:it.n.id, order:i, row:it.row, gid:null, box:{ x:bx, y:by - it.t, w:it.sub.w, h:it.sub.h + it.t + it.be } }; });
        out.levels.push({ key:b.id + ':' + bd.label, band:true, container:b, x1, x2, top:oy + bd.y, bottom:oy + bd.y + bd.h, items:its });
        const lastIt = bd.items[bd.items.length - 1], lb = its[its.length - 1].box, form = lastIt.n.form;
        // Centred on the cards of the band's last row (card tops and bottoms, not ears).
        const rowIts = bd.items.map((it, i) => ({ it, b:its[i].box })).filter(q => q.it.row === lastIt.row);
        const cy = (Math.min(...rowIts.map(q => q.b.y + q.it.t)) + Math.max(...rowIts.map(q => q.b.y + q.it.t + q.it.sub.h))) / 2;
        out.plus.push({ x: Math.min(lb.x + lb.w + 22, x2 + (b.virtual ? -11 : K.PAD / 2)), y: cy,
          act:{ t:'decl', block:b, form }, title: form === 'behavior' ? 'Add a behavior' : 'Add a shape' });
      });
    } };
  }

  function layoutLevel(L, inner, depth) {
    const units = L.units.map((u, ui) => ({ u, ui, gid: u.blocks.length > 1 ? L.key + ':' + ui : null, items: u.blocks.map((b, bi) => {
      const sub = layoutBlock(b, inner, depth), e = ext(b); return { b, bi, ui, sub, ow: sub.w, ch: sub.h, t:e.t, be:e.b };
    }) }));
    units.forEach(U => U.items.forEach(it => it.gid = U.gid));
    const cols = opts.flow === 'cols', { rowH, rowY, rowTop, h } = placeItems(units, inner, opts.wrap, cols ? 'cols' : 'rows');
    const all = units.flatMap(U => U.items);
    return { h, emit(ox, oy, container) {
      all.forEach(it => {
        it.cx0 = ox + it.x; it.cy0 = oy + rowY[it.row] + rowTop[it.row]; it.w = it.sub.w; it.h = it.sub.h;
        it.cx = it.cx0 + it.w / 2;
        it.sub.emit(it.cx0, it.cy0);
        const d = dotsOf(it.b, opts.childDots); it.hasIn = d.in.length > 0; it.hasOut = d.out.length > 0;
        out.loc.set(it.b.id, { L, ui:it.ui, bi:it.bi });
      });
      out.levels.push({ key:L.key, container, x1:ox, x2:ox + inner, top:oy, bottom:oy + h, flow: cols ? 'cols' : 'rows',
        items: all.map((it, i) => ({ id:it.b.id, order:i, row:it.row, col:it.col, seg:it.seg, gid:it.gid, box:{ x:it.cx0, y:it.cy0 - it.t, w:it.w, h:it.h + it.t + it.be } })) });
      // The line between two linked items, by where their cells are. Side by side: straight across (or, when
      // the two are on different rows, out to the gap between their columns and across there). One above
      // the other: from under the upper one's ear to over the lower one's, by the gap between their rows.
      const sideways = (s, b) => {
        const sx = s.cx0 + s.w, mx = b.cx0 - K.GAPX / 2;
        if (s.row === b.row) { const yy = s.cy0 + Math.min(Math.min(s.h, b.h) / 2, 64); return [[sx, yy], [b.cx0, yy]]; }
        const sy = s.cy0 + Math.min(s.h / 2, 64), ey = b.cy0 + Math.min(b.h / 2, 64);
        return [[sx, sy], [mx, sy], [mx, ey], [b.cx0, ey]];
      };
      const downward = (s, b) => {
        const sx = s.cx, sy = s.cy0 + s.h + (s.hasOut ? s.be : 0), ex = b.cx, ey = b.cy0 - (b.hasIn ? b.t : 0);
        // The turn is made in the gap under the upper one's row, or (a later stretch) in the gap over the lower one's.
        const mid = s.seg === b.seg ? oy + rowY[s.row] + rowH[s.row] + 6 : oy + rowY[b.row] - K.ROWGAP / 2;
        return Math.abs(sx - ex) < 1 ? [[sx, sy], [ex, ey]] : [[sx, sy], [sx, mid], [ex, mid], [ex, ey]];
      };
      // A group broken by a wrap is tied back to the line before (opts.vlink): its own previous member, its
      // nearest member there, or the nearest block there of any group.
      const from = (U, a, b, line, near) => {
        const cands = opts.vlink === 'pred' ? [a] : (opts.vlink === 'any' ? all : U.items).filter(i => line(i) === line(b) - 1);
        return cands.reduce((m, c) => (near(c) < near(m) ? c : m), cands[0]) || a;
      };
      const link = (U, a, b) => {
        if (!cols) { if (a.row === b.row) return [a, sideways(a, b)]; const s = from(U, a, b, i => i.row, c => Math.abs(c.cx - b.cx)); return [s, downward(s, b)]; }
        if (a.col === b.col || a.seg !== b.seg) return [a, downward(a, b)];   // under it, or in the stretch below
        const s = from(U, a, b, i => i.col, c => Math.abs(c.row - b.row)); return [s, sideways(s, b)];
      };
      units.forEach(U => {
        if (!U.gid) return;
        for (let k = 1; k < U.items.length; k++) {
          const a = U.items[k - 1], b = U.items[k], [src, pts] = link(U, a, b);
          out.connectors.push({ pts, a:src.b.id, b:b.b.id, ga:src.gid, gb:b.gid, cut:{ t:'split', L, ui:b.ui, at:b.bi } });
        }
      });
      const lastIt = all[all.length - 1], rowIts = cols ? [lastIt] : all.filter(it => it.row === lastIt.row);
      // Centred on the cards of the level's last row, beside its last card.
      const cy = (Math.min(...rowIts.map(it => it.cy0)) + Math.max(...rowIts.map(it => it.cy0 + it.h))) / 2;
      out.plus.push({ x: Math.min(lastIt.cx0 + lastIt.w + 22, ox + inner + (container && container.virtual ? -11 : K.PAD / 2)), y: cy, act:{ t:'append', L }, title:'Add a block to this level' });
    } };
  }

  const top = layoutBlock(model.root, opts.width, 0);
  top.emit(0, 0);
  // The drawing's size: the canvas width, or narrower when nothing reaches that far.
  const right = Math.max(K.MIN_EXP, ...out.blocks.map(B => B.x + B.w), ...out.levels.flatMap(L => L.items.map(it => it.box.x + it.box.w)));
  out.size = { w:Math.min(top.w, Math.ceil(right)), h:top.h };
  // Top-level dividers and gutters span the drawing, not the whole available canvas width.
  [...out.dividers, ...out.gutters].forEach(v => { if (v.act.block.virtual) v.x2 = Math.min(v.x2, out.size.w); });
  out.checks = runChecks(out);
  return out;
}
// What a layout draws, as a box in its own coordinates: { x, y, w, h }, or null. With an id, that block's
// card with the ears it draws; without one, the union of every card with its ears, the level lines with
// their names (10px either side), the file's appendix band and, with plus, the + buttons (radius 11).
// Hover-only gutters are left out. A level item's box keeps room for both ears; an ear is drawn only
// where the block has ports (its own or, as the viewer draws them, its children's), and a message's item
// box is already exact. Embed mode fits to this box (docs/DESIGN.md §6.9).
function contentBox(lay, id, plus) {
  if (!lay) return null;
  const items = new Map();
  lay.levels.forEach(L => L.items.forEach(it => items.set(it.id, it.box)));
  const card = B => {
    const b = items.get(B.id), n = B.node;
    if (!b) return { x:B.x, y:B.y, w:B.w, h:B.h };
    if (n.form === 'message') return { ...b };
    const d = dotsOf(n, true), top = d.in.length ? b.y : B.y, bot = d.out.length ? b.y + b.h : B.y + B.h;
    return { x:b.x, y:top, w:b.w, h:bot - top };
  };
  if (id) { const B = lay.blocks.find(b => b.id === id); return B ? card(B) : null; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (ax, ay, bx, by) => { x0 = Math.min(x0, ax); y0 = Math.min(y0, ay); x1 = Math.max(x1, bx); y1 = Math.max(y1, by); };
  lay.blocks.forEach(B => { const c = card(B); add(c.x, c.y, c.x + c.w, c.y + c.h); });
  lay.dividers.forEach(v => add(v.x1, v.y - 10, v.x2, v.y + 10));
  if (lay.canvas && lay.canvas.appendixY != null) add(0, lay.canvas.appendixY, lay.size.w, lay.canvas.h);
  if (plus) lay.plus.forEach(p => add(p.x - 11, p.y - 11, p.x + 11, p.y + 11));
  return x1 > x0 ? { x:x0, y:y0, w:x1 - x0, h:y1 - y0 } : null;
}

// @sbtel end Core.Layout
// @sbtel begin Core.LayoutChecks
// ---------- Layout checks: things any layout engine must keep true ----------
function runChecks(out) {
  const fails = { order:[], levelOrder:[], overlap:[], contain:[], chain:[], falseAdj:[] };
  const byContainer = new Map();
  out.levels.forEach(L => { if (!byContainer.has(L.container)) byContainer.set(L.container, []); byContainer.get(L.container).push(L); });
  out.levels.forEach(L => {
    // Source order is reading order: along each row, or (a level filled by columns) down each column of each stretch.
    const seq = [...L.items].sort((p, q) => (L.flow === 'cols' ? p.seg - q.seg || p.col - q.col || p.row - q.row : p.row - q.row || p.box.x - q.box.x)).map(i => i.order);
    if (seq.some((v, i) => v !== i)) fails.order.push(L.key);
    L.items.forEach(it => { if (it.box.x < L.x1 - .5 || it.box.x + it.box.w > L.x2 + .5) fails.contain.push(it.id); });
  });
  byContainer.forEach(Ls => {
    for (let i = 1; i < Ls.length; i++) if (Ls[i - 1].bottom > Ls[i].top + .5) fails.levelOrder.push(Ls[i].key);
    const items = Ls.flatMap(L => L.items);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i].box, b = items[j].box;
      if (a.x < b.x + b.w - .5 && b.x < a.x + a.w - .5 && a.y < b.y + b.h - .5 && b.y < a.y + a.h - .5) fails.overlap.push(items[i].id + ' × ' + items[j].id);
    }
  });
  const groups = new Map();
  out.levels.forEach(L => L.items.forEach(it => { if (it.gid) { if (!groups.has(it.gid)) groups.set(it.gid, []); groups.get(it.gid).push(it.id); } }));
  const parent = {}; const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
  groups.forEach(ids => ids.forEach(id => parent[id] = id));
  out.connectors.forEach(c => {
    c.bad = !c.ga || c.ga !== c.gb;
    if (c.bad) fails.falseAdj.push(c.a + ' — ' + c.b);
    else parent[find(c.a)] = find(c.b);
  });
  groups.forEach(ids => { const r = new Set(ids.map(find)); if (r.size > 1) fails.chain.push(ids.join(', ')); });
  return [
    { k:'order', label:'Blocks keep source order in every level', f:fails.order },
    { k:'levelOrder', label:'Levels stay stacked top to bottom', f:fails.levelOrder },
    { k:'overlap', label:'No two blocks overlap', f:fails.overlap },
    { k:'contain', label:'Every block stays inside its parent', f:fails.contain },
    { k:'chain', label:'Each adjacent group stays one connected chain', f:fails.chain },
    { k:'falseAdj', label:'No line joins blocks that are not adjacent', f:fails.falseAdj },
  ];
}

// @sbtel end Core.LayoutChecks
// @sbtel begin Core.Edits
// ---------- Source edits (splice text so the user's formatting survives) ----------
function lineStart(src, pos) { return src.lastIndexOf('\n', pos - 1) + 1; }
function colOf(src, pos) { return pos - lineStart(src, pos); }
function lineIndent(src, pos) { return /^[ \t]*/.exec(src.slice(lineStart(src, pos)))[0]; }
function indentAt(src, pos) { const pre = src.slice(lineStart(src, pos), pos); return /^\s*$/.test(pre) ? pre : null; }
function reindent(text, from, to) {
  const d = to - from; if (!d) return text;
  return text.split('\n').map((ln, i) => i === 0 ? ln : d > 0 ? ' '.repeat(d) + ln : ln.replace(new RegExp('^ {0,' + (-d) + '}'), '')).join('\n');
}
function sliceAt(src, n, col) { return reindent(src.slice(n.s, n.e), colOf(src, n.s), col); }
// A rewritten group keeps the sketch of the group it comes from (unitSk: that group's sketch form, if any).
function unitSk(U) { return U && U.node.form === 'adjacent' ? U.node.children.find(c => c.form === 'sketch') || null : null; }
function adjText(src, blocks, ind, sk) { return '(adjacent\n' + (sk ? ind + '  ' + sliceAt(src, sk, ind.length + 2) + '\n' : '') + blocks.map(b => ind + '  ' + sliceAt(src, b, ind.length + 2)).join('\n') + ')'; }
function unitsSpan(L) { return { s:L.units[0].node.s, e:L.units[L.units.length - 1].node.e }; }
// Where new children go when a block has none to anchor on: before its closing paren, or for the
// file (virtual root) at the end of the text. Children of the file are indented ''.
function endIn(src, b) { return b.virtual ? src.replace(/\s+$/, '').length : b.e - 1; }
function childIndent(src, b) { return b.virtual ? '' : (indentAt(src, b.s) ?? '') + '  '; }
function freshName(model) { let i = 1; while (model.blocks.has('NewBlock' + i)) i++; return 'NewBlock' + i; }
function applyEdit(src, model, act) {
  const splice = (s, e, t) => src.slice(0, s) + t + src.slice(e);
  if (act.t === 'delete') {
    const n = act.node;
    // Remove a span along with its indentation and the line break before it.
    const cut = (s, e) => { let a = s; const ls = lineStart(src, s); if (/^\s*$/.test(src.slice(ls, s))) { a = ls; if (a > 0 && src[a - 1] === '\n') a--; } return src.slice(0, a) + src.slice(e); };
    if (n.form !== 'block') return { src: cut(n.s, n.e) };
    const { L, ui } = act.loc, U = L.units[ui];
    const rest = U.blocks.filter(b => b !== n);
    if (!rest.length) {
      if (L.units.length === 1 && L.kind === 'level') return { src: cut(L.node.s, L.node.e) };
      return { src: cut(U.node.s, U.node.e) };
    }
    const ind = indentAt(src, U.node.s) ?? '  ';
    const text = rest.length === 1 ? sliceAt(src, rest[0], ind.length) : adjText(src, rest, ind, unitSk(U));
    return { src: splice(U.node.s, U.node.e, text) };
  }
  if (act.t === 'split') {
    const U = act.L.units[act.ui]; const ind = indentAt(src, U.node.s) ?? '  ';
    // Cutting a group in two: its sketch stays with the first part that is still a group.
    const sk = unitSk(U), first = act.at > 1, part = (list, k) => list.length === 1 ? sliceAt(src, list[0], ind.length) : adjText(src, list, ind, k ? sk : null);
    return { src: splice(U.node.s, U.node.e, part(U.blocks.slice(0, act.at), first) + '\n' + ind + part(U.blocks.slice(act.at), !first)) };
  }
  if (act.t === 'connect') {
    // Join the target's unit to the source's group, right beside the source block
    // (after it if the target was to the right, before it if to the left).
    const { L, ui, bi, uj } = act;
    const lo = Math.min(ui, uj), hi = Math.max(ui, uj);
    const A = L.units[ui].blocks, B = L.units[uj].blocks;
    const merged = uj > ui ? [...A.slice(0, bi + 1), ...B, ...A.slice(bi + 1)] : [...A.slice(0, bi), ...B, ...A.slice(bi)];
    // The joined group keeps the source group's sketch, else the target's.
    const seq = [];
    for (let k = lo; k <= hi; k++) { if (k === ui) seq.push({ list:merged, sk:unitSk(L.units[ui]) || unitSk(L.units[uj]) }); else if (k !== uj) seq.push({ list:L.units[k].blocks, sk:unitSk(L.units[k]) }); }
    const s = L.units[lo].node.s, e = L.units[hi].node.e, ind = indentAt(src, s) ?? '  ';
    const part = x => x.list.length === 1 ? sliceAt(src, x.list[0], ind.length) : adjText(src, x.list, ind, x.sk);
    const moved = Math.abs(uj - ui) > 1 || (uj > ui ? bi < A.length - 1 : bi > 0);
    return { src: splice(s, e, seq.map(part).join('\n' + ind)), name: B[0].name, moved };
  }
  if (act.t === 'decl') {
    // New behavior or message type, placed after the block's last declaration of that kind.
    const b = act.block, isB = act.form === 'behavior', base = isB ? 'NewBehavior' : 'NewShape', pool = isB ? model.behaviors : model.messages;
    let i = 1; while (pool.has(base + i)) i++; const nm = base + i;
    const same = b.children.filter(c => c.form === act.form), ref = same[same.length - 1] || b.children[0];
    const ind = (ref && indentAt(src, ref.s)) ?? childIndent(src, b);
    const text = isB ? `(behavior ${nm}\n${ind}  (sketch "What a block promises when it implements this."))` : `(shape ${nm} (sketch "What this data carries."))`;
    if (same.length) return { src: splice(ref.e, ref.e, '\n' + ind + text), name:nm };
    if (ref) return { src: splice(ref.s, ref.s, text + '\n' + ind), name:nm };
    const at = endIn(src, b); return { src: splice(at, at, (at ? '\n' : '') + ind + text), name:nm };
  }
  const name = freshName(model);
  const blockText = ind => '(block ' + name + '\n' + ind + '  (sketch "Describe what this block does."))';
  if (act.t === 'append') {
    const L = act.L;
    if (L.kind === 'level') {
      const ind = (indentAt(src, L.node.s) ?? '') + '  ';
      return { src: splice(L.node.e - 1, L.node.e - 1, '\n' + ind + blockText(ind)), name };
    }
    const last = L.units[L.units.length - 1].node; const ind = indentAt(src, last.s) ?? '  ';
    return { src: splice(last.e, last.e, '\n' + ind + blockText(ind)), name };
  }
  if (act.t === 'level') return { src: levelInsert(src, act.block, act.at, blockText).src, name };
  // ---------- Move, attach and property edits ----------
  if (act.t === 'move') return moveEdit(src, model, act);
  if (act.t === 'deleteMany') {
    // Delete each node in turn on the re-parsed result; nodes already gone with an ancestor are skipped.
    let cur = src;
    for (const id of act.ids) {
      const m = parse(cur), n = m.node(id); if (!n || n === m.root) continue;
      const loc = n.form === 'block' ? locIn(n) : null; if (n.form === 'block' && !loc) continue;
      cur = applyEdit(cur, m, { t:'delete', node:n, loc }).src;
    }
    return { src:cur };
  }
  if (act.t === 'implements') {
    const b = act.block; if (b.impl.includes(act.name)) return { src };
    const p = childInsert(src, b, ['implements']);
    return { src: src.slice(0, p.pos) + p.pre + '(implements ' + act.name + ')' + p.post + src.slice(p.pos), name:b.name };
  }
  if (act.t === 'ref') {
    // A file named on a block, behavior or shape: after its other refs, else after its sketch.
    const b = act.block; if (b.children.some(c => c.form === 'ref' && c.path === act.path)) return { src };
    const p = childInsert(src, b, ['ref', 'sketch']);
    const path = /^[^\s()";~]+$/.test(act.path) ? act.path : JSON.stringify(act.path);
    return { src: src.slice(0, p.pos) + p.pre + '(ref ' + path + ')' + p.post + src.slice(p.pos), name:b.name };
  }
  if (act.t === 'port') {
    const b = act.block, p = childInsert(src, b, ['port', 'implements']);
    return { src: src.slice(0, p.pos) + p.pre + portForm(act.name, act.dir, act.kind) + p.post + src.slice(p.pos), name:b.name };
  }
  if (act.t === 'props') {
    // One splice set: name token, :type, sketch, and (for behaviors and message types) every reference.
    const n = act.node, reps = [], its = itemsOf(src, n), nameTok = headSym(its[1]);
    const name = act.name != null ? act.name : n.name;
    if (name !== n.name && nameTok) reps.push({ s:nameTok.s, e:nameTok.e, t: n.form === 'block' ? nameForm(name.replace(/\s+/g, ' ').trim()) : name });
    if (act.type != null && act.type !== (n.type || '')) {
      let k = -1, i = 2; for (; i < its.length && its[i].t === 'sym' && its[i].v.startsWith(':'); i += 2) if (its[i].v === ':type') k = i;
      const lastKw = its[Math.min(i, its.length) - 1];
      if (k >= 0 && its[k + 1]) reps.push(act.type ? { s:its[k + 1].s, e:its[k + 1].e, t:quoteStr(act.type) } : { s:its[k - 1].e, e:its[k + 1].e, t:'' });
      else if (act.type) { const first = n.children[0], ind = first && indentAt(src, first.s); reps.push({ s:lastKw.e, e:lastKw.e, t:(ind != null ? '\n' + ind : ' ') + ':type ' + quoteStr(act.type) }); }
    }
    // Behaviors (act.impl: every behavior the block should implement) and own ports (act.ports: rows in
    // order, each { node?, name, dir, kind }; node ties a row to the port it edits). Kept implements stay
    // as written, type arguments included. Removals are pushed last, so an insertion at the start of a
    // removed span is not cut with it.
    const gone = new Set(), cuts = [];
    // A removed child takes the spaces before it, and its line break when it is on a line of its own.
    const cutRep = c => { let a = c.s; while (a > 0 && /[ \t]/.test(src[a - 1])) a--; if (a > 0 && src[a - 1] === '\n') a--; return { s:a, e:c.e, t:'' }; };
    const insert = (forms, items) => { if (!items.length) return; const p = childInsert(src, n, forms, gone), j = p.pre || p.post; reps.push({ s:p.pos, e:p.pos, t:p.pre + items.join(j) + p.post }); };
    const impls = n.form !== 'message' && act.impl ? n.children.filter(c => c.form === 'implements' && !act.impl.includes(c.name)) : [];
    const ownP = n.children.filter(c => c.form === 'port'), keepP = new Set((act.ports || []).map(q => q.node).filter(Boolean));
    impls.forEach(c => gone.add(c)); if (act.ports) ownP.forEach(c => { if (!keepP.has(c)) gone.add(c); });
    if (act.sketch != null && !act.sketch.trim()) n.children.filter(c => c.form === 'sketch').forEach(c => gone.add(c));
    if (n.form !== 'message' && act.impl) insert(['implements'], act.impl.filter(x => !n.impl.includes(x)).map(x => '(implements ' + x + ')'));
    // A message's carried types (act.carries: names, in order): one (carries …) form, rewritten whole.
    if (n.form === 'message' && act.carries) {
      const cur = n.children.find(c => c.form === 'carries'), want = act.carries.filter(Boolean);
      if (want.join(' ') !== (cur ? cur.names.join(' ') : '')) {
        if (cur && want.length) reps.push({ s:cur.s, e:cur.e, t:'(carries ' + want.join(' ') + ')' });
        else if (cur) cuts.push({ s:cur.s - (src[cur.s - 1] === ' ' ? 1 : 0), e:cur.e, t:'' });
        else { const p = childInsert(src, n, ['refines'], gone); reps.push({ s:p.pos, e:p.pos, t:(p.pre || (p.pos === n.e - 1 ? ' ' : '')) + '(carries ' + want.join(' ') + ')' + p.post }); }
      }
    }
    if (act.ports) {
      // A row's sketch (q.sketch; undefined keeps the port's own) is written in the form the port's sketch
      // already has, and an unchanged one is copied as written; a new one is (~ … ~).
      const portSk = q => {
        const cur = q.node && q.node.children.find(c => c.form === 'sketch');
        if (q.sketch == null || (cur && sketchNorm(q.sketch, cur) === cur.text)) return cur ? ' ' + src.slice(cur.s, cur.e) : '';
        const t = sketchNorm(q.sketch, cur); return t ? ' ' + sketchForm(t, cur, lineIndent(src, q.node ? q.node.s : n.s)) : '';
      };
      // The 0.3 form, with :as only when the name is not the type's default one (so a rename back to the
      // default drops it). A 0.2 port the edit touches is rewritten in the 0.3 form.
      const portText = q => portForm(q.name, q.dir, q.kind).slice(0, -1) + portSk(q) + ')';
      const skChanged = q => q.sketch != null && sketchNorm(q.sketch, q.node.children.find(c => c.form === 'sketch')) !== (q.node.sketch || '');
      act.ports.forEach(q => { if (q.node && (q.name !== q.node.name || q.dir !== q.node.dir || q.kind !== q.node.kind || skChanged(q))) reps.push({ s:q.node.s, e:q.node.e, t:portText(q) }); });
      insert(['port', 'implements'], act.ports.filter(q => !q.node).map(portText));
    }
    [...gone].filter(c => c.form !== 'sketch').forEach(c => cuts.push(cutRep(c)));
    if (act.sketch != null) reps.push(...sketchReps(src, n, act.sketch, n.form === 'block' ? ['port', 'implements'] : ['port', 'refines', 'carries'], gone));
    if (name !== n.name && n.form !== 'block') {
      const old = n.name, sym = x => { const h = headSym(x); if (h && h.t === 'sym' && h.v === old) reps.push({ s:h.s, e:h.e, t:name }); };
      const visit = c => {
        if (c.form === 'implements' && n.form === 'behavior' && c.name === old) sym(itemsOf(src, c)[1]);
        else if (c.form === 'implements' && n.form === 'message' && (c.args || []).includes(old)) { const arg = itemsOf(src, c)[1]; arg.list.slice(1).forEach(sym); }
        else if (c.form === 'port' && c.kind === old) sym(itemsOf(src, c)[1]);
        else if ((c.form === 'refines' || c.form === 'carries') && (c.names || []).includes(old)) itemsOf(src, c).slice(1).forEach(sym);
        c.children.forEach(visit);
      };
      visit(model.root);
    }
    return { src: multiSplice(src, [...reps, ...cuts]), name };
  }
  if (act.t === 'levelProps') return levelEdit(src, act);
  if (act.t === 'groupSketch') return { src: multiSplice(src, sketchReps(src, act.node, act.sketch, [])) };
  return { src };
}
// Insert a new level holding one item (text from inner(indent)) at level position `at` of block b.
// Returns the new source, the insertion offset and the offset where the inner text starts.
function levelInsert(src, b, at, inner) {
  const Ls = b.levels; let pos, pre = '', post = '', ind;
  if (!Ls.length) { ind = childIndent(src, b); pos = endIn(src, b); pre = pos ? '\n' + ind : ind; }
  else if (at < Ls.length) { const s = Ls[at].kind === 'level' ? Ls[at].node.s : unitsSpan(Ls[at]).s; ind = indentAt(src, s) ?? '  '; pos = s; post = '\n' + ind; }
  else {
    const lastL = Ls[Ls.length - 1], s0 = lastL.kind === 'level' ? lastL.node.s : unitsSpan(lastL).s;
    ind = indentAt(src, s0) ?? '  '; pos = lastL.kind === 'level' ? lastL.node.e : unitsSpan(lastL).e; pre = '\n' + ind;
  }
  const head = '(level\n' + ind + '  ', text = head + inner(ind + '  ') + ')';
  return { src: src.slice(0, pos) + pre + text + post + src.slice(pos), pos, at: pos + pre.length + head.length };
}

// ---------- Move, attach and property edits ----------
// Where a block sits in its parent's levels: { L, ui, bi }.
function locIn(b) {
  const P = b && holderOf(b); if (!P) return null;
  for (const L of P.levels) for (let ui = 0; ui < L.units.length; ui++) { const bi = L.units[ui].blocks.indexOf(b); if (bi >= 0) return { L, ui, bi }; }
  return null;
}
// Whether node n is block anc or lies inside it (blocks via parent, declarations via owner).
function isWithin(n, anc) { for (let x = n.form === 'block' ? n : n.owner; x; x = x.parent) if (x === anc) return true; return false; }
const quoteStr = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
// A block's name as source text: bare when it can be a symbol, a string when it is a phrase.
const nameForm = name => (/^[^\s()";:][^\s()";]*$/.test(name) ? name : quoteStr(name));
// Top-level items of a node's list, with absolute offsets (lists keep their own items, offset too).
function itemsOf(src, n) {
  const shift = x => x.list ? { ...x, list:x.list.map(shift), s:x.s + n.s, e:x.e + n.s } : { ...x, s:x.s + n.s, e:x.e + n.s };
  return shift(readAll(src.slice(n.s, n.e))[0]).list;
}
const headSym = x => x && (x.list ? x.list[0] : x);
// Insert a child form into block b: after its last child of the first form in `after` that has one,
// else before its first child, else before its closing paren.
function childInsert(src, b, after, gone) {
  for (const f of after) { const l = b.children.filter(c => c.form === f); if (l.length) { const ref = l[l.length - 1]; return { pos:ref.e, pre:'\n' + (indentAt(src, ref.s) ?? (indentAt(src, b.s) ?? '') + '  '), post:'' }; } }
  const first = b.children.find(c => !gone || !gone.has(c));
  if (first) { const ind = indentAt(src, first.s); return ind != null ? { pos:first.s, pre:'', post:'\n' + ind } : { pos:first.s, pre:'', post:' ' }; }
  return { pos:endIn(src, b), pre:'\n' + childIndent(src, b), post:'' };
}
// ---------- Sketch text, in either form ----------
// A sketch's text as the edit means it: by the (sketch "…") rule when cur is a (sketch "…") form (every
// whitespace run is one space), else by the (~ … ~) rule, which keeps paragraph breaks (tildeText).
function sketchNorm(text, cur) { return cur && !cur.tilde ? String(text).replace(/\s+/g, ' ').trim() : tildeText(String(text)); }
// The source of a sketch with text t, in cur's form: (sketch "…"), or (~ … ~) with as many tildes as it
// takes for t not to contain the closer. A paragraph break becomes a blank line, the next paragraph
// indented under the sketch (ind is the indent of the sketch's line).
function sketchForm(t, cur, ind) {
  if (cur && !cur.tilde) return '(sketch ' + quoteStr(t) + ')';
  let k = 1; while (t.includes('~'.repeat(k) + ')')) k++;
  const T = '~'.repeat(k);
  return t ? '(' + T + ' ' + t.split('\n\n').join('\n\n' + ind + '  ') + ' ' + T + ')' : '(' + T + ' ' + T + ')';
}
// Replacements that set node n's sketch to `text`: replace the sketch (keeping its form), remove it when
// text is blank, or add a (~ … ~) where childInsert puts a child after the forms in `after`.
function sketchReps(src, n, text, after, gone) {
  const cur = n.children.find(c => c.form === 'sketch'), t = sketchNorm(text, cur);
  if (t === (cur ? cur.text : '')) return [];
  const ind = lineIndent(src, cur ? cur.s : n.s);
  if (cur && t) return [{ s:cur.s, e:cur.e, t:sketchForm(t, cur, ind) }];
  if (cur) { let a = cur.s; while (a > 0 && /\s/.test(src[a - 1])) a--; return [{ s:a, e:cur.e, t:'' }]; }
  if (!t) return [];
  const p = childInsert(src, n, after, gone);
  return [{ s:p.pos, e:p.pos, t:p.pre + sketchForm(t, null, /\n/.test(p.pre + p.post) ? (p.pre || p.post).replace(/^\n/, '') : ind) + p.post }];
}
// A level's :name and sketch (act.at: its index in act.block.levels). An implicit level is wrapped in a
// (level …) form first, unless both are empty; an explicit one keeps its form even when both are cleared.
function levelEdit(src, act) {
  const L = act.block.levels[act.at]; if (!L) return { src };
  const name = (act.name || '').trim(), sk = act.sketch == null ? null : tildeText(act.sketch);
  if (!L.node) {
    if (!name && !sk) return { src };
    const { s, e } = unitsSpan(L), ind = indentAt(src, s), col = colOf(src, s);
    const head = '(level' + (name ? ' :name ' + quoteStr(name) : '');
    if (ind == null) return { src: src.slice(0, s) + head + (sk ? ' ' + sketchForm(sk, null, '') : '') + ' ' + src.slice(s, e) + ')' + src.slice(e) };
    const body = (sk ? '\n' + ind + '  ' + sketchForm(sk, null, ind + '  ') : '') + '\n' + ind + '  ' + reindent(src.slice(s, e), col, col + 2);
    return { src: src.slice(0, s) + head + body + ')' + src.slice(e) };
  }
  const its = itemsOf(src, L.node), reps = [];
  let k = -1; for (let i = 1; i < its.length && its[i].t === 'sym' && its[i].v.startsWith(':'); i += 2) if (its[i].v === ':name' && k < 0) k = i;
  const val = k >= 0 ? its[k + 1] : null, hasVal = val && !val.list && !(val.t === 'sym' && val.v.startsWith(':'));
  if (name !== (L.name || '')) {
    if (k >= 0 && hasVal) reps.push(name ? { s:val.s, e:val.e, t:quoteStr(name) } : { s:its[k - 1].e, e:val.e, t:'' });
    else if (k >= 0) reps.push(name ? { s:its[k].e, e:its[k].e, t:' ' + quoteStr(name) } : { s:its[k - 1].e, e:its[k].e, t:'' });
    else if (name) reps.push({ s:its[0].e, e:its[0].e, t:' :name ' + quoteStr(name) });
  }
  if (sk != null) reps.push(...sketchReps(src, L.node, sk, []));
  return { src: multiSplice(src, reps) };
}
function multiSplice(src, reps) {
  reps.map((r, i) => ({ ...r, i })).sort((a, b) => b.s - a.s || b.i - a.i).forEach(r => { src = src.slice(0, r.s) + r.t + src.slice(r.e); });
  return src;
}
// Move a block: insert a copy at the destination, then delete the original with the usual delete edit,
// so groups left with one block are unwrapped and emptied levels removed. `at` is the copy's offset.
function moveEdit(src, model, act) {
  const n = act.node, d = act.dest, P = d.block, Ls = P.levels;
  let mid, pos, copyAt;
  if (n.form !== 'block') {
    // A behavior or message type: to position d.at among P's declarations of the same form (where a new
    // one would go when P has none), then the original span is cut as the delete edit cuts it.
    const same = P.children.filter(c => c.form === n.form), own = same.indexOf(n);
    if (own >= 0 && (d.at === own || d.at === own + 1)) return { src, name:n.name, at:n.s };
    let pre = '', post = '', ind;
    if (d.at < same.length) { const ref = same[d.at]; ind = indentAt(src, ref.s) ?? childIndent(src, P); pos = ref.s; post = '\n' + ind; }
    else if (same.length) { const ref = same[same.length - 1]; ind = indentAt(src, ref.s) ?? childIndent(src, P); pos = ref.e; pre = '\n' + ind; }
    else { const first = P.children[0]; ind = (first && indentAt(src, first.s)) ?? childIndent(src, P);
      if (first) { pos = first.s; post = '\n' + ind; } else { pos = endIn(src, P); pre = (pos ? '\n' : '') + ind; } }
    mid = src.slice(0, pos) + pre + sliceAt(src, n, ind.length) + post + src.slice(pos); copyAt = pos + pre.length;
    const added = mid.length - src.length, os = n.s + (pos <= n.s ? added : 0);
    const out = applyEdit(mid, null, { t:'delete', node:{ form:n.form, s:os, e:os + (n.e - n.s) } }).src;
    return { src:out, name:n.name, at: copyAt < os ? copyAt : copyAt + (out.length - mid.length) };
  }
  if (d.edge) {
    const r = levelInsert(src, P, d.edge === 'start' ? 0 : Ls.length, ind => sliceAt(src, n, ind.length));
    mid = r.src; pos = r.pos; copyAt = r.at;
  } else if (d.unit != null) {
    // Into adjacent group d.unit before member d.pos (or after its last member): the copy is linked.
    const bs = Ls[d.level].units[d.unit].blocks, own = locIn(n);
    if (own && own.L === Ls[d.level] && own.ui === d.unit && (d.pos === own.bi || d.pos === own.bi + 1)) return { src, name:n.name, at:n.s };
    const ref = bs[Math.min(d.pos, bs.length - 1)], ind = indentAt(src, ref.s) ?? '  ', text = sliceAt(src, n, ind.length);
    if (d.pos < bs.length) { pos = ref.s; mid = src.slice(0, pos) + text + '\n' + ind + src.slice(pos); copyAt = pos; }
    else { pos = ref.e; mid = src.slice(0, pos) + '\n' + ind + text + src.slice(pos); copyAt = pos + 1 + ind.length; }
  } else {
    const U = Ls[d.level].units; let pre = '', post = '', text;
    if (d.at < U.length) { const s = U[d.at].node.s, ind = indentAt(src, s) ?? '  '; pos = s; post = '\n' + ind; text = sliceAt(src, n, ind.length); }
    else { const last = U[U.length - 1].node, ind = indentAt(src, last.s) ?? '  '; pos = last.e; pre = '\n' + ind; text = sliceAt(src, n, ind.length); }
    mid = src.slice(0, pos) + pre + text + post + src.slice(pos); copyAt = pos + pre.length;
  }
  const added = mid.length - src.length, origS = n.s + (pos <= n.s ? added : 0);
  const m2 = parse(mid), orig = [...m2.blocks.values()].find(b => b.s === origS);
  const r = applyEdit(mid, m2, { t:'delete', node:orig, loc:locIn(orig) });
  let at = copyAt < origS ? copyAt : copyAt + (r.src.length - mid.length);
  // Deleting from the copy's own group rewrites that group, so find the copy by its (unique) name instead.
  if (d.unit != null) { const same = [...parse(r.src).blocks.values()].filter(b => b.name === n.name); if (same.length === 1) at = same[0].s; }
  return { src:r.src, name:n.name, at };
}
// Every edit that moves block `id` somewhere else: any position in any level of any open block
// (never itself or a descendant), any position inside an adjacent group there (dest.unit, dest.pos),
// or a new level at the start or end of an open block.
// A behavior or message type card moves into the appendix of any open block or of the file, at any
// position among the declarations of its form there (dest.at).
function moveCandidates(model, id, openIds) {
  const dn = model.node(id); if (!dn || dn === model.root) return [];
  if (dn.form === 'behavior' || dn.form === 'message') {
    const out = [];
    for (const P of [model.root, ...model.blocks.values()]) {
      if (!P.virtual && !openIds.has(P.id)) continue;
      const k = P.children.filter(c => c.form === dn.form).length;
      for (let at = 0; at <= k; at++) out.push({ t:'move', node:dn, dest:{ block:P, at } });
    }
    return out;
  }
  const n = model.blocks.get(id); if (!n) return [];
  const out = [];
  // The file (model.root) is always open: blocks can move to the top level.
  for (const P of [model.root, ...model.blocks.values()]) {
    if (!P.virtual && (!openIds.has(P.id) || isWithin(P, n))) continue;
    P.levels.forEach((L, i) => {
      for (let at = 0; at <= L.units.length; at++) out.push({ t:'move', node:n, dest:{ block:P, level:i, at } });
      // Inside an adjacent group: between two members or at either end (joining it, or reordering within it).
      L.units.forEach((U, ui) => { if (U.blocks.length > 1) for (let pos = 0; pos <= U.blocks.length; pos++) out.push({ t:'move', node:n, dest:{ block:P, level:i, unit:ui, pos } }); });
    });
    out.push({ t:'move', node:n, dest:{ block:P, edge:'start' } });
    if (P.levels.length) out.push({ t:'move', node:n, dest:{ block:P, edge:'end' } });
  }
  return out;
}
function freePortName(b, kind) { return portNameFor(kind, new Set(portsOf(b).map(p => p.name))); }
// Every edit that attaches behavior or message card `id` to a visible block. One on a block outside the
// declaring block's scope carries `why` (the reason it is refused); the drag bounces back from it.
function attachCandidates(model, id, visibleIds) {
  const d = model.node(id); if (!d || (d.form !== 'behavior' && d.form !== 'message')) return [];
  const out = [];
  for (const b of model.blocks.values()) {
    if (!visibleIds.has(b.id)) continue;
    const why = d.owner && !isWithin(b, d.owner) ? `${b.name} can't ${d.form === 'behavior' ? 'implement ' + d.name : 'use shape ' + d.name}: ${d.name} is declared in ${d.owner.name}, and ${b.name} is outside it.` : '';
    if (d.form === 'behavior') { if (!b.impl.includes(d.name)) out.push({ t:'implements', block:b, name:d.name, why }); }
    else ['in', 'out'].forEach(dir => out.push({ t:'port', block:b, dir, kind:d.name, name:freePortName(b, d.name), why }));
  }
  return out;
}
// @sbtel end Core.Edits
// @sbtel begin Core.Scope
// ---------- Edit dialog: what is in scope, and checks on a block's ports ----------
const NAME_RE = /^[^\s()";:][^\s()";]*$/;
// Behaviors a block may implement: declared in it or one of its ancestors. A behavior may implement the
// others visible where it is declared.
function behaviorsInScope(model, b) {
  const up = b.form === 'block' ? ancestorsOrSelf(b) : b.owner ? ancestorsOrSelf(b.owner) : [];
  return [...model.behaviors.values()].filter(bh => bh !== b && (!bh.owner || up.includes(bh.owner)));
}
// Message types a port of node n may use: in scope where n is (a behavior: where it is declared), plus a behavior's own type parameters.
function typesInScope(model, n) {
  const where = n.form === 'block' ? n : n.owner, up = where ? ancestorsOrSelf(where) : [];
  const ts = [...model.messages.values()].filter(m => !m.owner || up.includes(m.owner)).map(m => m.name);
  return n.form === 'behavior' ? [...ts, ...n.params.filter(p => p && !ts.includes(p))] : ts;
}
// Ports a block (or behavior) gets from the behaviors in impl, through the behaviors they implement too,
// with the arguments its (implements …) forms pass (portsOf's rule). `self` is a behavior's own name.
function inheritedPorts(model, impl, args, self) { return inheritedVia(model, { form: self ? 'behavior' : 'block', name:self, impl, implArgs: args || Object.create(null) }); }
// A free name for a new port of type kind: the default one (defaultPortName), or that with a number.
function portNameFor(kind, taken) { const base = defaultPortName(kind); if (!taken.has(base)) return base; let i = 2; while (taken.has(base + i)) i++; return base + i; }
// The first problem with a node's port rows (with impl as its behaviors, for a block), or '' when fine.
function portsProblem(model, node, ports, impl) {
  const types = new Set(typesInScope(model, node)), from = new Map();
  if (node.form !== 'message') inheritedPorts(model, impl || node.impl, node.implArgs, node.form === 'behavior' ? node.name : null).forEach(p => { if (!from.has(p.name)) from.set(p.name, p.via); });
  const own = new Set();
  for (let i = 0; i < ports.length; i++) {
    const p = ports[i], label = p.name ? `Port ${p.name}` : `Port ${i + 1}`;
    if (!NAME_RE.test(p.name || '')) return `${label}: a port name cannot be empty or contain spaces, parentheses, quotes or semicolons.`;
    if (p.dir !== 'in' && p.dir !== 'out') return `${label}: direction must be in or out.`;
    if (!p.kind) return `${label}: choose a shape.`;
    if (!types.has(p.kind)) return `${label}: ${p.kind} is not in scope here.`;
    if (own.has(p.name)) return `Two ports are named ${p.name}.`;
    if (from.has(p.name)) return `Port ${p.name} clashes with the ${p.name} port from ${from.get(p.name)}.`;
    own.add(p.name);
  }
  return '';
}
// A name already used by another block, behavior or message type ('' when free).
function nameClash(model, node, name) {
  // A block's name may be a phrase (it is then written as a string); a behavior's or a shape's is one word.
  if (node && node.form === 'block') { if (!name.trim() || /[\n\r]/.test(name) || name.length > 80) return 'A block needs a name: a word or a short phrase on one line.'; }
  else if (!NAME_RE.test(name)) return 'A name cannot be empty or contain spaces, parentheses, quotes or semicolons.';
  if (name === node.name) return '';
  if ([...model.blocks.values()].some(b => b !== node && b.name === name)) return `${name} is already the name of a block.`;
  if (model.behaviors.has(name) && model.behaviors.get(name) !== node) return `${name} is already the name of a behavior.`;
  if (model.messages.has(name) && model.messages.get(name) !== node) return `${name} is already the name of a shape.`;
  return '';
}
// @sbtel end Core.Scope
// @sbtel begin Core.Random
// ---------- Random spec for stress tests ----------
function randomSpec(seed) {
  let s = seed >>> 0 || 1; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const nouns = ['Cache','Router','Ledger','Inbox','Planner','Parser','Index','Gateway','Scheduler','Renderer','Auth','Billing','Search','Feed','Uploader','Queue','Profile','Metrics','Session','Editor','Sync','Mailer','Pricing','Catalog','Audit'];
  const adjs = ['', '', '', 'Remote','Local','Batch','Live','Shadow','Retry','Edge'];
  const kinds = ['Request','Event','Snapshot','Command','Receipt'];
  const sk = ['Keeps the latest state per key.','Turns raw input into typed commands and rejects anything malformed before it reaches storage.','Fans out each event to every subscriber that asked for its kind.','Thin wrapper.','Retries failed deliveries with backoff, then parks them for a human to look at.','Draws the list and only mounts what is on screen.'];
  const used = new Set(); const nm = () => { let n; do { n = pick(adjs) + pick(nouns); } while (used.has(n)); used.add(n); return n; };
  let total = 0;
  function block(depth, ind) {
    total++;
    const name = nm(); let t = '(block ' + name;
    if (rnd() < .25) t += ' :type "' + pick(['Process','Store','Feature','Service']) + '"';
    const port = (dir, names) => { const pn = pick(names), k = pick(kinds); return '\n' + ind + '  ' + portForm(pn || defaultPortName(k), dir, k); };
    if (rnd() < .5) t += port('in', ['', 'req', 'evt']);
    if (rnd() < .4) t += port('out', ['', 'emit', 'done']);
    if (rnd() < .3) t += '\n' + ind + '  (implements ' + pick(['Durable','Observable']) + ')';
    t += '\n' + ind + '  (sketch "' + pick(sk) + '")';
    if (depth < 3 && total < 60 && rnd() < (depth === 0 ? 1 : .35)) {
      const nl = 1 + Math.floor(rnd() * (depth === 0 ? 3 : 2));
      for (let l = 0; l < nl; l++) t += '\n' + ind + '  ' + level(depth + 1, ind + '  ');
    }
    return t + ')';
  }
  function level(depth, ind) {
    let t = '(level'; const nu = 1 + Math.floor(rnd() * (depth === 1 ? 4 : 3));
    for (let u = 0; u < nu; u++) {
      if (rnd() < .45) { const m = 2 + Math.floor(rnd() * 3); t += '\n' + ind + '  (adjacent'; for (let i = 0; i < m; i++) t += '\n' + ind + '    ' + block(depth, ind + '    '); t += ')'; }
      else t += '\n' + ind + '  ' + block(depth, ind + '  ');
    }
    return t + ')';
  }
  const head = '(block System\n  :type "Module"\n  (sketch "A randomly generated system for testing layout rules.")\n' +
    kinds.map(m => '  (shape ' + m + ' (sketch "A ' + m.toLowerCase() + '."))').join('\n') +
    '\n  (behavior Durable (port :in Event :as keep) (sketch "Retains events until acknowledged."))' +
    '\n  (behavior Observable (port :out Snapshot :as metric) (sketch "Reports its own health."))';
  total = 0; let body = '';
  const nl = 2 + Math.floor(rnd() * 2);
  for (let l = 0; l < nl; l++) body += '\n  ' + level(1, '  ');
  return head + body + ')\n';
}
// @sbtel end Core.Random
// @sbtel begin Core.Diff
// ---------- Spec diff ----------
// diffSpecs(m0, m1): what changed from model m0 (side a) to model m1 (side b), as plain JSON (DESIGN.md §7).
// Matching: same kind and id first; then every unmatched element, plus every id match that scores below
// the threshold against itself, is paired greedily by structural similarity (Jaccard index of feature
// sets, §7.2), in two passes so that renamed holders, children and message types count in the second.
const DIFF_MIN = 0.5;
// Word diff of two sketches: LCS over whitespace-split words, merged into runs of the same op.
// A paragraph break (\n\n, from a (~ … ~) sketch) is a word of its own, joined to its neighbours without a space.
const sketchWords = t => t.split(/(\n\n)|\s+/).filter(Boolean);
const joinWords = (x, w) => x + (x.endsWith('\n\n') || w === '\n\n' ? '' : ' ') + w;
function wordDiff(a, b) {
  const A = sketchWords(a), B = sketchWords(b), n = A.length, m = B.length;
  const L = []; for (let i = 0; i <= n; i++) L.push(new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++; }
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { ops.push(['-', A[i]]); i++; }
    else { ops.push(['+', B[j]]); j++; }
  }
  const runs = [];
  ops.forEach(([op, w]) => { const r = runs[runs.length - 1]; if (r && r.op === op) r.text = joinWords(r.text, w); else runs.push({ op, text:w }); });
  return runs;
}
function diffSpecs(m0, m1) {
  const MS = [m0, m1], KINDS = ['message', 'behavior', 'block'];
  const starts = MS.map(m => { const a = [0]; for (let i = m.src.indexOf('\n'); i >= 0; i = m.src.indexOf('\n', i + 1)) a.push(i + 1); return a; });
  const lineOf = (k, pos) => { const a = starts[k]; let lo = 0, hi = a.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  const bySrc = (p, q) => p.s - q.s;
  const kindOf = n => n.form === 'block' ? 'block' : n.form;
  const els = (m, kind) => [...(kind === 'block' ? m.blocks : kind === 'behavior' ? m.behaviors : m.messages).values()].sort(bySrc);
  const E = MS.map(m => ({ message:els(m, 'message'), behavior:els(m, 'behavior'), block:els(m, 'block') }));
  // Step 1: by id.
  const base = new Map();
  KINDS.forEach(kind => { const ix = new Map(E[1][kind].map(n => [n.id, n])); E[0][kind].forEach(a => { const b = ix.get(a.id); if (b) base.set(a, b); }); });
  // Matching state: ab (a node -> b node), ba. During a pass, kinds already paired in this pass read the
  // new maps and the others read the previous pass's.
  let ab = new Map(base), ba = new Map([...base].map(([a, b]) => [b, a]));
  let nab = null, nba = null, done = new Set();
  const A2B = a => (done.has(kindOf(a)) ? nab : ab).get(a), B2A = b => (done.has(kindOf(b)) ? nba : ba).get(b);
  // Names and ids of side a, in side b's terms (unmatched ones get a prefix that side b never has).
  const msgB = name => { const a = m0.messages.get(name), b = a && A2B(a); return b ? b.name : name; };
  const behB = name => { const a = m0.behaviors.get(name), b = a && A2B(a); return b ? b.name : name; };
  const keyA = n => { if (!n) return ''; const b = A2B(n); return b ? b.id : '?' + n.id; };
  const keyB = n => { if (!n) return ''; return B2A(n) ? n.id : '+' + n.id; };
  // Ports that use each message type, per side: kind -> [{ owner, port }].
  const uses = MS.map(m => { const u = new Map(), add = (k, o, p) => { if (!k) return; if (!u.has(k)) u.set(k, []); u.get(k).push({ o, p }); };
    m.blocks.forEach(b => b.ownPorts.forEach(p => add(p.kind, b, p.name))); m.behaviors.forEach(bh => bh.ports.forEach(p => add(p.kind, bh, p.name))); return u; });
  const levelIdx = n => { const H = holderOf(n); return H ? H.levels.findIndex(L => L.units.some(u => u.blocks.includes(n))) : -1; };
  // Sketch words as features: ASCII letters lowercased and ASCII punctuation trimmed from both ends (ASCII
  // only, so every engine agrees); the word diff itself compares words exactly.
  const words = (F, s) => s.split(/\s+/).forEach(w => { w = w.replace(/^[!-\/:-@\[-`{-~]+|[!-\/:-@\[-`{-~]+$/g, '').replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32)); if (w) F.add('w:' + w); });
  // Features (§7.2). Side a's names are mapped into side b's, so shared features are equal strings.
  // Cached per kind step: the mapping that features read only changes between steps.
  let fcache = [new Map(), new Map()];
  function feats(n, side) {
    if (fcache[side].has(n)) return fcache[side].get(n);
    const F = new Set(), K = side ? keyB : keyA, msg = side ? (x => x) : msgB, beh = side ? (x => x) : behB;
    if (n.form === 'block') {
      F.add('h:' + K(n.parent)); F.add('L:' + levelIdx(n));
      if (n.type) F.add('t:' + n.type);
      n.ownPorts.forEach(p => { F.add('p:' + p.dir + ':' + msg(p.kind)); F.add('pn:' + p.name); });
      n.impl.forEach(x => F.add('i:' + beh(x)));
      childBlocks(n).forEach(c => F.add('c:' + K(c)));
      n.behaviorDecls.forEach(d => F.add('db:' + beh(d.name))); n.messageDecls.forEach(d => F.add('dm:' + msg(d.name)));
    } else if (n.form === 'behavior') {
      F.add('h:' + K(n.owner));
      n.ports.forEach(p => { const pi = n.params.indexOf(p.kind); F.add('p:' + p.dir + ':' + (pi >= 0 ? '$' + pi : msg(p.kind))); F.add('pn:' + p.name); });
      F.add('n:' + n.params.length);
      if (n.type) F.add('t:' + n.type);
      n.impl.forEach(x => F.add('i:' + beh(x)));
      implementersOf(MS[side], n.name).forEach(b => F.add('u:' + K(b)));
    } else {
      F.add('h:' + K(n.owner));
      if (n.type) F.add('t:' + n.type);
      if (n.refines) F.add('r:' + msg(n.refines)); n.carries.forEach(x => F.add('k:' + msg(x)));
      (uses[side].get(n.name) || []).forEach(u => F.add('u:' + K(u.o) + '.' + u.p));
    }
    words(F, n.sketch || '');
    fcache[side].set(n, F);
    return F;
  }
  const jac = (P, Q) => { let k = 0; P.forEach(x => { if (Q.has(x)) k++; }); const u = P.size + Q.size - k; return u ? k / u : 0; };
  for (let pass = 0; pass < 2; pass++) {
    nab = new Map(); nba = new Map(); done = new Set();
    KINDS.forEach(kind => {
      fcache = [new Map(), new Map()];
      const PA = [], PB = [], cands = [];
      E[0][kind].forEach(a => { const b = base.get(a); if (b && jac(feats(a, 0), feats(b, 1)) >= DIFF_MIN) { nab.set(a, b); nba.set(b, a); } else PA.push(a); });
      E[1][kind].forEach(b => { if (!nba.has(b)) PB.push(b); });
      if (PA.length && PB.length) {
        const FA = PA.map(a => feats(a, 0)), FB = PB.map(b => feats(b, 1)), ix = new Map();
        FB.forEach((F, j) => F.forEach(x => { if (!ix.has(x)) ix.set(x, []); ix.get(x).push(j); }));
        FA.forEach((F, i) => {
          const hit = new Map(); F.forEach(x => (ix.get(x) || []).forEach(j => hit.set(j, (hit.get(j) || 0) + 1)));
          const self = base.get(PA[i]), sj = self ? PB.indexOf(self) : -1;
          if (sj >= 0 && !hit.has(sj)) hit.set(sj, 0);
          hit.forEach((k, j) => { const sc = k / (F.size + FB[j].size - k || 1); if (sc >= DIFF_MIN || j === sj) cands.push({ i, j, sc }); });
        });
        cands.sort((p, q) => q.sc - p.sc || PB[p.j].s - PB[q.j].s || PA[p.i].s - PA[q.i].s);
        const ua = new Set(), ub = new Set();
        cands.forEach(c => { if (ua.has(c.i) || ub.has(c.j)) return; ua.add(c.i); ub.add(c.j); nab.set(PA[c.i], PB[c.j]); nba.set(PB[c.j], PA[c.i]); });
      }
      done.add(kind); fcache = [new Map(), new Map()];
    });
    ab = nab; ba = nba;
  }
  nab = ab; nba = ba;
  // ---------- Changes ----------
  const ref = (n, k) => ({ id:n.id, name:n.name, in: n.form === 'block' ? (n.parent ? n.parent.id : null) : (n.owner ? n.owner.id : null), lines:{ start:lineOf(k, n.s), end:lineOf(k, n.e - 1) } });
  const port = p => ({ name:p.name, dir:p.dir, kind:p.kind, via:null, sketch:p.sketch || '' });
  const skDiff = (x, y) => (x || '') === (y || '') ? null : { from:x || '', to:y || '', words:wordDiff(x || '', y || '') };
  // Level index for moves: levels above n in its holder that hold at least one matched block.
  // A block's level number in its holder: from the bottom, 1-based (null when it is in no level).
  const levelNo = n => { const H = holderOf(n), li = levelIdx(n); return li < 0 ? null : H.levels.length - li; };
  const moveLevel = (n, side) => { const H = holderOf(n), li = levelIdx(n); if (li < 0) return null; let c = 0;
    for (let i = 0; i < li; i++) if (H.levels[i].units.some(u => u.blocks.some(x => side ? ba.has(x) : ab.has(x)))) c++; return c; };
  const keyed = list => { const seen = new Map(); return list.map(p => { const k = (seen.get(p.name) || 0) + 1; seen.set(p.name, k); return { key: k > 1 ? p.name + '#' + k : p.name, p }; }); };
  const setDiff = (from, to) => { const F = new Set(from), T = new Set(to); return { added: to.filter((x, i) => !F.has(x) && to.indexOf(x) === i), removed: from.filter((x, i) => !T.has(x) && from.indexOf(x) === i) }; };
  const adjOf = n => { const H = holderOf(n); for (const L of (H ? H.levels : [])) for (const u of L.units) if (u.blocks.includes(n)) return u.blocks.filter(x => x !== n); return []; };
  const portFields = new Map();
  // Level names and sketches, and adjacent groups' sketches, of holder a (side a) against holder b. Levels
  // pair by the matched blocks they share (most first, then b's order, then a's); groups of two or more
  // blocks pair the same way within a paired level. A level or group that pairs with none is not reported:
  // its blocks are added or removed. Each entry is { level: b's level number, from the bottom, 1-based,
  // name?, sketch?, groups? }.
  function levelFields(a, b) {
    const pairs = (As, Bs, members) => {
      const cands = [];
      As.forEach((x, i) => Bs.forEach((y, j) => { const k = members(x).filter(n => ab.has(n) && members(y).includes(ab.get(n))).length; if (k) cands.push({ i, j, k }); }));
      cands.sort((p, q) => q.k - p.k || p.j - q.j || p.i - q.i);
      const ua = new Set(), ub = new Set(), out = [];
      cands.forEach(c => { if (ua.has(c.i) || ub.has(c.j)) return; ua.add(c.i); ub.add(c.j); out.push(c); });
      return out.sort((p, q) => p.j - q.j);
    };
    const res = [];
    pairs(a.levels, b.levels, L => L.units.flatMap(u => u.blocks)).forEach(({ i, j }) => {
      const La = a.levels[i], Lb = b.levels[j], e = { level:b.levels.length - j };
      if ((La.name || null) !== (Lb.name || null)) e.name = { from:La.name || null, to:Lb.name || null };
      const sk = skDiff(La.sketch, Lb.sketch); if (sk) e.sketch = sk;
      const Ga = La.units.filter(u => u.blocks.length > 1), Gb = Lb.units.filter(u => u.blocks.length > 1), groups = [];
      pairs(Ga, Gb, u => u.blocks).forEach(g => { const d = skDiff(Ga[g.i].sketch, Gb[g.j].sketch); if (d) groups.push({ blocks:Gb[g.j].blocks.map(x => x.id), sketch:d }); });
      if (groups.length) e.groups = groups;
      if (Object.keys(e).length > 1) res.push(e);
    });
    return res.length ? res : null;
  }
  function fieldsOf(a, b) {
    const F = {};
    if ((a.type || null) !== (b.type || null)) F.type = { from:a.type || null, to:b.type || null };
    if ((a.sketch || '') !== (b.sketch || '')) F.sketch = { from:a.sketch || '', to:b.sketch || '', words:wordDiff(a.sketch || '', b.sketch || '') };
    if (b.form !== 'message') { const d = setDiff(a.impl.map(behB), b.impl); if (d.added.length || d.removed.length) F.implements = { added:d.added, removed: a.impl.filter(x => d.removed.includes(behB(x))) }; }
    if (b.form !== 'message') {
      const PA = keyed(b.form === 'block' ? a.ownPorts : a.ports), PB = keyed(b.form === 'block' ? b.ownPorts : b.ports);
      const ia = new Map(PA.map(x => [x.key, x.p])), ib = new Map(PB.map(x => [x.key, x.p]));
      const kindA = p => b.form === 'behavior' && a.params.includes(p.kind) ? '$' + a.params.indexOf(p.kind) : msgB(p.kind);
      const kindB = p => b.form === 'behavior' && b.params.includes(p.kind) ? '$' + b.params.indexOf(p.kind) : p.kind;
      const added = PB.filter(x => !ia.has(x.key)).map(x => port(x.p)), removed = PA.filter(x => !ib.has(x.key)).map(x => port(x.p));
      // A port whose sketch alone changed is `changed` with a `sketch` word diff, and stays stable (§7.4).
      const retyped = x => ia.get(x.key).dir !== x.p.dir || kindA(ia.get(x.key)) !== kindB(x.p);
      const changed = PB.filter(x => ia.has(x.key) && (retyped(x) || (ia.get(x.key).sketch || '') !== (x.p.sketch || ''))).map(x => {
        const c = { name:x.p.name, from:port(ia.get(x.key)), to:port(x.p) }, sk = skDiff(ia.get(x.key).sketch, x.p.sketch); if (sk) c.sketch = sk; return c; });
      if (added.length || removed.length || changed.length) F.ports = { added, removed, changed };
      portFields.set(b, new Set([...added, ...removed, ...PB.filter(x => ia.has(x.key) && retyped(x)).map(x => x.p)].map(p => p.name)));
    }
    if (b.form === 'block') {
      const lab = (n, side) => { const d = dotsOf(n, true), f = p => portLabel(side ? p : { ...p, kind:msgB(p.kind) }); return { in:d.in.map(f), out:d.out.map(f) }; };
      const da = lab(a, 0), db = lab(b, 1), di = setDiff(da.in, db.in), dout = setDiff(da.out, db.out);
      if (di.added.length || di.removed.length || dout.added.length || dout.removed.length) F.drawer = { in:di, out:dout };
      const pa = adjOf(a).filter(x => ab.has(x)).map(x => ab.get(x)), pb = adjOf(b).filter(x => ba.has(x));
      const d = setDiff(pa.sort(bySrc).map(x => x.id), pb.sort(bySrc).map(x => x.id));
      if (d.added.length || d.removed.length) F.adjacency = d;
      const lv = levelFields(a, b); if (lv) F.levels = lv;
    }
    if (b.form === 'behavior' && a.params.join(' ') !== b.params.join(' ')) F.params = { from:a.params.slice(), to:b.params.slice() };
    if (b.form === 'message') {
      const ra = a.refines ? msgB(a.refines) : null;
      if (ra !== (b.refines || null)) F.refines = { from:a.refines || null, to:b.refines || null };
      const d = setDiff(a.carries.map(msgB), b.carries);
      if (d.added.length || d.removed.length) F.carries = { added:d.added, removed:a.carries.filter(x => d.removed.includes(msgB(x))) };
    }
    return Object.keys(F).length ? F : null;
  }
  const out = [];
  const element = n => n.form === 'block' ? 'block' : n.form === 'message' ? 'shape' : n.form; // the model's 'message' is a shape to everyone outside
  KINDS.forEach(kind => E[1][kind].forEach(b => {
    const a = ba.get(b);
    if (!a) { out.push({ s:b.s, c:{ element:element(b), tags:['added'], a:null, b:ref(b, 1), moved:null, renamed:null, fields:null } }); return; }
    const tags = [], c = { element:element(b), tags, a:ref(a, 0), b:ref(b, 1), moved:null, renamed:null, fields:null };
    if (kind === 'block') {
      const fa = keyA(a.parent), fb = b.parent ? b.parent.id : '', la = moveLevel(a, 0), lb = moveLevel(b, 1);
      // Move detection compares the top-down counts of moveLevel; the reported number is the level's own,
      // counted from the bottom of its holder, 1-based (level 1 is the lowest), like every level number.
      if (fa !== fb || la !== lb) c.moved = { from:{ in:a.parent ? a.parent.id : null, level:levelNo(a) }, to:{ in:b.parent ? b.parent.id : null, level:levelNo(b) } };
    } else if (keyA(a.owner) !== (b.owner ? b.owner.id : '')) c.moved = { from:{ in:a.owner ? a.owner.id : null, level:null }, to:{ in:b.owner ? b.owner.id : null, level:null } };
    if (c.moved) tags.push('moved');
    if (a.name !== b.name) { tags.push('renamed'); c.renamed = { from:a.name, to:b.name, similarity: Math.round(jac(feats(a, 0), feats(b, 1)) * 100) / 100 }; }
    c.fields = fieldsOf(a, b); if (c.fields) tags.push('changed');
    if (tags.length) out.push({ s:b.s, c });
  }));
  // The file's own levels (top level) are a change of element "file", which sorts first.
  { const lv = levelFields(m0.root, m1.root); if (lv) out.push({ s:-1, c:{ element:'file', tags:['changed'], a:ref(m0.root, 0), b:ref(m1.root, 1), moved:null, renamed:null, fields:{ levels:lv } } }); }
  out.sort((p, q) => p.s - q.s);
  const gone = [];
  KINDS.forEach(kind => E[0][kind].forEach(a => { if (!ab.has(a)) gone.push({ s:a.s, c:{ element:element(a), tags:['removed'], a:ref(a, 0), b:null, moved:null, renamed:null, fields:null } }); }));
  gone.sort((p, q) => p.s - q.s);
  const changes = [...out, ...gone].map(x => x.c);
  // ---------- Affected ports (§7.4) ----------
  // Stable ports: matched owner, same port name on both sides, not in the owner's fields.ports.
  const stable = [];
  [...E[1].block, ...E[1].behavior].forEach(b => {
    const a = ba.get(b); if (!a) return;
    const skip = portFields.get(b) || new Set(), pa = new Map(keyed(b.form === 'block' ? a.ownPorts : a.ports).map(x => [x.key, x.p]));
    keyed(b.form === 'block' ? b.ownPorts : b.ports).forEach(x => {
      const q = pa.get(x.key); if (!q || skip.has(x.p.name) || (x.p.dir !== 'in' && x.p.dir !== 'out') || q.dir !== x.p.dir) return;
      stable.push({ owner:b, name:x.p.name, dir:x.p.dir, ka:q.kind, kb:x.p.kind, lost:[], gained:[] });
    });
  });
  const cls = dir => { const g = new Map(); stable.filter(p => p.dir === dir).forEach(p => { const k = p.ka + '\u0001' + p.kb; if (!g.has(k)) g.set(k, []); g.get(k).push(p); }); return [...g.values()]; };
  const ins = cls('in'), outs = cls('out'), who = p => ({ owner:p.owner.id, port:p.name });
  ins.forEach(I => outs.forEach(O => {
    const ca = accepts(m0, I[0].ka, O[0].ka), cb = accepts(m1, I[0].kb, O[0].kb); if (ca === cb) return;
    I.forEach(p => O.forEach(q => { if (p === q) return; (ca ? p.lost : p.gained).push(who(q)); (ca ? q.lost : q.gained).push(who(p)); }));
  }));
  const cmp = (x, y) => x < y ? -1 : x > y ? 1 : 0;
  const byWho = (x, y) => cmp(x.owner, y.owner) || cmp(x.port, y.port);
  const affected = stable.filter(p => p.lost.length || p.gained.length).sort((p, q) => p.owner.s - q.owner.s || cmp(p.name, q.name))
    .map(p => ({ owner:p.owner.id, port:p.name, dir:p.dir, kind:p.kb, lost:p.lost.sort(byWho), gained:p.gained.sort(byWho) }));
  const count = t => changes.filter(c => c.tags.includes(t)).length;
  return { changes, affected, summary:{ added:count('added'), removed:count('removed'), moved:count('moved'), renamed:count('renamed'), changed:count('changed'), affected:affected.length } };
}
/*CORE-END*/
// @sbtel end Core.Diff
