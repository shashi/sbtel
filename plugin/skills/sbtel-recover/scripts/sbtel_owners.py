#!/usr/bin/env python3
"""Optional helper for the sbtel-recover skill (Python 3.8+, standard library only).

Reads `@sbtel` annotations from source files, works out which block (or behavior) owns each line,
reports annotation errors, and turns location-to-location references into `Caller -> Callee  # file:line`
edges.

  sbtel_owners.py SPEC FILE...              owner ranges: file<TAB>start<TAB>end<TAB>owner
  sbtel_owners.py SPEC FILE... --edges      read "from_file:line to_file:line" pairs on stdin,
                                            print one edge per distinct (caller, callee, from location)

Annotation forms, inside any line comment (//, #, --, ;, %, ', <!-- -->, /* */), as in
docs/DESIGN.md section 8. There are no others:
  @sbtel Name             the next declaration belongs to Name (one per declaration)
  @sbtel begin Name       a region starts; regions nest, the innermost wins
  @sbtel end Name         the region ends; the name must match its begin
  @sbtel file Name        from here to the end of the file
  @sbtel shape Name       anchor: where shape Name is defined; owns no code
  @sbtel port Block.port  anchor: where a port of Block is handled; owns no code

A Name is a block, or a behavior: `@sbtel Durable` above an interface, trait, protocol or typedef
declaration maps it to behavior Durable (sbtel 0.2.2). Blocks come first, so a name that is both a
block's and a behavior's names the block; write `beh:Durable` for the behavior. A behavior should own
only its declaration. That is not checked: what is a type-like declaration differs too much between
languages to tell reliably, so any form may name a behavior. In the ranges a behavior owner is printed
`beh:Name`.

With --edges, each pair is a reference from one owner's code to another owner's declaration:
  - block A to block B: the edge A -> B;
  - block A to behavior X: the edge A -> X (sbtel check allows it when X is in A's scope: the
    `abstraction` rule), written beh:X when a block is also called X;
  - a pair tagged `implements` in a third column after the name (`from to<TAB>name<TAB>implements`,
    as sbtel_refs.mjs and sbtel_refs_go print for `class Store implements Durable`, `var _ Durable =
    (*Store)(nil)` or an embedded interface; write the tag yourself for Rust's `impl Durable for
    Store`) whose callee is a behavior is not a binding: it states that the caller implements the
    behavior. It prints no edge, and it is an error when the spec has no matching (implements ...),
    directly or through behaviors the caller implements;
  - a behavior's own code to anything else prints nothing: a behavior owns its declaration, whose
    signature is its ports (their types are shapes), not code that binds.

Anchors are checked (the message type, or the block and its port, must exist in the spec) but
change no ownership: the lines after one belong to whoever owned them anyway, and a pending
`@sbtel Name` above an anchor still applies to the declaration below it.

"The next declaration" is found by indentation: its first non-blank line, the lines indented deeper
than it, and a closing line at its own indentation; comment lines between the annotation and it (a doc
comment, a JSDoc block) belong to it too (`}`, `)`, `]`, `end`...). That fits formatted
code in most languages; check the output where it matters. Lines inside a multi-line string literal
(a backtick string in Go or JS, a triple-quoted string in Python) belong to the declaration whatever
their indentation, and an `@sbtel` inside any string literal is not an annotation.

Errors (stderr, exit 1): unknown block or behavior name, unknown shape or port in an anchor, end without
begin or with another name, begin never ended, code in no block, code owned only by a container
block (one with child blocks), two `@sbtel Name` lines before one declaration, a second `@sbtel file`
in one file, and any other @sbtel text.
"""
import os
import re
import sys

ANN = re.compile(r'(?:^|[\s/#;%\'*!-])@sbtel\s+(.*)$')
CLOSE = re.compile(r'\s*(?:-->|\*/)\s*$')
NAME = re.compile(r'^[^\s()";:][^\s()";]*$')
COMMENT = re.compile(r'^\s*(?://|#|--|;|%|\'|/\*|\*|<!--|-->)')
OPENER = re.compile(r'(?://|#|--|;|%|\'|/\*|<!--|^\s*\*)')
CLOSER = re.compile(r'^\s*(?:[}\])]|end\b|fi\b|done\b|esac\b|</)')


