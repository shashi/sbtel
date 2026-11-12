# sbtel design: the contract

sbtel is a language to design, understand, and collaborate on a system's architecture with AI. It
describes a system as nested blocks in levels, and comes with a diagram viewer that humans and AI
agents share. This document is the contract between the parts. Where it
says MUST, the conformance tests, the acceptance suites or a reviewer will hold you to it. When you
find something wrong or missing, fix this document in the same change as the code. Never let the two
disagree silently.

Status: v0.2.5 (§11, entries 107-113): `sbtel export` writes one self-contained HTML file, the viewer with
a spec (and optionally its bindings) baked in, to share with people who have no sbtel (§3.14, §6.9);
read-only works in the full viewer too, and the bindings view moved to viewer/src/bindings.js, shared by
server mode and exported files. Before that, v0.2.4 (§11, entries 104-106): embed mode fits what the diagram draws, reports its natural size
to a same-origin parent page (`sbtel:size`) so the page can size the frame, and takes `&focus=<Block>`
(§6.9). Before that, v0.2.3 (§11, entries 97-103): the viewer is a proper HTML document with a device-width
viewport, the playground's "sbtel" links to the project's home page, and a standalone page loads a spec
from its URL (`#src=`, `#example=`) and embeds in docs pages (`?embed`; §6.9). Before that, v0.2.2 (§11, entries 78-96): behaviors are read with a block's grammar (`:type`, ports,
sketch, `implements`), a behavior may implement (extend) others, shapes take `:type`, and
`sbtel check` allows a binding to a behavior in the caller's scope (`abstraction`): calls through an
interface are checkable; the recover skill's helpers map interfaces to behaviors. Before that, v0.2.1 (§11, entries 61-77): levels are numbered from the bottom (level 1 is the lowest), the
browser sends GitHub-style reviews (pending comments, a message and the edits as a proposed spec, never
written to the file; §6.7), Save asks before overwriting a newer version, and the undo history and the
draft persist in the browser. Before that, v0.2.0, the language pass (§11, entries 42-60): `layer` is now `level` (a clean break), levels
have names, sketches go on levels, ports and adjacent groups, `(~ … ~)` is sugar for `(sketch "…")`,
`(carries …)` relates shapes (has-a), `either`, `:fill` and free keywords are gone, lint adds
placement notes, and the viewer shows sketches in callouts that edit in place. Before that, v0.1.2. The foundation and the four workstreams of §10 (A: check, query, diff; B: server
and sessions; C: diff core and view; D: docs, install, plugin) are built and integrated (§11,
entries 27-30). §10 is kept as the record of who built what. v0.1.1 (§11, entries 31-35) fixes
comments in diff sessions and makes the viewer's own spec, annotations and bindings agree, checked by
`make selfcheck` (§8). v0.1.2 (§11, entries 36-38) embeds the viewer's fonts so the page never calls
out, adds `--help` to every command, checks the docs' snippets against the binary, prints the
`# VIOLATION:` notes in `sbtel check`, ships a Go reference helper for the recover skill, and checks the
Go code against examples/sbtel.sbtel (entries 39-41). CHANGELOG.md
lists the releases.

Contents:

1. Overview
2. The core API (JS)
3. CLI
4. State directory
5. Server
6. Viewer modes
7. The diff contract
8. Annotation convention
9. Install and release
10. Workstreams
11. Decisions and deviations log

---

## 1. Overview

```
                 core/core.js  (parser, model, spec checks, layout, edits, bindingVerdict, diffSpecs)
                 core/api.js   (stable entry points, canonical JSON, CLI formatting)
                   │                                   │
        go:embed (assets.go)                 viewer/build.mjs inlines core.js (not api.js)
                   │                                   │
   ┌───────────────▼──────────────┐      ┌─────────────▼──────────────────────────────┐
   │ sbtel binary (Go, static)    │      │ viewer/dist/index.html (one self-contained  │
   │  cmd/sbtel   CLI commands    │      │ page: CSS, markup, core, app, session.js,   │
   │  internal/engine  goja + api │      │ server.js, diff.js). Also go:embedded.      │
   │  internal/server  HTTP (§5)  │─────▶│ standalone | server mode | diff mode (§6)   │
   │  internal/state   ~/.sbtel   │ HTTP │                                             │
   └───────────────┬──────────────┘      └─────────────────────────────────────────────┘
                   │ files
            ~/.sbtel/ (§4): server.json, sessions/<id>/{meta.json, events.jsonl, versions/, ...}
```

There is one implementation of the language. core/core.js is DOM-free plain script. The browser runs it
inline in the page, and the Go binary runs the same text in goja (a JS engine in pure Go). Lint, query,
check and diff therefore mean the same thing in the CLI and in the viewer. Conformance (§2.9) proves that
node and goja agree byte for byte.

Data flow for the agent loop:

1. An agent runs `sbtel open spec.sbtel`. The CLI starts the shared localhost server if needed,
   registers a session and opens a browser tab at `http://127.0.0.1:<port>/s/<id>/`.
2. The human reads the diagram, edits it (each edit splices the source text) and comments on elements.
   Comments and edits gather in a draft review in the tab; Send review appends one `review` event to
   the session's `events.jsonl`, with the edits as a proposed spec in `proposals/` (the spec file is
   not written). A comment sent on its own (Send now) and a Save are events too.
3. The agent runs `sbtel inbox <id> --wait`, reads the review, applies or merges the proposed spec with
   its own changes and runs `sbtel open spec.sbtel --session <id>`. The tab shows a "new version" toast
   with a Reload action. The agent runs `sbtel reply <id> <comment-id> "done"` to answer a comment (or
   a review) in the tab.

### Repository layout

| Path | What | Owner (§10) |
|---|---|---|
| `core/core.js` | THE source of truth: reader, model, checks, layout, edits, splice helpers, `bindingVerdict`; `diffSpecs` slot | frozen, except C adds the SpecDiff region |
| `core/api.js` | entry points for hosts, canonical JSON, CLI text formats | A (foundation parts are frozen) |
| `assets.go` | package `sbtel`: go:embed of core, api, viewer page, VERSION | frozen |
| `VERSION` | release version, one line | release owner |
| `internal/engine/` | goja loader, `Call`, `CLI`; conformance test | frozen |
| `cmd/sbtel/main.go`, `args.go`, `errors.go`, `cmd_lint.go` | dispatch table, flag syntax, IO helpers, lint | frozen |
| `cmd/sbtel/cmd_a.go` | check, query, diff | A |
| `cmd/sbtel/cmd_b*.go` | open, open-diff, inbox, reply, sessions, close, serve | B |
| `cmd/sbtel/cmd_export.go` | export (§3.14): the viewer page with a spec baked in | release owner |
| `internal/state/`, `internal/server/` | state dir, sessions, HTTP server | B |
| `viewer/src/index.html` | the page with core removed and `/*@@include …@@*/` slots | frozen (see §6.5) |
| `viewer/src/session.js` | comments in a session, shared by server and diff mode (§6.3, §6.4) | B and C |
| `viewer/src/bindings.js` | an edges file's violations in the checks and the "uses" outline: server mode and exported files (§6.3, §6.9) | release owner |
| `viewer/src/review.js` | the draft review and the shared change list, both modes (§6.7) | B and C |
| `viewer/src/server.js` | server-mode module | B |
| `viewer/src/diff.js` | diff-mode module | C |
| `viewer/src/play.js` | the standalone page: a spec from the URL or baked into an exported file, read-only, embed mode, the home link (§6.9) | release owner |
| `viewer/build.mjs` | assembles `viewer/dist/index.html`; inlines `viewer/fonts/*.woff2` as data: URLs | frozen |
| `viewer/fonts/` | the page's fonts (Commissioner, JetBrains Mono; OFL, from @fontsource-variable 5.3.0; Hanken Grotesk until v0.4.1) and their licenses | release owner |
| `viewer/dist/index.html` | built page, committed (go:embed needs it) | generated |
| `viewer/test/` | acceptance suites and `run.sh`; accept6 (v0.2) covers callouts, editors, level labels and carried types; accept7 (v0.2.1) the standalone undo history across a browser restart; accept8 (v0.2.2) behavior and message pills, the implementers outline and a behavior's Edit dialog; accept9 (v0.2.3) `#src`, `#example`, `?embed` and the home link; accept10 (v0.2.3) three embedded viewers in one docs page; accept11 (v0.2.4) the tight fit, `sbtel:size` and `&focus`; accept12 (v0.2.5) files made by `sbtel export`, from disk | frozen (add suites, don't edit; §11 entry 51) |
| `conformance/` | specs, cases, expected records, node runner | shared, see §2.9 |
| `examples/*.sbtel` | sample specs; `viewer.sbtel` is the viewer's own spec, with `viewer.edges.txt`, and `sbtel.sbtel` the system's, its Go blocks checked against the Go code with `sbtel.edges.txt` (§8) | D |
| `tools/docs/snippets.mjs` | dev-only: checks every spec and output in the docs against the binary (`make docs-check`) | release owner |
| `tools/selfcheck/` | dev-only: the edges extractor for the viewer and the Go code and the `make selfcheck` checks, with a pinned TypeScript (npm, not used by the binary) | release owner |
| `docs/DESIGN.md` | this contract | everyone (keep it true) |
| `docs/LANGUAGE.md`, `README.md`, `install.sh`, `install.ps1`, `plugin/`, `.claude-plugin/` | docs, install, Claude Code plugin (with `sbtel_owners.py` and its tests) | D |
| `scripts/release.sh`, `Makefile` | build and release | frozen |
| `LICENSE`, `THIRD_PARTY_NOTICES`, `scripts/third-party-notices.sh` | MIT; the licenses of the bundled modules and of the page's fonts (embedded, `sbtel licenses`) and their generator | release owner |
| `scripts/test-install.sh` | install.sh tests against `dist/` (`make test-install`) | D |
| `.github/workflows/ci.yml`, `release.yml`, `RELEASING.md`, `CHANGELOG.md` | CI on three OSes; release on a tag; how to release; what changed | release owner |
| `third_party/xtext/` | pruned golang.org/x/text v0.22.0 (goja needs it) | frozen |

### Build

```
make            # check-viewer + node conformance + go vet/test + bin/sbtel
make viewer     # rebuild viewer/dist/index.html (after any change to viewer/src or core/core.js)
make accept     # viewer acceptance suites in headless Chrome (standalone mode; builds bin/sbtel for accept12)
make release    # dist/sbtel_<os>_<arch>[.exe] for 6 targets + dist/checksums.txt
make selfcheck  # the viewer's spec, annotations and edges agree; every violation explained (§8)
make edges      # regenerate examples/viewer.edges.txt
make docs-check # every spec, lint, query and check output in the docs matches bin/sbtel
make test-all   # all + go test -race + test-owners + selfcheck + docs-check + test-viewer-diff + test-e2e + accept
```
`test-owners` runs the recover skill's helper tests (python3), `test-viewer-diff` runs
`conformance/diff/viewer.test.mjs` and `test-e2e` runs `internal/server/e2e/e2e.js` (both need
Playwright for node). CI (`.github/workflows/ci.yml`) and releases are described in RELEASING.md.

The toolchain is Go 1.24 (`go 1.24` in go.mod) and node ≥ 18 (for the viewer build and conformance
only; the binary needs no node). Builds use `GOPROXY=direct GOSUMDB=off`, which the Makefile and
release.sh set. Do not run `go mod tidy`: it tries to fetch goja's test-only dependencies and fails.
Edit go.mod and go.sum by hand. The binary takes no new Go dependencies: use the standard library
only (goja is the one exception).

---

## 2. The core API (JS)

### 2.1 Loading

A host evaluates `core/core.js` and then `core/api.js` as classic scripts in one global scope. They are
not ES modules. The core's top-level functions become globals (`parse`, `lintSpec`, `layout`,
`applyEdit`, `bindingVerdict`, …), and api.js defines one global, `__api`.

- Go: `engine.New()` (internal/engine) compiles both embedded files into a fresh goja runtime. An
  `*Engine` is single-threaded: use one per goroutine, or put a mutex around a shared one.
  `New()` costs tens of milliseconds.
- Node: `vm.runInContext(core + '\n' + api + '\n;__api', vm.createContext(Object.create(null)))`
  (see conformance/run-node.mjs).
- Browser: the viewer inlines core.js only, and calls core functions directly. api.js is not in the
  page. If the viewer ever needs an api.js function, move that function into core.js.

The core MUST stay DOM-free and side-effect-free on load: no `window`, `document`, `console`,
timers or `require`. Use only what goja runs. The core already uses ES2020 features such as `??`,
spread and `Map`/`Set`; newer syntax may not work in goja. `go test ./...` is the check.

### 2.2 Conventions

- Every public `__api` function takes strings, numbers and booleans (or a JSON string where noted).
  It returns a string, usually canonical JSON.
- Spec problems never throw. They come back as `error` or `warnings` fields. Only host misuse throws:
  for example, a spec that is not a string throws a `TypeError`. Go reports a thrown error as
  `"<fn>: <exception .message>"`.
- **Canonical JSON** (`__api.canon(x, true)`): keys are sorted. Non-ASCII and control characters are
  escaped as `\uXXXX`, one per UTF-16 code unit, so the bytes are identical in every engine. Maps become
  `{"$map":[[k,v],…]}` and Sets become `{"$set":[…]}`. The back pointers `parent`, `owner` and
  `container` become `"@<id>"`. An object reached twice gets `"$id":n` on first emission and
  `{"$ref":n}` after that. `_ctx` and functions are dropped. Plain result objects (everything except
  `parseSpec`'s model) contain no Maps, Sets or repeated objects, so they read as ordinary JSON.
- **Positions**: `line` and `col` are 1-based. `col` counts UTF-16 code units from the start of the
  line. That matches JS string indexing, and for ASCII it equals the byte column.
- `Located = { message: string, line: int|null, col: int|null }`. The core's trailing
  `" at L:C"` or `" (line L:C)"` is moved out of `message` into `line` and `col`.
- **Element ids** in results:
  - blocks: the block name, or `Name#2` for the second block with a duplicate name;
  - behaviors: `β:Name`;
  - shapes: `μ:Name`.

  Inputs (query ids) also accept `beh:Name` and `msg:Name`. A bare name is looked up as a block, then
  a behavior, then a shape.
- **Stability**: `__api.apiVersion` is `2` (v0.2.0: Element's `layers` became `levels` with names and
  sketches, `fill`, `keywords` and `either` went, Ports gained `sketch`, LintResult gained `info`, and
  the diff's `Place.layer` became `Place.level`; v0.2.1, within 2: `Place.level` and
  `Fields.levels[].level` are level numbers counted from the bottom, 1-based, §11 entry 61). Adding
  keys or functions is compatible. Renaming or
  removing them, or changing their meaning, needs `apiVersion: 3` and an update to this section.

### 2.3 `__api.lint(src) → LintResult`

```
LintResult = {
  ok:       bool,                 // problems === 0
  error:    Located | null,       // parse error; when set, warnings=[], checks=[], counts=null
  warnings: Located[],            // model warnings: duplicates, bad port dir, adjacent < 2, empty level;
                                  // then form warnings (below), in source order
  checks:   { k, label, failures: string[] }[],   // lintSpec, always these 6, in this order:
            //  beh    "Every implemented behavior is declared"
            //  scope  "Behaviors are used only inside the block that declares them"
            //  msg    "Every port uses a declared shape"
            //  mscope "Shapes are used only inside the block that declares them"
            //  rel    "refines and carries name declared types"
            //  cycle  "No behavior implements itself" (v0.2.2; failures read A → B → A)
  info:     Info[],               // placement notes (§2.8 placementFindings); never problems
  problems: int,                  // 1 if error, else warnings + all failures
  counts:   { blocks, behaviors, messages } | null
}
```
`Info = { severity: "info", message, line, col, kind: "shape"|"behavior", name, in: block id ('' =
the file), home: block id ('' = the file) | null }`: `home` is where the declaration could move, null
when nothing uses it. `__api.lintText(name, src)` returns the human text described in §3.3.

**Form warnings** (api.js `formWarnings`) report what the model builder silently drops or misreads:
an unknown form (`(blok A)`), an empty or headless form, a stray word or string where a form belongs,
a form in a place that ignores it (allowed children: the file takes block, level, adjacent, message,
behavior; a block also takes port, implements, sketch; level and adjacent take block and adjacent;
message takes sketch, refines, carries; behavior takes port, sketch, implements; level and adjacent
also take one sketch; a port takes one sketch after its type), a missing name, a keyword without
a value or after the children (block, behavior and message share one keyword grammar: `:type` only),
a port without exactly `name dir Type`, `implements` without exactly one name or one `(Name Arg …)`
list, `refines` without exactly one name, an empty `carries` or a name twice in one, a sketch that is not text, a second
sketch/refines/carries, a block keyword other than `:type`, a level keyword other than one non-empty
string `:name`, a sketch on a nested adjacent group, and two
ports with one name in a block or behavior. The core itself reports (as model warnings, so the viewer
shows them too) a block, level, adjacent group, message or behavior inside a behavior (`behavior B:
behaviors don't contain blocks, levels or declarations; declare X beside the behavior instead`, and
the form is left out of the model) and arguments that do not fill a behavior's parameters
(`(implements (Store A B)) passes 2 arguments, but Store takes 1`).

### 2.4 `__api.query(src, ids, withDeps) → QueryResult`

`ids` is a JSON array string (or an array). Ids are resolved as in §2.2, and repeated ids are dropped.

```
QueryResult = {
  ok:         bool,               // no error and missing = []
  error:      Located | null,
  results:    Element[],          // in request order
  deps:       Element[],          // withDeps only, in source order (see below)
  missing:    string[],           // ids that name nothing
  unresolved: string[],           // withDeps only: referenced names declared nowhere, sorted
  fragment:   string,             // the results as a self-contained spec (below); "" on a parse error
  stubs:      string[],           // withDeps only: block ids shown as collapsed stubs, in source order
  suggest:    { [missingId]: string[] }   // up to 3 close ids per missing id ("did you mean")
}
Element = {
  id, kind: "block"|"behavior"|"shape", name,
  in:     string|null,            // holder: parent block (blocks), declaring block (behavior, message); null = file
  path:   string[],               // ancestor block ids, outermost first (excludes self)
  sketch: string,                 // "" if none
  lines:  { start, end },         // 1-based, inclusive, of the element's parenthesised form
  source: string,                 // the form's text, re-indented so its first line is at column 0
  type: string|null,              // :type, every kind (v0.2.2: behaviors and shapes too)
  // block only:
  implements: string[], ports: Port[] /* own, then inherited (via = the behavior declaring it) */,
  levels: { name: string|null, sketch: string, units: { sketch: string, blocks: string[] }[] }[],
                                  // levels, top first → units (a block, or an adjacent group) → block ids
  // behavior only:
  params: string[], implements: string[] /* direct */, ports: Port[] /* own, then from what it extends */,
  // message only:
  refines: string|null, carries: string[],   // own (carries …)
  carriers: { shapes: string[], ports: { owner, port }[], blocks: string[] }   // §2.8 carriers
}
Port = { name, dir: string|null /* "in"|"out" when valid; else as written, and lint warns */, kind: string|null, via: string|null, sketch: string }
```
**Dependencies** are the declarations that the text of the results uses but does not contain, followed
transitively. Every block, behavior and message lexically inside a result (or a dependency) contributes:

- blocks: their `implements` names (as behaviors), the arguments those pass (as shapes) and their
  own ports' kinds (as shapes);
- behaviors: their port kinds that are not behavior parameters, and their `implements` names and
  arguments as for blocks;
- shapes: their `refines` and `carries` names.

A declaration inside any result is not repeated as a dependency.

**The fragment** is a spec that `lint` accepts whenever the original does (the conformance cases and
a node property run over every element of every lint-clean spec hold it to that). It holds:

- each result's own source (a result inside another result is not repeated);
- the enclosing blocks as **skeletons**: `(block Name :k v…`, the first sketch, then only the levels
  and adjacent groups that lead to something shown. One kept level is written bare; several are
  written as `(level …)`, in source order, so the relative order of levels is the original's;
- every behavior and shape the shown text uses (the dependency rules above, transitively),
  placed in the block that declares it, which becomes a skeleton if it is not shown already, so scope
  is exactly the original's;
- with `withDeps`, the blocks the results may bind to (§2.5 `ok`, other than `same` and
  `descendant`): for the result and each of its ancestors X, the blocks in lower levels of X's holder
  and X's adjacent peers. Each is a **collapsed stub**: header, `implements`, ports and sketch, with a
  `; collapsed: <counts>` comment when it has insides. Descendants are already in the result's source.
  `bindingVerdict` gives the same answer for a result and a stub in the fragment as in the spec.

### 2.5 `__api.check(src, bindingsText) → CheckResult` and the binding rule

The bindings text has one edge per line: `Caller -> Callee`, optionally followed by whitespace, `#` and
a free-text location (`src/x.ts:12`). Spaces around `->` are optional, and a name is any run of
non-space characters. Blank lines and lines whose first non-blank character is `#` are ignored. Any
other line that does not match is `invalid`. Lines end in `\n`, `\r\n` or `\r`, and a leading BOM is
dropped. The location starts at the first `#` that follows whitespace, so it may contain `->` and `#`
(`Dup#2` without a space is a name). The part before it must hold exactly one `->`: `A -> B -> C` is
invalid. Duplicate edges are kept, one per line. A callee may name a behavior (v0.2.2, below). An
`unknown` text gets a hint: `(did you mean X?)` over blocks (callers) or blocks and behaviors
(callees), `(X is a behavior; a binding's caller is a block)` or `(X is a shape; bindings name
blocks and behaviors)`. The parser is `parseBindings(text)` in core.js, shared
by api.js `check` and the viewer's server mode; `__api.parseBindings(text)` exposes it:
`{ edges: [{line, caller, callee, location|null, note|null}], invalid: [{line, text}],
orphans: [{line, note, why}] }`.
**Explanations**: a comment line `# VIOLATION: reason` in the run of comment lines directly above an
edge (no blank line or edge between) is that edge's `note` (the text after `VIOLATION:`, trimmed;
the comment lines after it in the run continue it, joined with single spaces). A note that a blank
line, another `# VIOLATION:` line, a line that is not an edge or the end of the file reaches first is
an **orphan** (`why`: `blank`, `note`, `invalid` or `end`). The verdict ignores notes: an explained
violation is still a violation. CheckResult carries each violation's note and counts the explained
ones; an orphan, or a note on an allowed edge, is a **warning** (a stale or misplaced explanation),
which does not change `ok` or the exit code. The viewer shows the notes (§6.3), and `make selfcheck`
requires one for every violation of the viewer's and the CLI's own bindings (§8).

