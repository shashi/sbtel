# Conformance

The JS core runs in two engines: node (the reference, and the viewer's browser engine family) and
goja (inside the Go binary). Both must produce the same bytes for every record here.

- `specs/*.sbtel`: every spec gets a record `expected/<name>.json` = `__api.conformance(src, cases)`:
  the canonical parse model, the lint result, the lint text, plus any query and check cases.
- `diff/`: spec pairs for diff cases (not linted on their own), and two scripts:
  - `diff/gen-big.mjs` writes the `big-a.sbtel` / `big-b.sbtel` pair (about 670 blocks, with renames,
    moves, removals, additions, sketch and port edits). It is deterministic; rerun it only when you
    change the generator, then update `expected/diff-big.json` with `--only diff-big`;
  - `diff/viewer.test.mjs` tests the diff view (viewer/src/diff.js) in headless Chrome with
    Playwright: the `?diff` dev hook, every fixture pair, light, dark and phone, and server mode
    against a stub server. It reads `viewer/dist/index.html`, so run `make viewer` first.
- `cases/*.json`: extra cases, one file per workstream, merged in file-name order:
  `{ "specs": { "<file>.sbtel": { "query": [{ "ids": [...], "withDeps": bool }], "check": [{ "name": "<bindings file in specs/>" }] } },
     "random": [seeds], "diff": [{ "name": "...", "a": "<path from conformance/>", "b": "..." }] }`.
  Random seeds give `expected/random-<seed>.json` from core `randomSpec(seed)`; diff cases give
  `expected/diff-<name>.json` = `__api.diff(a, b)`.
- `expected/`: written by node only.

```
node conformance/run-node.mjs                         # compare (make conformance)
node conformance/run-node.mjs --update                # rewrite all records
node conformance/run-node.mjs --update --only diff-   # rewrite only records whose file name contains "diff-"
go test ./internal/engine                             # the goja side, same files
node conformance/diff/gen-big.mjs                     # regenerate the big diff pair
node conformance/diff/viewer.test.mjs [--shots dir]   # diff view in headless Chrome (make test-viewer-diff)
```
`make test-all` runs all of these together with the Go tests, the e2e test and `make accept`.
Review every changed expected file before keeping it: the expected files are the contract.