def strings(lines):
    """For each line: whether it starts inside a multi-line string literal, and the column spans
    [a, b) of the string literals on it (quotes included). A rough lexer that fits most languages:
    backtick and triple-quoted strings may span lines; "..." and '...' end on their line (a quote with
    no closing partner on the line, such as an apostrophe in a comment or a Rust lifetime, is not a
    string); a line comment (// or # after a blank or at the start) ends the scan of its line."""
    out, state = [], None  # state: the open multi-line delimiter, or None
    for raw in lines:
        starts_in, spans, i, a = state is not None, [], 0, 0
        while i < len(raw):
            if state is not None:
                k = raw.find(state, i)
                if k < 0:
                    spans.append((a, len(raw)))
                    i = len(raw)
                    break
                spans.append((a, k + len(state)))
                i, state = k + len(state), None
                continue
            c = raw[i]
            if raw.startswith('//', i) or (c == '#' and (i == 0 or raw[i - 1] in ' \t')):
                break
            if raw.startswith('"""', i) or raw.startswith("'''", i) or c == '`':
                state, a = (raw[i:i + 3] if c != '`' else '`'), i
                i += len(state)
                continue
            if c in '"\'':
                k = i + 1
                while k < len(raw) and raw[k] != c:
                    k += 2 if raw[k] == '\\' else 1
                if k < len(raw):
                    spans.append((i, k + 1))
                    i = k + 1
                    continue
            i += 1
        out.append((starts_in, spans))
    return out


class Spec:
    """What the annotations are checked against: block names, containers (blocks with a child block),
    shape names, behavior names, each block's ports (its own, plus those of the behaviors it
    implements, through the behaviors they implement), and what each block and behavior implements."""

    def __init__(self, blocks, containers, messages, ports, behaviors=(), impl_block=None, impl_beh=None):
        self.blocks, self.containers, self.messages, self.ports = blocks, containers, messages, ports
        self.behaviors = set(behaviors)
        self.impl_block, self.impl_beh = impl_block or {}, impl_beh or {}

    def implemented(self, key):
        """The behaviors an owner key (a block name, or beh:Name) implements, directly or through others."""
        start = self.impl_beh.get(key[4:], ()) if key.startswith('beh:') else self.impl_block.get(key, ())
        out, todo = set(), list(start)
        while todo:
            b = todo.pop()
            if b not in out:
                out.add(b)
                todo.extend(self.impl_beh.get(b, ()))
        return out

    def resolve(self, name):
        """The owner key a Name annotation means: a block first, then beh:X / β:X, then a behavior."""
        if name in self.blocks:
            return name
        m = re.match(r'^(?:β|beh):(.+)$', name)
        bare = m.group(1) if m else name
        return 'beh:' + bare if bare in self.behaviors else None


def default_port_name(kind):
    """A port's name without :as (core.js defaultPortName): the type's name with its first letter
    lowercased, of its last `.`/`:` component, with type arguments (<...>, [...]) dropped first."""
    t = kind
    g = re.search(r'[<\[]', t)
    if g and g.start() > 0:
        t = t[:g.start()]
    parts = [x for x in re.split(r'[.:]+', t) if x]
    t = parts[-1] if parts else kind
    return t[0].lower() + t[1:]