```
CheckResult = {
  ok:         bool,               // no error, no violations, no invalid lines
  error:      Located | null,     // spec parse error
  edges:      int,                // edges parsed
  violations: { line, caller, callee, location: string|null, rule, text, note: string|null }[],   // in file order
  invalid:    { line, text }[],
  warnings:   { line, message }[],  // orphan notes and notes on allowed edges, by line
  explained:  int                   // violations with a note
}
```
`bindingVerdict(model, a, b)` in core.js is the rule, shared with the viewer. It returns
`{ ok, rule, text }`. The callee is resolved by `bindingTarget(model, b)`: blocks and behaviors are
separate namespaces, and a name is a block id first (exactly as written), then `beh:Name` or `β:Name`, then
a bare behavior name. A bare name that is both a block's and a behavior's therefore binds the block,
and CheckResult gets a warning (`X names a block and a behavior; this edge binds the block (write
beh:X to bind the behavior)`). When the callee is a behavior T and the caller a block A, the verdict is
`abstraction` (ok) if T is in A's scope (declared in A, an ancestor of A, or the file), else `scope`
(`A binds T, declared in D: a behavior is used only inside the block that declares it`). Let A and B be the blocks named a (caller) and b (callee). Let c be their
nearest common holder (a block, or the file). Let a2 and b2 be the children of c on the way down to
A and B. Levels are counted top to bottom in source order.

| rule | ok | when |
|---|---|---|
| `same` | yes | A is B |
| `descendant` | yes | B is inside A (any depth) |
| `ancestor` | no | A is inside B (any depth): a part may not depend on its whole |
| `lower-level` | yes | a2's level comes before b2's level in c (higher levels bind lower ones) |
| `adjacent` | yes | a2 and b2 are in the same adjacent group of the same level |
| `same-level` | no | same level of c, different adjacent groups |
| `upward` | no | a2's level comes after b2's |
| `abstraction` | yes | b is a behavior in A's scope (v0.2.2): a call through the abstraction |
| `scope` | no | b is a behavior declared outside A's scope |
| `unknown` | no | a is not a block id, b is neither a block nor a behavior, or a block is not placed in a level |

Note the `ancestor` row: binding an enclosing block is forbidden, as an upward dependency (a part
depending on its whole), as the older marquee-check.js had it (§11, entry 15). Binding a descendant
stays allowed.

### 2.6 `__api.diff(a, b) → DiffEnvelope`

```
DiffEnvelope = { ok: bool, error: (Located & { side: "a"|"b"|null }) | null, diff: DiffResult | null }
```
api.js parses both sources and calls the core's `diffSpecs(modelA, modelB)`. If `diffSpecs` is not
defined yet, the envelope is `ok:false` with message `"diff is not implemented yet"` and side `null`.
`DiffResult` is §7.

### 2.7 `__api.cli(cmd, argsJSON) → {exit, stdout, stderr}`

The command logic that has no IO lives in JS, so node conformance can test the text formats and exit
codes. Go reads the files, passes `args` and prints what comes back. `args.files` is
`[{name, src}]`, where `name` is the path as the user typed it, or `<stdin>`. Implemented:
`cli("lint", {files, json})`, and `check`, `query` and `diff` with the args listed in §10.A.
`__api.diffText(diffResultJSON)` returns the §7.5 text for a DiffResult.

### 2.8 Other entry points

- `__api.parseSpec(src)`: `{error, model}`, with the full model in canonical form. It is a debug and
  conformance shape, not stable: don't build on it.
- `__api.randomSpec(seed)`: the playground's random spec generator, deterministic per seed.
- `__api.topBlocks(src)` (v0.2.5): `{error, blocks: [{id, name}]}`, the file's top-level blocks in source
  order (core.js `topBlocks`); `error` is the parse error (Located) or null. `sbtel export` titles its
  page with the first, as the viewer's chip names it.
- `__api.migratePorts(src)` (v0.3.0): the rewrite behind `sbtel fmt --migrate-ports` (§3.15),
  `{error, src, ports: [{line, col, from, to}]}`. core.js `defaultPortName(Type)` is the default-name
  rule (LANGUAGE.md §3.5) and `portForm(name, dir, Type)` the text the viewer writes for a port.
- `__api.carriers(src, name)` and core.js `carriers(model, T)`: every shape that carries T,
  transitively (A carries B, B carries T), counting what a subtype inherits from its supertype's
  `carries`; T itself only through a cycle. Then every port typed with one of them (blocks' own,
  behaviors') and every block with such a port (inherited ports count). Cycle-safe, in source order:
  `{ messages, ports: [{owner, port}], blocks }`. `carriedBy(model, m)` is m's own `carries` plus its
  supertypes'. `accepts` ignores `carries`.
- core.js `behaviorsOf(n)`: the behaviors a block or behavior implements, directly or through the
  behaviors those implement, each once, depth first (a behavior on a cycle lists itself).
  `implementersOf(model, name)`: every block that implements the behavior that way, in source order;
  it is the one "implementers of" (placement, the viewer's outline and info card, the diff's features).
  `portsOf(n)` of a block or a behavior is its own ports, then those of every behavior in
  `behaviorsOf`, with `via` the declaring behavior and each port typed with a parameter retyped by the
  arguments that reach it (`(implements (Store Event))`; a behavior's own parameter passed on is
  replaced by its implementer's argument). `bindingTarget(model, name)`: §2.5.
- core.js `placementFindings(model)`: the placement notes of lint (`info`), shared with the viewer's
  checks popover. A shape or behavior should be declared at the lowest common ancestor (the
  file counts) of its users. Users of shape T: blocks with a port of T (inherited ones too),
  of a type that carries T, or of a subtype of T (and what carries those); and the declaring sites of
  those carrying types and subtypes, and of behaviors with a port of any of them or passing one as an
  argument. Users of a behavior: its implementers (`implementersOf`), and the declaring sites of the
  behaviors that implement it directly. Bindings are not read, so a behavior kept where its callers
  see it can be noted as one that could live lower (§11 entry 86). Declared strictly above the LCA: `X is declared in A but only used within B; it
  could live there.`; no users: `X is never used.` Below the LCA is a scope failure, never a note.
- `__api.conformance(src, casesJSON)`: one conformance record. It is for tests only.

### 2.9 Conformance

`conformance/specs/*.sbtel` each give one record, `expected/<name>.json`:
`{parse, lint, lintText, query: [...], check: [...]}`, plus `edits` and `carriers` when the cases have
them: `edits` are viewer edits (a sketch or level name set through `applyEdit`, as the page does) whose
result is parsed again and compared with the text meant (`same`), and `carriers` are `carriers()`
results. The cases come from `conformance/cases/*.json`,
merged in file-name order. Each workstream owns its own file: `base.json` (foundation), `a.json`,
`diff.json` (C), `v2.json` (v0.2: levels, sketches, `(~ … ~)` edits, carries, placement). `random` seeds give `expected/random-<seed>.json`. `diff` cases
(`{name, a, b}`, paths relative to `conformance/`, fixture pairs in `conformance/diff/`) give
`expected/diff-<name>.json`.

Node writes the expected records (`node conformance/run-node.mjs --update [--only <substr>]`). The goja
test (`go test ./internal/engine`) compares its own records with them byte for byte. A change that
alters records MUST update them in the same change, scoped with `--only` to the records you meant to
change, after reading the diff.

---

## 3. CLI

### 3.1 Conventions (all commands)

- `sbtel <command> [args]`. Flags are long only: `--name`, `--name=value` or `--name value`. Flags and
  positionals mix in any order, and `--` ends flags. `-` as a spec argument means stdin, at most once
  per command. Unknown flags are a usage error. The one parser is `parseArgs` in cmd/sbtel/args.go.
  The one short flag is `export`'s `-o` (and `-o=f`), the compilers' spelling, which it turns into
  `--out` before parsing (§11 entry 109).
- `--help` or `-h` anywhere before `--` in a command's arguments, and `sbtel help <command>`, print
  that command's usage line, what it does and its flags on stdout, and exit 0 (the `help` field in
  main.go's `commands`). `sbtel help`, `--help` and `-h` alone print every command's usage line.
- **Exit codes**: `0` ok, `1` check failures (the spec or bindings fail a rule, a spec does not parse,
  for `diff`, the specs differ), `2` usage or IO error (bad flags, unreadable
  file, server unreachable, unknown session, malformed bindings line, a query id that names nothing). When both apply, 2 wins.
- stdout carries the result. stderr carries diagnostics, which start `sbtel <cmd>: `. That includes
  IO errors from reading the inputs (`sbtel lint: open x.sbtel: no such file or directory`).
- **Human output** is the default. It is line-oriented and greppable, and each problem starts with
  `<file>:` or `<file>:<line>:<col>:`, in the style of compilers.
- **`--json`**: JSON Lines, one object per input or event. JS-produced lines are canonical (§2.2).
  Go-produced lines (server commands) come from encoding/json, so consumers MUST NOT depend on key
  order. JSON output never contains the human text.

### 3.2 `sbtel version`

Prints `sbtel <VERSION>` and exits 0. `sbtel --version` is the same.

`sbtel licenses` prints `sbtel <VERSION> is under the MIT license:`, the LICENSE text, and then
THIRD_PARTY_NOTICES: the full license text of every third-party module linked into the binary
(goja, regexp2, sourcemap and pprof, which goja uses, and golang.org/x/text), of the Go standard
library, and of the two fonts the viewer page embeds (viewer/fonts, SIL OFL 1.1). Both files are embedded (assets.go). scripts/third-party-notices.sh writes the notices from
the modules' own license files (`go list -deps ./cmd/sbtel`); `make check-notices`, CI and
release.sh fail when the file is stale. Exit 0; any argument is a usage error (2).

### 3.3 `sbtel lint <spec>|- ... [--json]`  (implemented)

This prints, in order:

- for each warning, `<file>:<line>:<col>: warning: <message>`;
- for each check failure, `<file>: <check label>: <failure>`;
- for each placement note, `<file>:<line>:<col>: info: <message>`;
- then one summary line: `<file>: ok (N blocks, N behaviors, N shapes)` or
  `<file>: N problems (…)`.

A parse error prints only `<file>:<line>:<col>: error: <message>`. With `--json`, each file gives one
LintResult plus `"file": <name>`. The exit code is 1 if any file has problems; notes are not
problems.

### 3.4 `sbtel check <spec>|- --bindings <edges.txt>|- [--json]`  (A)

`--bindings` is required; leaving it out is a usage error (2). Either the spec or the bindings (not
both) may be `-`. The human output is:

- one line per violation: `<bindings>:<line>: <caller> -> <callee>: <rule>: <text>`, with
  `  (<location>)` appended when the edge has a location, and under it `  VIOLATION: <note>` when the
  edge is explained (§2.5);
- one line per invalid line: `<bindings>:<line>: error: not an edge: <text>`;
- one line per warning: `<bindings>:<line>: warning: <message>` (an orphan note, a note on an
  allowed edge, or a bare callee that names both a block and a behavior);
- then `<spec>: N bindings, N not allowed`, plus `, N explained` when N not allowed is not 0. So
  "every violation is explained" is the two numbers being equal.

A spec parse error prints like lint's, followed by the invalid lines, the warnings and no summary. `--json` prints one CheckResult plus `"file"` and
`"bindingsFile"`. The exit code is 2 if there are invalid lines, otherwise 1 if there are violations or
a parse error, otherwise 0.

### 3.5 `sbtel query <spec>|- <id>... [--with-deps] [--json]`  (A)

At least one id is required. The human output is one valid spec that `lint` accepts (the fragment,
§2.4), headed by sbtel comments:

```
; sbtel query <file> <ids as given>[ --with-deps]
; <id>: <kind> in <path joined by " > " or "the file">, lines <start>-<end>     (one per result)
;   carried by A, B; on the ports of X, Y              (a shape that something carries)
; may bind to (collapsed): A, B, C                     (--with-deps; "nothing else" when none)
; unresolved: X, Y                                     (names the shown text uses, declared nowhere)
<fragment>
```
So an agent can paste the whole output as its context. Each missing id goes to stderr as
`sbtel query: no element <id>`, plus ` (did you mean A, B?)` when `suggest` has names; the
elements found are still printed. A parse error prints like lint's. `--json` prints one QueryResult
plus `"file"`. The exit code is 2 if an id names nothing (a usage error, like an unknown session),
otherwise 1 if the spec does not parse, otherwise 0.

### 3.6 `sbtel diff <a> <b> [--json]`  (A wires, C computes)

Either side, but not both, may be `-`. The human format is in §7.5. `--json` prints the DiffEnvelope
(§2.6) plus `"a"` and `"b"` file names. Exit codes follow diff(1):

- 0: no changes and no affected ports;
- 1: the specs differ;
- 2: usage or IO error, a parse error on either side, or diff not implemented.

A parse error goes to stderr as `sbtel diff: <file>:<line>:<col>: error: <message>`, with nothing on
stdout (with `--json`, the envelope is still printed).

### 3.7 `sbtel open <spec>|- [--session id] [--label text] [--bindings edges.txt] [--no-browser] [--json]`  (B)

1. Ensure the server is running and on this binary's version (§5.1).
2. Without `--session`, create a session (§4).
   - From a file, the session is *file-backed*. It stores the absolute path, and saves from the tab
     write that file.
   - From `-`, the session is *stdin-backed*. Its spec lives in `sessions/<id>/spec.sbtel`.

   `--label` defaults to the file's base name, or `stdin`.
3. With `--session id`, the session must exist and have kind `spec`; otherwise this is a usage error
   (2). The new content (and path, for a file) becomes the next version, and a `version` event is
   appended (`by: "agent"`). Every connected tab for the session gets an SSE `version` message and
   shows a toast with a Reload action. Tabs never reload by themselves. Pushing exactly what the
   session already holds (same bytes, path, label and bindings) records nothing and returns the
   current version (§11).
4. `--bindings` copies the edges file into the session (`bindings.txt`, replacing any earlier one) so
   the tab can show violations (§6.2).
5. Open the browser at `http://127.0.0.1:<port>/s/<id>/` unless `--no-browser` is given or
   `SBTEL_NO_BROWSER=1` is set. With `--session`, a tab already connected to the session is not
   opened again. The browser command is `$SBTEL_BROWSER <url>` if set, otherwise `open` (macOS),
   `xdg-open` (others) or `rundll32 url.dll,FileProtocolHandler` (Windows). If it cannot open a
   browser, the command prints the URL to stderr and still exits 0.

The command prints the session id alone on stdout (`<32 hex>\n`), and `sbtel open: <url>` on stderr.
`--json` prints `{"session","url","version","created": bool}`, where `version` is the session's
version number. A spec that does not parse, or has lint problems, is still opened (the tab shows the
problems). The problems are printed to stderr in lint's format, and the exit code is still **0**, so
`id=$(sbtel open x.sbtel)` is safe in scripts. A spec over 1 MiB is not linted here (goja needs
seconds per MiB); stderr says so. IO or server failure is 2.

### 3.8 `sbtel open-diff <a> <b> [--session id] [--label text] [--no-browser] [--json]`  (B)

Same as open, but creates (or, with `--session`, updates) a session of kind `diff`. Either side, but
not both, may be `-`. Both sides are snapshotted into `a.sbtel` and `b.sbtel`; they are not live files,
and there are no saves. The URL is `http://127.0.0.1:<port>/s/<id>/diff`. `--label` defaults to
`<a name> → <b name>`. The output is the same as open's. `--session` on a session of kind `spec` is a
usage error (2).

### 3.9 `sbtel inbox <session> [--wait] [--timeout s] [--peek] [--json]`  (B)

This reads `events.jsonl` directly from disk; it needs no server. It prints the unread **user** events,
of kinds `review`, `comment` and `save`, with `seq` greater than the session's read cursor. Then it
advances the cursor to the last event it read (of any kind), unless `--peek` is given. These are only
what the human *sent*: a draft review (pending comments, the message, edits not yet sent) lives in the
tab and never reaches the server (§6.7), so `--wait` never wakes for it.

- `--wait`: when nothing is unread, poll the file every 250 ms until something is, or until
  `--timeout` seconds pass (default 600; `0` means wait forever). On timeout it prints nothing to
  stdout, prints `sbtel inbox: nothing new after <s>s` on stderr, and exits 0.
- Human output, one block per event:
  ```
  c7 comment on block Shell.Turn (version 3, 2026-11-08T09:30:12Z)
    > Split this into rendering and state.
    source:
      (block Shell.Turn
        ...)

  save version 4 by user (was 3), 2026-11-08T09:31:02Z, written to /abs/spec.sbtel

  save version 6 by user (was 5, which the user overwrote without merging), 2026-11-08T09:40:00Z, written to /abs/spec.sbtel

  r9 review of version 4 by user, 2026-11-08T09:35:40Z: a message, 2 comments, proposed edits
    > Two things.
    edits against version 4 (sbtel diff):
      ~ block Shell.Turn: sketch [-old-] {+new+}
      1 change (0 added, 0 removed, 0 moved, 0 renamed, 1 changed), 0 affected ports
    proposed spec: /abs/home/sessions/<id>/proposals/9.sbtel
    it replaces the proposed spec of r8
    c9.1 comment on block Shell.Turn
      > Split this.
      source:
        (block Shell.Turn …)
    c9.2 comment on …
  ```
  `c7` is the comment id to pass to `reply`. A review prints as one unit, in this order: the header
  (its id, the version its edits are against, the time, and what it holds: `a message`, `N comments`,
  `proposed edits`), the message (`  > `), the diff of the proposal against that version (the text of
  `sbtel diff`, or `edits against version N: formatting or comments only, no change to any element`),
  the proposed spec's path, `it replaces the proposed spec of rK` when it does, then each comment as
  a comment event prints, indented two more spaces and without its version. A comment-only review has
  no edit lines. A forced save (§5.2) says `which the user overwrote without merging`.
- `--json` prints one event object (§4.3) per line. A review is
  `{seq, kind: "review", by: "user", at, id: "r<seq>", message, version, hash, comments: [{id:
  "c<seq>.<k>", target, targetLabel, text, source}], proposal: {path, hash, base, baseVersion,
  diffText} | null, supersedes?}`: `version` and `hash` are the version the review was made against
  (with a proposal, its `baseVersion` and `base`); `path` is absolute.
- An unknown session is exit 2. An empty inbox is exit 0 with no output.

### 3.10 `sbtel reply <session> <comment-id> <text>|-`  (B)

Appends a `reply` event through the server (§5.3), so that connected tabs show it at once via SSE. The
CLI starts the server if needed. `-` reads the text from stdin. The text must not be empty, and the id
must name, in the session, a comment (`c<seq>`), a review's comment (`c<seq>.<k>`) or a review as a
whole (`r<seq>`; the tab shows it under the review in the Review panel's "Sent reviews", with a dot on
the Review button), or a note of the agent's own (`n<seq>`). Otherwise this is exit 2. It prints nothing
on success.

### 3.10b `sbtel ack <session> <comment-id> [emoji]`  (B, v0.4.1)

Marks a comment (`c<seq>` or a review's `c<seq>.<k>`) as taken in, with nothing more to say. It appends
an `ack` event (`to`, and the emoji as `text`; 👍 by default; anything longer than one emoji is exit 2)
and prints nothing. The tab shows the emoji as a reaction beside the comment's status, counts the comment
as seen, and marks nothing unread, so the reader is not called back. It is logged and restored with the
comments. The skills tell agents to ack where a reply would only confirm, and to reply with results.

### 3.10a `sbtel note <session> <target> <text>|-`  (B, v0.4.1)

Starts a thread with the agent's words first: the one thing an agent can say without a comment to
answer. `<target>` is a block's name, `shape:Name`, `behavior:Name`, or `.` for the whole file; a thing
the session's current spec does not declare is exit 2. It appends a `note` event (`id` `n<seq>`,
`target`, `targetLabel`, `text`) through the server and prints the id. The tab shows the thread on the
target with an unread dot, like a reply; nothing is announced. A note is not the human's, so no inbox
delivers it. The human's answer is an ordinary comment on the same target; the agent adds to its own
thread with `sbtel reply <session> n<seq> …`. Notes are kept in the project's comment log and restored
with the rest. The skills tell agents to use it only when the human asks.

In any comment or reply, a block's name is a link to the block: any name in backticks, and
a bare one that could not be a plain word (it has `-`, `/`, `#`, `.` or an inner capital).

### 3.11 `sbtel sessions [--json]`  (B)

Reads the state directory from disk. It prints one line per session, newest `updated` first:

```
<id>  <kind>  <label>  v<version>  <unread> unread  updated <RFC3339>  <path or "stdin">
```
For a diff session the last column is `<a> -> <b>`, each side its absolute path or `stdin`.
`--json` prints one object per line:
`{id, kind, label, version, unread, created, updated, path|null, tabs: int|null}`. `tabs` is null
when the server is not running.

### 3.12 `sbtel close <session>`  (B)

Through the server, this sends `closed` to the session's tabs and deletes `sessions/<id>/`. A
file-backed spec file is never touched. An unknown session is exit 2.

### 3.13 `sbtel serve --status | --stop [--json]`, and hidden `serve --foreground`  (B)

- `--status` prints `running pid <pid> port <port> version <v> since <RFC3339>`, or `not running`.
  The exit code is 0 if running and 1 if not. `--json` prints the server.json fields without the
  token, plus `"running": bool`.
- `--stop` asks the server to exit (§5.3), waits up to 5 s, and exits 0 whether or not a server was
  running.
- `--foreground [--port n] [--idle minutes] [--prefer-port n]` runs the server in this process. It is
  hidden from help; `open` uses it to start the detached server, and tests use it directly. `--idle`
  may be fractional. `--prefer-port` is the port to try first; the CLI passes the old server's port
  when it replaces one, because a cleanly stopped server has removed server.json (§5.1).

### 3.14 `sbtel export <spec>|- [-o out.html] [--readonly] [--embed] [--bindings edges.txt] [--title text]`  (v0.2.5)

Writes one self-contained HTML file: the viewer page (`sbtel.ViewerHTML`, as `open` serves it) with
the spec, its options and, with `--bindings`, the edges baked in, for people who have no sbtel. It
needs no server and starts none, and the page requests nothing (§6.5); it runs in the standalone mode
of §6.9, with everything §6.9 says of a spec from the URL.

- **Output**: `-o f` or `--out f`; the default is the spec's base name with its extension replaced by
  `.html`, in the current directory (`examples/viewer.sbtel` → `viewer.html`). `-o -` writes the page to
  stdout. From stdin, `-o` is required (no name to derive). An output that is the spec file itself is a
  usage error. The file is written through a temporary file in the same directory and renamed, so a
  failure never leaves half a page. An existing file is replaced.
- **The baked blocks** replace the page's `<title>sbtel Playground</title>` line, in the head, before the
  page's script: `<title>` (the title, HTML-escaped), `<meta name="generator" content="sbtel export
  <version>">`, then three inert script blocks:
  `<script type="application/json" id="sbtel-export">{"embed","readonly","title","version"}</script>`
  (encoding/json, which writes `<`, `>` and `&` as `\u003c`, `\u003e`, `\u0026`),
  `<script type="text/sbtel" id="sbtel-spec">…</script>` and, with `--bindings`,
  `<script type="text/plain" id="sbtel-bindings">…</script>`. The text of the last two is escaped: `&`
  as `&amp;`, `<` as `&lt;`, CR as `&#13;` and NUL as `&#0;`, after invalid UTF-8 is replaced with
  U+FFFD. With no `<` left, no text can end the block (`</script`) or start a comment (`<!--`), and
  the escaped CR and NUL survive the HTML parser, which would turn them into LF and U+FFFD. play.js
  undoes exactly these escapes (`&lt;`, `&amp;`, `&#N;`), so the page's text is the spec's text, byte
  for byte.
- **`--readonly`**: the page opens read-only, in the full viewer (the semantics of `?embed=readonly`).
  **`--embed`**: the chromeless layout of `?embed`, for an iframe. Together: `?embed=readonly`.
- **`--bindings f`** (or `-`, when the spec is not): the checks pill and popover show the edges'
  violations and a behavior's "uses" outline, as in server mode with `open --bindings` (§6.3, §6.8).
- **`--title t`**: the page's `<title>` and the label in the brand chip (`<title> · N blocks`, plus
  ` · read-only`). Default: the name of the spec's first top-level block (`__api.topBlocks`), else the
  spec's file name (`stdin` from stdin). An empty or blank `--title` is a usage error.
- **Validation**: the spec is parsed first. A parse error prints `sbtel export: <file>:<line>:<col>:
  error: <message> (nothing written)` and exits 2, writing nothing (as `diff`, §3.6: the command cannot
  make its output). Otherwise lint problems go to stderr in lint's format (§3.3) when there are any,
  and the file is written. With `--bindings`, stderr gets `sbtel check`'s text (§3.4) when a violation is
  unexplained, a line is not an edge or a note is misplaced, and otherwise only its summary line. As with
  `open`, a spec over 1 MiB is not linted or checked (a note says so); it is still parsed.
- **stderr** ends with `sbtel export: wrote <out> (<n> bytes, <k> KiB)`, or `sbtel export: <n> bytes, <k>
  KiB to stdout`. stdout is empty unless `-o -`. The page is the viewer's size plus the spec (about
  600 KB, most of it the two embedded fonts).
