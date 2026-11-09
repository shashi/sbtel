#!/usr/bin/env node
// Tests for tools/selfcheck/stale.mjs (make selfcheck runs them): line numbers drifting is not stale; a
// new edge, a removed one, an edge in a new file and a changed VIOLATION note are.
import { compareEdges } from './stale.mjs';

const base = `# header
A -> B  # src/a.js:10
# VIOLATION: B calls back up.
B -> A  # src/b.js:4 (+2 more)
C -> B  # src/c.js:7
`;
const shift = t => t.replace(/:(\d+)/g, (_, n) => ':' + (+n + 6));
let fail = 0;
const is = (what, got, want) => { if (got !== want) { fail++; console.log(`FAIL ${what}: got ${got}, want ${want}`); } };
const d = compareEdges(base, shift(base));
is('lines shifted: not stale', d.same, true); is('lines shifted: drifted', d.drifted, true);
is('"+N more" changes: not stale', compareEdges(base, base.replace('(+2 more)', '(+3 more)')).same, true);
is('identical: not drifted', compareEdges(base, base).drifted, false);
is('CRLF checkout: not stale', compareEdges(base.replace(/\n/g, '\r\n'), base).same, true);
const added = compareEdges(base, shift(base) + 'D -> A  # src/d.js:1\n');
is('a new edge: stale', added.same, false); is('a new edge is reported', added.added.join(), 'D -> A  # src/d.js');
is('a removed edge: stale', compareEdges(base, base.replace('C -> B  # src/c.js:7\n', '')).same, false);
is('the same edge in a new file: stale', compareEdges(base, base + 'A -> B  # src/z.js:3\n').same, false);
is('a changed VIOLATION note: stale', compareEdges(base, base.replace('calls back up', 'calls up')).same, false);
is('a note moved to another edge: stale', compareEdges(base, base.replace('# VIOLATION: B calls back up.\nB -> A  # src/b.js:4 (+2 more)\nC -> B  # src/c.js:7', 'B -> A  # src/b.js:4 (+2 more)\n# VIOLATION: B calls back up.\nC -> B  # src/c.js:7')).same, false);
console.log(fail ? `stale: ${fail} failed` : 'stale: all passed');
process.exit(fail ? 1 : 0);
