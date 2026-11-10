---
name: sbtel-recover
description: Recover an sbtel architecture spec from an existing codebase (code to sbtel). Survey the code, get its reference graph, find the groups of mutually dependent code, propose blocks and levels, annotate the source with // @sbtel markers, extract who-names-whom into an edges.txt, and run sbtel check until it is clean or every violation is explained. Use when the user wants to map, document, reverse-engineer or audit the architecture of existing code with sbtel, or asks whether code respects a spec's levels.
---

# Recovering a spec from code

Use the sbtel-language skill for syntax and commands, and the sbtel-design skill for what makes a
good spec. This skill is about being **faithful to the code that exists**. The detail is in three
reference files: [granularity.md](granularity.md) (SCCs, block sizes, levels),
[extracting-bindings.md](extracting-bindings.md) (references and edges, with or without an import
graph) and [annotations.md](annotations.md) (the forms, existing annotations, moving ownership).

## Rules

- **Don't invent architecture that the code doesn't have.** Every block maps to real code: a
  directory, a package, a module, a file or a group of declarations. Every level and adjacency follows
  real dependencies. Put proposals for change in a separate spec or a `;` comment, never in the
  recovered one.
- **Record a real violation as a violation.** When the code binds upward or across a level, keep the
  levels that the code mostly follows, and leave the offending edge in edges.txt with a
  `# VIOLATION:` note. Never reorder levels, add adjacency, merge blocks, invent a message or move an
  annotation just to make `sbtel check` pass. Moving an annotation is a fix only when the declaration
  really belongs to the other strand (annotations.md says how to tell); otherwise it is gaming the
  check, and it is forbidden.
- **Existing `@sbtel` annotations are a hypothesis**, not the answer. Verify each one against the
  code, and report which you kept, changed or removed. For a blind or independent recovery, strip
  them before you read the code (annotations.md).
- **Accuracy over coverage.** Every edge carries a location (`# path:line`). A short list of edges you
  verified beats a long list you guessed. Never draw edges from text matches alone. Say what you did
  not cover.