- **Exit codes**: 0 written (with any warnings or violations); 2 usage or IO error, or a spec that does
  not parse. There is no 1: problems are reported, not fatal, as with `open` (§11 entry 13).

### 3.15 `sbtel fmt --migrate-ports [--check] <spec>|- ...`  (v0.3.0)

Rewrites every port in the 0.2 form, `(port name in|out Type …)`, in the 0.3 form,
`(port :in|:out Type [:as name] …)`, in place. `:as name` is written only when `name` is not the
type's default name (LANGUAGE.md §3.5). Only the head of each port changes (the name, direction and
type tokens); the type is copied as written, and its sketch, comments, spacing and the rest of the file
stay byte for byte. The rewrite is `__api.migratePorts(src)` → `{ error: Located|null, src, ports: [{
line, col, from, to }] }`; it works on the reader's output, so a file must read (balanced parentheses,
closed strings and sketches) but need not lint. A rewritten file is idempotent under a second run.

- `--migrate-ports` is required: `fmt` without it is a usage error (2). It is the only rewrite so far;
  `fmt` is not a formatter.
- stdout: one line per rewritten port, `<file>:<line>:<col>: <from> -> <to>` (`…` stands for a sketch
  or other items after the type), then `<file>: rewrote N ports`. With `-`, the result goes to stdout
  and the report to stderr.
- `--check` writes nothing and ends each file with `<file>: N ports in the 0.2 form`.
- **Exit codes**: 0 done (or, with `--check`, nothing to rewrite); 1 with `--check` when a file has a
  0.2 port; 2 usage or IO error, or a file that does not read (`<file>:<line>:<col>: error: <msg>`; the
  other files are still processed).

---

## 4. State directory

`$SBTEL_HOME`, default `~/.sbtel` (`%USERPROFILE%\.sbtel` on Windows). Directories are created with
mode 0700 and files with 0600. Every rewrite of a whole file is atomic: write `<name>.tmp` in the same
directory, then rename it over the target.

```
$SBTEL_HOME/
  server.json            {pid, port, version, started, token}            written by the server
  server.log             detached server's stdout+stderr, truncated at each start
  sessions/<id>/         id = 32 lowercase hex chars (128 bits, crypto/rand)
    meta.json            §4.1                                             written by the server
    events.jsonl         §4.3, append-only                                 written by the server
    cursor.json          {"read": <seq>}                                   written by `inbox` only
    spec.sbtel           current spec, stdin-backed sessions only          written by the server
    a.sbtel, b.sbtel     diff sessions only                                written by the server
    bindings.txt         optional, from open --bindings                    written by the server
    versions/<n>.sbtel   every version seen, n = 1, 2, …                   written by the server
    proposals/<seq>.sbtel the proposed spec of the review event <seq>      written by the server
```

**Single-writer rule.** Only the server process writes session files. The one exception is
`cursor.json`, which only `inbox` writes (and races between two `inbox` calls on one session are
accepted). CLI commands that change a session (open, open-diff, reply, close) go through the control
API (§5.3), starting the server if needed. As a result, nothing ever needs a file lock, which keeps
the binary portable across the three operating systems with no dependencies.

### 4.1 meta.json

```
{ "id": "…", "kind": "spec" | "diff", "label": "…",
  "created": RFC3339, "updated": RFC3339,         // updated = last event or version
  "spec": { "path": "/abs/x.sbtel" | null, "name": "x.sbtel" | "stdin" },   // kind spec
  "diff": { "a": {"name": "…", "path": …|null}, "b": {…} },                  // kind diff
  "version": n,                                    // current version number
  "base": "<sha256 hex of the current version's bytes>",   // diff: sha256(hex(sha256 a) + hex(sha256 b))
  "bindings": bool }
```

### 4.2 server.json

`{ "pid": int, "port": int, "version": "0.2.1", "started": RFC3339, "token": "<32 hex>" }`. The
token authenticates the control API, and the 0600 file mode is what keeps it from other users. On
Windows, the user-profile ACL does the same job. The
server deletes server.json on a clean exit.

### 4.3 events.jsonl

One JSON object per line. `seq` is 1-based and equals the line number. `at` is an RFC3339 UTC time
with milliseconds.

| kind | by | fields |
|---|---|---|
| `version` | `agent` \| `user` \| `disk` | `version, hash, path\|null` (and `label` when it changed) |
| `comment` | `user` | `id: "c<seq>", target, targetLabel, text, version, hash, source` |
| `reply` | `agent` | `to: "<comment id>", text` |
| `save` | `user` | `version, hash, prev: <previous hash>, path\|null`, and `force: true` when it overwrote a newer version than the tab's base (§5.2) |
| `review` | `user` | `id: "r<seq>", message, version, hash, comments: [{id: "c<seq>.<k>", target, targetLabel, text, source}], proposal: {path, hash, base, baseVersion, diffText}\|null`, `supersedes` (§3.9, §6.7) |

A save appends `save` and not `version`. A review appends `review` and never a `version`: its
proposed spec is a file in `proposals/`, not a version, and the spec file is not touched. A review's
comments are not separate events; their ids are `c<seq>.<k>` (k = 1, 2, …), which cannot clash with a
`c<seq>`. A file change found on disk appends `version` with
`by: "disk"` (§5.4). The first event of every session is `version` 1.

`target` is the viewer's comment key:

- `block:<block id>`;
- `beh:<behavior name>`;
- `msg:<message name>`;
- `line:<a id>|<b id>`, an adjacency line between two blocks.

`source` is the element's source text at the version the comment was written against (for a line, the
two blocks' texts joined by a blank line).

### 4.4 The project folder (v0.4)

`.sbtel/` beside a spec file holds what belongs with the project rather than with one machine:

- `files/`: files the human attached (§5.2, `POST /s/<id>/file`).
- `comments/<spec file>.jsonl`: every comment, reply and review event of every session on that spec,
  appended as it is written to the session's events.jsonl (a proposal's path is left out).

Each line of the comment log also carries `session`, the session it was said in. A new session on a spec
file reads that file's log and appends its comments, reviews (without `proposal`) and replies to its own
events, renumbered as its own (`c<seq>`, `r<seq>`, `c<seq>.<k>`) and marked `old: true`, with `origins`
mapping each new id to its `session/id` in the log. `sbtel inbox` skips old events. A reply to an old
comment is logged under the original session and id, so the next session restores it too.

`sbtel open` on a file looks for a `.git` at or above the spec's directory; when it finds one and the
repository's top `.gitignore` has no line that ignores `.sbtel`, it appends `.sbtel/` and reports
`added .sbtel/ to <path>` on stderr. The server does the same before it first writes a file.

---

## 5. Server

### 5.1 Lifecycle

- There is one shared process per `$SBTEL_HOME`, running `sbtel serve --foreground`. `open`,
  `open-diff`, `reply` and `close` start it **detached** when no healthy server answers:
  - Unix: `setsid` via `SysProcAttr`;
  - Windows: `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, in a `_windows.go` file.

  stdout and stderr go to server.log. The CLI then polls for a server.json naming a *new* server (a
  token other than the one it saw before, which also covers a reused pid) that answers
  `GET /control/status` on the CLI's version, for up to 5 s. If none does, that is exit 2, and the error names
  server.log.
- **Healthy** means server.json exists, `GET /control/status` with the token answers 200 within 1 s,
  and its `version` equals the CLI's `sbtel.Version()`. If the server answers with another version,
  the CLI sends `POST /control/stop`, waits for it to exit, and starts its own. Sessions live on disk,
  so a restart loses nothing.
- **Start race.** After binding, a new server reads server.json. If another server listed there is
  healthy, the new one exits 0. Otherwise it writes its own server.json. Every 2 s, a server that finds
  server.json naming another pid exits. The loser of a simultaneous start therefore disappears quickly.
- It binds the port in the previous server.json if that port is free, so open tabs' EventSource
  reconnects by itself after a restart. A port the previous server has just released can stay
  unbindable for a moment (its last connections are closing; on Windows, TIME_WAIT can hold it longer),
  so it retries the preferred ports for up to 1.5 s (15 tries, 100 ms apart). Otherwise it binds
  `127.0.0.1:0` (a random port): keeping the port is a best effort, and on Windows the tests only log a
  fallback. `--port`
  overrides both.
- **Idle shutdown** is off unless asked for (v0.4.1; before, 30 minutes): the server stays up until
  `sbtel serve --stop`, a signal, or a newer sbtel replacing it. With `--idle N` or `$SBTEL_IDLE_MINUTES`
  it exits when it has had no SSE client and no request for N minutes.
- It removes server.json on exit (SIGINT, SIGTERM, idle, or stop).

### 5.2 Browser API (every route under `/s/<id>/`)

An unknown or malformed `<id>` is 404 with an empty body. So is `/`, and every path not listed here.

| Method, path | Response |
|---|---|
| `GET /s/<id>/` | the viewer page (`sbtel.ViewerHTML`), `text/html`. For a diff session, a 302 to `/s/<id>/diff` |
| `GET /s/<id>/diff` | the same page. For a spec session, a 302 to `/s/<id>/` |
| `GET /s/<id>/meta` | `{id, kind, label, version, hash, name, path\|null, bindings, serverVersion}` |
| `GET /s/<id>/spec` | `{version, hash, name, src}`: the current version (spec sessions) |
| `GET /s/<id>/diff.json` | `{a: {name, label, path, src, hash}, b: {…}, version, hash, label}` (diff sessions; the "page data" for C; `label` is the session's) |
| `GET /s/<id>/bindings` | `text/plain` bindings, or 404 |
| `GET /s/<id>/log` | `{events: Event[]}`: all events, so a reloaded tab can rebuild comment threads |
| `GET /s/<id>/versions/<n>` | `{version, hash, src}`: version n's bytes (spec sessions, 1 ≤ n ≤ the current version; anything else is 404). The tab uses it for a draft kept against an older version (§6.7) |
| `POST /s/<id>/review` | body `{message, comments: [{target, targetLabel, text, source}], proposal: {src, base, baseVersion}\|null, supersedes?, version?}` → appends one `review` event (§4.3) → 200 `{id, seq, comments: [ids], proposal: path\|null}`. 400 for an empty review (no message, no comment, no proposal; whitespace is nothing), a comment without target or text, a proposal in a diff session, or a proposal whose `base` is not the hash of `versions/<baseVersion>`. A proposal equal to its base is dropped. The proposal is written to `proposals/<seq>.sbtel`, and its `diffText` is `sbtel diff` of the base and the proposal, from `Options.DiffText` (the CLI's engine; the server never names the engine), computed outside the session lock. The spec file is never written |
| `POST /s/<id>/save` | body `{base, src, tab?, force?}` (`tab` as in `events?tab=`, so that tab gets no `version` echo). If `base` ≠ the current hash and `force` is not true: **409** `{version, hash, by}` (`by` made the current version: `agent`, `user` or `disk`), and the tab asks the human (§6.3). With `force`, the save goes ahead and its event has `force: true` (a save on the current base is never marked). Otherwise write the file (file-backed, atomically) or spec.sbtel (stdin), add `versions/<n+1>`, append `save`, and answer 200 `{version, hash}`. Diff sessions answer 405 |
| `POST /s/<id>/comment` | body `{target, targetLabel, text, version, source}` → appends `comment` → 200 `{id, seq}` |
| `GET /s/<id>/events` | SSE, described below |

**SSE stream**:

- `hello` `{version, hash, seq}` on connect (`seq` is the session's last event). A tab whose base
  differs from `hash` shows the version toast: that covers versions pushed while it was disconnected;
- `version` `{version, hash, by, label?}` when a new version arrives from the agent or from disk, or
  from a save in *another* tab. A version with the tab's own hash (only the label or bindings
  changed) is adopted quietly, without a toast;
- `reply` `{to, text, seq, at}`;
- `closed` `{}`;
- a `:ping` comment every 25 s.

Each message has `id: <seq>` where an event exists. The client may send `Last-Event-ID`, or the query
parameter `after=<seq>` when it opens a fresh EventSource, and the server then replays later `reply`
events, and `version` and `save` events as `version` messages. The query parameter `tab=<random>`
names the tab (see `save`). The number of open SSE connections per session
is the session's `tabs`.

**Security (MUST):**

- **Host**: any request whose `Host` is not exactly `127.0.0.1:<port>` or `localhost:<port>` is
  rejected with 421 and an empty body. This blocks DNS rebinding.
- **Writes** (every POST): `Origin` MUST be present and equal `http://127.0.0.1:<port>` or
  `http://localhost:<port>`, and `Content-Type` MUST be `application/json`; otherwise the request gets
  403. Bodies are limited to 64 MiB (413), the same limit as control bodies (§5.3), so the tab can
  save any spec an agent can push. The tab measures a save's body in UTF-8 bytes before posting, and
  refuses one over the limit itself (toast, the edits stay), so it never uploads a body the server
  would cut off.
- **Session ids** are the capability: 128 random bits from crypto/rand, written as 32 lowercase hex
  characters. Compare them only through a map lookup, never by prefix. Nothing lists them over HTTP.
- **No CORS**: the server never sends `Access-Control-*` headers and answers `OPTIONS` with 405.
- **Headers** on every response:
  - `Cache-Control: no-store`;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: no-referrer`, so the capability URL never leaks through a link the page opens
    (the page itself requests nothing outside the server, §6.5);
  - `X-Frame-Options: SAMEORIGIN` (no other origin may frame a page; the page frames its own diff view for
    "See changes", §6.3);
  - `Cross-Origin-Resource-Policy: same-origin` (an extra: other origins cannot even embed responses).
- `POST /s/<id>/file {name, data}` (v0.4; spec sessions with a file) stores a file the human dropped,
  pasted or picked. `data` is base64, at most 16 MiB decoded. The file is written to `.sbtel/files/`
  beside the spec (§4.4) and nowhere else: the name is reduced to its base name, to the characters
  `[A-Za-z0-9._-]`, without a leading dot, at most 80 characters; a file with the same contents is reused,
  and one with other contents is never replaced (`-2`, `-3`, … are tried). The answer is
  `{path: ".sbtel/files/<name>", size}`. A stdin spec answers 409.
- `GET /s/<id>/ref?path=…` serves `.sbtel/files/<name>` (one level, no dot-file) without the spec or a
  comment naming it; every other dot-directory stays refused.
- A level's layout (v0.4.1) is three steps, each resting on the one before. A flow gives every item a
  cell (row, column) and an x: `flowRows` goes across and wraps down; `flowCols` (opts.flow `cols`) goes
  down and wraps across, using as many rows as `flowRows` needs at that width and one more while the
  columns do not fit; it cuts the level into stretches at any item too wide to have a neighbour, which
  gets a line to itself (`seg`), and starts the columns again after it. `gridTracks` turns the rows into tops and heights, the same for both flows, so rows
  stay aligned across columns. `layoutLevel` then emits boxes and the line between two linked items by
  where their cells are (sideways, or downward under the ears). The viewer's drop targets come from laying
  out each candidate edit, so they follow either flow; its two gap helpers share `gapBetween`. The order
  check reads source order along rows or down columns.
- The corner (v0.4.1). A block's top-right corner holds its open/close toggle (`.ctog`, only when it
  has an inside) and then its comment count (`.cbub`), in one `.ccorner`. A closed block is one thread
  (its own comments and those on everything inside it), so the toggle beside the count is how you read
  them together. The count of blocks under the title still toggles; the arrow beside it is gone.
- Spring-open (v0.4.1). Drop zones come only from blocks that are open, so a closed block had no inside
  to drop into. While a block is dragged, the pointer resting on the middle of a closed block (the
  inner 48% of its width, on the board as drawn with the dragged block lifted out, so no preview can
  move the target away) starts a wait of `SPRING.dwell`; moving `SPRING.still` px starts it over, and a
  ring grows on the block in the wait's second half. Meanwhile the drag previews as usual. When the wait ends
  the block joins `state.open`, the board is laid out again and `moveZones` runs again, with the sprung
  ids counted as open (a card with nothing inside has no frame; its candidate is the `edge:'start'`
  move that makes its first level). Inside a sprung block only its own zones are offered. Out of it for
  `SPRING.leave`, it closes and the zones are rebuilt. At the end of the drag every sprung block leaves
  `state.open` except the one dropped into and those around it. One edit, one undo step.
- Dismissal (v0.4.1). One list in the kit (`surfaces`, with `opened(id, close, opt)`, `closed(id)` and
  `dismiss()`) holds everything open over the canvas, in the order it opened: callouts and their
  editors, popovers, the large thread, the reading-order menu, dialogs, the file and code windows, the
  sheets (shapes, source, review), the help panel, the tour, a diagram or comparison shown over the
  page, and a drag in progress. One capture listener sends Escape to `dismiss()`, which closes the last
  entry wherever the focus is. An entry marked `light` (a hover tip) closes on the way to the next one
  and does not cost a press; an entry whose `live()` is false is skipped. A surface that closes any
  other way calls `closed`, so the list matches the screen. With nothing listed, Escape leaves a text
  box, then lets go of the talk outline, the ears and the selection. A new surface registers itself and
  writes no key handling. The diff view's change list is the view's standing panel and is not listed.
- The keyboard (v0.4.1). The selection is the cursor, and one table (`KEYS`) names every key, what it
  does and its line in the help panel; the global key handler looks keys up in it. Moving is by sight:
  the arrows use `stepTo`, which picks the nearest box ahead within a cone, preferring boxes in the same holder; `kbOrder` is
  the picture's reading order for Tab, which hands the key back to the browser at either end so the
  toolbar stays reachable. Keys are not taken while typing, in a dialog, with Ctrl, Alt or Cmd held, or
  (Space, Enter, Tab) from a focused control. A letter is matched in lower case, so Caps Lock is not Shift.
- Reading replies (v0.4.1) is the page's own business; the server only says which comments have replies.
  "Unread" is a fact of the log (a reply the reader has not opened), never something an agent declares.
  A comment whose target is hidden inside a closed block is read at the outermost closed block that hides
  it (`stopOf`), whose chat shows every such thread together (`inScope`). The walk visits stops in source
  order chosen by three questions in turn (`nextStop`): nearest (the stop sharing the longest run of
  enclosing blocks with where the reader is), back (the region visited most recently) and beginning (reading
  order); the reader picks nearest-back-beginning (the default), nearest-beginning, beginning alone, or by
  latest or oldest reply. A back arrow returns through the threads read. A reply is never announced (no
  toast): the dots are the only signal, and the reader comes to them when they choose.
- What `/ref` answers, by kind (v0.4.1). The JSON answer carries the text of a text file (at most 2 MiB).
  With `raw=1` a picture (png, jpg, gif, webp), a PDF or a calendar invite (`.ics`) is sent as itself,
  with its own type and `nosniff`; pictures and PDFs may be up to 32 MiB. HTML and SVG are never sent as
  themselves, so a referenced file cannot run in the page's origin. The page draws them from the JSON
  text: Markdown through its own small renderer (text escaped first, links limited to http, https and
  mailto), HTML in an `<iframe sandbox>` without `allow-scripts` or `allow-same-origin`, SVG as an
  `<img>`, an invite as a card. The viewer's icons are Lucide's (`viewer/icons`, ISC), inlined by the build.
- `GET /s/<id>/open?path=…[&via=<session>]` (v0.4) opens a ref to another spec: the path must end in
  `.sbtel` and pass the tests of `/ref` (named in the spec or in a comment, inside the spec's directory, a
  regular file). The answer is `303` to the page of a session on that file: the most recently used
  session that already shows it, else a new one labelled with the file's name. With `via`, the page's URL
  carries `?via=<session>`: the page is shown inside that session's page and sends `from: <session>` with
  each comment, review and save. Anything else is 404.
- **Sent from (v0.4).** A comment, review or save event whose `from` names another live spec session
  stays in its own session's log with that field, and the server appends to the sender's log
  `{kind:"ref", by, session, file, ref}`: the session and file it happened in (the file relative to the
  sender's spec) and the event itself. A reply to such a comment or review is copied the same way. The
  sender's tabs get the copy as SSE `ref`. `sbtel inbox` shows a `ref` whose event is the user's, and
  skips a comment, review or save that has `from`: each agent hears what was sent from its own page.
- **Seen (v0.4.1).** `GET /s/<id>/log` also answers `seen`: the ids of the comments and reviews (and
  the reviews' comments) that `sbtel inbox` has handed to an agent. Those are the session's own up to
  its cursor, those sent from another session's page once that session's cursor has passed its `ref`
  copy, and everything restored from the project log. After it moves a cursor, `sbtel inbox` posts
  `/control/sessions/<id>/seen`; the server then sends SSE `seen {ids}` to that session's tabs and to
  the tabs of every session it holds copies for. `inbox --peek` moves no cursor, so it marks nothing.
- `/` lists nothing (404).
- Control bodies (§5.3) are limited to 64 MiB, like browser writes. (Before the integration pass browser
  writes had a 4 MiB limit, so a tab could not save a big spec an agent had pushed; §11, entry 27.)

### 5.3 Control API (CLI → server; not for browsers)

Routes live under `/control/`. Each request MUST carry `Authorization: Bearer <token from
server.json>`, compared in constant time, and MUST NOT carry an `Origin` header. Requests that break
either rule get 403. The Host check applies here too. Bodies and responses are JSON.

| Route | Body → Response |
|---|---|
| `GET /control/status` | `{pid, port, version, started, sessions: int, clients: int}` |
| `POST /control/stop` | `{}`. The server answers, then exits |
| `POST /control/sessions` | `{kind, label, spec: {path\|null, name, src}` or `diff: {a: {name, path, src}, b: {…}}, bindings: text\|null}` → `{id, version, url}` |
| `POST /control/sessions/<id>/version` | `{label?, spec: {…}` or `diff: {…}, bindings?: text\|null}` → `{version, url, tabs}` |
| `POST /control/sessions/<id>/reply` | `{to, text}` → `{seq}`. If no such comment, 404 |
| `POST /control/sessions/<id>/close` | `{}` → `{}` |
| `GET /control/sessions` | `{sessions: [{id, tabs}]}`, live tab counts for `sessions` |

### 5.4 Saves and external edits

- `base` is the sha256 of the version the tab loaded (the `hash` from `/spec` or SSE). The tab never
  hashes anything itself: it echoes the hash it was given.
- Before handling `save`, `spec` and `meta`, and every 2 s while the session has a tab connected, the
  server hashes a file-backed session's file. If the hash differs from `base`, it records the file as a
  new version (`version` event, `by: "disk"`) and pushes SSE `version`. An agent that edits the file and
  forgets `open --session` is therefore still seen.
- If writing the file fails (permissions, disk), `save` answers 500 `{error}`, records nothing, and the
  tab shows the error and stays dirty.
- A file that has disappeared is not an error. The session keeps its last version, `/spec` serves it,
  and a save recreates the file.

---

## 6. Viewer modes

### 6.1 Detection (in viewer/src/index.html, block `Viewer.Mode`)

```js
const SBTEL = { version, mode: 'standalone' | 'server' | 'diff', session: id | null, base: '/s/<id>/' | null,
                compare: key | null, compares: {}, modes: {} };
