// When is a committed edges file stale? (make selfcheck; docs/DESIGN.md §8.) Only when what it says
// changes: an edge (caller -> callee, per file) appears or goes, a comment line changes (the header, or a
// `# VIOLATION:` note, which also decides what is explained). Line numbers and "(+N more)" counts are not
// compared: they drift with every ordinary edit above them. `make edges` still writes them, for people.
//
//   compareEdges(committed, fresh) -> { same: bool, drifted: bool, removed: string[], added: string[] }
// `drifted` is true when the files differ only in locations. removed/added are the differing lines, as
// normalized (an edge line as `caller -> callee  # file`).
export function normalize(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n').map(l => {
    const m = /^(\S+) -> (\S+)\s+#\s*(\S+?):\d+(?: \(\+\d+ more\))?\s*$/.exec(l);
    return m ? `${m[1]} -> ${m[2]}  # ${m[3]}` : l;
  });
}
export function compareEdges(committed, fresh) {
  const a = normalize(committed), b = normalize(fresh), A = new Set(a), B = new Set(b);
  const same = a.length === b.length && a.every((l, i) => l === b[i]);
  return { same, drifted: same && String(committed).replace(/\r\n?/g, '\n') !== fresh, removed: a.filter(l => !B.has(l)), added: b.filter(l => !A.has(l)) };
}