def read_spec(src):
    # (~ text ~) is a sketch (sbtel 0.2): `(` and k tildes open it, the first k tildes and `)` close it, and
    # nothing inside is special; it is skipped like a comment, since no name lives in a sketch.
    tok = re.compile(r'\((~+)(?!~)[\s\S]*?\1\)|"(?:\\.|[^"\\])*"|;[^\n]*|[()]|[^\s()";]+', re.S)
    toks = [m.group(0) for m in tok.finditer(src) if not m.group(0).startswith(';') and not m.group(1)]
    stack, names, containers, messages, behaviors = [], [], set(), set(), set()
    own_ports, beh_ports, implements, beh_impl = {}, {}, {}, {}
    word = lambda k: toks[k] if k < len(toks) and toks[k] not in '()' else None
    # (behavior (Name P ...) ...) and (implements (Name Arg ...)): the name is the first word of the list.
    named = lambda k: word(k) or (word(k + 1) if k < len(toks) and toks[k] == '(' else None)
    def port_name(k):
        # (takes Shape [:as name] ...) and (gives Shape ...): the :as name, or the default one. k is the shape.
        j = k + 1
        while word(j) and word(j).startswith(':'):
            if word(j) == ':as' and word(j + 1) and not word(j + 1).startswith(':'):
                return word(j + 1)
            j += 2
        return default_port_name(word(k)) if word(k) and not word(k).startswith(':') else None
    for i, t in enumerate(toks):
        if t == '(':
            head = toks[i + 1] if i + 1 < len(toks) else ''
            head = 'message' if head == 'shape' else 'port' if head in ('takes', 'gives') else None if head in ('message', 'port') else head
            name = named(i + 2) if head in ('block', 'message', 'behavior') else None
            # The nearest enclosing block or behavior, and whether a message form intervenes.
            owner = next(((f[0], f[1]) for f in reversed(stack) if f[0] in ('block', 'behavior', 'message')), (None, None))
            if head == 'block' and name:
                names.append(name)
                if owner[0] == 'block':
                    containers.add(owner[1])
            elif head == 'message' and name:
                messages.add(name)
            elif head == 'behavior' and name:
                behaviors.add(name)
            elif head == 'port' and owner[1] and port_name(i + 2):
                (own_ports if owner[0] == 'block' else beh_ports if owner[0] == 'behavior' else {}).setdefault(owner[1], set()).add(port_name(i + 2))
            elif head == 'implements' and owner[0] in ('block', 'behavior') and named(i + 2):
                (implements if owner[0] == 'block' else beh_impl).setdefault(owner[1], set()).add(named(i + 2))
            stack.append((head, name))
        elif t == ')' and stack:
            stack.pop()
    spec = Spec(set(names), containers, messages, {}, behaviors, implements, beh_impl)
    spec.ports = {b: set(own_ports.get(b, ())) for b in names}
    for b in implements:
        for beh in spec.implemented(b):
            spec.ports.setdefault(b, set()).update(beh_ports.get(beh, ()))
    return spec


def show(key):
    """An owner key as a name: beh:Name is a behavior's key, shown as Name."""
    return key[4:] if key.startswith('beh:') else key


def spec_blocks(src):
    """Block names in an sbtel spec, and the set of containers (kept for callers of older versions)."""
    sp = read_spec(src)
    return sp.blocks, sp.containers


