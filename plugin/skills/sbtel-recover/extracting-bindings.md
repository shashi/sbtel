# Extracting bindings from code

sbtel is language-neutral, and so is this guide. Every tool below is **if available**. Use what the
project already has, prefer the compiler's own view over text search, and never add a dependency to
the user's project just to draw edges. Write throwaway scripts in a scratch directory, not in the
repository.

## Contents

- What counts as a binding
- The pipeline
- With an import graph
- No import graph? Resolve symbols
- Go
- Fallback: ctags and scoped search
- Tools by ecosystem
- Collapsing to one line per caller, callee and file
- Precision checklist
- The helper scripts

## What counts as a binding

Code in block A **binds** block B when it names something owned by B:

- an import, require, include or `use` of B's module;
- a call, a construction or a reference to a type, function, constant or variable owned by B;
- a type-only import or annotation (it still names B);
- inheritance from B's class (it names B);
- replacing or wrapping B's function (`render = myRender`): the code names B's declaration.

These are **not** bindings: A and B exchanging data through a port-like mechanism (a queue, an event
bus, HTTP, a callback or parameter that a third party supplies, a string-keyed registry), where
neither names the other. Those are messages.

An interface, trait or protocol that a behavior stands for is annotated with the behavior's name. If A
calls through behavior X's interface, the binding is `A -> X`, not A to whichever block implements it
(`check`'s `abstraction` rule allows it when X is in A's scope). A's own implementation of X (`class A
implements X`, `impl X for A`, Go's `var _ X = (*A)(nil)`) is **not** a binding: it is the spec's
`(implements X)`. The reference helpers mark those references with a third column, `implements`
(`from to<TAB>name<TAB>implements`), and `sbtel_owners.py --edges` checks them against the spec
instead of printing an edge; write the column yourself for a language without a helper. The code of the
interface's own declaration binds nothing: its signature is the behavior's ports.

## The pipeline

1. **Ownership.** Map every file and line to a block, from the `@sbtel` annotations
   (`sbtel_owners.py`).
2. **References.** Get `from_file:line to_file:line` pairs from the best tool available: a module
   graph gives file to file, a compiler or language server gives declaration to declaration.
3. **Edges.** Map both ends to their owners and drop pairs where A = B: `sbtel_owners.py --edges`
   writes `A -> B  # from_file:line`, one per location.
4. **Collapse** to one line per caller, callee and file (below).
5. **Check.** Run `sbtel check spec.sbtel --bindings edges.txt`, and read every violating edge's lines.

## With an import graph

A file-level graph (imports) is a sound start when the code has modules. Each import line names the
imported module, and its owner is usually the `@sbtel file` block of the target: point each import at
line 1 of the imported file. Refine it with symbol-level references when one file holds several
blocks.

```sh
# Example for a JS project with madge (if available): madge prints {"a.js": ["b.js", ...], ...}
madge --json src | python3 -c '
import json, re, sys
g = json.load(sys.stdin)
for a, bs in g.items():
    src = open("src/" + a).read().split("\n")
    for b in bs:
        stem = re.escape(b.rsplit(".", 1)[0].split("/")[-1])
        for n, line in enumerate(src, 1):
            if re.search(r"(import|require).*[\x27\"/]" + stem + r"(\.\w+)?[\x27\"]", line):
                print("src/%s:%d src/%s:1" % (a, n, b)); break
'
```

## No import graph? Resolve symbols

Some code has no imports to follow: one global script, files that the build concatenates or inlines
into one page, legacy JS with globals, shell scripts that `source` each other, C unity builds, PHP or
Perl that `include`s into one namespace, and **the files of one Go package**, which share one
namespace and never import each other (see Go, below). An import graph is empty or meaningless there, and text
search on names like `render` or `state` gives plausible garbage. Resolve every identifier with the
compiler or a language server instead:

1. **Load the code the way the build does.** If the build concatenates files, give the tool all of
   them as one program, so a name used in one file resolves to its declaration in another. Inline
   `<script>` in HTML counts as code. Where build constraints pick files (Go's `_windows.go` and
   `//go:build`, C's `#ifdef`, Rust's `#[cfg]`), load once per platform and tag set and merge the
   results, or the files the current platform skips have no edges at all.