```
The mode is `server` when `location.protocol` is not `file:` and the path is exactly `/s/<32 hex>/`.
It is `diff` for exactly `/s/<32 hex>/diff`, and for `/s/<32 hex>/?compare=<key>`: a comparison that a
tab of that session opened (the Review panel's full diff, or "View their changes"), with `session` and
`base` null and the pair read from the opener's `window.sbtelCompares[key]` (§6.7). Everything else is `standalone`: file://, the published
playground, and any other path. At Boot, the page calls `SBTEL.modes[SBTEL.mode].boot()` if that is
registered. Otherwise it calls `setSource(SAMPLE)`, which is exactly the original playground. Since
v0.2.3 play.js registers `standalone` (§6.9); without URL parameters its `boot()` does exactly that,
and adds the home link.

### 6.2 Standalone

This is the playground as published, titled "sbtel Playground". "sbtel" in the brand chip links to the
project's home page: the `content` of `<meta name="sbtel-home">` when the page has one (the website's
copy at /sbtel/play/ has `content="../"`), else `https://shashi.biz/sbtel/`; in a frame (a published
artifact) it opens a new tab. Server and diff mode have no home link. The comment Send button copies a text
payload to paste into an agent conversation; there is no Review button. Settings and comments persist
in localStorage under `sbtel-play`, `sbtel-comments` and `sbtel-help-seen`; on first read it falls back
to the old `marquee-*` keys. The undo history persists under `sbtel-hist` (§6.7).
Standalone behaviour MUST NOT change: `make accept` (viewer/test) is the proof. Its results must
equal `viewer/test/expected.txt`, which were recorded on the frozen Marquee page.

### 6.3 Server mode (viewer/src/server.js, workstream B)

`boot()` does the following:

1. Fetch `meta` and `spec`, call `setSource(src)` and `fit(false)`, and show the label in `#specName`.
2. Rebuild comment threads from `log`. Server-mode comments live on the server, so replace the
   localStorage-backed `state.comments` and `saveComments` for this page. This part is
   viewer/src/session.js (`sessionComments`), which diff mode shares (§6.4).
3. Connect `EventSource(base + 'events')`.

The UI behaviour is as follows (v0.2.1: reviews, §6.7).

- **The chat** (v0.3.1; before it, a composer and a separate thread). A target's comments are one popover:
  the thread, scrolled to its newest message, over an input, with **Send** (primary; ⌘/Ctrl+Enter) and
  **Add to review** (Shift+Enter). Send posts the comment to `comment` at once; Add to review keeps it as
  `pending` in the draft review. Enter is a new line. The chat stays open after either, the agent's
  replies appear in it as they arrive, and unsent text is kept for the target while the page lives. On a
  screen narrower than 760px it is a sheet at the bottom, lifted above the on-screen keyboard.
- **Unread replies** (v0.3.1). A reply that arrives while its target's chat is closed puts a dot on the
  comment count (`.cbub.unread`) until the chat is opened. What has been read is kept in localStorage
  per session (`sbtel-read:<id>`: comment id to the number of replies read), and is dropped with the
  session's other keys. On the first load of a session in a browser, what is already there is read.
- **Review (N)**, the primary action, at the end of the dock: N is the pending comments plus the
  edits (the changes `diffSpecs` finds since the draft's base, at least 1 when the text differs), hidden
  at 0. It opens the Review panel (§6.7). Send review posts `review`.
- **Edits** mark the page dirty. **Save**, a secondary action in the dock (⌘S), posts `save` with
  `base`; it sends no comment. A save still records a `save` event.
  - On 200, adopt the new `hash` (and drop a sent proposal: the file now holds the tab's text).
  - On 409, ask: "The spec changed since you started (agent pushed a new version). Overwrite it with
    yours?" (the parenthesis names `by`: "the file changed on disk", "it was saved from another tab").
    **Overwrite** saves again with `force`; **View their changes** opens a comparison of the tab's base
    and the current version in a new tab and leaves the question open; **Cancel** writes nothing and
    shows the version toast again. It never overwrites silently.
- **SSE `version`** shows a notice: "Version N from your agent" (or "the file changed on disk", "saved from another tab") with a **Reload** action (and
  "Discard my edits and reload" when there are unsent edits; with only a sent proposal, it says the
  version may hold it). Reload refetches `spec` and calls `setSource`,
  keeping the open blocks and the camera. The page never reloads by itself. **See changes** (v0.3.1), beside
  Reload, fetches `spec` and shows the diff view of the tab's loaded version against it, in a frame over
  the page (`?compare=<key>`, §6.1; the frame reads the pair from its parent, as a compare tab reads it
  from its opener), under a bar with **Back** (the page as it was, and the toast again) and **Reload**.
  Unsent edits are not part of that comparison, and the bar says so.
- **SSE `reply`** shows the reply under its comment in the chat; when that chat is closed, a toast and
  the unread dot.
- **SSE `closed`** shows a banner: the session is closed and the page is read-only.
- **Bindings**: when `meta.bindings` is set, fetch `bindings`, run `bindingVerdict` (core) on each
  edge, and list the violations in the checks popover.
- **Errors**: when the server is unreachable, show one banner and retry every 5 s.

As built (B):

- The Save control is a dock button before the checks pill (`#sbSave`), also ⌘/Ctrl-S. The title area
  reads `<label> · v<n>[ · edited | · proposed, awaiting agent | · proposed in rK, then edited] · <N>
  blocks`, and `document.title` gets a `•` while there are unsent edits (neither saved nor in a sent
  review).
- Reload pushes the tab's own text onto the undo stack when it differs, so "Discard my edits and
  reload" is undoable with ⌘Z (the toast says so). A load is an ordinary step of the persistent
  history (§6.7), and it drops a sent proposal.
- Sent comments keep their bubble (server mode counts every comment, not only unsent ones), so a
  thread with an agent reply stays reachable; sent comments lose their Delete button.
- The bindings show as one extra check, "Code bindings respect the levels (N edges, K of V violations
  explained)", whose failures are the unexplained violating edges (and invalid lines), in a "Bindings"
  section of the checks popover. An explained violation fails nothing (v0.3.0): when every violation is
  explained the check is not failing (a neutral `◦`, class `expl`) and the pill reads "◦ K explained"
  in a neutral style (class `expl`) instead of "✕ 1 failing"; beside a failing check it adds a muted
  "· K explained". `make selfcheck` and `sbtel export`'s stderr treat all-explained the same way. Below it, every violation is listed with its rule, its location and its
  `# VIOLATION:` explanation, or "Not explained in the bindings file". The page parses the edge
  syntax with core.js `parseBindings`, the CLI's own parser (§2.5).
- A tab that finds its session gone (404 on `meta`, or SSE `closed`) shows "This session was closed.
  The page is read-only." and stops retrying. The source editor becomes read-only and edits are
  refused with a toast.

### 6.4 Diff mode (viewer/src/diff.js, workstream C)

`boot()` fetches `diff.json`, parses both sides with `parse`, computes `diffSpecs` and renders. The
page shows one picture, side b's layout with ghosts (§11, entry 23):

- **After** (the default) lays out a *merged* spec: side b's source with a minimal ghost form
  spliced in at the old place of each removed element and of each moved one. The old place is the
  mapped old holder; the b level that holds the element's old level-mates; beside its nearest old
  neighbour. When none of its old level-mates are there, it gets a new level between the right
  neighbours. Ghosts therefore get room of their own in the ordinary layout. Ghost names start with
  `~` (removed) or `~>` (moved away) and never clash with side b. Only the outermost removed element
  gets a ghost, which reads "Removed, with N inside".
- **Marks.** Added elements are green. Removed ones are dashed red ghosts. Moved ones are blue, with a
  faint ghost at the old place and a dashed arrow to the new one. Changed and renamed ones get an
  amber dot whose title lists the fields. Collapsed blocks with changes inside show an amber count.
  The field marks are:
  - the old name struck after the new one;
  - the old type pill struck;
  - the sketch as an inline word diff;
  - behavior badges added (ringed) or removed (struck);
  - port dots and drawer rows added (green ring) or removed (hollow dot, struck row);
  - affected ports (§7.4), ringed amber.

  Cards measure the old name and the merged sketch, so the marks fit.
- **Before** lays out side a with its ids renamed to the merged ids, so `paint`'s transitions move
  every shared block between its two places. Elements that exist in only one view fade in or out.
  The B and A keys switch views.
- **Change list**: a right sheet, open by default on wide screens, grouped as added, removed, moved,
  changed and affected ports. Clicking an entry opens the blocks that hold it, pans to it (zooming
  to a readable size) and selects it. Selecting on the canvas highlights the entry. On a phone the
  sheet is closed at first and closes after a pick.
- **v0.2 marks.** A renamed level's label shows the new name and the old one struck; a changed level,
  port or group sketch is amber (label, drawer row and ear dot, line), and its callout shows the word
  diff. Carried types added are ringed, removed ones hollow, on the card's carries ear. The change list
  names level, port-sketch and carries changes, and lists the file's own level changes as "the file".
- **Initial view**: top-level blocks, plus the blocks that hold a change, opened shallowest first
  while about 160 cards are visible. The canvas width is chosen from a few candidates to give the
  largest fit zoom, and it is kept for both views. A diff with no changes shows a "No changes" card.
  A side that does not parse shows an error card.

The diff view is read-only: no edits, drags, links, menus that edit, or save. In a diff session the
chat offers Send and Add to review, and the Review panel holds comments and a message, never
edits (§6.7). A comparison page (`?compare=`, §6.1) has no session: no comments, no review. SSE `version` (from
`open-diff --session`) shows a toast with Reload, and Reload refetches `diff.json`, keeping the
camera and what the reader opened. Comments post to `comment` as in server mode. Their `target` keys
refer to side b, their `source` is side b's text, and `version` is `diff.json`'s `version`. Ghosts
take no comments. Comments behave exactly as in server mode, through the same session.js: a sent
comment keeps its bubble and thread (after a reload too, rebuilt from `log`), sent comments lose their
Delete button, and SSE `reply` puts the agent's answer in the comment's thread as well as in a toast.

**Without the server**: `SBTEL.modes.diff.open(data)` shows any pair, where `data` has the shape of
`diff.json`. In a standalone page, the query `?diff` switches to diff mode with a built-in pair: the
playground sample against the same edits as `conformance/diff/shell-b.sbtel`. `?diff=none` gives a
pair with no changes. This dev hook is the one thing diff.js does in a standalone page, and only when
the query is present. The browser test is `node conformance/diff/viewer.test.mjs [--shots dir]`. It
uses Playwright, which is not a repo dependency.

### 6.5 Rules for viewer modules

- session.js, bindings.js (v0.2.5), review.js, server.js, diff.js and play.js are inlined by
  `viewer/build.mjs` into the page's single script, in that order, after the app code and before Boot.
  bindings.js defines `bindingsView(get)`, which server.js and play.js call (it reassigns `renderChecks`,
  `showChecks` and `behaviorUsers`). review.js defines `sessionReview(o)`
  (the draft review, §6.7), `openCompare(data)`, and the change list both modes draw
  (`changeItems`, `changeListHTML`, `changeSummaryHTML`, `changeLines`, `runsHTML`, `changesStyle`,
  region `Viewer.Changes`). session.js defines `sessionComments({ version,
  closed })`, which both modes call; its `hook()` reassigns `saveComments`, `openSend`,
  `commentCounts` and the chat's row hooks (`chatStatus`, `chatRowBtns`, `chatReplies`; `openChat` to
  mark replies read), and `rebuild(events)` and `onReply(d)` take the log and SSE. They share its scope: `state`, `$`, `SBTEL`, the core functions and the app's functions.
- A module MUST do nothing at load when `SBTEL.mode` is not its mode, apart from registering
  `SBTEL.modes.<mode>`.
- To change app behaviour, a module reassigns top-level **function declarations**, for example
  `const orig = openSend; openSend = list => …`. These are reassignable: `setSource(src, {flash,
  fromEditor, fromEdit})`, `render`, `fit(animate)`, `toast(msg)`, `openSend(list)`, `payload(list)`,
  `saveComments`, `renderSendBtn`, `select`, `edit`, `undo`, `redo`, `persist`, `targetLabel(key)`
  and `targetSource(key)`. Server mode also reassigns `behaviorUsers` (v0.2.2: the blocks whose loaded bindings bind a behavior; §6.8), `openThread`, `commentCounts`, `renderChecks`
  and `showChecks` (any top-level function declaration works the same way; `openThread` and
  `commentCounts` through session.js, in both modes; review.js, in both modes, reassigns
  `openComposer`, the chat's `chatKeep`, `chatAdd`, `chatStatus` and `chatRowBtns`, `saveComments`, `renderSendBtn`, `paint` and `fillBlock`, the last two
  for the pending badges). Diff mode also
  reassigns `pressStart`, `startLink`, `openEdit`, `askDelete`, `askDeleteMany`, `cutSelected`,
  `menuItems`, `renderStrip`, `openCode`, `renderMsgTable`, `openMessages`, `openComposer` and
  `centerOn`, and (v0.2) `readOnly` (true: callouts only pin, no editors, no "Name this level", no
  "Move to …") and `calloutSketch(kind, ref, text)` (a changed sketch shows its word diff). `const` bindings cannot be reassigned, so `version`, `store`, `SAMPLE` and `M` are
  read-only, but their objects' properties are not: diff mode wraps `M.tw` and `M.wrap`. If you need a hook that no function gives you, add the smallest possible hook to viewer/src/index.html inside
  the `Viewer.Mode` region and note it here. That and comment-only edits (the `@sbtel` annotations
  of §8) are the only allowed edits to index.html. Keep `make accept` green.