def owners(path, lines, spec, errors):
    """Ranges (start, end, block) of owned lines, 1-based inclusive. The innermost owner wins: a
    declaration over the region around it, a region opened inside a declaration over the declaration,
    an inner region over an outer one, and anything over the file annotation."""
    def err(n, msg):
        errors.append('%s:%d: %s' % (path, n, msg))

    known, containers = spec.blocks, spec.containers

    def valid(n, name, what='block'):
        if not NAME.match(name):
            err(n, 'not a %s name: %r' % (what, name))
            return False
        if what == 'block' and name not in known:
            err(n, 'unknown block %s' % name)
        return True

    def owner_key(n, name):
        """An ownership form's Name: a block, or a behavior (beh:Name). None if it is not a name."""
        if not NAME.match(name):
            err(n, 'not a block name: %r' % name)
            return None
        key = spec.resolve(name)
        if key is None:
            err(n, 'unknown block or behavior %s' % name)
        return key or name  # reported; it still opens and closes regions, as written

    def anchor(n, kw, name):
        """`message Name` or `port Block.port`: checked, owns nothing."""
        if kw == 'shape':
            if valid(n, name, 'shape') and name not in spec.messages:
                err(n, 'unknown shape %s' % name)
            return
        block, dot, port = name.rpartition('.')
        if not dot or not block or not port:
            err(n, 'port anchor needs Block.port: %s' % name)
        elif valid(n, block) and block in known and port not in spec.ports.get(block, ()):
            err(n, 'block %s has no port %s' % (block, port))

    owner = [None] * (len(lines) + 1)
    regions, pending, file_owner, decl = [], [], None, None  # decl = (name, last line, region depth)
    file_line, ann_lines, lex = 0, set(), strings(lines)
    in_str = lambda n, col: any(a <= col < b for a, b in lex[n - 1][1])

    def current():
        if decl and len(regions) > decl[2]:
            return regions[-1][0]
        if decl:
            return decl[0]
        return regions[-1][0] if regions else file_owner

    for n, raw in enumerate(lines, 1):
        m = ANN.search(raw)
        if m:
            at = raw.index('@sbtel', m.start())
            if in_str(n, at) or not any(not in_str(n, o.start()) for o in OPENER.finditer(raw[:at])):
                m = None  # "@sbtel" outside a comment, or inside a string literal
        if m:
            ann_lines.add(n)
            words = CLOSE.sub('', m.group(1)).split()
            if len(words) == 2 and words[0] in ('shape', 'port'):
                anchor(n, words[0], words[1])
            elif len(words) == 2 and words[0] in ('begin', 'end', 'file'):
                kw, name = words
                name = owner_key(n, name)
                if name:
                    if kw == 'begin':
                        regions.append((name, n))
                    elif kw == 'file':
                        if file_line:
                            err(n, 'a second @sbtel file (the first is on line %d): one per file' % file_line)
                        file_owner, file_line = name, n
                    elif not regions:
                        err(n, 'end %s without begin' % words[1])
                    else:
                        if regions[-1][0] != name:
                            err(n, 'end %s does not match begin %s (line %d)' % (words[1], show(regions[-1][0]), regions[-1][1]))
                        regions.pop()
            elif len(words) == 1:
                key = owner_key(n, words[0])
                if key:
                    if pending:
                        err(n, 'a second @sbtel %s for the same declaration (after @sbtel %s): one per declaration'
                            % (words[0], show(pending[-1][0])))
                    pending.append((key, n))
            else:
                err(n, 'not one of the annotation forms (Name, begin Name, end Name, file Name, shape Name, '
                       'port Block.port): %s' % ' '.join(words))
            if decl and n > decl[1]:
                decl = None
            owner[n] = current()  # an annotation line belongs to the owner in effect after it
            continue
        if decl and n > decl[1]:
            decl = None
        if pending and raw.strip() and not COMMENT.match(raw) and not lex[n - 1][0]:
            # The next declaration: this line, deeper-indented lines, and a closing line at its indent.
            ind, end = len(raw) - len(raw.lstrip()), n
            head = not raw.lstrip().startswith('@')  # decorators and annotations come before the head
            for k in range(n + 1, len(lines) + 1):
                s = lines[k - 1]
                if lex[k - 1][0]:  # inside a multi-line string: part of the declaration
                    end = k
                    continue
                if not s.strip():
                    continue
                d = len(s) - len(s.lstrip())
                if not head and d == ind:
                    end, head = k, not s.lstrip().startswith('@')
                    continue
                if d > ind or (d == ind and CLOSER.match(s)):
                    end = k
                    if d == ind:
                        break
                    continue
                break
            decl, pending = (pending[-1][0], end, len(regions)), []
        # A comment between `@sbtel Name` and its declaration is the declaration's doc comment (a JSDoc
        # @param {T} there names T): it belongs to Name too.
        owner[n] = pending[-1][0] if pending and raw.strip() and not lex[n - 1][0] else current()
    for name, n in regions:
        err(n, 'begin %s never ended' % show(name))
    ranges, cur = [], None
    for n in range(1, len(lines) + 1):
        o, raw = owner[n], lines[n - 1]
        code = raw.strip() and (lex[n - 1][0] or not COMMENT.match(raw)) and n not in ann_lines
        if code and o is None:
            err(n, 'code in no block')
        if code and o in containers:
            err(n, 'code owned by container block %s (code belongs to leaf blocks)' % o)
        if cur and cur[2] == o:
            cur[1] = n
        else:
            if cur and cur[2]:
                ranges.append(tuple(cur))
            cur = [n, n, o]
    if cur and cur[2]:
        ranges.append(tuple(cur))
    return ranges