2. **Resolve every identifier to its declaration.** Keep a reference when the declaration is in
   another top-level unit (a top-level statement, or a statement directly inside a top-level
   immediately invoked function) or another file. Drop the rest: they are inside one unit, so inside
   one block.
3. **Print `from_file:line to_file:line` pairs** and feed them to `sbtel_owners.py --edges`.
4. **Add what the resolver cannot see**, each resolved by hand or by a tiny script you can show:
   DOM ids (`getElementById('x')` to the element with `id="x"`), string-keyed dispatch, reflection.

Per ecosystem, in order of preference:

| Code | Resolver |
|---|---|
| JS / TS, including global scripts and HTML | the TypeScript checker: `scripts/sbtel_refs.mjs` (below), or tsserver / typescript-language-server "find references" |
| Go | `scripts/sbtel_refs_go` (below: go/types, every GOOS, types and fields as well as calls); `gopls references` one position at a time |
| Python | pyright (`pyright --outputjson` with a small driver, or its LSP), jedi `Script.get_references` |
| C / C++ | clangd with `compile_commands.json` (find references), or libclang cursors |
| Rust | rust-analyzer (LSP "find references", or `rust-analyzer scip` for an index) |
| Java / Kotlin | jdtls, or an IDE call hierarchy |
| Shell | read it: `source` lines give file edges; functions are few enough to resolve by hand |

`scripts/sbtel_refs.mjs` (if Node ≥ 18 and the `typescript` package are available; it looks in the
current directory, then `npm root -g`, or takes `--typescript DIR`):

```sh
FILES="core/core.js viewer/src/index.html viewer/src/server.js"
node scripts/sbtel_refs.mjs $FILES > refs.txt                  # one line per reference
python3 scripts/sbtel_owners.py spec.sbtel $FILES --edges < refs.txt > edges.raw
node scripts/sbtel_refs.mjs --units $FILES | python3 scripts/sbtel_sccs.py   # the SCCs (granularity.md)
```

It also handles ES modules and CommonJS (each import or require of a project file is an edge to
line 1 of that file), `-p tsconfig.json` for a TypeScript project's own files and options, and
`--no-props` to count plain identifiers only. It cannot see calls through untyped values (a JS
parameter has no type), string-keyed dispatch, DOM ids or CSS classes. Say so in the report.

A DOM-id pass in the same spirit, for a page whose markup is above its script:

```sh
python3 - index.html <<'PY'
import re, sys
f = sys.argv[1]; L = open(f).read().split('\n')
ids = {m.group(1): i for i, l in enumerate(L, 1) for m in re.finditer(r'\bid="([^"]+)"', l)}
for i, l in enumerate(L, 1):
    for m in re.finditer(r"""getElementById\(\s*['"]([^'"]+)['"]\s*\)""", l):
        if m.group(1) in ids and ids[m.group(1)] != i:
            print('%s:%d %s:%d' % (f, i, f, ids[m.group(1)]))
PY
```

## Go

A Go package is the no-imports case: its files share one namespace, so the import graph only connects
packages, and Go forbids import cycles, so package-level SCCs are always empty. The structure worth
recovering is inside the packages: which files and declarations name which. In practice a struct is
declared in one file and its methods live in others, so expect knots there, and violations where a
struct names a type from a higher block.

`scripts/sbtel_refs_go` is a small standalone Go module (standard library only; it needs the Go
toolchain and nothing else). It runs `go list -deps -export` once per GOOS (default linux, darwin and
windows) and per `--tags` set, type-checks the module's non-test files with go/types, and prints every
reference that crosses a top-level declaration, in the format of `sbtel_refs.mjs`: calls, but also
types (a field of type `*T`, a conversion, a composite literal), struct fields (`x.f`, `T{f: 1}`),
methods, constants and variables. Run it from the module's root:

```sh
H=path/to/sbtel-recover/scripts
go -C $H/sbtel_refs_go run . --dir "$PWD" ./... > refs.txt            # add --tags a,b per tag set
python3 $H/sbtel_owners.py spec.sbtel $(git ls-files '*.go' | grep -v _test.go) --edges < refs.txt > edges.raw
go -C $H/sbtel_refs_go run . --dir "$PWD" --units ./... | python3 $H/sbtel_sccs.py --by-file
```