- CSS for a mode goes in a `<style>` element that the module inserts in `boot()` (session.js inserts
  its own from `hook()`, which each mode's `boot()` calls).
- Nothing may contain `</script` (build.mjs refuses it). Modules use no external libraries and no
  network requests other than to their own session routes. The page as a whole requests nothing from
  any other host: its fonts are inlined as data: URLs from viewer/fonts, build.mjs refuses a remote
  `<link>`, `<script>` or CSS `url()`, and the e2e test fails on any request to a host other than
  127.0.0.1, in server and diff mode, or on any network request from the standalone page.
- After any change, run `make viewer`. viewer/dist/index.html is committed and embedded in the
  binary, and `make check-viewer` fails when it is stale.

### 6.6 Sketch callouts, level labels and carried types (v0.2)

These are app features (index.html), in every mode; §11 entries 50-56 record the choices.

- **Callouts.** One at a time, fixed to the screen beside what it describes (it never moves the
  layout), with an arrow at it, and re-placed when the camera moves. Modes: `hover` (mouse, instant,
  gone on leave), `pin` (a tap on a touch screen, or a click where `readOnly()`; gone on a tap
  elsewhere) and `edit` (an editor in place). An editor saves on Enter (⌘/Ctrl-Enter in a textarea)
  or a press outside it, as one `edit()` (one undo step); Esc cancels. A press outside with an invalid
  editor discards it with a toast.
- **Ports.** Hovering a drawer row shows the port's sketch (none, no callout) and outlines the blocks
  it can talk to (`state.talk`, which used to take a click). Clicking a row edits the port: name, in or
  out, type (in-scope types as suggestions; a name clash or an out-of-scope type shows as you type),
  sketch, and Delete. Inherited ports (from a behavior) and a child's ports on its container's drawer
  open read-only, with "Edit in behavior X" or "Edit in block X". Hovering a dot on a closed ear shows
  the port's name, type and sketch. On touch, a tap pins the callout with the outline and an Edit
  button. The type arrow on a row still goes to the type's card. The Edit dialog's port rows have a
  sketch field.
- **Level labels.** A separator carries the name of the level below it (the persistent `.lsep`
  element; it slides and fades with the line): line, name and + are flex items on one axis, the name
  right of the line unless Settings puts it left. Only a click on the name edits; the line is not a
  target (hovering it shows an unnamed level's "Name this level", which is). A named
  first level gets a header separator (`'|0'`, and K.NAMEGAP more room); an unnamed one keeps its
  hover gutter. A long name truncates and the first click shows it whole; hover shows the level's
  sketch; a click edits name and sketch. An unnamed level shows "Name this level" on hover.
- **Adjacency lines.** Hover shows the group's sketch. A click selects the line, as before, and opens
  the group's sketch editor without focus, so Delete still cuts the line.
- **Sketch forms.** Edits keep a sketch's form: `(sketch "…")` stays a string (whitespace collapsed),
  `(~ … ~)` stays a tilde sketch with enough tildes, and a new sketch is `(~ … ~)` (core.js
  `sketchForm`, `sketchReps`). Card sketches render paragraph breaks (`white-space: pre-line`, and
  `M.wrap` counts them).
- **Carried types.** A message card has a bottom ear with one dot per carried type (inherited ones
  dimmed). Hovering a dot shows that type's name and sketch; clicking it goes to that type's card (a tap
  pins the callout with a Go button). Hovering a type (its card, a chip, a dot) outlines every carrier
  of it, the blocks whose ports use it or a carrier, and lights their drawer rows, in the port
  outline's style. On touch, selecting a type card does the same. A drawer row's hover stays the port
  outline. The Edit dialog of a shape has a Carries field.
- **Placement notes.** The checks pill shows `· N notes` in muted text and never turns red for them;
  the popover lists them under "Placement notes", each with "Move to X", the same move edit a drag
  makes.

### 6.7 Reviews, drafts and the persistent undo history (v0.2.1)

viewer/src/review.js (`Viewer.Review`) holds the draft review of server and diff mode; App.History
(index.html) holds the undo history on disk, in every mode that edits. §11 entries 61-74 record the
choices.

**The draft review.** Edits and comments accumulate in the tab, as a GitHub review, and go to the
agent together.

- *Pending comments* (`status: 'pending'` in `state.comments`) come from Add to review. Their bubble
  on the canvas is outlined, with a "pending" (or "N pending") badge; their thread says Pending and
  offers Edit (in the panel), Send now and Delete.
- *Edits* are the difference between the tab's text and the draft's base: the version the tab is
  based on, or, after a review with edits, that review's proposal.
- *The Review panel* (a right sheet, `#rvSheet`) lists the edits as the diff view's change list
  (`diffSpecs`, then `changeItems` and `changeListHTML`, shared with diff.js) with **Open the full
  diff**, the pending comments (each an editable text with Send now and Delete), an optional overall
  message, **Send review**, and the reviews sent in the session with the agent's replies to them.
- *Send review* posts `review` (§5.2) with the message, the pending comments (target, label, text,
  and the source as the tab shows it) and, when there are edits, the whole text as `proposal` with the
  version it is based on. It never writes the spec file. After it, the draft is clear: the comments are
  sent (ids `c<seq>.<k>`), the message is empty, and the edits stay in the tab marked "proposed,
  awaiting agent" until a new version arrives (the version toast, then Reload, replaces them) or the
  human saves.
- *Editing after a review* starts a new draft on top of the proposal. The title says "proposed in rK,
  then edited", the panel says the edits are on top of rK's proposal, and sending them sends the whole
  text again, `supersedes: "rK"` (inbox: "it replaces the proposed spec of rK"), with its diff against
  the server version, so the agent never has to stack two proposals.
- *A diff session's* review holds comments and a message only; it has no Save.
- *Comparisons.* Open the full diff and View their changes (§6.3) call `openCompare(data)`: the pair
  (the shape of diff.json) goes into `SBTEL.compares[key]` and `window.sbtelCompares`, and a new tab
  opens the page at `?compare=<key>`, which reads it from its opener and shows it in diff mode. A
  comparison whose opener has gone says so.

**Drafts on disk.** The draft is kept in localStorage under `sbtel-draft:<session id>`:
`{v: 1, version, base, src|null, proposal: {id, src|null}|null, message, comments: [{id, target,
text, version, at}], at}` (diff mode: no version, base, src or proposal). `src` is null when the text
is the base's; a proposal's `src` is null when it is the text. It is written 300 ms after a change and
on `pagehide`; an empty draft removes the key. On load the comments and message come back; server
mode restores the text when the draft's base is the current version, and when the draft has edits
against an older version, it fetches that version (`versions/<n>`) and stays based on it, so the
version toast offers the new one and Save asks before overwriting it. Leaving the page with a
non-empty draft (pending comments, a message, or edits neither saved nor sent) asks first
(`beforeunload`).

**The undo history on disk.** The undo and redo stacks persist in localStorage, under
`sbtel-hist:<session id>` in server mode and `sbtel-hist` in the standalone playground; diff mode
keeps none. The record is `{v: 1, head, undo: [patch], redo: [patch]}`: `head` is the current text,
and each step is a patch `[at, deleted, inserted]` (one splice, from the common prefix and suffix) from
its neighbour, the top of each stack from `head`. It is written 300 ms after a change of either stack,
and on `pagehide` and when the page is hidden; patches already computed are reused. The record is
kept under 2^20 UTF-16 code units (about 2 MB, as browsers count storage), dropping the oldest undo
steps first, then the farthest redo steps; a head over the cap is not stored. On load
(`histUse(key)`), the kept stacks come back; when the current text is not the kept head (the file
changed while the browser was closed, or the standalone page opened with the sample), the current text
becomes a new step, so undo still reaches the earlier edits. A version from the agent, a disk change and
"Discard my edits and reload" are ordinary steps. Undoing past them only changes the tab: nothing is
written until Save or a review.

**Storage failures.** Every localStorage access goes through `store` (App.Kit) in a try/catch. A write
that fails (quota, private mode, blocked storage) stops that record from being written for the rest
of the page's life and logs one console warning for the page; editing, undo, comments and reviews go
on.

**Cleanup.** `sbtel close` reaches the tab as SSE `closed`, and the tab removes the session's draft and
history. A tab that loads a session that no longer exists (404) removes them too. After loading, a
session page asks the server about every other session it holds keys for (`GET /s/<id>/meta`, at most
64) and removes the keys of those that answer 404; an unreachable server prunes nothing.

### 6.8 Behaviors: pills, implementers and users (v0.2.2)

App features (index.html), in every mode; §11 entries 89-91 record the choices.

- **Pills.** A behavior card and a shape card show their `:type` as a pill, as a block card
  does (the same `topHTML` and layout row). A behavior that implements others shows their badges.
- **Implementers and users.** Hovering a behavior, its card or a badge that names it, outlines its
  implementers (`implementersOf`, and the behaviors that extend it) with a solid line in the behavior's
  glyph colour and a small label, "implements"; the behavior's own card gets a dotted outline. With
  bindings loaded (server mode, `open --bindings`), the blocks whose edges bind the behavior
  (`bindingTarget` resolves the callee to it) get a dashed outline in the same colour, labelled
  "uses"; a block that does both says "implements · uses". Without bindings, `behaviorUsers` returns
  nothing and only implementers are shown. On touch, selecting a behavior card does the same. The
  outline gives way to a port's partners or a type's carriers while those are shown. The behavior info
  card counts both ("implemented by N · used by M") and lists what the behavior extends.
- **Edit.** The Edit dialog has a Type field for blocks, behaviors and shapes, and a behavior's
  dialog lists the behaviors it may extend (in scope where it is declared), with the inherited ports;
  a choice that would make a cycle is refused with "B already implements A: A cannot implement it too."

### 6.9 The standalone page's URL, embed mode and the home link (v0.2.3; size and focus v0.2.4; read-only and exported files v0.2.5)

viewer/src/play.js, block `Viewer.Play`, registers `SBTEL.modes.standalone`; §11 entries 97-103 record
the choices. The page itself is a full document: `<!doctype html>`, `<html lang="en">`, `<meta
charset="utf-8">` and `<meta name="viewport" content="width=device-width, initial-scale=1">`, after
the `@sbtel file App.Page` comment (a comment before the doctype keeps standards mode).

| URL part | Meaning |
|---|---|
| `#src=<base64url>` | the spec: base64url (RFC 4648 §5, padding optional; the standard alphabet is accepted too) of its UTF-8 text, instead of the sample |
| `#example=<name>` | fetch `examples/<name>.sbtel` relative to the page (`[\w-]+`, with `/` between folders), so long specs stay out of URLs; `#src` wins over it |
| `?embed` | embed mode, interactive |
| `?embed=readonly` | embed mode, nothing edits |
| `&theme=light`, `&theme=dark` (or `?theme=`) | a fixed theme; otherwise the system's (embed mode ignores a stored setting) |
| `&focus=<Block>` (v0.2.4) | embed mode fits that block (an id such as `Notes.Store`, or a name) instead of the whole file; its ancestors start open. An unknown name fits the file |
| `?embed=off` (v0.2.5) | no embed mode, even in an exported file that bakes `--embed` in (its Open full view link) |

The query and the hash combine: `play/?embed=readonly&theme=dark#example=shell`. A change of the hash
reloads the page. `?diff` (§6.4) still wins: diff.js switches the mode before Boot.

**Storage.** A spec from the URL, and any embed (the sample too), keeps its settings, comments and undo
history under keys with a 64-bit hash of its initial text (`SBTEL.modes.standalone.digest`):
`sbtel-hist:spec-<hash>` and `sbtel-play:spec-<hash>`, `sbtel-comments:spec-<hash>` for a page
with `#src` or `#example`, `…:embed-<hash>` in embed mode, so no two demos, a demo and the same spec in
the playground, or a demo and the playground share anything. The keys start from the defaults, not
from the playground's settings (`loadPrefs`, App.Document). A read-only embed keeps no history. The
playground without a hash keeps its keys (`sbtel-hist`, `sbtel-play`, `sbtel-comments`). After an
error the key is the hash of the URL part. `sbtel-help-seen` stays global.

**Errors.** Text that is not base64url UTF-8, an example that does not load or a spec that does not
parse shows the usual parse-error UI: the source sheet opens with the text and the message in red, over
an empty diagram (the empty spec is set first, so the app always has a model); fixing the text draws it.
In embed mode, which has no source sheet, a card says "This spec cannot be drawn" with the message.

**Embed mode** is for docs pages that show the real viewer in an iframe, one demo per concept.

- No brand chip, help, sheets, Messages, Source, checks, Send or settings. The dock keeps undo, redo,
  zoom out, the zoom level, zoom in, Fit and **Open in playground ↗**, a link in a new tab to this page
  without the query: the same hash, or `#src=` with the edited text once the demo was edited. Below
  480 px the link shows only ↗.
- Comments, the message table and the source sheet are the playground's: their menu items and strip
  buttons are left out, and anything else that would open them says so in a toast.
- The diagram fits the frame on load, on resize and on Fit, and the layout width follows the frame
  (1.25 × its width, from 560 to 1180), so a small frame wraps rows. Since v0.2.4 the fit is tight: it
  fits `contentBox(lay, focus, plus)` (Core.Layout), what is drawn: every card with the ears it draws
  (a level item's box keeps room for both ears; only a block with ports, its own or its children's,
  draws one), level lines with their names, the file's appendix band and, where the frame edits, the +
  buttons; not the hover-only gutters, and not the layout's canvas width. Around it: 12 px, and 52 px
  below for the dock. The zoom is at most 1 (the full app's 1.1 and its extra 40 px are gone), and a box
  smaller than the frame is centred.
- **Natural size** (v0.2.4). In a frame, the viewer posts `{ type: 'sbtel:size', width, height }` to
  `window.parent`: the fitted box's size in CSS pixels at zoom 1, including the 12 px padding and the
  dock's 52 px (so `width` = box width + 24, `height` = box height + 64). It posts after the first
  layout and after any relayout (an edit, an open or close, a resize that changes the layout width)
  that changes those numbers; a drag preview posts nothing. The target origin is fixed at `'/'`, the
  frame's own origin: a docs page served with the viewer (the website's `/sbtel/docs/` and
  `/sbtel/play/`) hears it, a page on another origin gets nothing and keeps its own frame height, so no
  page learns about a diagram it did not serve. A page that is not framed posts nothing. A host should
  match messages to frames by `event.source`, keep the frame's width, set its height from the ratio,
  and ignore changes of a few pixels; changing only the height never changes the layout, so the two
  cannot chase each other.
- Without `&theme` the background is transparent (the dot grid stays), so the frame sits on the
  page's card; with a fixed theme it is the theme's canvas colour, so it reads on any card. The theme
  follows `prefers-color-scheme` as the frame sees it.
- Interactive by default: hover callouts, selection, drag, link, the Edit dialog, click-to-edit ports,
  undo. `?embed=readonly` reassigns what edits, as diff mode does (§6.5): `readOnly()` is true, and
  `edit`, `undo`, `redo`, `pressStart`, `startLink`, `openEdit` and the deletes do nothing; the menu
  has Open or Close and Code, the strip only Code, and callouts are read-only.
- **Not in the reader's way.** Nothing takes focus on load and there is no `beforeunload`. Until the
  frame is clicked, tapped or focused it is not live: a capturing wheel listener on the frame's window
  stops the canvas's handler, so the browser scrolls the outer page, and on touch the canvas allows
  `pan-x pan-y`, so a swipe scrolls the page. A small "Click to interact" pill shows on the first
  hover, and again when a wheel is ignored. The frame stops being live when its window loses focus. A
  press focuses the frame's window (v0.2.4): a press on a card prevents mousedown's default, which also
  kept the frame from taking focus, so it never blurred and stayed live. A
  page opened directly (not in a frame) is live from the start.

**Read-only** (v0.2.5, also in the full viewer). `?embed=readonly`, and a file exported with
`--readonly` in either layout, reassign what edits (§6.5), as diff mode does: `readOnly()` is true;
`edit`, `undo`, `redo`, `pressStart`, `startLink`, `openEdit`, the deletes and `cutSelected` do nothing;
the menu and the strip keep the items that only look (Open or Close, Code, the message table) and,
where the layout has them, Comment (a comment is the reader's note, not an edit); the source textarea
is read-only; undo, redo, the + buttons, gutters and handles are hidden (`body.pl-ro`); callouts only
pin. No undo history is kept.

**Exported files** (v0.2.5, `sbtel export`, §3.14). play.js reads the baked blocks first: when
`#sbtel-export` and `#sbtel-spec` are in the page, the spec is the baked one, unless the hash has `#src`
or `#example`, which win as they do over the sample (so a link can carry an edited text); the layout is
the baked one (`embed`, `readonly`) unless the query has `?embed…`; a baked read-only stays read-only
whatever the query says (it is a presentation, not protection: anyone can edit the file). Storage is
that of a spec from the URL: `…:spec-<hash>` or `…:embed-<hash>` of the baked text, so each exported
spec keeps its own undo history, settings and comments, apart from other exports, from the playground
and from the same spec's embed; two files of one spec in one browser share them, being one spec (file://
pages share one origin in Chrome). Beyond that:

- The chip and the tab say the baked title (`<title> · N blocks · read-only`); Load sample and Random
  spec are gone from the source sheet, since the file is about its spec.
- Baked bindings go to `bindingsView` (viewer/src/bindings.js), so the pill counts and lists their
  violations with their notes and a behavior's "uses" outline works, exactly as in server mode.
- The home link ("sbtel" in the chip) stays, at the project's home page, and always opens a new tab
  (`rel="noopener noreferrer"`): a reader of a shared file most likely needs to learn what sbtel is, and
  should keep the diagram open. It is a link the reader follows, not a request the page makes.
- In embed layout, **Open in playground ↗** becomes **Open full view ↗**: the same file at `?embed=off`
  (with `#src=` of the text once it was edited, as before). There is no playground beside a shared file,
  and sending the spec to the public playground would take it somewhere the author did not choose.
- Nothing else changes: no server calls, no session, comments are the standalone page's (Send copies a
  text to paste to an agent).

accept9 checks the parameters, the errors, embed mode, read-only and the home link over HTTP; accept10
loads a docs page with three embedded viewers and checks that their histories stay apart, that the
page scrolls over an idle frame and a clicked one takes the wheel, and that nothing logs an error. accept11
(v0.2.4) checks the tight fit, `sbtel:size` (numbers, once per layout, zoom 1 at the natural height,
after an edit, not while dragging, silent across origins and unframed), `&focus`, and the release
after a click on a card. accept12 (v0.2.5) exports with the binary and opens the files from disk: the
spec renders and round-trips exactly, no network request, read-only, bindings, and an edit kept per
spec across a reload.

---

## 7. The diff contract

`diffSpecs(m0, m1)` lives in core/core.js (region `SpecDiff`). It takes two models from `parse`
(each carries `.src`) and returns a plain JSON-able object, with no Maps or back pointers. It MUST be
deterministic, and conformance pins it (`conformance/cases/diff.json`).

### 7.1 Shape

```
DiffResult = {
  changes:  Change[],             // one per element that differs; unchanged elements are absent
  affected: Affected[],
  summary:  { added, removed, moved, renamed, changed, affected }   // counts; a Change counts once per tag
}
Change = {
  element: "block" | "behavior" | "shape" | "file",   // "file": the file's own levels changed (§7.3)
  tags:    ("added" | "removed" | "moved" | "renamed" | "changed")[],  // added/removed alone; others combine, in this order
  a: Ref | null,                  // null when added
  b: Ref | null,                  // null when removed
  moved:   { from: Place, to: Place } | null,
  renamed: { from: string, to: string, similarity: number } | null,     // names; similarity rounded to 2 decimals
  fields:  Fields | null          // only keys that changed are present; a name change is `renamed`, never a field
}
Ref   = { id, name, in: string|null, lines: { start, end } }   // in its own side's model; `in` as in §2.4
Place = { in: string|null, level: int|null }                   // level: number from the bottom, 1-based (7.3); null for behaviors/messages
Fields = {
  type?:      { from: string|null, to: string|null },          // all three kinds (behaviors and messages since v0.2.2)
  sketch?:    { from: string, to: string, words: { op: "=" | "+" | "-", text: string }[] },
  implements?:{ added: string[], removed: string[] },          // blocks and behaviors: names, compared after rename mapping
  ports?:     { added: Port[], removed: Port[], changed: { name, from: Port, to: Port, sketch?: Words }[] },
              // own ports (blocks), ports (behaviors); identity = the port's effective name (its :as
              // name or the default one, v0.3), so adding or dropping an :as that names the default
              // is no change, and a new :as name is a removed and an added port; a port whose sketch alone
              // changed is `changed`, with `sketch`, and stays stable for §7.4
  drawer?:    { in: { added: string[], removed: string[] }, out: { added: string[], removed: string[] } },
              // the rows of the block's ear drawers: portLabel of dotsOf(block, true), compared as label strings
  adjacency?: { added: string[], removed: string[] },          // blocks: ids (side b) of blocks now in / no longer in its adjacent group
  levels?:    { level: int, name?: { from: string|null, to: string|null }, sketch?: Words,
                groups?: { blocks: string[], sketch: Words }[] }[],
              // blocks (and the file): its levels' names and sketches, and its adjacent groups' sketches
  params?:    { from: string[], to: string[] },                // behaviors
  refines?:   { from: string|null, to: string|null },          // messages
  carries?:   { added: string[], removed: string[] }           // messages; removed uses side a's names
}
Words = { from: string, to: string, words: { op: "=" | "+" | "-", text: string }[] }
Affected = {
  owner: string,                  // id of the block or behavior holding the port, in side b
  port:  string, dir: "in"|"out", kind: string,
  lost:   { owner, port }[],      // partners in a that are no longer compatible in b
  gained: { owner, port }[]       // partners compatible in b that were not in a
}
```

### 7.2 Matching

1. Elements match by kind and id (blocks by block id, behaviors and messages by name).
2. **Renames.** Unmatched elements of the same kind on both sides are paired by structural
   similarity, a score in [0, 1]. A pair counts as renamed only if its score is at least **0.5**. The
   pairing is one-to-one, greedy by highest score, with ties broken by source order of side b and then
   side a.

   An id match whose own score is below 0.5 (a *weak* match) also enters this pairing, with its
   partner as an extra candidate at whatever score it has. It keeps that partner unless a pair it is
   in scores higher. That is how two blocks that swap names come out as two renames rather than as
   two blocks that changed everything (§11, entry 24). Kinds are paired in the order shapes,
   behaviors, blocks, so blocks see the message and behavior matches. The whole of step 2 runs twice:
   the second pass sees the first pass's renames, such as a renamed holder or renamed children.

   The score is the Jaccard index of the feature sets. Names in side a's features are mapped to side
   b's names through the matches known so far. An unmatched element on side a is `?<id>` and one on
   side b is `+<id>`, so the two never meet. The features are:
   - **blocks**: `h:` holder; `L:` level index in the holder; `t:` type; `p:dir:kind` and
     `pn:name` for each own port; `i:` each implemented behavior; `c:` each child block; `db:` and
     `dm:` each declared behavior and shape;
   - **behaviors**: `h:` declaring block; `p:dir:kind` for each port (a type parameter becomes `$i`)
     and `pn:name`; `n:` the number of parameters; `t:` type; `i:` each behavior it implements; `u:`
     each block that implements it (`implementersOf`, so through extension too);
   - **shapes**: `h:` declaring block; `t:` type; `r:` refines; `k:` each carried type; `u:owner.port`
     for each port that uses it.
   - **all three**: `w:` each sketch word, with ASCII letters lowercased and ASCII punctuation
     trimmed from both ends. This is ASCII only, so every engine agrees. The word diff (§7.3) still
     compares words exactly.
3. Whatever stays unmatched is `added` (side b) or `removed` (side a).

All later comparisons map names through these matches. A block that implements a renamed behavior does
not count as changing its `implements`.

### 7.3 Tags

- **moved**:
  - for a block, its holder (mapped) differs, or its level index differs. The level index is the
    number of levels above it in its holder that contain at least one matched block, so inserting a
    new level of only added blocks moves nothing;
  - for a behavior or message, its declaring block (mapped) differs.
  - `Place.level` is the block's level number in that side's holder, counted from the bottom and
    1-based, as everywhere (level 1 is the lowest); the comparison above still decides whether it
    moved, so a number can differ without a move. Order within a level is not a move, and neither is a
    change of adjacent group within the same level (that one is `fields.adjacency`): reordering
    blocks inside a level gives an empty diff (§11, entry 25).
- **renamed**: matched in step 2, and the names differ.
- **changed**: any key in `fields`.
- **Fields details**:
  - `ports` identity is the port name; a repeated name is `name#2`;
  - `drawer` labels on side a are computed with shapes renamed, so a renamed type adds no
    drawer noise;
  - `adjacency` counts only matched partners, because an added or removed partner is already its own
    change;
  - `implements.removed` and `carries.removed` use side a's names;
  - `levels` pairs a holder's levels by the matched blocks they share (most first, then side b's order,
    then side a's), and within a pair of levels, the adjacent groups of two or more blocks the same way.
    `level` is side b's level number, from the bottom and 1-based. A level or group that pairs with none is not reported (its
    blocks are added or removed). Level names and sketches never enter the matching features. The
    file's own levels are reported as a change with `element: "file"` (refs with id `""`), first in
    `changes`.
- **Sketch word diff**: split both sketches on whitespace, then take the LCS of the word lists. Merge
  consecutive words with the same op into one run, joined by single spaces. Output `=` runs as well,
  so the runs concatenate back to either side. A paragraph break of a `(~ … ~)` sketch (`\n\n`) is a
  word of its own, joined to its neighbours without a space.
- **Order of `changes`**:
  1. elements present in b, by the source offset of their form in b;
  2. removed elements, by offset in a.

### 7.4 Affected ports

Compatibility is `accepts(model, inKind, outKind)` (core), taken over every pair of an out port and an
in port. The ports are blocks' own ports and behaviors' ports, across the whole spec. A port is
**affected** when all of the following hold:

- it is matched;
- it is not in `fields.ports` (added, removed or kind-changed);
- its set of compatible partners differs between a and b, after mapping. In practice this comes from
  `refines` changes, or from a renamed, removed or added shape (`carries` changes nothing here).

Partners are only *stable* ports, which are ports that meet the first two conditions. An added,
removed or retyped port is already a change of its own, and makes nobody else affected (§11, entry
26). Only in and out ports count. A behavior's type parameter is compared as written.

Order by owner offset in b, then by port name. `lost` and `gained` are sorted by owner id, then by port.

### 7.5 `sbtel diff` text (implemented by A in api.js from this shape)

Each change is one line, in `changes` order:

```
+ block Shell.Banner2 (in Shell.Notification)
- shape Notice (was in Shell)
~ block Shell.Turn: renamed from Shell.Item (0.83); moved from Shell.Transcript level 2 to Shell.SessionView level 1; type "A" -> "B"; sketch [-old words-] {+new words+}; implements +Durable; ports +in x: Foo -out y: Bar ~in z: Z -> out z: Z; drawer in +x: Foo out -y: Bar; adjacency +Shell.TurnActions
~ behavior Box: params (T) -> (T K)
~ shape Ack: moved from Shell to the file; refines Msg -> none; carries +P -Q
~ the file: level 1 name none -> "Programs"; level 2 sketch [-old-] {+new+}; level 2 adjacent (A B) sketch {+why+}
~ block Shell.Router: ports ~in intent: Intent sketch {+Every intent.+}
! port Shell.Router.intent (in Intent): lost Shell.Composer.submit; gained Shell.X.y
```
After the change lines comes a summary line:
`N changes (a added, r removed, m moved, n renamed, c changed), k affected ports` (singular for 1), or
`no changes`. Field parts appear in the order of the Fields keys above. The sketch shows only the changed runs, with
`[-…-]` for removed words and `{+…+}` for added words. Blocks are named by id, behaviors and messages
by name; a null holder is `the file`; levels print 1-based; similarity prints with 2 decimals; `type`
prints quoted, and null is `none`; a port prints `<dir> <name>: <kind>`; a port whose kind and
direction did not change prints only `~<dir> <name>: <kind>` before its sketch diff; a level prints as
`level N` (1-based) and its name quoted; a paragraph break in a word diff prints as `¶`.

---

## 8. Annotation convention