def collapse(errors):
    """Merge the same message on consecutive lines of one file into one line: file:a-b: message."""
    out = []
    for e in errors:
        m = re.match(r'(.*?):(\d+)(?:-(\d+))?: (.*)$', e)
        if m and out:
            p = re.match(r'(.*?):(\d+)(?:-(\d+))?: (.*)$', out[-1])
            if p and p.group(1) == m.group(1) and p.group(4) == m.group(4) and int(p.group(3) or p.group(2)) + 1 == int(m.group(2)):
                out[-1] = '%s:%s-%s: %s' % (p.group(1), p.group(2), m.group(2), p.group(4))
                continue
        out.append(e)
    return out


def main(argv):
    args = [a for a in argv if a != '--edges']
    if len(args) < 2:
        sys.stderr.write(__doc__)
        return 2
    with open(args[0], encoding='utf-8') as f:
        spec = read_spec(f.read())
    errors, table = [], {}
    for path in args[1:]:
        with open(path, encoding='utf-8', errors='replace') as f:
            lines = f.read().split('\n')
        table[path] = owners(path, lines, spec, errors)
    if '--edges' in argv:
        # Pairs may name a file by another spelling of its path (a link resolved, as the go tool and
        # TypeScript do with macOS's /var -> /private/var): match them by real path.
        real = {os.path.realpath(p): r for p, r in table.items()}

        def owner_at(path, line):
            for s, e, b in table.get(path) or real.get(os.path.realpath(path), []):
                if s <= line <= e:
                    return b
            return None
        seen = set()
        for raw in sys.stdin:
            parts = raw.split()
            if len(parts) < 2:
                continue
            try:
                (fa, la), (fb, lb) = [(p.rsplit(':', 1)[0], int(p.rsplit(':', 1)[1])) for p in parts[:2]]
            except (ValueError, IndexError):
                errors.append('stdin: not a "file:line file:line" pair: %s' % raw.strip())
                continue
            a, b = owner_at(fa, la), owner_at(fb, lb)
            if not a or not b:
                errors.append('%s:%d -> %s:%d: no owner for %s' % (fa, la, fb, lb, 'caller' if not a else 'callee'))
                continue
            if a == b:
                continue
            if len(parts) > 3 and parts[3] == 'implements' and b.startswith('beh:'):
                # Not a binding: the code says that a implements b. The spec must say so too.
                if b[4:] not in spec.implemented(a) and (a, b) not in seen:
                    seen.add((a, b))
                    errors.append('%s:%d: %s implements %s in the code, but the spec does not say so (add (implements %s) to %s%s)'
                                  % (fa, la, show(a), show(b), show(b), 'behavior ' if a.startswith('beh:') else '', show(a)))
                continue
            if a.startswith('beh:'):
                continue  # a behavior's declaration: its signature is its ports, not code that binds
            # A callee behavior is written bare, or beh:Name when a block has that name too.
            callee = b if b.startswith('beh:') and b[4:] in spec.blocks else show(b)
            key = (a, callee, fa, la)
            if key not in seen:
                seen.add(key)
                print('%s -> %s  # %s:%d' % (a, callee, fa, la))
    else:
        for path, ranges in table.items():
            for s, e, b in ranges:
                print('%s\t%d\t%d\t%s' % (path, s, e, b))
    errors = collapse(errors)
    for e in errors:
        sys.stderr.write(e + '\n')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