- Take the SCCs **within each package**, at file level (`--by-file`) and at declaration level: those
  are where the knots are. A package-level graph has none by construction.
- `callgraph` (golang.org/x/tools) sees calls only. A struct field that holds another block's type is
  a binding too, and it is often the one violation that matters; the helper sees it.
- `gopls references` answers one position at a time, and gopls may not install at all behind a proxy
  or offline (`go install` needs golang.org). The bundled helper is the fallback that always works
  where `go build` does.
- What it cannot see: calls through an interface reach the interface's method, not its
  implementations (net/http calling your `ServeHTTP` names no block of yours); reflection; `go:embed`
  targets; cgo files. Add those edges by hand where they matter, and say so.
- Annotations: put `// @sbtel file Name` before the `package` clause (after any `//go:build` line), with
  a blank line before the package doc comment, so godoc does not include it.

**Elsewhere** the unit of no-imports code differs: a **Rust** crate's modules see each other through
`use crate::...` paths, so `cargo modules` gives a module graph, but `impl` blocks for one type spread
across modules the way Go methods do; a **Python** package imports module by module, but
`from . import *` and `__init__.py` re-exports blur it, so resolve names rather than imports; a
**Java** package is like a Go package (classes in one package need no import), so resolve symbols
within it and use imports only between packages.

## Fallback: ctags and scoped search

Only when no compiler or language server can be run. Flag it in the edges file and in the report
("edges from ctags and rg, each verified by reading its line"), because it is text matching:

1. `ctags -R --fields=+nK -f tags .` (universal-ctags) lists the definitions with their kinds and
   lines; keep the top-level ones.
2. For each definition name, search only where it can be visible (its file and the files loaded
   after it, or its package): `rg -nw --no-heading NAME scope/`.
3. Drop hits in comments and strings, local variables or parameters with the same name, property
   names (`x.render`) and shadowed names.
4. **Read every remaining line** before you write it as an edge. Keep only those you confirmed, and
   note the names you skipped as ambiguous (`init`, `state`, `render` defined in several places).

## Tools by ecosystem

All of these are optional, so check first (`command -v tool`).

| Ecosystem | Module graph | Symbol references or call graph |
|---|---|---|
| Any | `rg -n '^\s*(import\|from\|require\|use\|include\|#include)'`; universal-ctags (`ctags -R --fields=+n`) for definitions | an LSP's "find references" (Claude Code's LSP tool, gopls, pyright, typescript-language-server, rust-analyzer, clangd, jdtls) |
| Go | `go list -deps ./...`; `go list -f '{{.ImportPath}}: {{join .Imports " "}}' ./...` | `scripts/sbtel_refs_go` (go/types; types, fields and calls, every GOOS); `gopls references`; `callgraph` (calls only) |
| Python | `pydeps --show-deps --no-output pkg`; `grimp`; `import-linter` (it has level contracts of its own) | `pyan3`, pyright or jedi references |
| JS / TS | `madge --json src`; `dependency-cruiser --output-type json src` | `scripts/sbtel_refs.mjs` (the TypeScript checker), `tsserver` references |
| Java / JVM | `jdeps -verbose:class target/classes` | ArchUnit, an IDE call hierarchy, jdtls |
| C# / .NET | project references in `*.csproj`; `dotnet list reference` | Roslyn analyzers, an IDE "find all references" |
| Rust | `cargo tree`; `cargo modules dependencies` | rust-analyzer references |
| C / C++ | `cc -MM` or `clang -MM` (includes); `compile_commands.json` with clangd | `cflow`, clangd references |
| Elixir | `mix xref graph --format plain` | `mix xref callers Mod` |
| Ruby | `rg` on `require` and constant references | Solargraph or ruby-lsp references |
| Shell, SQL, configs | `rg` for sourced files, table names and keys | read them |

Map module names to files with the tool's own output, or the language's resolution rules. Don't guess
from names that merely look alike.

## Collapsing to one line per caller, callee and file