Annotations tie code to spec elements. A tool or an agent can then extract the bindings between
blocks, for `sbtel check` and for keeping the spec honest. An annotation is the token `@sbtel` inside
any line comment, in any language: `//`, `#`, `--`, `;`, `%`, `'`, `<!-- … -->`, `/* … */` on one line.
It is recognised wherever `@sbtel` follows the start of the line, whitespace, or comment punctuation,
and everything after it on the line is the annotation. An `@sbtel` inside a string literal is not an
annotation, and the lines of a multi-line string literal (a backtick string, a triple-quoted string)
belong to the declaration that holds them, whatever their indentation.

| Form | Meaning |
|---|---|
| `@sbtel Name` | the next declaration belongs to Name: a block, or (v0.2.2) a behavior, for the interface, trait, protocol or typedef it stands for. One per declaration: a second one before the same declaration is an error |
| `@sbtel begin Name` | a region starts; regions nest, and the innermost one wins |
| `@sbtel end Name` | the region ends; the name MUST match its `begin` |
| `@sbtel file Name` | from here to the end of the file |
| `@sbtel message Name` | anchor: where a shape's shape is defined. It owns no code |
| `@sbtel port Block.port` | anchor: where a block's port is handled (the block id, a dot, the port's effective name: its `:as` name, or the default one from its type, LANGUAGE.md §3.5). It owns no code |

- There is no other form (an earlier draft had a long s-expression form; it is gone). Names use the
  spec's name syntax: no whitespace, no `( ) " ;`, and not starting with `:`.
- **Behaviors** (v0.2.2). A Name is a block first, then a behavior (`beh:Name` names the behavior when
  a block has the same name), as a binding's callee is (§2.5). A behavior owns the declaration of its
  abstraction in code. Any form may name one: what is a type-like declaration differs too much across
  languages to check reliably, so this is documented, not enforced. Comment lines between `@sbtel Name`
  and its declaration (a doc comment, a JSDoc block whose `@param {T}` names a type) belong to the
  declaration.
- **Edges to and from behaviors.** A reference from block A's code to a declaration owned by behavior
  X is the edge `A -> X` (the abstraction rule decides it). A reference that states an implements
  relation (a heritage clause `implements X` / `extends X`, JSDoc `@implements`, Go's blank assertion
  `var _ X = …` or an interface embedded in an interface; Rust's `impl X for T` written by hand) is
  tagged `implements` by the reference helpers (a third column after the name) and is no binding:
  `sbtel_owners.py --edges` checks that the spec says the caller implements X, directly or through
  other behaviors, and reports an error when it does not. A behavior's own code binds nothing: its
  signature is its ports, whose types are shapes.
- **Anchors** change no ownership: the lines after one belong to whoever owned them anyway, and a
  pending `@sbtel Name` above an anchor still applies to the declaration below it.
- **Errors** an annotation checker reports:
  - an unknown name: a block, or an anchor's shape, or a port its block does not have (own
    ports, plus those of the behaviors it implements);
  - any other text after `@sbtel`;
  - an `end` without a `begin`, or with a different name;
  - a `begin` never ended;
  - code in no block;
  - code owned only by a container block (one with child levels);
  - a second `@sbtel Name` before the same declaration, or a second `@sbtel file` in one file.
- **Go**: put `// @sbtel file Name` before the `package` clause (after any `//go:build` line and its
  blank line), and leave a blank line between it and the package doc comment, so godoc does not pick
  it up. After `package`, the package line itself would be code in no block.
- Bindings extracted from annotated code are `Caller -> Callee  # file:line` edges (§2.5).
  Extraction is per language and lives outside the binary. The sbtel-recover skill
  (`plugin/skills/sbtel-recover/`) has the recipes and three optional helpers: `sbtel_owners.py`
  (Python 3.8+), the language-neutral annotation checker and edge maker, tested by
  `test_sbtel_owners.py`; `sbtel_sccs.py`, the strongly connected components and condensed levels
  of an edge list (tested there too); `sbtel_refs.mjs`, JS and TS references resolved by the
  TypeScript checker, for code with or without imports (tested by `tools/selfcheck/refs.test.mjs`);
  and `sbtel_refs_go/`, a standalone Go module (standard library only) that resolves a Go module's
  references with go/types for every GOOS and tag set, types and fields as well as calls (its own
  `main_test.go`; `make test-owners` runs both test suites).
- **Explained violations.** A violation that the code really has stays in the bindings file, with a
  `# VIOLATION: reason` comment line directly above its edge (§2.5, `note`). That is the one
  mechanism: `sbtel check` prints the reason and counts the explained violations, the viewer shows
  it, and `make selfcheck` accepts a violation only with one.
- **sbtel checks itself** (`make selfcheck`, in CI): `examples/viewer.sbtel` against the viewer's code
  (core.js and viewer/src, references from `sbtel_refs.mjs`) and `examples/sbtel.sbtel` against the
  Go code (assets.go, cmd/, internal/, references from `sbtel_refs_go`). For each: the annotations
  pass `sbtel_owners.py`, a fresh run of `tools/selfcheck/edges.mjs` equals the committed edges file,
  and `sbtel check` has no unexplained violation and no warning.
