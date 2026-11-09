#!/usr/bin/env python3
"""Optional helper for the sbtel-recover skill (Python 3.8+, standard library only).

Finds the groups of mutually dependent code (the strongly connected components, SCCs) of a reference
graph, and the levels of what is left once each group is one node. Use it before choosing blocks,
and again on a draft's edges (see granularity.md).

  sbtel_sccs.py [--by-file] [FILE]       read edges from FILE or stdin

Input lines, either form (anything after the two ends is ignored, and so are blank and # lines):
  from to                 two node names, e.g. "src/a.js:10 src/b.js:3" (sbtel_refs.mjs --units)
  Caller -> Callee  # x   an edges.txt line (sbtel_owners.py --edges, or a draft's edges)
--by-file turns "path:line" into "path", for a file-level graph.

Output: each SCC with more than one node, largest first, with its size and members; then the levels of
the condensed graph (each SCC as one node), printed top first and numbered from the bottom, as sbtel
numbers levels (level 1 is the lowest): the top level holds what nothing depends on, and a node sits
one level below the lowest level of anything that depends on it. An SCC shows as
[n nodes: first, ...]. Nodes with no edges at all are listed apart as isolated: their level is a
choice, not a fact (granularity.md).
Exit 0; 2 on bad usage.
"""
import re
import sys


def read_edges(lines, by_file=False):
    edges, nodes = [], set()
    for raw in lines:
        s = raw.strip()
        if not s or s.startswith('#'):
            continue
        m = re.match(r'(\S+)\s*->\s*(\S+)', s)
        parts = [m.group(1), m.group(2)] if m else s.split()[:2]
        if len(parts) < 2:
            continue
        a, b = parts
        if by_file:
            a, b = (re.sub(r':\d+$', '', x) for x in (a, b))
        nodes.update((a, b))
        if a != b:
            edges.append((a, b))
    return nodes, edges


def sccs(nodes, edges):
    """Tarjan's algorithm, iterative. Returns a list of components (lists of nodes)."""
    adj = {n: [] for n in nodes}
    for a, b in edges:
        adj[a].append(b)
    index, low, on, stack, out, counter = {}, {}, set(), [], [], [0]
    for root in sorted(nodes):
        if root in index:
            continue
        work = [(root, iter(sorted(set(adj[root]))))]
        index[root] = low[root] = counter[0]; counter[0] += 1
        stack.append(root); on.add(root)
        while work:
            v, it = work[-1]
            w = next(it, None)
            if w is None:
                work.pop()
                if work:
                    low[work[-1][0]] = min(low[work[-1][0]], low[v])
                if low[v] == index[v]:
                    comp = []
                    while True:
                        x = stack.pop(); on.discard(x); comp.append(x)
                        if x == v:
                            break
                    out.append(sorted(comp))
            elif w not in index:
                index[w] = low[w] = counter[0]; counter[0] += 1
                stack.append(w); on.add(w)
                work.append((w, iter(sorted(set(adj[w])))))
            elif w in on:
                low[v] = min(low[v], index[w])
    return out


def levels(comps, edges):
    """Levels of the condensation, numbered from the bottom as sbtel numbers levels (1 is the lowest):
    components are placed top down, each one level below the lowest component that depends on it (so
    callers sit above callees), and the numbers are then counted from the bottom."""
    of = {n: i for i, c in enumerate(comps) for n in c}
    down = {i: set() for i in range(len(comps))}
    up = {i: set() for i in range(len(comps))}
    for a, b in edges:
        x, y = of[a], of[b]
        if x != y:
            down[x].add(y); up[y].add(x)
    depth, todo = {}, [i for i in down if not up[i]]
    pending = {i: len(up[i]) for i in down}
    for i in todo:
        depth[i] = 1
    while todo:
        i = todo.pop()
        for j in down[i]:
            depth[j] = max(depth.get(j, 1), depth[i] + 1)
            pending[j] -= 1
            if not pending[j]:
                todo.append(j)
    isolated = sorted(i for i in down if not up[i] and not down[i])
    by = {}
    placed = [d for i, d in depth.items() if i not in isolated]
    top = max(placed) if placed else 0
    for i, d in depth.items():
        if i not in isolated:
            by.setdefault(top + 1 - d, []).append(i)
    return by, isolated


def label(c):
    return c[0] if len(c) == 1 else '[%d nodes: %s%s]' % (len(c), ', '.join(c[:3]), ', ...' if len(c) > 3 else '')


def main(argv):
    by_file = '--by-file' in argv
    args = [a for a in argv if a != '--by-file']
    if any(a.startswith('-') for a in args) or len(args) > 1:
        sys.stderr.write(__doc__)
        return 2
    src = open(args[0], encoding='utf-8') if args else sys.stdin
    nodes, edges = read_edges(src, by_file)
    comps = sccs(nodes, edges)
    big = sorted((c for c in comps if len(c) > 1), key=lambda c: (-len(c), c))
    pl = lambda n, w: '%d %s%s' % (n, w, '' if n == 1 else 's')
    print('%s, %s, %s with more than one node' % (pl(len(nodes), 'node'), pl(len(set(edges)), 'edge'), pl(len(big), 'SCC')))
    for k, c in enumerate(big, 1):
        print('SCC %d (%d nodes): %s' % (k, len(c), ' '.join(c)))
    by, isolated = levels(comps, edges)
    print('levels of the condensed graph, top first (level 1 is the lowest):')
    for d in sorted(by, reverse=True):
        print('  %d: %s' % (d, '  '.join(sorted(label(comps[i]) for i in by[d]))))
    if isolated:
        print('isolated (no edges): %s' % ' '.join(sorted(label(comps[i]) for i in isolated)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