`sbtel_owners.py --edges` prints one line per location, which can be a thousand lines. `sbtel check`
judges each line on its own, so collapse them to one line per caller, callee and file: the first
location, and a count of the others. Keep the full list (`edges.raw`) to read the violating locations.

```sh
python3 - edges.raw > edges.txt <<'PY'
import re, sys
seen = {}
for l in open(sys.argv[1]):
    m = re.match(r'(\S+) -> (\S+)\s+# (\S+):(\d+)', l)
    if m: seen.setdefault(m.groups()[:3], []).append(int(m.group(4)))
for (a, b, f), ns in seen.items():
    print('%s -> %s  # %s:%d%s' % (a, b, f, min(ns), ' (+%d more)' % (len(ns) - 1) if len(ns) > 1 else ''))
PY
```

Then explain each violation with a `# VIOLATION: reason` line directly above its edge (no blank line
between; more comment lines continue the reason). `sbtel check` prints the reason under the violation
and counts the explained ones, and warns about a note that explains no edge or sits on an allowed
edge; `sbtel open --bindings` shows the reason beside the violation in the checks popover. If you
regenerate the file, carry the explanations over by caller, callee and file.

## Precision checklist

- **Resolve, don't match text.** `rg 'Store'` finds comments, strings and other things named Store.
  Use it to *find* candidates, then confirm each one in the code or with a resolver.
- **Tests, generated code, vendored code.** Exclude them, or give them their own blocks. Tests
  binding everything are expected, and they would drown the real edges.
- **Dynamic dispatch, dependency injection, reflection, plugins and string-keyed registries** are
  invisible to static tools. Find the registration sites, and decide whether they are bindings (a
  concrete class is named) or messages (a key or interface is named).
- **Re-exports and barrel files** (`index.ts`, `__init__.py`, `mod.rs`) hide the real target. Follow
  them to the declaring file.
- **Every edge needs a location** that a reviewer can open. If a tool reports only file-level edges,
  find the import line.
- **Read every violating edge's lines** before you explain it or change the spec.
- **Say what you didn't cover**, such as languages, directories or dynamic paths, in the edges file's
  header and in your summary to the human.

## The helper scripts

All in `scripts/`, all optional:

- `sbtel_owners.py` (Python 3.8+, standard library only) checks the annotations and maps reference
  pairs to edges, for any language with line comments;
- `sbtel_sccs.py` (Python 3.8+) prints the SCCs and the condensed levels of any edge list;
- `sbtel_refs.mjs` (Node ≥ 18 and the `typescript` package) resolves JS and TS references;
- `sbtel_refs_go/` (the Go toolchain) resolves Go references with go/types, for every GOOS and tag
  set (Go, above). Its tests: `go -C scripts/sbtel_refs_go test .`.

```sh
# Check the annotations and print ownership: file<TAB>start<TAB>end<TAB>block
python3 scripts/sbtel_owners.py spec.sbtel $(git ls-files 'src/*')

# Turn reference pairs into edges (one "from_file:line to_file:line" per stdin line)
some-reference-dump | python3 scripts/sbtel_owners.py spec.sbtel $(git ls-files 'src/*') --edges > edges.raw
sbtel check spec.sbtel --bindings edges.txt
```

`sbtel_owners.py` accepts every form in annotations.md: `@sbtel Name`, `begin`/`end`, `file`, and the
anchors `@sbtel message Name` and `@sbtel port Block.port`, which own no code. It reports unknown
block names, anchors naming an unknown shape or port, unmatched `begin`/`end`, regions that
never end, code in no block, code owned by a container block, two `@sbtel Name` lines before one
declaration, a second `@sbtel file` in a file, and any other `@sbtel` text. It ignores `@sbtel` inside
string literals, and keeps the lines of a multi-line string literal (a Go or JS backtick string, a
Python triple-quoted one) in their declaration whatever their indentation. Its tests
are `scripts/test_sbtel_owners.py`. It finds "the next declaration" for `@sbtel Name` by indentation
(the head line, deeper lines, and a closing `}` or `end` at the same indentation), skipping
decorators. Check its ranges where your code is formatted unusually.
