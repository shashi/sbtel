# sbtel plugin for Claude Code

Skills for working with [sbtel](https://github.com/shashi/sbtel). sbtel is a language to design,
understand, and collaborate on a system's architecture with AI: nested blocks in ordered levels, the
messages between them and the behaviors they share. The `sbtel` CLI checks specs and serves a live
diagram that the human edits and comments on.

| Skill | Use it for |
|---|---|
| `sbtel-language` | reading, writing and fixing `.sbtel` specs; the `lint`, `query` and `check` commands; the review loop with the human (`open`, `inbox`, apply the proposed spec, `open --session`, `reply`) |
| `sbtel-design` | designing or restructuring a system as a spec (levels of language, one strand per block, no more words than needed), with a red-team checklist |
| `sbtel-recover` | recovering a spec from existing code: the reference graph and its SCCs, blocks and levels, annotating with `@sbtel`, extracting bindings, running `sbtel check` and explaining each violation |

## Setup

The skills drive the `sbtel` binary. Install it with:

```sh
curl -fsSL https://raw.githubusercontent.com/shashi/sbtel/main/install.sh | sh
```

On Windows, use `irm https://raw.githubusercontent.com/shashi/sbtel/main/install.ps1 | iex`. Then
install the plugin:

```
/plugin marketplace add shashi/sbtel
/plugin install sbtel@sbtel
```

`sbtel-recover` ships four optional helpers in `skills/sbtel-recover/scripts/`:
`sbtel_owners.py` (Python 3.8 or later) checks `@sbtel` annotations and turns code references into
edges; `sbtel_sccs.py` (Python 3.8 or later) finds the groups of mutually dependent code and their
levels; `sbtel_refs.mjs` (if Node 18+ and the `typescript` package are available) resolves
JavaScript and TypeScript references, including code with no imports at all; and `sbtel_refs_go/` (a
standalone Go module that needs only the Go toolchain) resolves Go references for every GOOS.

License: MIT (see the repository's LICENSE).
