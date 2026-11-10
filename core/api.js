// core/api.js: the stable entry points the CLI calls (docs/DESIGN.md §2). Loaded after core/core.js
// into the same scope, as plain script, in goja (the Go binary) and in node (conformance). DOM-free.
// Every public function takes strings (and JSON-able values) and returns a string of canonical JSON,
// so the host never walks JS objects: Go passes strings in and prints strings out.
var __api = (function () {
  // ---------- Canonical JSON ----------
  // Deterministic: keys sorted, Map/Set in iteration order as {"$map":[[k,v]...]} / {"$set":[...]},
  // back pointers (parent/owner/container) written as "@<id>", _ctx and functions dropped, objects
  // reached more than once get "$id" at first emission and {"$ref":n} after. Strings are escaped to
  // pure ASCII per UTF-16 code unit, so the bytes never depend on the engine or the host's UTF-8.
  // One regex pass, not a char-by-char +=: goja's string concatenation is linear per step, so the
  // loop was quadratic on long sources (a 600-block query took seconds). Same bytes as before.
  function escOne(ch) { var c = ch.charCodeAt(0); return c === 34 ? '\\"' : c === 92 ? '\\\\' : '\\u' + ('000' + c.toString(16)).slice(-4); }
  function esc(s) { return '"' + s.replace(/["\\\u0000-\u001f\u007f-\uffff]/g, escOne) + '"'; }
  var BACK = { parent: 1, owner: 1, container: 1 }, DROP = { _ctx: 1 };
  function canon(root, sortKeys) {
    var counts = new Map();
    function keysOf(x) { var ks = Object.keys(x).filter(function (k) { return !DROP[k] && typeof x[k] !== 'function' && x[k] !== undefined; }); return sortKeys ? ks.sort() : ks; }
    function isBack(k, v) { return BACK[k] && v && typeof v === 'object' && typeof v.id === 'string'; }
    function count(x) {
      if (!x || typeof x !== 'object') return;
      var n = (counts.get(x) || 0) + 1; counts.set(x, n); if (n > 1) return;
      if (x instanceof Map) x.forEach(function (v, k) { count(k); count(v); });
      else if (x instanceof Set) x.forEach(count);
      else if (Array.isArray(x)) x.forEach(count);
      else keysOf(x).forEach(function (k) { if (!isBack(k, x[k])) count(x[k]); });
    }
    count(root);
    var ids = new Map(), next = 0;
    function ser(x) {
      if (x === null || x === undefined) return 'null';
      var t = typeof x;
      if (t === 'string') return esc(x);
      if (t === 'number') return isFinite(x) ? (Object.is(x, -0) ? '-0' : String(x)) : esc('#' + String(x));
      if (t === 'boolean') return String(x);
      if (ids.has(x)) return '{"$ref":' + ids.get(x) + '}';
      var tag = '';
      if (counts.get(x) > 1) { ids.set(x, next); tag = '"$id":' + (next++) + ','; }
      if (x instanceof Map) { var a = []; x.forEach(function (v, k) { a.push('[' + ser(k) + ',' + ser(v) + ']'); }); return '{' + tag + '"$map":[' + a.join(',') + ']}'; }
      if (x instanceof Set) { var b = []; x.forEach(function (v) { b.push(ser(v)); }); return '{' + tag + '"$set":[' + b.join(',') + ']}'; }
      if (Array.isArray(x)) { var body = '[' + x.map(ser).join(',') + ']'; return tag ? '{' + tag + '"$arr":' + body + '}' : body; }
      var parts = keysOf(x).map(function (k) { var v = x[k]; return esc(k) + ':' + (isBack(k, v) ? esc('@' + v.id) : ser(v)); });
      return '{' + tag + parts.join(',') + '}';
    }
    return ser(root);
  }
  var J = function (x) { return canon(x, true); };

  // ---------- Positions and errors ----------
  function lineStarts(src) { var a = [0]; for (var i = src.indexOf('\n'); i >= 0; i = src.indexOf('\n', i + 1)) a.push(i + 1); return a; }
  function posOf(starts, pos) { // 1-based line and column (column in UTF-16 code units, as in the core's messages)
    var lo = 0, hi = starts.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: pos - starts[lo] + 1 };
  }
  // A parse error or warning text: the core ends them with "at L:C" or " (line L:C)".
  function located(text) {
    var m = /^(.*?)(?: at (\d+):(\d+)| \(line (\d+):(\d+)\))$/.exec(String(text));
    if (!m) return { message: String(text), line: null, col: null };
    return { message: m[1], line: +(m[2] || m[4]), col: +(m[3] || m[5]) };
  }
  function errorOf(e) { return located(e && e.message !== undefined ? e.message : e); }
  function load(src) {
    if (typeof src !== 'string') throw new TypeError('spec source must be a string');
    try { return { model: parse(src), error: null }; } catch (e) { return { model: null, error: errorOf(e) }; }
  }
  function counts(model) { return { blocks: model.blocks.size, behaviors: model.behaviors.size, messages: model.messages.size }; }
  function asList(x) { return typeof x === 'string' ? JSON.parse(x) : (x || []); }

  // ---------- lint ----------
  function lintObj(src) {
    var L = load(src);
    if (L.error) return { ok: false, error: L.error, warnings: [], checks: [], info: [], problems: 1, counts: null };
    var warnings = L.model.warnings.map(located).concat(formWarnings(src));
    var checks = lintSpec(L.model).map(function (c) { return { k: c.k, label: c.label, failures: c.f.slice() }; });
    var problems = warnings.length + checks.reduce(function (n, c) { return n + c.failures.length; }, 0);
    // Placement findings are information: never problems, never an exit code.
    var starts = lineStarts(src), info = placementFindings(L.model).map(function (f) {
      var p = posOf(starts, f.s);
      return { severity: 'info', message: f.text, line: p.line, col: p.col, kind: f.kind, name: f.name, in: f.in, home: f.home };
    });
    return { ok: problems === 0, error: null, warnings: warnings, checks: checks, info: info, problems: problems, counts: counts(L.model) };
  }
  function at(name, p) { return name + (p.line ? ':' + p.line + ':' + p.col : '') + ': '; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function lintText(name, r) {
    if (r.error) return at(name, r.error) + 'error: ' + r.error.message + '\n';
    var out = '';
    r.warnings.forEach(function (w) { out += at(name, w) + 'warning: ' + w.message + '\n'; });
    r.checks.forEach(function (c) { c.failures.forEach(function (f) { out += name + ': ' + c.label + ': ' + f + '\n'; }); });
    (r.info || []).forEach(function (f) { out += at(name, f) + 'info: ' + f.message + '\n'; });
    var tally = plural(r.counts.blocks, 'block') + ', ' + plural(r.counts.behaviors, 'behavior') + ', ' + plural(r.counts.messages, 'shape');
    return out + name + ': ' + (r.ok ? 'ok' : plural(r.problems, 'problem')) + ' (' + tally + ')\n';
  }

  // ---------- query ----------
  // Ids: a block id ("Shell.Turn", "Dup#2"), "β:Name" or "beh:Name" for a behavior, "μ:Name" or
  // "msg:Name" for a message type, or a bare name tried as block, then behavior, then message type.
  function resolve(model, id) {
    var m = /^(β|beh|μ|msg):(.*)$/.exec(id);
    if (m) return (m[1] === 'β' || m[1] === 'beh') ? model.behaviors.get(m[2]) || null : model.messages.get(m[2]) || null;
    return model.blocks.get(id) || model.behaviors.get(id) || model.messages.get(id) || null;
  }
  function kindOf(n) { return n.form === 'block' ? 'block' : n.form === 'behavior' ? 'behavior' : 'message'; }
  function describe(model, starts, n) {
    var holder = n.form === 'block' ? n.parent : n.owner, path = [];
    for (var x = holder; x; x = x.parent) path.unshift(x.id);
    var d = { id: n.id, kind: kindOf(n), name: n.name, in: holder ? holder.id : null, path: path, sketch: n.sketch || '',
      lines: { start: posOf(starts, n.s).line, end: posOf(starts, Math.max(n.s, n.e - 1)).line }, source: sliceAt(model.src, n, 0) };
    // :type grounds every kind the same way: what the element is in code.
    d.type = n.type === undefined ? null : n.type;
    if (n.form === 'block') {
      d.implements = n.impl.slice();
      d.ports = portsOf(n).map(function (p) { return { name: p.name, dir: p.dir, kind: p.kind, via: p.via || null, sketch: p.sketch || '' }; });
      d.levels = n.levels.map(function (L) { return { name: L.name || null, sketch: L.sketch || '', units: L.units.map(function (u) { return { sketch: u.sketch || '', blocks: u.blocks.map(function (b) { return b.id; }) }; }) }; });
    } else if (n.form === 'behavior') {
      d.params = n.params.slice();
      d.implements = n.impl.slice();
      d.ports = portsOf(n).map(function (p) { return { name: p.name, dir: p.dir, kind: p.kind, via: p.via || null, sketch: p.sketch || '' }; });
    } else { d.refines = n.refines; d.carries = n.carries.slice(); d.carriers = carriers(model, n.name); }
    return d;
  }
  // What a block's or behavior's (implements …) forms name: the behaviors, and the message types passed as
  // arguments (a behavior's own parameters are not declarations).
  function implUses(x, beh, msg) {
    if (x.form === 'message') return;
    x.impl.forEach(function (b) { if (!b) return; beh(b); (x.implArgs[b] || []).forEach(function (t) { if (t && !(x.form === 'behavior' && x.params.indexOf(t) >= 0)) msg(t); }); });
  }
  // Declarations that n's source text uses but does not contain, transitively, in source order.
  function depsOf(model, roots) {
    var all = [].concat(Array.from(model.blocks.values()), Array.from(model.behaviors.values()), Array.from(model.messages.values()));
    var inside = function (x, n) { return x.s >= n.s && x.e <= n.e; };
    var covered = function (x) { return roots.some(function (r) { return inside(x, r); }); };
    var found = new Map(), unresolved = new Set(), queue = roots.slice();
    function want(name, map) {
      var d = map.get(name);
      if (!d) { unresolved.add(name); return; }
      if (covered(d) || found.has(d)) return;
      found.set(d, true); queue.push(d);
    }
    while (queue.length) {
      var n = queue.shift();
      all.filter(function (x) { return inside(x, n); }).forEach(function (x) {
        implUses(x, function (b) { want(b, model.behaviors); }, function (t) { want(t, model.messages); });
        if (x.form === 'block') x.ownPorts.forEach(function (p) { if (p.kind) want(p.kind, model.messages); });
        else if (x.form === 'behavior') x.ports.forEach(function (p) { if (p.kind && x.params.indexOf(p.kind) < 0) want(p.kind, model.messages); });
        else [x.refines].concat(x.carries).forEach(function (t) { if (t) want(t, model.messages); });
      });
    }
    return { nodes: Array.from(found.keys()).sort(function (a, b) { return a.s - b.s; }), unresolved: Array.from(unresolved).sort() };
  }
  function queryObj(src, ids, withDeps, keep) {
    ids = asList(ids);
    var L = load(src);
    if (L.error) return { ok: false, error: L.error, results: [], deps: [], missing: [], unresolved: [], fragment: '', stubs: [], suggest: {} };
    var model = L.model, starts = lineStarts(src), seen = new Set(), nodes = [], missing = [], suggest = {};
    ids.forEach(function (id) {
      id = String(id); var n = resolve(model, id);
      if (!n) { if (missing.indexOf(id) < 0) { missing.push(id); suggest[id] = suggestIds(model, id); } }
      else if (!seen.has(n)) { seen.add(n); nodes.push(n); }
    });
    var D = withDeps ? depsOf(model, nodes) : { nodes: [], unresolved: [] }, F = fragmentOf(model, nodes, withDeps);
    if (keep) keep.fragment = F;
    return { ok: missing.length === 0, error: null,
      results: nodes.map(function (n) { return describe(model, starts, n); }),
      deps: D.nodes.map(function (n) { return describe(model, starts, n); }),
      missing: missing, unresolved: D.unresolved, fragment: F.text, stubs: F.stubs, suggest: suggest };
  }

  // ---------- check (code bindings against the spec's levels) ----------
  // parseBindings (the §2.5 edge syntax) lives in core.js, so the viewer and the CLI share one parser.
  function checkObj(src, bindingsText) {
    // A `# VIOLATION:` note travels with its violation; one on an allowed edge, or one with no edge
    // under it, is a warning (a stale or misplaced explanation). Warnings do not change the exit code.
    var L = load(src), B = parseBindings(bindingsText);
    var WHY = { blank: 'a blank line follows it', note: 'another VIOLATION note follows it', invalid: 'the line after it is not an edge', end: 'the file ends after it' };
    var warnings = B.orphans.map(function (o) { return { line: o.line, message: 'VIOLATION note explains no edge: ' + WHY[o.why] }; });
    if (L.error) return { ok: false, error: L.error, edges: B.edges.length, violations: [], invalid: B.invalid, warnings: warnings, explained: 0 };
    var violations = [];
    B.edges.forEach(function (e) {
      var v = bindingVerdict(L.model, e.caller, e.callee);
      if (!v.ok && v.rule === 'unknown') v = { ok: false, rule: v.rule, text: v.text + unknownHint(L.model, e.caller, e.callee) };
      // A bare name that is both a block's and a behavior's binds the block (bindingTarget); say so.
      if (L.model.blocks.has(e.callee) && L.model.behaviors.has(e.callee)) warnings.push({ line: e.line, message: e.callee + ' names a block and a behavior; this edge binds the block (write beh:' + e.callee + ' to bind the behavior)' });
      if (!v.ok) violations.push({ line: e.line, caller: e.caller, callee: e.callee, location: e.location, rule: v.rule, text: v.text, note: e.note });
      else if (e.note !== null) warnings.push({ line: e.line, message: 'VIOLATION note on an allowed edge: ' + e.caller + ' -> ' + e.callee + ' (' + v.rule + ')' });
    });
    warnings.sort(function (a, b) { return a.line - b.line; });
    var explained = violations.filter(function (v) { return v.note !== null; }).length;
    return { ok: violations.length === 0 && B.invalid.length === 0, error: null, edges: B.edges.length, violations: violations, invalid: B.invalid, warnings: warnings, explained: explained };
  }

  // ---------- diff (diffSpecs is workstream C; see docs/DESIGN.md §7) ----------
  function diffObj(a, b) {
    if (typeof diffSpecs !== 'function') return { ok: false, error: { side: null, message: 'diff is not implemented yet', line: null, col: null }, diff: null };
    var A = load(a), Bm = load(b);
    if (A.error || Bm.error) { var side = A.error ? 'a' : 'b', e = A.error || Bm.error; return { ok: false, error: { side: side, message: e.message, line: e.line, col: e.col }, diff: null }; }
    var d = diffSpecs(A.model, Bm.model);
    return { ok: true, error: null, diff: d };
  }

  // ======================= Workstream A (docs/DESIGN.md §10.A) =======================
  // ---------- lint: structural warnings the model builder accepts silently ----------
  // The core drops what it does not understand (an unknown form, a stray word, a port without a type).
  // These walk the reader's output and report each such thing as a warning, after the core's own.
  var ALLOWED = {
    file: ['block', 'level', 'adjacent', 'shape', 'behavior'],
    block: ['block', 'level', 'adjacent', 'takes', 'gives', 'shape', 'behavior', 'implements', 'sketch', 'ref'],
    level: ['block', 'adjacent', 'sketch'], adjacent: ['block', 'adjacent', 'sketch'], port: ['sketch'],
    message: ['sketch', 'refines', 'carries', 'ref'], behavior: ['takes', 'gives', 'sketch', 'implements', 'ref'], ref: ['sketch']
  };
  function formWarnings(src) {
    var out = [], starts = lineStarts(src);
    function warn(msg, pos) { var p = posOf(starts, pos); out.push({ message: msg, line: p.line, col: p.col }); }
    var isSym = function (x) { return !!x && x.t === 'sym'; };
    var isName = function (x) { return isSym(x) && x.v.charAt(0) !== ':'; };
    // nested: an adjacent group inside another, whose sketch the outer group's replaces.
    function kids(ctx, where, items, nested) {
      var seen = {};
      for (var i = 0; i < items.length; i++) {
        var x = items[i];
        if (!x.list) {
          if (isSym(x) && x.v.charAt(0) === ':' && (ctx === 'block' || ctx === 'behavior' || ctx === 'message')) { warn('keyword ' + x.v + ' must come right after the name of ' + where, x.s); if (items[i + 1] && !items[i + 1].list) i++; }
          else if (isSym(x) && x.v.charAt(0) === ':' && ctx === 'level') { warn('keyword ' + x.v + ' must come right after (level', x.s); if (items[i + 1] && !items[i + 1].list) i++; }
          else warn('stray ' + (x.t === 'str' ? 'string' : x.v) + ' in ' + where + ' (expected a form)', x.s);
          continue;
        }
        var h = x.list[0];
        if (!isSym(h)) { warn((x.list.length ? 'a form must start with its name' : 'empty form ()') + ' in ' + where, x.s); continue; }
        if (!FORMS.has(h.v)) { warn('unknown form (' + h.v + ') in ' + where, x.s); continue; }
        if (ctx === 'behavior' && NOT_IN_BEHAVIOR[h.v]) continue;  // the core reports it: declare it beside the behavior
        if (ALLOWED[ctx].indexOf(h.v) < 0) { warn('(' + h.v + ') is not allowed in ' + where, x.s); continue; }
        if ((h.v === 'sketch' || h.v === 'refines' || h.v === 'carries') && seen[h.v]) warn(where + ' has more than one (' + h.v + '); only the first counts', x.s);
        else if (h.v === 'sketch' && nested) warn('a nested adjacent group has no sketch of its own; put it in the outer (adjacent)', x.s);
        seen[h.v] = true;
        form(h.v, x, ctx === 'adjacent');
      }
    }
    // The keywords right after a declaration's name, one grammar for block, behavior and message (the
    // core's declHead): :type is the one keyword (v0.2 dropped :fill and free :key value pairs). Returns the
    // index of the first body item.
    function keywords(kind, name, it) {
      var i = 1;
      for (; i < it.length && isSym(it[i]) && it[i].v.charAt(0) === ':'; i += 2) {
        var v = it[i + 1];
        if (it[i].v !== ':type') warn('unknown keyword ' + it[i].v + ' in ' + kind + ' ' + name + '; a ' + kind + ' takes only :type', it[i].s);
        if (!v || v.list || (isSym(v) && v.v.charAt(0) === ':')) { warn('keyword ' + it[i].v + ' of ' + kind + ' ' + name + ' needs a value', it[i].s); if (v && isSym(v)) i--; }
      }
      return i;
    }
    function form(h, x, inAdjacent) {
      var it = x.list.slice(1), nm = it[0];
      // (takes Shape …) and (gives Shape …) are checked as one thing, a port with a direction.
      var verb = h === 'takes' || h === 'gives' ? h : null;
      if (verb) { it = [{ t: 'sym', v: verb === 'takes' ? ':in' : ':out', s: x.s, e: x.s }].concat(it); h = 'port'; }
      if (h === 'shape') h = 'message';
      if (h === 'block') {
        if (!isName(nm)) { warn('block needs a name', x.s); return kids('block', 'a block', it.filter(function (y) { return y.list; })); }
        return kids('block', 'block ' + nm.v, it.slice(keywords('block', nm.v, it)));
      }
      if (h === 'level') {
        // Keywords right after `level`: :name "a non-empty string", once. Nothing else is a level keyword.
        var j = 0, named = false;
        for (; j < it.length && isSym(it[j]) && it[j].v.charAt(0) === ':'; j += 2) {
          var kv = it[j + 1], key = it[j].v;
          if (!kv || kv.list || (isSym(kv) && kv.v.charAt(0) === ':')) { warn('keyword ' + key + ' of a level needs a value', it[j].s); j--; continue; }
          if (key !== ':name') warn('unknown keyword ' + key + ' in a level; a level takes only :name', it[j].s);
          else if (named) warn('a level has more than one :name; only the first counts', it[j].s);
          else if (kv.t !== 'str') warn('level :name takes a "string"', kv.s);
          else if (!kv.v.trim()) warn('level :name is empty', kv.s);
          if (key === ':name') named = true;
        }
        return kids('level', 'a level', it.slice(j));
      }
      if (h === 'adjacent') return kids('adjacent', 'an adjacent group', it, inAdjacent);
      if (h === 'port') {
        // (port :in|:out Type [:as name] [sketch]). The core reports the 0.2 form, a bad direction and two
        // ports with one name.
        var pp = portParts(it);
        var vb = pp.dir === 'in' ? 'takes' : 'gives';
        if (!isName(it[1])) { warn(vb + ' needs a shape: (' + vb + ' Shape [:as name])', x.s); return; }
        var pn = 'port ' + pp.name, j = 2, named = false;
        for (; j < it.length && isSym(it[j]) && it[j].v.charAt(0) === ':'; j += 2) {
          var av = it[j + 1];
          if (it[j].v !== ':as') warn('unknown keyword ' + it[j].v + ' in a port; a port takes only :as name', it[j].s);
          else if (named) warn(pn + ' has more than one :as; only the first counts', it[j].s);
          if (!isName(av)) { warn('keyword ' + it[j].v + ' of a port needs a name', it[j].s); if (!av || av.list || isSym(av)) j--; }
          else if (it[j].v === ':as') named = true;
        }
        // After the type and :as, only a sketch: (port :in KeyChord (sketch "…")) or (~ … ~).
        var extra = it.slice(j), bad = extra.filter(function (y) { return !(y.list && isSym(y.list[0]) && y.list[0].v === 'sketch'); });
        kids('port', pn, extra.filter(function (y) { return bad.indexOf(y) < 0; }));
        if (bad.length) warn(pn + ' has extra items after its shape' + (isSym(bad[0]) && !named && j === 2 && extra.length === 1 ? ' (to name it, write :as ' + bad[0].v + ')' : ''), bad[0].s);
        return;
      }
      // (implements Name), or (implements (Name Arg ...)) for a behavior with parameters.
      if (h === 'implements') { if (it.length !== 1 || !(isName(nm) || (nm.list && nm.list.length > 1 && nm.list.every(isName)))) warn('implements names exactly one behavior, as Name or (Name Arg ...)', x.s); return; }
      if (h === 'refines') { if (it.length !== 1 || !isName(nm)) warn('refines names exactly one shape', x.s); return; }
      if (h === 'carries') {
        if (!it.length || !it.every(isName)) warn('carries names one or more shapes', x.s);
        var seenC = {}; it.forEach(function (y) { if (isName(y)) { if (seenC[y.v]) warn('carries names ' + y.v + ' twice', y.s); seenC[y.v] = true; } });
        return;
      }
      if (h === 'sketch') { if (!it.length || it.some(function (y) { return y.list; })) warn('sketch takes a "string"', x.s); return; }
      if (h === 'ref') {
        if (!nm || nm.list || (isSym(nm) && nm.v.charAt(0) === ':')) { warn('ref needs a path: (ref path) or (ref "a path")', x.s); return; }
        var rp = refParts(nm.v);
        if (!rp.url && (/^([\\/]|[A-Za-z]:[\\/])/.test(rp.file) || rp.file.split(/[\\/]/).indexOf('..') >= 0)) warn('ref ' + nm.v + ' leaves the spec\'s directory; a ref is a path beside or below the spec', nm.s);
        return kids('ref', 'ref ' + nm.v, it.slice(1));
      }
      if (h === 'message') {
        if (!isName(nm)) { warn('shape needs a name', x.s); return; }
        return kids('message', 'shape ' + nm.v, it.slice(keywords('shape', nm.v, it)));
      }
      if (h === 'behavior') {
        var ok = isName(nm) || (nm && nm.list && nm.list.length && nm.list.every(isName));
        if (!ok) { warn('behavior needs a name, or (Name Param ...)', x.s); return; }
        var bn = nm.list ? nm.list[0].v : nm.v;
        return kids('behavior', 'behavior ' + bn, it.slice(keywords('behavior', bn, it)));
      }
    }
    kids('file', 'the file', readAll(src));
    return out;
  }

  // ---------- "did you mean": close names for an id that names nothing ----------
  function editDistance(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev.push(j);
    for (i = 1; i <= a.length; i++) {
      cur = [i]; var lo = i;
      for (j = 1; j <= b.length; j++) { cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))); lo = Math.min(lo, cur[j]); }
      if (lo > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  var tail = function (s) { var i = s.lastIndexOf('.'); return i < 0 ? s : s.slice(i + 1); };
  // Up to 3 ids of the closest kind of match: same name ignoring case, then the same last dotted part (Turn finds
  // Shell.Turn), then edit distance ≤ max(1, ⌊len/3⌋). kinds limits the candidates ('block' for check).
  function suggestIds(model, id, kinds) {
    var m = /^(β|beh|μ|msg):(.*)$/.exec(id), want = (m ? m[2] : id).toLowerCase(), wt = tail(want), c = [];
    var capOf = function (s) { return Math.max(1, Math.floor(s.length / 3)); }, cap = capOf(want), capT = capOf(wt);
    var only = kinds || (m ? (m[1] === 'β' || m[1] === 'beh' ? 'behavior' : 'message') : null);
    var has = function (k) { return !only || only.split(',').indexOf(k) >= 0; };
    var add = function (show, name, order) {
      var n = name.toLowerCase(), t = tail(n), d = n === want ? 0 : t === want || t === wt ? 1 : 99;
      if (d === 99) { var df = editDistance(want, n, cap), dt = editDistance(wt, t, capT); d = 2 + Math.min(df <= cap ? df : 99, dt <= capT ? dt : 99); }
      if (d < 99) c.push({ show: show, score: d, order: order });
    };
    var k = 0;
    if (has('block')) model.blocks.forEach(function (b) { add(b.id, b.id, k++); });
    if (has('behavior')) model.behaviors.forEach(function (b) { add(model.blocks.has(b.name) || only === 'behavior' ? 'beh:' + b.name : b.name, b.name, k++); });
    if (has('message')) model.messages.forEach(function (x) { add(model.blocks.has(x.name) || model.behaviors.has(x.name) || only ? 'msg:' + x.name : x.name, x.name, k++); });
    c.sort(function (p, q) { return p.score - q.score || p.order - q.order; });
    c = c.filter(function (x) { return x.show !== id; });
    return c.filter(function (x) { return x.score === c[0].score; }).slice(0, 3).map(function (x) { return x.show; });  // the closest tier only
  }
  // The hint after an `unknown` verdict. A caller is a block; a callee is a block or a behavior (§2.5).
  function unknownHint(model, a, b) {
    var caller = !model.blocks.has(a), miss = caller ? a : !bindingTarget(model, b) ? b : null;
    if (!miss) return '';
    var bare = miss.replace(/^(β|beh):/, '');
    if (caller && (model.behaviors.has(a) || /^(β|beh):/.test(a) && model.behaviors.has(bare))) return ' (' + bare + ' is a behavior; a binding\'s caller is a block)';
    if (model.messages.has(bare)) return ' (' + bare + ' is a shape; bindings name blocks' + (caller ? '' : ' and behaviors') + ')';
    var s = suggestIds(model, miss, caller ? 'block' : 'block,behavior');
    return s.length ? ' (did you mean ' + s.join(', ') + '?)' : '';
  }

  // ---------- query: the selection as a self-contained spec fragment ----------
  // The fragment is a spec that lint accepts whenever the original does: each selected element's own
  // source; the enclosing blocks as skeletons (name, keywords, sketch, and only the levels and adjacent
  // groups that lead to something shown); every behavior and message type that the shown text uses,
  // transitively, in the block that declares it (so scope is as in the original); and, withDeps, the
  // blocks the selection may bind to (bindingVerdict ok: lower levels and adjacent peers of the block
  // and of each of its ancestors) as collapsed stubs (keywords, implements, ports, sketch). Descendants
  // are inside the selection's own source. Returns { text, stubs: ids in source order, unresolved }.
  function fragmentOf(model, nodes, withDeps) {
    var src = model.src, root = model.root, all = [];
    model.blocks.forEach(function (b) { all.push(b); }); model.behaviors.forEach(function (b) { all.push(b); }); model.messages.forEach(function (b) { all.push(b); });
    var inside = function (x, n) { return x !== n && x.s >= n.s && x.e <= n.e; };
    var full = nodes.filter(function (n) { return !nodes.some(function (r) { return inside(n, r); }); });
    var isFull = new Set(full), covered = function (x) { return isFull.has(x) || full.some(function (r) { return inside(x, r); }); };
    var tree = new Map();  // root or block -> { stub, decls }
    var up = function (x) { return x === root ? null : x.form === 'block' ? holderOf(x) : (x.owner || root); };
    function chain(b) { for (var x = b; x && !tree.has(x); x = up(x)) tree.set(x, { stub: false, decls: [] }); }
    // Full elements: blocks sit in their holder's levels, declarations in their declaring block.
    full.forEach(function (n) { if (n.form === 'block') chain(holderOf(n)); else { chain(n.owner || root); tree.get(n.owner || root).decls.push(n); } });
    var stubs = [];
    if (withDeps) {
      var seenS = new Set();
      full.forEach(function (A) {
        if (A.form !== 'block') return;
        for (var X = A; X; X = X.parent) {
          var H = holderOf(X), w = null;
          H.levels.forEach(function (L, li) { L.units.forEach(function (u, ui) { if (u.blocks.indexOf(X) >= 0) w = { li: li, ui: ui }; }); });
          if (!w) continue;
          H.levels.forEach(function (L, li) { L.units.forEach(function (u, ui) { u.blocks.forEach(function (c) {
            if (c !== X && (li > w.li || (li === w.li && ui === w.ui)) && !seenS.has(c) && !covered(c)) { seenS.add(c); stubs.push(c); }
          }); }); });
        }
      });
      stubs.sort(function (a, b) { return a.s - b.s; });
      stubs.forEach(function (s) { chain(s); tree.get(s).stub = true; });
    }
    // Declarations the shown text uses, transitively; each goes to its declaring block (made a skeleton).
    var need = new Set(), unresolved = new Set(), queue = [];
    function want(nm, map) { if (!nm) return; var d = map.get(nm); if (!d) { unresolved.add(nm); return; } if (!need.has(d)) { need.add(d); queue.push(d); } }
    function uses(x) {
      implUses(x, function (b) { want(b, model.behaviors); }, function (t) { want(t, model.messages); });
      if (x.form === 'block') x.ownPorts.forEach(function (p) { want(p.kind, model.messages); });
      else if (x.form === 'behavior') x.ports.forEach(function (p) { if (p.kind && x.params.indexOf(p.kind) < 0) want(p.kind, model.messages); });
      else [x.refines].concat(x.carries).forEach(function (t) { want(t, model.messages); });
    }
    var usesIn = function (n) { all.forEach(function (x) { if (x === n || inside(x, n)) uses(x); }); };
    full.forEach(usesIn);
    stubs.forEach(function (s) { uses(s); });
    var shownDecls = [];
    while (queue.length) {
      var d = queue.shift();
      if (covered(d)) continue;
      shownDecls.push(d); usesIn(d);
    }
    shownDecls.forEach(function (d) {
      if (shownDecls.some(function (e) { return inside(d, e); })) return;  // nested in another shown declaration
      chain(d.owner || root); tree.get(d.owner || root).decls.push(d);
    });
    // Render, two spaces per level.
    var pad = function (n) { return new Array(n + 1).join('  '); };
    var shown = function (c) { return isFull.has(c) || tree.has(c); };
    function close(lines, depth) { var last = lines[lines.length - 1]; if (/^\s*;/.test(last.split('\n').pop())) lines.push(pad(depth) + ')'); else lines[lines.length - 1] = last + ')'; }
    function text(n, depth) { return pad(depth) + sliceAt(src, n, depth * 2); }
    function header(b) {
      var its = itemsOf(src, b), h = '(block ' + (its[1] ? src.slice(its[1].s, its[1].e) : '?');
      for (var i = 2; i < its.length && its[i].t === 'sym' && its[i].v.charAt(0) === ':'; i += 2) h += ' ' + its[i].v + (its[i + 1] && !its[i + 1].list ? ' ' + src.slice(its[i + 1].s, its[i + 1].e) : '');
      return h;
    }
    function blockLines(b, depth) {
      if (isFull.has(b)) return [text(b, depth)];
      var info = tree.get(b), lines = [pad(depth) + header(b)];
      if (info.stub) {
        if (hasInside(b) && !childBlocks(b).some(shown)) lines.push(pad(depth + 1) + '; collapsed: ' + countText(b));
        b.children.forEach(function (c) { if (c.form === 'implements' || c.form === 'port') lines.push(text(c, depth + 1)); });
      }
      var sk = b.children.filter(function (c) { return c.form === 'sketch'; })[0];
      if (sk) lines.push(text(sk, depth + 1));
      lines = lines.concat(inner(b, depth + 1));
      close(lines, depth);
      return lines;
    }
    function inner(b, depth) {
      var lines = tree.get(b).decls.slice().sort(function (p, q) { return p.s - q.s; }).map(function (d) { return text(d, depth); });
      // Kept levels and groups carry their own label and sketch: a level with a :name or a sketch is written
      // as (level :name "…" (sketch …)) even when it is the only one kept, and a group of two or more shown
      // blocks keeps its sketch. Keywords and sketches are copied as written, so (~ … ~) stays (~ … ~).
      var kept = b.levels.map(function (L) { return { L: L, units: L.units.map(function (u) { return { u: u, bs: u.blocks.filter(shown) }; }).filter(function (x) { return x.bs.length; }) }; }).filter(function (x) { return x.units.length; });
      var skLine = function (n, d) { var sk = n.children.filter(function (c) { return c.form === 'sketch'; })[0]; return sk ? [text(sk, d)] : []; };
      var unit = function (x, d) {
        if (x.bs.length === 1) return blockLines(x.bs[0], d);
        var ls = [pad(d) + '(adjacent'].concat(x.u.node.form === 'adjacent' ? skLine(x.u.node, d + 1) : []);
        x.bs.forEach(function (c) { ls = ls.concat(blockLines(c, d + 1)); }); close(ls, d); return ls;
      };
      var levelHead = function (L) {
        var h = '(level';
        if (L.node) { var its = itemsOf(src, L.node); for (var i = 1; i < its.length && its[i].t === 'sym' && its[i].v.charAt(0) === ':'; i += 2) if (its[i + 1] && !its[i + 1].list) h += ' ' + its[i].v + ' ' + src.slice(its[i + 1].s, its[i + 1].e); }
        return h;
      };
      kept.forEach(function (K) {
        var labelled = K.L.node && (K.L.name || K.L.sketch);
        if (kept.length === 1 && !labelled) { K.units.forEach(function (x) { lines = lines.concat(unit(x, depth)); }); return; }
        var ls = [pad(depth) + levelHead(K.L)].concat(K.L.node ? skLine(K.L.node, depth + 1) : []);
        K.units.forEach(function (x) { ls = ls.concat(unit(x, depth + 1)); }); close(ls, depth); lines = lines.concat(ls);
      });
      return lines;
    }
    var body = tree.has(root) ? inner(root, 0) : [];
    return { text: body.length ? body.join('\n') + '\n' : '', stubs: stubs.map(function (s) { return s.id; }), unresolved: Array.from(unresolved).sort() };
  }

  // ---------- Text formats (docs/DESIGN.md §3.4, §3.5, §7.5) ----------
  function checkText(specName, bindName, r) {
    var out = '';
    if (r.error) out += at(specName, r.error) + 'error: ' + r.error.message + '\n';
    r.violations.forEach(function (v) {
      out += bindName + ':' + v.line + ': ' + v.caller + ' -> ' + v.callee + ': ' + v.rule + ': ' + v.text + (v.location ? '  (' + v.location + ')' : '') + '\n';
      if (v.note !== null) out += '  VIOLATION: ' + v.note + '\n';
    });
    r.invalid.forEach(function (v) { out += bindName + ':' + v.line + ': error: not an edge: ' + v.text + '\n'; });
    r.warnings.forEach(function (w) { out += bindName + ':' + w.line + ': warning: ' + w.message + '\n'; });
    if (!r.error) out += specName + ': ' + plural(r.edges, 'binding') + ', ' + r.violations.length + ' not allowed' + (r.violations.length ? ', ' + r.explained + ' explained' : '') + '\n';
    return out;
  }
  function queryText(name, ids, withDeps, r, F) {
    if (r.error) return at(name, r.error) + 'error: ' + r.error.message + '\n';
    if (!r.results.length) return '';
    var out = '; sbtel query ' + name + ' ' + ids.join(' ') + (withDeps ? ' --with-deps' : '') + '\n';
    r.results.forEach(function (e) {
      out += '; ' + e.id + ': ' + (e.kind === 'message' ? 'shape' : e.kind) + ' in ' + (e.path.length ? e.path.join(' > ') : 'the file') + ', lines ' + e.lines.start + '-' + e.lines.end + '\n';
      if (e.kind === 'message' && e.carriers.messages.length) out += ';   carried by ' + e.carriers.messages.join(', ') + (e.carriers.blocks.length ? '; on the ports of ' + e.carriers.blocks.join(', ') : '') + '\n';
    });
    if (withDeps) out += '; may bind to (collapsed): ' + (F.stubs.length ? F.stubs.join(', ') : 'nothing else') + '\n';
    if (F.unresolved.length) out += '; unresolved: ' + F.unresolved.join(', ') + '\n';
    return out + F.text;
  }
  // DiffResult (§7.1) as text (§7.5).
  function diffText(d) {
    var out = '', nn = function (x) { return x == null ? 'none' : quoteStr(x); };
    var where = function (x) { return x == null ? 'the file' : x; };
    var place = function (p) { return where(p.in) + (p.level == null ? '' : ' level ' + p.level); };
    var refName = function (el, r) { return el === 'block' ? r.id : r.name; };
    var port = function (p) { return (p.dir || '?') + ' ' + p.name + ': ' + (p.kind || '?'); };
    // A word diff's changed runs; a paragraph break prints as ¶ so each change stays on one line.
    var words = function (w) { return (w || []).filter(function (x) { return x.op !== '='; }).map(function (x) { var t = x.text.replace(/\n\n/g, '¶'); return x.op === '-' ? '[-' + t + '-]' : '{+' + t + '+}'; }).join(' '); };
    var levelPart = function (e) {
      var n = 'level ' + e.level, out = [];
      if (e.name) out.push(n + ' name ' + nn(e.name.from) + ' -> ' + nn(e.name.to));
      if (e.sketch) out.push(n + ' sketch ' + words(e.sketch.words));
      (e.groups || []).forEach(function (g) { out.push(n + ' adjacent (' + g.blocks.join(' ') + ') sketch ' + words(g.sketch.words)); });
      return out.join('; ');
    };
    var set = function (s, fmt) { fmt = fmt || String; return [].concat((s.added || []).map(function (x) { return '+' + fmt(x); }), (s.removed || []).map(function (x) { return '-' + fmt(x); })).join(' '); };
    (d.changes || []).forEach(function (c) {
      var r = c.b || c.a, head = c.element === 'file' ? 'the file' : (c.element === 'message' ? 'shape' : c.element) + ' ' + refName(c.element, r);
      if (c.tags.indexOf('added') >= 0) { out += '+ ' + head + ' (in ' + where(c.b.in) + ')\n'; return; }
      if (c.tags.indexOf('removed') >= 0) { out += '- ' + head + ' (was in ' + where(c.a.in) + ')\n'; return; }
      var parts = [], f = c.fields || {};
      if (c.renamed) parts.push('renamed from ' + c.renamed.from + ' (' + Number(c.renamed.similarity).toFixed(2) + ')');
      if (c.moved) parts.push('moved from ' + place(c.moved.from) + ' to ' + place(c.moved.to));
      if (f.type) parts.push('type ' + nn(f.type.from) + ' -> ' + nn(f.type.to));
      if (f.sketch) parts.push('sketch ' + words(f.sketch.words));
      if (f.implements) parts.push('implements ' + set(f.implements));
      var portChange = function (x) { var t = x.from.dir !== x.to.dir || x.from.kind !== x.to.kind; return '~' + port(x.from) + (t ? ' -> ' + port(x.to) : '') + (x.sketch ? ' sketch ' + words(x.sketch.words) : ''); };
      if (f.ports) parts.push('ports ' + [set(f.ports, port)].concat((f.ports.changed || []).map(portChange)).filter(Boolean).join(' '));
      if (f.drawer) parts.push('drawer ' + ['in', 'out'].filter(function (k) { return f.drawer[k] && set(f.drawer[k]); }).map(function (k) { return k + ' ' + set(f.drawer[k]); }).join(' '));
      if (f.adjacency) parts.push('adjacency ' + set(f.adjacency));
      (f.levels || []).forEach(function (e) { parts.push(levelPart(e)); });
      if (f.params) parts.push('params (' + f.params.from.join(' ') + ') -> (' + f.params.to.join(' ') + ')');
      if (f.refines) parts.push('refines ' + (f.refines.from || 'none') + ' -> ' + (f.refines.to || 'none'));
      if (f.carries) parts.push('carries ' + set(f.carries));
      out += '~ ' + head + ': ' + parts.join('; ') + '\n';
    });
    var pp = function (l) { return l.map(function (x) { return x.owner + '.' + x.port; }).join(', '); };
    (d.affected || []).forEach(function (a) {
      out += '! port ' + a.owner + '.' + a.port + ' (' + a.dir + ' ' + a.kind + '): ' + [a.lost && a.lost.length ? 'lost ' + pp(a.lost) : '', a.gained && a.gained.length ? 'gained ' + pp(a.gained) : ''].filter(Boolean).join('; ') + '\n';
    });
    var s = d.summary || {}, n = (d.changes || []).length, k = (d.affected || []).length;
    if (!n && !k) return out + 'no changes\n';
    return out + plural(n, 'change') + ' (' + (s.added || 0) + ' added, ' + (s.removed || 0) + ' removed, ' + (s.moved || 0) + ' moved, ' + (s.renamed || 0) + ' renamed, ' + (s.changed || 0) + ' changed), ' + plural(k, 'affected port') + '\n';
  }
  function usage(cmd, line) { return J({ exit: 2, stdout: '', stderr: 'sbtel ' + cmd + ': ' + line + '\n' }); }
  // ===================== end of workstream A's block (cli below dispatches to it) =====================

  // ---------- CLI glue: one call per command, returns {exit, stdout, stderr} ----------
  // args.files: [{ name, src }] already read by the host; IO errors never reach here (exit 2 in Go).
  function cli(cmd, args) {
    args = typeof args === 'string' ? JSON.parse(args) : args;
    var out = '', err = '', exit = 0;
    if (cmd === 'lint') {
      if (!args.files || !args.files.length) return J({ exit: 2, stdout: '', stderr: 'usage: sbtel lint <spec>|- ... [--json]\n' });
      args.files.forEach(function (f) {
        var r = lintObj(f.src);
        if (!r.ok) exit = 1;
        if (args.json) { r.file = f.name; out += J(r) + '\n'; } else out += lintText(f.name, r);
      });
    } else if (cmd === 'check') {
      if (!args.files || args.files.length !== 1 || !args.bindings) return usage('check', 'usage: sbtel check <spec>|- --bindings <edges.txt>|- [--json]');
      var spec = args.files[0], bf = args.bindings, cr = checkObj(spec.src, bf.src);
      exit = cr.invalid.length ? 2 : cr.ok ? 0 : 1;
      if (args.json) { cr.file = spec.name; cr.bindingsFile = bf.name; out = J(cr) + '\n'; } else out = checkText(spec.name, bf.name, cr);
    } else if (cmd === 'query') {
      var ids = (args.ids || []).map(String);
      if (!args.files || args.files.length !== 1 || !ids.length) return usage('query', 'usage: sbtel query <spec>|- <id>... [--with-deps] [--json]');
      var keep = {}, qr = queryObj(args.files[0].src, ids, !!args.withDeps, keep);
      qr.missing.forEach(function (id) { var s = qr.suggest[id]; err += 'sbtel query: no element ' + id + (s && s.length ? ' (did you mean ' + s.join(', ') + '?)' : '') + '\n'; });
      exit = qr.missing.length ? 2 : qr.error ? 1 : 0;
      if (args.json) { qr.file = args.files[0].name; out = J(qr) + '\n'; } else out = queryText(args.files[0].name, ids, !!args.withDeps, qr, keep.fragment);
    } else if (cmd === 'diff') {
      if (!args.files || args.files.length !== 2) return usage('diff', 'usage: sbtel diff <a> <b> [--json]');
      var fa = args.files[0], fb = args.files[1], dr = diffObj(fa.src, fb.src);
      exit = !dr.ok ? 2 : (dr.diff.changes || []).length || (dr.diff.affected || []).length ? 1 : 0;
      if (args.json) { dr.a = fa.name; dr.b = fb.name; out = J(dr) + '\n'; }
      else if (dr.ok) out = diffText(dr.diff);
      if (!dr.ok) { var de = dr.error; err += 'sbtel diff: ' + (de.side ? at(de.side === 'a' ? fa.name : fb.name, de) + 'error: ' : '') + de.message + '\n'; }
    } else return J({ exit: 2, stdout: '', stderr: 'sbtel: unknown command ' + cmd + '\n' });
    return J({ exit: exit, stdout: out, stderr: err });
  }

  // ---------- Conformance: viewer edits round-trip (tests only) ----------
  // One sketch (or level name) edit, as the viewer makes it, then a fresh parse of the result. c.on names
  // what to edit: block:Id, beh:Name, msg:Name, port:Owner.port (Owner a block id or β:Name), level:Id|i
  // or group:Id|i|u (Id '' is the file). The record holds the new text, the sketch read back and the
  // sketch meant (the edit's text normalized by the form it is written in); `same` says they agree.
  function editCase(src, c) {
    var m = parse(src), on = String(c.on), k = on.indexOf(':'), kind = on.slice(0, k), id = on.slice(k + 1), act, read, want;
    var holder = function (x) { return x ? m.blocks.get(x) : m.root; };
    var portsNow = null;
    if (kind === 'port') {
      // A port edit as the port editor makes it: c.sketch, and (v0.3) c.name, c.dir, c.kind, or c.delete.
      // The record adds the owner's own ports read back (ports), so renames round-trip too.
      var dot = id.lastIndexOf('.'), oid = id.slice(0, dot), owner = m.node(oid), pn = id.slice(dot + 1);
      var own = owner.children.filter(function (x) { return x.form === 'port'; }), node = own.filter(function (x) { return x.name === pn; })[0];
      var nn = c.name != null ? c.name : pn;
      act = { t: 'props', node: owner, ports: own.filter(function (x) { return !(c['delete'] && x === node); }).map(function (x) {
        return x === node ? { node: x, name: nn, dir: c.dir || x.dir, kind: c.kind || x.kind, sketch: c.sketch }
          : { node: x, name: x.name, dir: x.dir, kind: x.kind }; }) };
      want = c['delete'] ? null : c.sketch == null ? node.sketch : sketchNorm(c.sketch, node.children.filter(function (x) { return x.form === 'sketch'; })[0]);
      read = function (m2) { var q = portsOf(m2.node(oid)).filter(function (p) { return p.name === nn && !p.via; })[0]; return c['delete'] ? (q ? 'still there' : null) : q.sketch; };
      portsNow = function (m2) { return m2.node(oid).children.filter(function (x) { return x.form === 'port'; }).map(function (x) { return { name: x.name, as: x.as, dir: x.dir, kind: x.kind }; }); };
    } else if (kind === 'attach') {
      // Shift-attach of a message type to a block: a new port named by freePortName (attachCandidates).
      var B = m.blocks.get(id), cand = attachCandidates(m, 'μ:' + c.kind, new Set([id])).filter(function (a) { return a.block === B && a.dir === c.dir; })[0];
      act = cand; want = '';
      read = function (m2) { var q = m2.blocks.get(id).children.filter(function (x) { return x.form === 'port'; }).pop(); return q.name === cand.name && q.kind === c.kind ? q.sketch : 'wrong port ' + q.name; };
      portsNow = function (m2) { return m2.blocks.get(id).children.filter(function (x) { return x.form === 'port'; }).map(function (x) { return { name: x.name, as: x.as, dir: x.dir, kind: x.kind }; }); };
    } else if (kind === 'level' || kind === 'group') {
      var parts = id.split('|'), H = holder(parts[0]), at = +parts[1], L = H.levels[at];
      if (kind === 'level') { act = { t: 'levelProps', block: H, at: at, name: c.name == null ? (L.name || '') : c.name, sketch: c.sketch }; want = tildeText(c.sketch); }
      else { var U = L.units[+parts[2]]; act = { t: 'groupSketch', node: U.node, sketch: c.sketch }; want = sketchNorm(c.sketch, U.node.children.filter(function (x) { return x.form === 'sketch'; })[0]); }
      read = function (m2) { var L2 = (parts[0] ? m2.blocks.get(parts[0]) : m2.root).levels[at]; if (kind === 'level' && c.name != null && (L2.name || '') !== c.name.trim()) throw new Error('name read back as ' + L2.name); return kind === 'level' ? L2.sketch : L2.units[+parts[2]].sketch; };
    } else {
      var n = m.node(kind === 'beh' ? 'β:' + id : kind === 'msg' ? 'μ:' + id : id);
      // c.name (v0.3) renames the element too: a message type's rename rewrites the ports typed with it.
      act = { t: 'props', node: n, sketch: c.sketch }; if (c.name != null) act.name = c.name;
      want = c.sketch == null ? n.sketch : sketchNorm(c.sketch, n.children.filter(function (x) { return x.form === 'sketch'; })[0]);
      var nid = c.name == null ? n.id : n.id.replace(/[^:]*$/, c.name);
      read = function (m2) { return m2.node(nid).sketch; };
    }
    var out = applyEdit(src, m, act).src, back = null, err = null, ports;
    try { var m2 = parse(out); back = read(m2); if (portsNow) ports = portsNow(m2); } catch (e) { err = String(e.message); }
    var r = { on: on, src: out, sketch: back, want: want, same: err === null && back === want, error: err };
    if (portsNow) r.ports = ports || null;
    return r;
  }

  // ---------- Conformance: one record per spec, compared byte for byte in node and goja ----------
  function conformance(src, cases) {
    cases = typeof cases === 'string' ? JSON.parse(cases) : (cases || {});
    var L = load(src), rec = { parse: { error: L.error, model: L.model }, lint: lintObj(src) };
    rec.lintText = lintText('spec.sbtel', rec.lint);
    rec.query = (cases.query || []).map(function (q) { return { ids: q.ids, withDeps: !!q.withDeps, result: queryObj(src, q.ids, !!q.withDeps) }; });
    rec.check = (cases.check || []).map(function (c) { return { bindings: c.name, result: checkObj(src, c.text) }; });
    if (cases.edits && cases.edits.length) rec.edits = cases.edits.map(function (c) { return editCase(src, c); });
    if (cases.carriers && cases.carriers.length) rec.carriers = cases.carriers.map(function (t) { return { type: t, result: L.model ? carriers(L.model, t) : null }; });
    return J(rec) + '\n';
  }

  return {
    apiVersion: 2,
    canon: canon,
    parseSpec: function (src) { var L = load(src); return J({ error: L.error, model: L.model }); },
    lint: function (src) { return J(lintObj(src)); },
    lintText: function (name, src) { return lintText(name, lintObj(src)); },
    query: function (src, ids, withDeps) { return J(queryObj(src, ids, !!withDeps)); },
    parseBindings: function (text) { return J(parseBindings(text)); },
    check: function (src, bindingsText) { return J(checkObj(src, bindingsText)); },
    diff: function (a, b) { return J(diffObj(a, b)); },
    diffText: function (d) { return diffText(typeof d === 'string' ? JSON.parse(d) : d); },
    // The file's top-level blocks, in source order (v0.2.5): `sbtel export` titles a page with the first.
    topBlocks: function (src) { var L = load(src); return J({ error: L.error, blocks: L.model ? topBlocks(L.model).map(function (b) { return { id: b.id, name: b.name }; }) : [] }); },
    carriers: function (src, name) { var L = load(src); return J(L.error ? { error: L.error } : carriers(L.model, String(name).replace(/^(μ|msg):/, ''))); },
    cli: cli,
    conformance: conformance,
    randomSpec: function (seed) { return randomSpec(seed); }
  };
})();