- **Record what the code makes evident, in the fewest words.** Give a level a `:name`, or a level,
  port or adjacent group a sketch, only when the code makes it evident (a package doc, a directory, a
  README section, a type's comment); never invent one. Record `(carries …)` only where the code's data
  types really contain one another. Give each block a `:type` naming the kind of code artifact it maps
  to (`"Package"`, `"File"`, `"Function"`…), consistently. Name each block as the code names the thing: a
  directory or file by its path from the repository root (`internal/server/`, `cmd/sbtel/main.go`), a
  package, type or function by its own name. Do not turn paths into CamelCase. One sentence per sketch; none where the
  structure already says it.
- **Ask before mass edits.** Annotating means editing many source files (comment lines only). Confirm
  the scope with the user first, and keep the annotations in their own commit when they want commits.

## Procedure

1. **Survey.** Read the layout, the build files, the entry points, the README and the docs. Note the
   languages, the existing module boundaries, and how the build assembles the code: separate modules,
   or files concatenated or inlined into one script. Deal with existing annotations now (Rules).
2. **Get the reference graph, mechanically.** Use the compiler's or the language server's view: an
   import graph where there is one, symbol references where there is not (one global script,
   concatenated files, `source`d shell, unity builds). extracting-bindings.md has a recipe for each,
   and `scripts/sbtel_refs.mjs` does JS and TS if Node and TypeScript are available, and
   `scripts/sbtel_refs_go` does Go with the Go toolchain alone (every GOOS, types and fields as well
   as calls; a Go package is a no-imports namespace). Text search
   (ctags, `rg`) is a flagged fallback, and every edge it gives must be verified by reading its line.
3. **Find the groups of mutually dependent code** (the strongly connected components of the graph)
   before choosing any block: `scripts/sbtel_sccs.py`. An SCC is at most one block; splitting it
   costs at least one violation. In Go, take the SCCs of files within each package (granularity.md). See granularity.md for sizes and for signs a block is too fine or too
   coarse.
4. **Find the strands.** For each candidate block, write one sentence on what it is for. A sentence
   that needs "and" is braided; record that, but don't fix it here.
5. **Propose blocks and levels.** Leaf blocks map to code; container blocks group them. Derive the
   levels from the dependency direction of the condensed graph (`sbtel_sccs.py` prints it), then merge
   or split until the levels hold with few, explainable violations. A cycle between peers is
   either a real cooperation (make it `adjacent`, with the reason in the group's sketch when the code
   states it) or a violation (keep it as one). Model as **messages** only what crosses without naming a counterpart: events, queues,
   HTTP routes, a registry, a callback or parameter whose implementation must stay open. Model shared
   properties (pure, durable) as **behaviors**. Declare each message type and behavior in the lowest
   block that holds its users; `sbtel lint`'s placement notes say where. Run `sbtel lint` until it is
   clean.
6. **Annotate the code** with comment lines in the code's own syntax (annotations.md): `@sbtel file`,
   `begin`/`end`, `@sbtel Name`, and optionally the anchors `message` and `port`. Annotate leaf
   blocks only. If Python 3 is available, `scripts/sbtel_owners.py spec.sbtel FILES` checks them.
7. **Extract the bindings.** Turn the references into `A -> B  # path:line` edges with
   `sbtel_owners.py --edges`, then collapse them to one line per caller, callee and file
   (extracting-bindings.md).
8. **Check**: `sbtel check spec.sbtel --bindings edges.txt`. Read every violating edge's lines. For
   each, decide:
   - the spec is wrong (you misread the structure): fix the spec, and say why;
   - the code breaks its own structure: keep the edge, put a comment line directly above it
     (`# VIOLATION: Store refreshes the UI directly; should emit Changed`), and add a `;` note at the
     block in the spec.

   Repeat until the check is clean, or every remaining violation is explained: `sbtel check` prints
   each reason under its violation, ends with `N not allowed, N explained` (the two numbers must be
   equal), and warns about a note that explains no edge or sits on an allowed one (remove it). A changed spec means
   regenerating the graph's SCCs and levels, not only the edges.
9. **Open it for the human**: `id=$(sbtel open spec.sbtel --bindings edges.txt)`. The checks popover
   lists the violations with their `# VIOLATION:` notes. In chat, report the strands, the levels, how
   the edges were extracted (which tool, what was not covered), the violations with your
   explanations, and the existing annotations you kept or changed. Then iterate on comments, as in the
   sbtel-language skill.

## Calls through an abstraction

When code calls through an interface, trait or protocol, model the abstraction as a **behavior** and
annotate its declaration with the behavior's name (`// @sbtel Durable` above `type Durable
interface`, `interface Durable`, `trait Durable`, a JSDoc `@typedef`); give the behavior a `:type`
saying what it is in code (`"interface"`, `"trait"`). The caller then binds only the behavior
(`Editor -> Durable`, allowed by `check`'s `abstraction` rule when Durable is in the caller's scope),
the implementers say `(implements Durable)`, and the composition root, the code that builds the
implementer and hands it over, binds the implementers. That is the dependency-inversion shape, and
`check` now holds it. The helpers tag a reference that only states an implementation (`implements
Durable`, Go's `var _ Durable = (*Store)(nil)`, an embedded interface) and `sbtel_owners.py` checks it
against the spec's `(implements …)` instead of making it an edge; for Rust's `impl Durable for Store`,
add the `implements` column yourself (extracting-bindings.md). Declare the behavior where its callers
can see it, even when lint notes it could live beside its implementers: lint does not read bindings.

## Done when

- `sbtel lint spec.sbtel` is clean;
- every leaf block maps to annotated code, and the annotation checker reports no errors;
- `sbtel check` is clean, or its summary says `N not allowed, N explained` with equal numbers and it
  prints no warning;
- the human has seen it, and their comments are answered. With no human in the loop (a headless or
  scheduled run), say so in the report, list the open questions you would have asked, and leave the
  `sbtel open` command for them to run.