- **The viewer's own source** is annotated this way against its spec, `examples/viewer.sbtel`
  (recovered from the code with the sbtel-recover skill), and `examples/viewer.edges.txt` holds its
  bindings. `make selfcheck` (CI and release run it) fails unless:
  1. `bin/sbtel lint` passes on `examples/viewer.sbtel` and `examples/sbtel.sbtel`;
  2. `sbtel_owners.py` finds no annotation error in core/core.js and viewer/src/{index.html,
     session.js, review.js, server.js, diff.js};
  3. `tools/selfcheck/edges.mjs --check` regenerates the edges (sbtel_refs.mjs, plus `$('id')` lookups
     resolved to the markup, through `sbtel_owners.py --edges`, one line per caller, callee and file)
     and the result says what the committed file says: the same edges (caller, callee and file) and
     the same comment lines (the header and the `# VIOLATION:` notes, so what is explained). Line
     numbers and "(+N more)" counts are not compared (tools/selfcheck/stale.mjs, tested by
     stale.test.mjs): an ordinary edit moves them, and only a note, "locations drifted, run `make edges`
     to refresh them", is printed. `make edges` still writes them, for readers. Regeneration carries
     each `# VIOLATION:` comment to the same caller, callee and file, so `make edges` keeps the
     explanations;
  4. `tools/selfcheck/violations.mjs` runs `bin/sbtel check` and finds every violation explained, and
     no explanation on an edge that is allowed.

  Two edges cross a dependency-inversion seam through a behavior (v0.2.2, §11 entry 93): `Core.Layout ->
  MeasuresText` (core.js's JSDoc `@typedef`, the measurer layout takes as a parameter) and
  `Sbtel.Server.Core -> DiffsSpecs` (server.go's `DiffFunc`); the abstraction rule allows both.

  The extractor needs node, python3 and a TypeScript checker pinned in `tools/selfcheck/package.json`
  (installed by `npm ci` on first use). It is dev-only: the binary and the page never load it.
  Changing the code usually moves line numbers; that alone passes, and `make edges` refreshes them. A
  new edge fails until `make edges` is run and committed, and a new violation then needs an
  explanation (or a fix of the spec or the code).

---

## 9. Install and release

### 9.1 Artifacts (scripts/release.sh)

`scripts/release.sh` builds the following targets, with `CGO_ENABLED=0`, `-trimpath` and
`-ldflags='-s -w'`:

- `linux/amd64`, `linux/arm64`;
- `darwin/amd64`, `darwin/arm64`;
- `windows/amd64`, `windows/arm64`.

It writes `dist/sbtel_<os>_<arch>` (with `.exe` on Windows), a copy of `THIRD_PARTY_NOTICES` and
`dist/checksums.txt`. The checksums file is in `sha256sum` format: `<64 hex>  <file name>`, one line
per binary and one for THIRD_PARTY_NOTICES. The script first checks that viewer/dist and
THIRD_PARTY_NOTICES are not stale. The version comes from the embedded VERSION file, with no ldflags
stamping. A release uploads exactly these eight files to a GitHub release:
`.github/workflows/release.yml` does it on a `v*` tag that matches VERSION, and `ci.yml` runs the
tests on Linux, macOS and Windows. RELEASING.md has the steps. The repository is `shashi/sbtel`.

### 9.2 install.sh (POSIX sh, workstream D)

```
curl -fsSL https://…/install.sh | sh
```

- Base URL: `${SBTEL_BASE_URL:-https://github.com/shashi/sbtel/releases/latest/download}`.
- OS from `uname -s`: Linux → `linux`, Darwin → `darwin`, MINGW, MSYS or CYGWIN → `windows` (with
  `.exe`). Anything else is an error.
- Arch from `uname -m`: x86_64 or amd64 → `amd64`; aarch64 or arm64 → `arm64`. Anything else is an
  error.
- Downloads `sbtel_<os>_<arch>[.exe]` and `checksums.txt` into a `mktemp -d` directory, which is
  removed on exit (trap). It uses `curl -fsSL`, or else `wget -qO`.
- Verifies the file's line in checksums.txt with `sha256sum`, or else `shasum -a 256`. A missing line or
  a mismatch is fatal, and nothing is installed.
- Installs to `${SBTEL_INSTALL_DIR:-$HOME/.local/bin}/sbtel` (mkdir -p, chmod 755, atomic `mv`), then
  runs `sbtel version`.
- If the directory is not on `$PATH`, prints a hint: `export PATH="<dir>:$PATH"` for the user's
  shell rc.
- Only POSIX sh is allowed (no bashisms; check with `sh -n` and, if available, shellcheck `-s sh`).
  Every failure prints `sbtel install: <reason>` and exits non-zero.
- `SBTEL_VERSION=v0.2.0` selects `…/releases/download/v0.2.0` instead of latest, unless
  `SBTEL_BASE_URL` is set, which takes precedence.

### 9.3 install.ps1 (workstream D)

The same contract for PowerShell 5.1+ (`irm …/install.ps1 | iex`):

- Arch from `$env:PROCESSOR_ARCHITECTURE`: AMD64 → amd64, ARM64 → arm64.
- Downloads with `Invoke-WebRequest` and verifies with `Get-FileHash -Algorithm SHA256`.
- Installs to `${env:SBTEL_INSTALL_DIR}`, defaulting to `$env:LOCALAPPDATA\Programs\sbtel\sbtel.exe`.
- Adds the directory to the *user* PATH (`[Environment]::SetEnvironmentVariable(…, 'User')`) if it
  is missing, and says that a new terminal is needed.

### 9.4 Testing the installers

Test with `SBTEL_BASE_URL=file://…` (curl supports it) or a local `python3 -m http.server` serving
`dist/`.

---

## 10. Workstreams

The four workstreams are independent. Each one owns the files listed. Everything else is read-only
for it, except this document: keep your sections true, and add to §11 when you change a decision.
Every workstream finishes with `make` green and `make accept` green, and reports the md5 of
viewer/dist/index.html.

### A. CLI non-server commands: check, query, diff

**Owns**: `cmd/sbtel/cmd_a.go` (and `cmd_a_*.go`, `cmd_a_test.go`), `core/api.js` (add to it; do not
change the foundation behaviour of lint, query, check, canon or conformance), and
`conformance/cases/a.json` and its expected records.

**Build**:

- `cli("check" | "query" | "diff", args)` in api.js, with the text formats of §3.4–3.6 and §7.5.
  - Args are `check: {files: [spec], bindings: {name, src}, json}`, `query: {files: [spec], ids,
    withDeps, json}` and `diff: {files: [a, b], json}`.
  - Exit codes are computed in JS.
- The Go commands parse flags with `parseArgs` and read inputs with `readInputs`, then call
  `runCLI`.
- Write `diffText` against the §7 shape, using a hand-written DiffResult fixture in your tests. Do not
  wait for C: when diffSpecs is missing, `sbtel diff` exits 2 with "diff is not implemented yet".

**Done when**:

- query and check cases in a.json cover every rule row of §2.5 and every Element kind;
- Go tests drive every command through `run(...)`, with exit codes 0, 1 and 2 each exercised;
- `sbtel check examples/shell.sbtel --bindings conformance/specs/sample.bindings.txt` prints what
  §3.4 says.

### B. Server, sessions, viewer server mode

**Owns**: `cmd/sbtel/cmd_b*.go`, `internal/state/` (paths, atomic writes, meta, events, cursor),
`internal/server/` (lifecycle, browser API, control API, SSE, disk polling, browser launching), and
`viewer/src/server.js`.

**Build**: §3.7–3.13, §4 and §5 in full, and §6.3. That includes `open-diff` and serving
`diff.json`, since C consumes that page data but B serves it.

**Done when**:

- Go tests with `SBTEL_HOME=t.TempDir()` and `serve --foreground --port 0` (in-process via `run`)
  cover:
  - session create, version push, inbox (`--wait` and `--peek`), reply, close;
  - 409 on a stale base;
  - Host and Origin rejection;
  - 404 for unknown ids and for `/`;
  - no CORS headers;
  - idle exit;
  - a version-mismatch restart.
- A headless-Chrome test opens a session page and checks that SSE `version` shows the toast and that
  Reload applies the new source.
- `make accept` still passes.

### C. Diff core and diff view

**Owns**: the `SpecDiff` region of `core/core.js` (`diffSpecs` and helpers; nothing else in core.js),
`viewer/src/diff.js`, `conformance/cases/diff.json`, `conformance/diff/*` and the `expected/diff-*`
records.

**Build**: §7 exactly, and the §7.2 feature list written into this document. Also §6.4.

**Done when**:

- the diff cases cover every tag, every Fields key, renames above and below the threshold, a new level
  that moves nothing, and an affected port through a `refines` change;
- node and goja agree (`make`);
- diff.js renders `diff.json` from a static fixture page (C may serve fixtures with a tiny test
  server, or stub `fetch` in a test copy). B's server is not needed until integration;
- `make accept` still passes, so standalone is untouched.

**Status (C)**: done. `conformance/cases/diff.json` has 18 cases (17 until v0.2) over the pairs in
`conformance/diff/`:
- `shell` (the dev hook's pair);
- `swap`, `rename-move`, `split`, `reorder` (empty), `whitespace` (empty) and `unicode`;
- `threshold` (above and below);
- `newlevel` (nothing moves);
- `fields` (every Fields key; v0.2 adds level, port and group sketches and carries);
- `levels` (v0.2: the file's own level names and sketches, a group and a port sketch);
- `affected` (refines changes, lost; `either` until v0.2);
- `nested` (nested moves), `removed-parent` (one ghost) and `ambiguous` (tie-break);
- `big`, about 670 blocks, from `gen-big.mjs`. It takes 0.2 s in node and 0.8 s in goja.

The viewer test is `conformance/diff/viewer.test.mjs`, with 84 checks (73 in v0.1.0, 79 in v0.1.1): the dev hook,
every fixture, light, dark and phone, and server mode against a stub server, including comments and
replies that survive a reload (v0.1.1).

### D. Docs, install and skills

**Owns**: `docs/LANGUAGE.md`, `README.md`, `install.sh`, `install.ps1`, `examples/*.sbtel`,
`plugin/` and `.claude-plugin/marketplace.json`.

**Build**:

- **LANGUAGE.md**: the language as the core parses it. Cover the forms `block`, `level`, `adjacent`,
  `port`, `message`, `behavior` (with params), `implements`, `sketch`, `refines` and `either`,
  keywords (`:type`, `:fill`, `:k`), the implicit level, file-level declarations, scope rules, the
  check list and the binding rules (§2.5). Every example in it MUST pass `sbtel lint`.
- **README**: what sbtel is, install, a 5-command tour, and links.
- **Installers**: §9.2 and §9.3.
- **Claude Code plugin**: the layout is `plugin/.claude-plugin/plugin.json` (name `sbtel`), plus
  `plugin/skills/<skill>/SKILL.md` with YAML frontmatter (`name`, `description`). The repo root gets
  `.claude-plugin/marketplace.json` pointing at `./plugin`. The skills are:
  - `sbtel-language`: reading and writing specs;
  - `sbtel-design`: designing or refactoring an architecture with the open/inbox/reply loop;
  - `sbtel-recover`: rebuilding a spec from an existing codebase, annotating code (§8), extracting
    bindings and running `sbtel check`.

  Validate with `claude plugin validate ./plugin` if available. Don't put a CLAUDE.md in the plugin.

**Done when**: `sh -n install.sh` passes; install.sh installs from a local `dist/` via
`SBTEL_BASE_URL`, and refuses a corrupted checksum; every `.sbtel` file and every sbtel code block in
the docs lints clean.

### Integration order

A, B, C and D run in parallel. When they merge:

1. B's server serves C's diff page.
2. A's `diff` text runs on C's real output.
3. D's skills describe the real commands.

---

## 11. Decisions and deviations log

1. **Cursor in `cursor.json`, not in meta.json.** The brief put the read cursor in meta.json. Here
   meta.json has one writer (the server) and the cursor has one writer (inbox), so no file needs a
   lock.
2. **Control API under `/control/`, with a bearer token.** The brief said every endpoint is under
   `/s/<id>/`. That still holds for the browser API. Agents' writes go through a token-authenticated
   control API so that the server is the only writer of session files. A web page can't call it: it
   has no token and sends an Origin header.
3. **Embedding without copies.** The brief allowed copying the core at generate time if embed paths
   required it. Instead, the `sbtel` root package (assets.go) embeds `core/*.js`,
   `viewer/dist/index.html` and VERSION, because go:embed can read its own subdirectories.
   `viewer/dist/index.html` is committed and checked by `make check-viewer`.
4. **The command logic and text formats live in api.js (`cli`).** Go only does IO, which lets node
   conformance test the output formats.
5. **`bindingVerdict` in core.js.** The check rule is shared by the CLI and the viewer (server mode
   shows violations).
6. **JSON Lines for `--json`.** `lint` takes several files, so each input gives one object per line.
7. **`diff` exit codes follow diff(1).** 1 means the specs differ, and a parse error is 2.
8. **Viewer modes by path only.** The page uses `/s/<id>/` for server mode and `/s/<id>/diff` for
   diff mode, and the server redirects to the path that matches the session's kind.
9. **Pruned third_party/xtext.** The brief's local x/text clone (41 MB) is cut to the 11 packages goja
   needs (9.5 MB), so the repo is self-contained.
10. **The acceptance suites are copied into viewer/test/.** The other agents can run them with
    `make accept`. The originals are untouched.
11. **localStorage keys renamed to `sbtel-*`**, with a read fallback to `marquee-*`, so existing users
    keep their settings and comments.
12. **server.json also holds `token`** (the brief listed pid, port, version and start time), for the
    control API.
13. **`open` exits 0 even when the spec has lint problems.** It prints them to stderr, so capturing the
    session id in scripts is safe.
14. **Server port reuse.** A restarted server tries the previous port first, so EventSource in open
    tabs reconnects without a reload.
15. **Binding an ancestor is forbidden** (lead decision; workstream A). The brief allowed "ancestor or
    child"; a part depending on its whole is an upward dependency, so `bindingVerdict` now returns
    `ancestor` with `ok:false`. Binding a descendant stays allowed.
16. **`query` prints a self-contained fragment** (lead decision; A). The human output is one spec
    that lints clean (§2.4, §3.5) instead of loose element sources, and `--with-deps` adds the blocks
    the selection may bind to as collapsed stubs. QueryResult gains `fragment`, `stubs`, `suggest`.
17. **A query id that names nothing is exit 2**, not 1 (lead decision; A): it is a usage error, like an
    unknown session, and stderr says "did you mean".
18. **Lint reports form warnings** (A): unknown or misplaced forms and malformed ports, names and
    keywords, which the model builder drops silently (§2.3). They add to `warnings`.
19. **Same-content `open --session` is a no-op** (B). It records no version and sends no toast, so an
    agent that edited the file (already seen by disk polling) and then runs `open --session` does
    not produce a duplicate version.
20. **`--prefer-port` and token identity** (B). A stopped server deletes server.json, so the CLI
    carries the old port to the replacement with the hidden `serve --prefer-port`. The CLI recognises
    the new server by its token rather than by pid.
21. **SSE `after` and `tab` query parameters** (B). A tab that reconnects after an error opens a new
    EventSource, which cannot set `Last-Event-ID`, so `after=<seq>` does the same job. `tab` stops a
    save from echoing back as a version toast in the tab that saved.
22. **`open` lints only specs up to 1 MiB** (B). Linting 12 MB in goja took 26 s.
23. **The diff view draws ghosts on the canvas** (C). §6.4 first said removed elements go in a side
    sheet with a toggle to show side A. Instead, removed and moved-away elements are ghost blocks in a
    merged layout, so each has its own space at its old place. All changes are listed in the change
    sheet, and Before/After animates between the two layouts.
24. **Weak id matches can be re-paired** (C, §7.2). A pure id match makes a name swap look like two
    total rewrites, and moves every child. An id match that scores below the rename threshold
    against itself now competes in the rename pairing. It keeps its partner unless something scores
    higher.
25. **Reordering within a level is not a change** (C, §7.3). Moves are holder and level changes only,
    and adjacency changes are a field.
26. **Affected ports compare stable partners only** (C, §7.4). A port that changed itself is
    reported as a change, not as a cause of other ports being affected.
27. **One 64 MiB body limit** (integration). Browser writes had 4 MiB and control bodies 64 MiB, so an
    agent could push a spec that the tab then could not save. Both are 64 MiB now; the tab checks the
    limit before it posts.
28. **`parseBindings` moved into core.js** (integration). The viewer had a copy of api.js's parser;
    now both use the core's, so the page and `sbtel check` read an edges file the same way.
29. **Annotation anchors** (integration, §8). `@sbtel message Name` and `@sbtel port Block.port` are
    kept (core.js and the viewer use them) and are the only forms besides the four ownership forms;
    the long s-expression form is gone. `sbtel_owners.py` checks anchors and its tests cover them.
30. **Deterministic server tests** (integration). `TestSSEReplayReplyAndClose` flaked because a
    replay connection the client had closed was still counted as a tab, so the test pushed a version
    before the live tab had connected. The 600 s hangs came from unbounded waits, the worst being a
    second server that took over after a 1 s health probe timed out under load and then served for
    30 minutes. The tests now wait for conditions and SSE events, bound every wait, build their
    control client from server.json, and give probes a long `Options.Health`.
31. **Comments in diff sessions, through session.js** (v0.1.1). diff.js reused the app's
    `commentCounts`, which skips sent comments, so a comment sent from an `open-diff` tab never got
    a bubble or a thread (not even after a reload), and an agent reply was only a toast. The session
    comment logic moved out of server.js into viewer/src/session.js, and both modes use it (§6.3-6.5).
    The diff viewer test and the e2e test cover the case.
32. **`parseBindings` keeps `# VIOLATION:` notes** (v0.1.1, §2.5). Edges gain `note`; CheckResult and
    the CLI's text are unchanged. The viewer lists each violation with its note.
33. **The viewer's spec is recovered, not hand-drawn** (v0.1.1, §8). examples/playground.sbtel
    described index.html as of an early version (no modes, no lint, no diff) and chose levels and
    adjacency so that every binding passed. It is replaced by examples/viewer.sbtel, recovered from
    the code by the sbtel-recover skill: violations are recorded and explained, not designed away.
    `conformance/specs/playground.sbtel` stays as a conformance fixture; it describes nothing.
34. **`make selfcheck`** (v0.1.1, §8): spec, annotations and edges of the viewer must agree, and every
    violation must be explained. It is the one place that needs npm (a pinned TypeScript checker in
    tools/selfcheck), and only for development.
35. **The recover skill finds SCCs before blocks** (v0.1.1). It now resolves symbols where there is no
    import graph (`sbtel_refs.mjs`), computes strongly connected components first (`sbtel_sccs.py`),
    treats existing annotations as a hypothesis, and draws the line between moving an annotation as a
    fix and moving it to pass `check` (granularity.md, annotations.md).
36. **The viewer embeds its fonts** (v0.1.2, §6.5). The page loaded Hanken Grotesk and JetBrains Mono
    from Google Fonts: a third-party request on every open, and a different font offline or behind a
    proxy (the fallback system font is wider, so sketches wrap and truncate differently). The same
    variable woff2 files, latin and latin-ext subsets plus greek for the mono (ids are written `β:`
    and `μ:`), 119 KB in all, now live in viewer/fonts and build.mjs inlines them, so standalone,
    server and diff mode look as before and never call out. Screenshots at deviceScaleFactor 1 of the
    page with Google's fonts and with the embedded ones are pixel-identical; a system font stack was
    not, and differs per OS. This was an edit to the head of index.html, outside the hooks §6.5
    allows; `make accept` stays green. THIRD_PARTY_NOTICES carries the fonts' OFL texts.
37. **Count wording in the viewer** (v0.1.2). A collapsed card's count line said "3 blocks in 1
    level", where "level" meant nesting depth, a word the language never uses (and it was easy to read
    as levels). It now says "3 blocks", and "9 blocks, 3 deep" when blocks nest; the same text
    heads collapsed stubs in `sbtel query --with-deps` (conformance/expected updated). Counts in the
    page say "1 comment", "1 check", "1 line" and "1 block" in the singular.
38. **`--help` on every command, and docs checked against the binary** (v0.1.2, §3.1, §1 Build).
    Subcommands rejected `--help` as an unknown flag (exit 2). `make docs-check`
    (tools/docs/snippets.mjs) runs every spec, lint output, query, check output and README tour
    transcript in the docs through bin/sbtel; it is in `make test-all`, CI (Linux) and the release
    workflow. `sbtel sessions` shows a diff session's two absolute paths, not its file names.
39. **`sbtel check` shows the explanations** (v0.1.2, §2.5, §3.4). check parsed the `# VIOLATION:` notes
    but dropped them, so "every violation explained" could be checked only in the browser. Each
    violation now carries its note (text: an indented `VIOLATION:` line; JSON: `note`), the summary
    adds `N explained`, and a note on an allowed edge or a note that explains no edge (`orphans` from
    parseBindings) is a warning. Warnings leave the exit code alone: they are about the explanations,
    not the code. tools/selfcheck/violations.mjs now reads all of it from `check --json`.
40. **sbtel_owners.py and Go** (v0.1.2, §8). A raw string whose lines start in column 0 cut a
    declaration short (gofmt never indents a raw string's contents), an `@sbtel` inside a string
    literal was read as an annotation, and stacked `@sbtel Name` lines or two `@sbtel file` lines in a
    file silently kept the last. A small lexer now finds string literals (multi-line backtick and
    triple-quoted ones too); the two duplicates are errors, since "several may stack" never said what
    they meant. `@sbtel file` in Go goes before `package`.
41. **The Go code is checked against its spec** (v0.1.2, §8). A fresh-eyes recovery of the Go side
    (18 blocks, 3 explained violations) is merged into examples/sbtel.sbtel, which had no Go detail,
    no home for assets.go (now `Sbtel.Assets`, below the engine and the CLI that name it) and the
    server above the viewer although no Go code names the page (now beside it). The Go sources carry
    comment-only `@sbtel` annotations, and `make selfcheck` checks them as it checks the viewer, with
    references from the recover skill's new Go helper, `sbtel_refs_go` (go/types and `go list -export`,
    standard library only, because gopls and golang.org/x/tools cannot be assumed to install).
42. **`layer` is now `level`, with no alias** (v0.2). The form, the model's identifiers (`b.levels`,
    `out.levels`, `K.LEVELGAP`, `t:'level'`…), the rule names (`lower-level`, `same-level`), every
    message, `--json` field, CLI help text, menu ("Insert a level above", "Add a block to this
    level"), test, example and doc. The rename was mechanical and case-preserving; it was proven
    behaviour-neutral by regenerating every conformance record and comparing it with the old one with
    the word replaced (no difference). `(layer …)` is reported by the **core** as a model warning,
    `unknown form (layer) in W (did you mean level?)`, so the viewer shows it too (lint's form warnings
    skip it, so it is said once). A parse error was not used: the reader has no form names, and an
    unknown form never stops a parse. CHANGELOG history keeps "layer". "Layering" in prose became
    "levels". *Red team*: a silent alias would have been friendlier for one release, but the user
    asked for a clean break, and the warning names the fix.
43. **Level names** (v0.2). `:name` is kept only as a non-empty string, the first one; anything else is
    no name plus a warning (`level :name takes a "string"`, `level :name is empty`, `a level has more
    than one :name`). Unlike a block keyword, a level keyword without a value never takes the next
    form as its value, so `(level :name (block A))` keeps A. A level takes no other keyword (a
    warning), and a keyword after the members is a warning. Names may repeat: they are labels, never
    referenced. Binding texts quote them with JSON.stringify (`level 2 "Routing" of Shell`), not
    Core.Edits' quoteStr, so Core.Bindings stays below Core.Edits. The wording keeps the 0.1 sentence
    (`A (level 2 "Feedback" of Shell) binds upward to B (level 1 "Routing")`) rather than the brief's
    example, so tools grepping `(level N of X)` for unnamed levels still work.
44. **Sketches on levels, ports and adjacent groups** (v0.2). One each; a second is the usual "more
    than one (sketch)" warning. A port's sketch comes after its type; anything else there is "extra
    items". A behavior's port sketches reach its implementers (portsOf copies them). An adjacent
    group's sketch is its outermost group's; a sketch on a nested group is a warning, because the
    model flattens nested groups. The sketch may sit anywhere among the group's members.
45. **`(~ … ~)`** (v0.2). The reader makes one token: `(` and the maximal run of k tildes open it, the
    first k tildes followed by `)` close it (so `(~)` is unterminated and `(~ ~)` is empty). It reads as
    a two-item list `(sketch "text")`, so every later stage (lint, query, fragments, edits) treats it as
    a sketch. Whitespace: the text is trimmed and runs collapse to one space, except a run with two or
    more line breaks, which is one paragraph break `\n\n` (`\r\n` and `\r` count as one). `(sketch "…")`
    keeps its 0.1 rule (every run is one space): applying the paragraph rule to strings would have
    changed existing sketches' text, layouts and diffs silently. So `(~ a\n\nb ~)` is "the same as
    `(sketch "a\n\nb")`" in every respect but this rule; LANGUAGE.md §3.2 says so. An opener with no
    closer is a parse error at the opener: `Unterminated (~: no closing ~)`. *Red team*: maximal munch
    means `(~~)` is an unterminated two-tilde opener, not an empty one-tilde sketch; documented, and
    the viewer always writes a space after the tildes.
46. **Edits keep the sketch's form** (v0.2, core.js `sketchNorm`, `sketchForm`, `sketchReps`). A
    `(sketch "…")` is rewritten as a string with its own rule (so paragraphs typed into it collapse); a
    `(~ … ~)` stays one, with the fewest tildes whose closer the text does not contain; a new sketch is
    `(~ … ~)`. A paragraph break is written as a blank line and an indented continuation. An unchanged
    port sketch is copied as written when the port is rewritten. An adjacent group's sketch survives
    the edits that rewrite groups: a delete leaving two or more, a cut (it stays with the first part
    that is still a group) and a join (the source group's, else the target's). Naming an implicit
    level wraps its members in `(level :name …)`; clearing an explicit level's name and sketch keeps
    `(level …)`. Conformance `edits` cases round-trip each through a fresh parse in both engines.
47. **Diff of the new sketches** (v0.2, §7). A port whose sketch alone changed is `ports.changed` with
    `sketch`, and stays stable for affected ports (its compatibility did not change). Level names and
    sketches and group sketches are `fields.levels` on the holder; levels and groups pair by shared
    matched blocks. The file's own levels needed a holder, so a change may have `element: "file"`.
    Level names are not matching features: renaming a level must not unpair the blocks in it.
48. **The viewer's click on a drawer row edits** (v0.2, §6.6). Hover took over the row's old click (the
    talk outline) and its old type popover (the row lost `data-msg`; chips and badges keep theirs). The
    hover outline shows no toast: it would flash on every pass of the mouse. A child's port on its
    container's drawer is read-only with "Edit in block X", like an inherited one: it is the child's.
    A press outside an invalid editor discards it with a toast, rather than saving a broken port or
    trapping the user.
49. **Level labels** (v0.2). A truncated name's first click shows it whole (as a clipped sketch does)
    and the next click edits: the brief asked for both on click. The named first level's header row
    needs room, so a named first level starts K.NAMEGAP (10px) lower; unnamed levels lay out exactly as
    in 0.1. The label, line and + are flex items of the zero-height separator, so they share one axis
    at any zoom (accept6 measures it within 0.5px at 0.5, 1 and 2).
50. **A click on an adjacency line selects it and opens its sketch editor without focus** (v0.2), so
    Delete still cuts the selected line and the strip still offers Cut and Comment; a click in the
    editor starts typing.
51. **App edits outside §6.5's hooks** (v0.2). This pass changes the app itself (callouts, labels, the
    carries ear, the checks pill), as the user asked. Two acceptance regexes assumed the sample's
    Router group starts `(adjacent (block …`; the group now has a sketch first, so they allow one. The
    other 0.1 expectations are unchanged, apart from the level renames in test names.
52. **The sample spec** (v0.2). Its three levels are named (Surfaces, Services, Foundation), it has a
    port, a level and a group sketch in `(~ … ~)`, its comment counts blocks without depth, and it loses
    `:fill "blue"`. examples/shell.sbtel stays identical to it. It keeps three placement notes on
    purpose (a comment says so): the playground shows attaching across blocks and refusing it out of
    scope.
53. **Cuts** (v0.2). `(either …)` is gone from the reader's forms, the checks, `accepts` (same type or a
    `refines` chain), the diff, the viewer and the docs; the core warns `either was removed in 0.2;
    declare each alternative with (refines Union) instead`. `:fill` and free `:key value` keywords are
    gone: a block's one keyword is `:type`, any other is `unknown keyword :k in block X; a block takes
    only :type`, and the model drops it. Element loses `fill`, `keywords` and `either`; Fields lose
    `fill` and `either`; the feature sets lose `f:` and `e:`. randomSpec no longer writes `:fill`, so
    its specs (and the random-N records) changed.
54. **`(carries …)`** (v0.2). Only the first `(carries …)` counts and a second is a warning, as with
    `refines` and `sketch`; merging them would make two forms mean one. A name twice is a warning;
    a message carrying itself is fine. Scope is the port rule, checked in `mscope`
    (`M carries T, declared in D`), and unknown names in `rel`. A subtype carries its supertypes'
    types (`carriedBy`). Every walk is cycle-safe. `accepts` ignores it.
55. **Carriers in the viewer** (v0.2). A message card's ear shows its own carried types and, dimmed,
    the inherited ones. The hover outline adds the blocks whose ports use the type itself to what
    `carriers()` returns: "who touches this data". A drawer row's hover stays the port outline. On
    touch, selecting a type card shows the outline; no toggle was needed.
56. **Placement notes** (v0.2, §2.8). A severity of its own, `info`: not a problem, no exit code, its
    own text line kind and `LintResult.info`. A subtype counts as a user of its supertype, and so do
    the declaring sites of carriers, subtypes and behaviors with such ports; without that, a type that
    is only refined would be "never used", and the suggested move could break scope. No "unused"
    check existed before. In this repo: examples/viewer.sbtel moved Pure into Core, MeasuresText into
    App.Kit and DiffPair into Viewer.Diff; examples/sbtel.sbtel moved SpecText into Sbtel.Cli and keeps
    Comment, Save, Version and Reply beside Event with a reason (the server takes them all as Event);
    the sample keeps its three (entry 52).
57. **Query and carries** (v0.2). Carried types are dependencies, so fragments lint clean. A message
    type's result has `carries` and `carriers`, and its header gets `;   carried by …` when anything
    carries it. A kept level with a name or sketch is written as `(level :name …)` even when it is the
    only one, and a kept group keeps its sketch.
58. **The viewer's own spec** (v0.2, §8). The callouts are App.Callouts, adjacent to App.Canvas (the
    canvas draws what a callout points at; a callout outlines partners on the canvas). Their event
    listeners live in App.Input, which tells them whether the gesture was a touch (`co.touch`).
    `readOnly()` lives in App.Document. applyCam() re-placing an open callout is one more explained
    violation of the camera's, like the strip. DiffPair carries SpecText, and CommentBatch carries
    Comment: the code's data really nests that way. The level holding Server and Diff is "Page modes".
59. **The collapsed card's count** (v0.2) is the number of blocks inside, at any depth: "23 blocks",
    "23 blocks · 1 behavior · 1 shape". Depth is gone from the card and from `query --with-deps`
    stubs; it rarely said anything, and the total says how much a block holds.
60. **sbtel_owners.py reads `(~ … ~)`** (v0.2). Its tokenizer skips a tilde sketch whole (nothing
    inside names a block), with a test.
61. **Levels are numbered from the bottom** (v0.2.1, user decision). Level 1 is the lowest level of a
    holder and numbers grow toward the top, so a lower level has a lower number, as in "low-level":
    `Store (level 1 of App) binds upward to Orders (level 2)`. Source order is unchanged (levels are
    still written top to bottom). Every number a human reads is 1-based from the bottom: binding and
    check texts, `sbtel diff` text, the viewer's level editor and callouts ("Level 2 of Shell"), the
    diff view's change list, docs and skills. **JSON**: the two fields that are level numbers, the
    diff's `Place.level` and `Fields.levels[].level`, are the same 1-based, bottom-up numbers as the
    text (so no consumer converts); query's `levels` arrays stay in source order (they are lists, not
    numbers). `Place.level` used to be a top-down count of the levels above that held a matched block;
    move *detection* still compares those counts (otherwise renumbering would change which blocks are
    "moved"), but the number reported is now the block's own level number on that side. `apiVersion`
    stays 2: 0.2.0's meaning changes within 2, which no released consumer relied on. The recover
    skill's `sbtel_sccs.py` keeps its placement and renumbers its output the same way. Checked: a
    level-numbering-only comparison of every conformance record (`level N` and `"level":N` masked)
    shows no other change (11 records changed), goja agrees byte for byte, and `make docs-check --fill`
    changed only those numbers (LANGUAGE.md §6; the README transcript by hand). *Red team*: tools that
    parsed "level 1" as the top now get the bottom; 0.2 is the release that broke specs anyway, and the
    CHANGELOG says so first.
62. **A review is one event** (v0.2.1, §4.3). Not N comment events plus a header: `inbox` prints it as
    a unit, `--wait` wakes once, and the cursor moves once. Its comments get ids `c<seq>.<k>`, so
    `reply` keeps targeting single comments (and `c<seq>` ids of comments sent on their own never
    clash). The comments' `source` is quoted from the tab's text, the proposed spec when there are
    edits: that is what the human was looking at. A review never appends a `version`.
63. **Proposals are files, not versions** (v0.2.1). `sessions/<id>/proposals/<seq>.sbtel`, named by the
    review's seq (unique without scanning; "proposal 2" would need a counter in meta.json, which has
    another writer's semantics). The event holds the absolute path, as `version` events hold the spec's.
    Making it a version would have changed what `/spec` serves and what tabs reload, i.e. applied the
    human's edits without the agent. *Red team*: an agent that ignores reviews never sees the edits;
    the inbox text leads with them, and the skill says to apply or merge them.
64. **The server computes the diff text, through an injected function** (v0.2.1, §5.2).
    `Options.DiffText` is the CLI's engine (`sbtel diff` of base and proposal), stored in the event,
    so `inbox`, `--json` and the log are self-contained and show the same text `sbtel diff` would. The
    server and the engine are peers in examples/sbtel.sbtel, so the server takes a function rather than
    naming the engine (no new binding). It runs outside the session lock (goja needs about a second for
    a large spec), then the session is looked up again; a session closed meanwhile is a 404. Over
    8 MiB it is not computed (a note says to run `sbtel diff`); a side that does not parse gives its
    error line. *Red team*: the diff is of the base version, not of the agent's current text; the
    agent's own changes since then are its to merge, which the skill says.
65. **`reply` may answer a review as a whole** (`r<seq>`, v0.2.1). The overall message often asks
    something; answering it on one comment would be arbitrary. The tab shows such a reply under the
    review in the panel's "Sent reviews", and in a toast.
66. **Save never overwrites silently** (v0.2.1, §5.2, §6.3). The 409 names who made the newer version
    (`by`), and the tab asks: Overwrite, View their changes, Cancel. Overwrite resends with `force`;
    the event says `force: true`, and inbox says "which the user overwrote without merging", so the
    agent knows its version was replaced (it stays in `versions/`). View their changes leaves the
    question open; Cancel shows the version toast again, so Reload is one click away. The wording is
    the user's for an agent push, with "the file changed on disk" and "it was saved from another tab"
    for the other two. A force on the current base is not marked. `GET versions/<n>` serves an old
    version (the comparison of a draft kept against it).
67. **Editing after sending a review** (v0.2.1, §6.7). The proposal stays in the tab; further edits
    are a new draft counted from it, and the title and the panel say so ("proposed in rK, then
    edited"; "on top of rK's proposal"). Sending it proposes the whole text again with `supersedes`,
    and its diff is against the server version, so the agent always applies one proposal, the latest.
    *Red team*: sending only the delta would make the agent stack proposals in order, and a lost one
    would corrupt the result; a whole text is idempotent. A new version from the agent, a disk change
    or a save drops the proposal; Reload keeps it reachable with ⌘Z.
68. **What Review (N) counts** (v0.2.1). Pending comments plus the changes `diffSpecs` finds between the
    draft's base and the text (at least 1 when the text differs but no element does, or a side does
    not parse), recomputed 200 ms after a change. *Red team*: deleting one block can count 3 (its
    holders' drawer rows change too); that is what the diff shows and what the agent will read, while
    counting undo steps would count noise.
69. **The draft on disk** (v0.2.1, §6.7). Per session, in localStorage, with the text only when it
    differs from the base. A draft with edits against a version the agent has since replaced stays
    based on that version (fetched with `versions/<n>`), so the toast offers the new one and Save asks.
    If that version cannot be fetched, the edits are shown against the current version, with a toast:
    edits are never dropped silently. The beforeunload question comes only when something is unsent:
    a sent proposal is safe on the server.
70. **The undo history on disk** (v0.2.1, §6.7). Patches between neighbours, not snapshots; one splice
    each (common prefix and suffix), which is exact and tiny for the edits the app makes. The head is
    stored in full, and a draft's `src` duplicates it: two independent records, so either survives the
    other's failure. The cap is 2^20 UTF-16 code units (about 2 MB as browsers count, a fifth of
    Chrome's 10 MB per origin), oldest undo steps first. The in-memory limit of 200 steps is kept.
    The standalone page always opens with the sample, so on reopening the sample becomes the newest
    step and the first ⌘Z brings back the last edit; Load sample, Random spec and typing in the
    source sheet stay outside the history, as before (standalone behaviour does not change). *Red
    team*: two tabs of one session write the same key and the last one wins; each tab's own history
    is intact while it is open.
71. **Storage failures stop writing, once** (v0.2.1). A failed write disables that record for the rest
    of the page's life and logs one warning for the page; retrying on every edit would cost time and
    warnings and rarely succeed. `store.set` (settings, standalone comments) keeps swallowing silently.
72. **Cleanup** (v0.2.1). `sbtel close` → SSE `closed` → the tab removes the session's draft and
    history; a 404 at load does the same. Pruning other sessions' keys asks `GET /s/<id>/meta` for each
    id the browser already holds (a capability it has, so nothing leaks), at most 64, and removes only
    on 404; a network error stops pruning. *Red team*: a key for a session on another port (another
    `$SBTEL_HOME`) is never seen, as localStorage is per origin.
73. **Comparisons open in a new tab from the opener** (v0.2.1, §6.1). The full diff of a draft includes
    the tab's unsaved text, which the server does not have, and a URL cannot carry megabytes. The new
    tab is the same page at `?compare=<key>` in diff mode, reading `window.sbtelCompares[key]` from its
    opener (a top-level `const` is not a window property, hence the explicit global). The server needed
    no route. If the opener has gone, the page says to open it again from there.
74. **The dock** (v0.2.1). Review is the last, filled button of the dock; Save keeps its place, without
    the accent. With a right sheet open on a wide screen (the diff view's change list is open by
    default), the dock centres in the room left of it, so Review is never under a sheet.
75. **Pending comments never leave the tab** (v0.2.1). Only a sent review, a comment sent with Send now
    and a save become events, so `inbox --wait` cannot wake for pending activity; the e2e test proves
    it while comments and edits are added. A Send now that fails puts the comment back in the review.
    Standalone keeps its Save and Send.
76. **One change list for the diff view and the Review panel** (v0.2.1). Its rows and markup
    (`changeItems`, `changeLines`, `changeListHTML`, `runsHTML`, and their CSS) moved from diff.js to
    review.js, region `Viewer.Changes`, below both users; diff.js passes its ghost ids and counts in.
77. **The viewer's own spec** (v0.2.1, §8). New blocks, recovered honestly from the code:
    `App.History` (the codec and the cap, in its own level between App.Document, which drives it, and
    App.Kit, whose `store` it uses), `Viewer.Review` (with its `Review` message, between the page modes
    and the session) and `Viewer.Changes` (beside Viewer.Session). examples/sbtel.sbtel gains the
    `Review` event and `Sbtel.Viewer.Review`. The page's standalone title is "sbtel Playground".
78. **One declaration grammar** (v0.2.2, user decision; §2.3). Block, behavior and shape heads are
    read by one function, core.js `declHead` (the name, then keywords; `:type` is the one keyword), and
    lint's form warnings by one `keywords()` in api.js, so the three report unknown, late and valueless
    keywords in the same words (`unknown keyword :k in behavior B; a behavior takes only :type`). A
    behavior's body keeps what has a meaning for a promise: sketch, ports, `implements`. *Red team*:
    "one grammar" could have meant a behavior accepting levels and blocks too; they have no meaning for
    a set of ports, so they are refused by name (entry 83) rather than accepted and ignored.
79. **`:type` on behaviors and shapes** (v0.2.2, user decision). Stored as on blocks, drawn by the
    same pill code (`topHTML`, the layout's top row already measured `n.type` for any card). Query's
    Element has `type` for every kind (null when unset), so every behavior and message Element in the
    conformance records gained `"type":null`; adding a key keeps `apiVersion` 2 (§2.2). The diff
    compares `type` for all kinds and uses it as a matching feature (`t:`).
80. **A behavior that implements another extends it** (v0.2.2, user decision). `behaviorsOf` is the
    transitive closure, each behavior once, depth first; `implementersOf` is the one "implementers of"
    (placement, the viewer's outline and info card, the diff's `u:` features); a behavior's `portsOf`
    is its own ports then those of what it extends, `via` the declaring behavior (so "Edit in behavior
    X" opens the right one). In a diamond (A extends B and C, both extend D) D's ports come once, through
    the first path; with arguments, the first path's arguments win. A block's card shows its direct
    behaviors only; a behavior's card shows the ones it extends as badges.
81. **Arguments flow by substitution** (v0.2.2). `(implements (Store Event))` retypes each of Store's
    ports typed with its parameter T to Event, in the ports the implementer gets; a behavior's own
    parameter passed on (`(behavior (Cache K) (implements (Store K)))`) is replaced by its implementer's
    argument, so arguments flow down the chain. Bare `(implements Store)` keeps the parameters as types
    (0.2.1's meaning). Arguments must fill every parameter (a model warning names the counts); partial
    application was rejected as a second meaning for one form. The list form is accepted on blocks too,
    not only on behaviors, because one grammar means one `implements`; 0.2.1 warned "implements names
    exactly one behavior" for it there and kept the bare parameter types. An argument is checked like a
    port type: declared (`msg`), in scope where the implementer is (`mscope`, "X passes M to Store,
    declared in D"), and it is a dependency in query fragments and a placement user. *Red team*: a spec
    that relied on 0.2.1 ignoring block arguments now gets typed ports, which is what it wrote.
82. **Cycles are a sixth lint rule, `cycle`** (v0.2.2), "No behavior implements itself", one failure per
    cycle named from its first behavior in source order (`A → B → C → A`). A rule, not a positioned
    warning, so the viewer's checks popover lists it and an edit that would add one is caught by the
    same comparison as other spec checks. LintResult's `checks` has six entries; every conformance
    record gained the empty one. Every walk over `implements` is cycle-safe, so a cycle never hangs
    layout, ports or placement. *Red team*: a model warning would carry a line and column; the chain is
    what one fixes, and one of its `implements` forms is the place.
83. **What a behavior does not contain** (v0.2.2, user decision). `block`, `level`, `adjacent`,
    `message` and `behavior` inside a behavior are reported by the core with their position, `behavior
    B: behaviors don't contain blocks, levels or declarations; declare block X beside the behavior
    instead` (or "the level", "the adjacent group", "message M", "behavior N"), so the viewer shows them,
    and are left out of the model: before, a `(block X)` inside a behavior became a block in no level.
    Lint's form warnings skip them, so each is said once.
84. **`abstraction` and `scope`** (v0.2.2, user decision; §2.5). A binding whose callee is a behavior is
    allowed (`abstraction`) when the behavior is declared in the caller, an ancestor or the file, else
    refused (`scope`, worded like lint's scope rule). The rule ignores levels on purpose: calling
    through an abstraction is how a higher block uses a lower one without naming it, and the levels
    still judge the composition root, which binds the implementers. `# VIOLATION:` notes work as on any
    edge. *Red team*: a block could launder an upward dependency through an interface its caller above
    implements; the root that wires them is then the one binding upward, and check sees it there.
85. **Blocks and behaviors are separate namespaces; a bare name binds the block** (v0.2.2). `bindingTarget`
    resolves a callee as a block id first (exactly as written), then `beh:Name`/`β:Name`, then a bare
    behavior name; check warns when a bare callee names both. Chosen over an error so an edges file keeps
    its meaning when someone adds a behavior with a block's name, and so `beh:` is the one explicit
    spelling, as in query ids. "Did you mean" ranges over blocks for callers and over blocks and
    behaviors for callees; an unknown callee reads "is not a block or a behavior in the spec" (records
    and docs updated); a behavior as a caller is `unknown` with "(X is a behavior; a binding's caller is
    a block)". sbtel_owners.py resolves annotation names the same way.
86. **Placement does not read bindings** (v0.2.2). Users of a behavior are its implementers (through
    extension) and the declaring sites of behaviors that extend it, which the user asked for. A behavior
    that exists for its callers must be declared where they see it, often above its implementers, and
    lint, which has no bindings, notes that it could live lower. Both dogfood specs keep such a note
    with a `;` comment saying why, the precedent of examples/sbtel.sbtel's Event kinds. *Red team*:
    `lint --bindings` would remove the note but adds CLI surface and a per-file flag to a multi-file
    command; the language docs and the recover skill say to keep the behavior where its callers see it.
87. **The helpers tag implements relations; they are no bindings** (v0.2.2, user decision; §8).
    sbtel_refs.mjs tags a name in a heritage clause (`implements`, `extends`) or JSDoc `@implements`;
    sbtel_refs_go tags the type of a blank assertion (`var _ X = …`) and an interface embedded in an
    interface; a third column, `implements`, after the name. sbtel_owners.py --edges never makes a
    tagged reference to a behavior a binding: it checks that the spec says the caller implements it
    (directly or by extension) and reports an error otherwise (exit 1, so make selfcheck fails on a
    mismatch). A tagged reference to a block (a class extending a concrete class) is an ordinary edge.
    An untagged reference from an implementer to its behavior (a hand-made pair for Rust's `impl X for
    T`, if not tagged) is `A -> X`, which the abstraction rule allows: harmless, and the docs say to tag
    it. The reverse mismatch (the spec says implements, the code has no assertion) is not reported: Go
    implements implicitly, so absence proves nothing. Code owned by a behavior binds nothing: its
    signature is its ports, typed with shapes. *Red team*: an interface whose method names a
    concrete block's type couples every caller to that block, and this hides it; the data shape belongs
    to a shape, whose `@sbtel message` anchor marks it.
88. **sbtel_owners.py and behavior owners** (v0.2.2). Any ownership form may name a behavior: what is a
    type-like declaration differs too much across languages to check reliably (Go `type X interface`,
    a Python `class X(Protocol)`, a JSDoc `@typedef`, a Rust `trait`, an Elixir `defprotocol`), so it
    is documented, not enforced. The ranges print a behavior owner as `beh:Name`; edges print it bare,
    or `beh:Name` when a block has the name. Comment lines between `@sbtel Name` and its declaration
    now belong to the declaration (they were the region's or the file's): a JSDoc `@param {T}` above a
    function is part of it. "unknown block X" became "unknown block or behavior X" for ownership forms;
    anchors still name blocks.
89. **JSDoc in sbtel_refs.mjs** (v0.2.2). JSDoc is visited (`node.jsDoc`), so `@param {T}` and `@type {T}`
    are references, and a `@typedef` or `@callback` is a unit of its own (it is attached to the next
    statement, which would otherwise swallow references to it). Plain JavaScript declares interfaces
    that way. No JSDoc type existed in sbtel's own code, so no earlier edge changed.
90. **The viewer's implementers and users outline** (v0.2.2, user decision; §6.8). The brief said hovering
    a behavior highlights its implementers "as it already does": 0.2.1 only showed the behavior's info
    card after 280 ms, so the outline is new. Implementers get a solid outline and "implements", users
    (from loaded bindings) a dashed one and "uses", both in the behavior's glyph colour, the behavior
    itself a dotted one; the label is a small pill above the card's top left corner (`::after` from
    `data-bh`), away from the ear and from the comment bubbles at the top right. Solid and dashed follow the port-partner outline's own pair (partner solid,
    source dashed), and the colour ties them to the behavior. `behaviorUsers` lives in App.Document's
    region and server.js reassigns it (§6.5), because App.Popovers (the info card) sits below
    App.Callouts.
91. **The Edit dialog edits a behavior like a block** (v0.2.2): a Type field for all three kinds; a
    behavior lists the behaviors it may extend (in scope where it is declared, not itself) with the
    ports that come through them; a choice that makes a cycle is refused in the dialog.
92. **bindingVerdict walks the caller's ancestors itself** (v0.2.2). Using Core.Model's `ancestorsOrSelf`
    from Core.Bindings would bind upward (Core.Bindings sits below Core.Model in examples/viewer.sbtel,
    beside the reader); a three-line loop keeps the levels.
93. **Dogfood: two dependency-inversion seams** (v0.2.2, §8). The viewer: layout(model, opts, M) calls
    the measurer only through its parameter. core.js now declares that interface as a JSDoc `@typedef
    MeasuresText` (annotated `@sbtel begin/end MeasuresText`) and types M with `@param`; the behavior
    MeasuresText (`:type "JSDoc typedef"`) moved from App.Kit up to Viewer, where Core.Layout can see
    it, and App.Kit implements it. New edge: `Core.Layout -> MeasuresText` (abstraction). The Go code:
    Options.DiffText was an anonymous `func(a, b string) string`; it is now the named type
    `server.DiffFunc`, annotated `@sbtel DiffsSpecs` (`:type "Go func type"`, declared in Sbtel), and
    cmd_b.go says `var _ server.DiffFunc = diffText`, a tagged reference that sbtel_owners.py checks
    against `(implements DiffsSpecs)` on Sbtel.Cli.SessionCommands. New edge: `Sbtel.Server.Core ->
    DiffsSpecs` (abstraction). No explained violation became an allowed abstraction binding: neither
    seam had produced an edge before (the layout never named M, the server never named the engine),
    so the counts went from 171 to 172 edges (viewer) and 39 to 40 (Go), with 10 and 3 explained
    violations as before.
94. **Portability fixes from the first CI run** (v0.2.2, coordinator). sbtel_refs_go resolves links in
    `--dir` (macOS's /var is /private/var, and the go tool reports real paths); sbtel_refs.mjs keys the
    project's files by real path and sbtel_owners.py matches pairs by real path, as hardening (on
    Linux the old JS helper did not show the bug through a linked directory; each helper has a test
    through a link). `.gitattributes` keeps LF everywhere except `conformance/specs/a-rules.bindings.txt`,
    which tests CRLF bindings and is `-text`. The byte-comparing checks (build.mjs --check, both
    conformance runners, docs-check, the notices check) read `\r\n` as `\n`, except that bindings
    fixtures are passed as they are.
95. **The server retries its previous port** (v0.2.2, coordinator; §5.1). A just-released port can stay
    unbindable for a moment (TIME_WAIT on Windows, where Go sets no SO_REUSEADDR), so listen tries the
    preferred ports 15 times, 100 ms apart, before a random port. Keeping the port stays a best effort:
    TestPortReuseStartRaceAndWatchdog logs a fallback on Windows instead of failing.
96. **Line drift is not staleness** (v0.2.2, coordinator; §8). `make selfcheck` compared the edges files
    byte for byte, so six lines added to server.go failed CI on locations alone. It now compares edges as
    `caller -> callee  # file` and every comment line: a new or removed edge, the same edge in a new file
    (it may need its own explanation) or a changed note is stale; line numbers and "(+N more)" are not,
    and a note says to refresh them. *Red team*: an edge whose only location moved to a different
    function in the same file passes unseen; the edge itself, and whether it is allowed, did not change.
97. **The viewer is a full HTML document** (v0.2.3, coordinator). viewer/src/index.html starts with the
    `@sbtel file App.Page` comment, then `<!doctype html>`, `<html lang="en">`, `<meta charset>` and a
    device-width viewport. Before, the page ran in quirks mode and phones laid it out 980 px wide unless
    the host (the claude.ai artifact) added a viewport; accept5, accept6 and the diff viewer test
    prepended one. They now load the page as it is, and every suite passes unchanged, so nothing relied
    on quirks mode. The comment stays first because sbtel_owners.py would count a doctype above it as
    code in no block; a comment before the doctype does not trigger quirks mode (`document.compatMode`
    is `CSS1Compat`, which accept9 checks). The stray `// @sbtel begin Viewer.Boot` above `<script>`,
    which the page drew as text under the canvas, is now an HTML comment: the transparent embed showed it.
98. **A home link in the playground only** (v0.2.3, user decision). "sbtel" in the brand chip is a link,
    underlined with a small ↗ on hover (always shown at 70% on touch), at `<meta name="sbtel-home">` or
    `https://shashi.biz/sbtel/`. Server and diff mode are a local tool and keep the plain word.
99. **Viewer.Play, a mode module for the standalone page** (v0.2.3). Boot already runs
    `SBTEL.modes[SBTEL.mode].boot()`; registering `standalone` keeps the URL parameters, embed mode and
    the home link in one file beside server.js and diff.js, with Boot's fallback unchanged. New block
    `Viewer.Play` in "Page modes" (examples/viewer.sbtel) and `Sbtel.Viewer.Play` (examples/sbtel.sbtel);
    14 new edges, all downward (186 bindings, 10 explained violations as before).
100. **Two small hooks in the app** (v0.2.3). `loadPrefs(key)` (App.Document) reads settings and
    comments under a key suffix, from the defaults, and `persist`/`saveComments` write under it;
    `fitPad` (App.Camera) holds the room `fit` leaves for the chrome. These are edits to index.html
    beyond Viewer.Mode (§6.5's rule is for the mode modules); standalone keys and margins are unchanged.
101. **Keys by the hash of the initial text** (v0.2.3, user decision). Two demos of different specs,
    a demo and the playground, and an embed and the same spec opened in the playground ("Open in
    playground ↗") each get their own history, settings and comments. The hash is 64 bits (cyrb53's
    mixing, both halves), not App.Kit's 32-bit `hash`, since many demos share one origin. *Red team*:
    two pages with the same spec in embed mode share a history; that is the same demo.
102. **Wheel only once the frame is live** (v0.2.3, user decision). A frame that zooms on the wheel traps
    a reader scrolling past it. The frame goes live on a click, a tap or focus, and idle again on blur;
    until then the wheel goes to the page (Chrome chains it out of a frame that does not scroll) and a
    hint says how to start. Touch: a swipe on an idle frame scrolls the page.
103. **Embed backgrounds** (v0.2.3). Transparent when the theme follows the system, so the demo sits on
    the docs page's card; the theme's canvas colour when `&theme` fixes it, since a forced dark demo on a
    light card would otherwise draw light text on light paper.
104. **Embeds fit what is drawn** (v0.2.4, user request). A docs example is usually one block with
    levels and a message band, tall and narrow; fitted with the full app's margins to the layout's canvas
    width, it came out at 40-55% in a docs frame and was hard to read. Embed mode now fits `contentBox`
    (a pure function of a layout in Core.Layout, so the website's build can run the same rule in node),
    with a 12 px edge, room for the dock, and no zoom past 1.
105. **The frame reports its natural size; the page sizes the frame** (v0.2.4, user request). The page
    knows its column width and how tall a frame may be; the viewer knows its diagram. `sbtel:size`
    carries the size at zoom 1, and the host sets the height. The target origin is fixed at `'/'`
    rather than `'*'` or a configured list: the docs and the playground are served together, and a size
    is still information about the page's content, so other origins get nothing.
106. **`&focus=<Block>`** (v0.2.4, user request). A demo about one part of a larger spec can fit that
    block: the camera and the reported size use its card; the rest of the file is still there to pan to.
107. **`sbtel export`, a file and not a URL** (v0.2.5, user request; §3.14). A shareable diagram had to be
    `play/?embed#src=<base64url>` on someone's server, or a session on the author's machine. A spec of a
    few hundred lines is tens of KB of base64 in a URL, which mail clients and chat tools wrap or cut;
    an inert `<script type="text/sbtel">` block in the page has no such limit, keeps the spec readable
    in the file, and needs no hosting. The page is the one `open` serves (no second build), so an
    export is always the binary's own viewer. The blocks replace the `<title>` line, which build.mjs
    keeps fixed, and a Go test and accept12's `builtFromThisPage` check that nothing else changed.
108. **The escape is HTML's, undone by hand** (v0.2.5). Script text is raw: the parser decodes no
    entities in it, ends it at `</script` and can be thrown into its "escaped" states by `<!--`. Writing
    `&` and `<` as entities removes every `<`, so none of that can happen whatever the spec holds, and
    the text stays readable; play.js decodes the same two entities and numeric references. CR and NUL
    are escaped too, because the parser rewrites them in any text. base64 was rejected: a third larger,
    and unreadable for a reader who opens the file in an editor. A `<template>` or `<textarea>` would
    decode entities by itself, but changes CRs and is less obviously inert. The JSON block is safe by
    encoding/json's own escaping.
109. **`-o`, one short flag** (v0.2.5, user request). §3.1 says flags are long only; `export` takes `-o` as
    its users expect from compilers and converters, rewritten to `--out` before `parseArgs`, so the one
    parser is unchanged and `--out` works too. No other command gains a short flag.
110. **A parse error is exit 2; problems are not fatal** (v0.2.5, user request). §3.1's "a spec does not
    parse" is 1 for commands that report on specs; `export`'s output is a file, and with a parse error it
    cannot make one, as `diff` cannot make a diff (§3.6). Warnings, check failures and binding violations
    are printed and the file is written, as `open` opens a spec with problems (entry 13): the page shows
    them too. Explained violations are not repeated on stderr one by one (only check's summary): an
    export of examples/viewer.sbtel would print twenty lines that say nothing is wrong.
111. **Read-only in the full viewer; comments allowed** (v0.2.5). `--readonly` needed the read-only of
    `?embed=readonly` without the embed layout, so it moved out of `embed()` into `readonlyMode()`, which
    filters the app's own menu and strip (dropping items that edit: those with an edit action, Edit and
    Delete; and Edit, Delete and Cut buttons) instead of building a fixed one. In embed layout the result
    is what it was (accept9 unchanged); in the full layout Comment and the message table stay, because a
    comment is the reader's own note and changes no spec. The source textarea is read-only too.
112. **bindings.js** (v0.2.5, §6.5). The bindings view (one more check, the popover's Bindings section,
    `behaviorUsers`) was server.js's; an exported page needs it without a server, so it moved, unchanged,
    into viewer/src/bindings.js (block `Viewer.Bindings`, beside Viewer.Session below the page modes),
    called by server.js and play.js, rather than play.js calling into server.js, a peer. The include is a
    new line in index.html outside Viewer.Mode, as the other module includes are; build.mjs's list of
    required includes and tools/selfcheck/edges.mjs's file list name it. New edges: Viewer.Server and
    Viewer.Play → Viewer.Bindings, and Viewer.Bindings → App and Core, all downward (193 edges, 10
    explained violations as before).
113. **The exported page's links** (v0.2.5, user request to decide). The home link stays (to the project's
    page, in a new tab): the reader of a shared file is the person most likely not to know what sbtel is.
    Open in playground would send the spec to the public playground (in a hash, so not to the server, but
    to a page the author did not choose), so in an export it is Open full view: the same file at
    `?embed=off`, which is why that value exists. `__api.topBlocks` was added for the default title so
    the CLI does not read the unstable `parseSpec` model. Sbtel.Cli.ExportCommand is a new block in
    examples/sbtel.sbtel beside the other commands; it binds Sbtel.Cli.Kit, Sbtel.Engine and Sbtel.Assets
    (all lower) and avoids cmd_b.go's helpers, a peer's.
114. **Ports are named after their type** (v0.3.0, owner decision; breaking). `(port name in Type)`
    repeated the type in the name most of the time (`(port edit in Edit)`), so 0.3 writes
    `(takes Type)`, named `type` (first letter lowercased), with `:as name` only to tell two ports
    apart. The rule is `defaultPortName` (core.js): lowercase the first code point of the type's name;
    for a qualified type the last component after `.` or `:`; for a parameterized one the head before
    `<` or `[`; a behavior parameter `T` gives `t` at the declaration, not after substitution, so a
    port's name never depends on its implementer. The viewer's `portNameFor` (Shift-attach, Add port)
    uses the same function, so a port the viewer adds is written without `:as` whenever it can be. The
    model keeps `node.as` (as written, or null) and `name` (effective); everything downstream (anchors,
    query, diff, `dotsOf`, the editors) uses `name`. The 0.2 form is still read, as it meant, with a
    warning that gives the exact 0.3 text, so an old spec draws and `sbtel fmt --migrate-ports` (§3.15)
    can rewrite it; the viewer rewrites a 0.2 port whenever an edit touches the block's ports. Clashes
    (own, own vs inherited, inherited vs inherited) moved from api.js's form walk into the core
    (`portClashes`), so the viewer shows them and drags that would create one are refused. Renaming a
    shape renames its implicit ports; that is the rule's point (the name is the type), so the
    viewer does not add `:as` to keep the old name. `portLabel` shows `name: Type` only when the name is
    not the default one.
115. **Explained violations fail nothing in the viewer** (v0.3.0, owner request). A spec whose every
    binding violation was explained showed "✕ 1 failing", which read as broken. The bindings check's
    failures are now its unexplained violations and invalid lines; explained ones are counted
    (`explained`) and the pill says "◦ N explained" in a neutral style (§6.3). `sbtel check`'s exit
    code is unchanged: 1 for any violation, explained or not (LANGUAGE.md §8).
116. **A deterministic overwrite-prompt e2e step** (v0.3.0). The step wrote the session's own spec file
    and then pushed it; the server's disk poll (every 2 s, §5.4) sometimes ran in between, recorded the
    version as a disk change, and the push became a no-op (same bytes, same path), so the prompt named
    the wrong cause. The agent now writes its version to a new file and pushes that path: the poll
    watches only the session's current path, so it cannot see the new bytes before the push switches the
    path and sets the base under the server's lock. The rest of e2e.js uses the new file. What the step
    checks is unchanged.
