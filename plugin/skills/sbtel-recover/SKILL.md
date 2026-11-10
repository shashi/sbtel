---
name: sbtel-recover
description: Recover an sbtel spec from an existing codebase and check the code against it. Survey the code, get its reference graph, find mutually dependent groups, propose blocks and levels, annotate the source with @sbtel markers, extract who-names-whom into edges.txt, and run sbtel check until it is clean or every violation is explained. Use when the user asks to map, understand, document or audit existing code with sbtel, or to verify that code matches a spec.
---

# Recovering a spec from code

Syntax and the review loop: sbtel-language. What makes a design good: sbtel-design. This skill is
about being faithful to the code that exists. Detail: [granularity.md](granularity.md),
[extracting-bindings.md](extracting-bindings.md), [annotations.md](annotations.md).

## Rules

- Every block maps to real code; every level and adjacency follows real dependencies. Proposals for
  change go in a separate spec.
- A real violation stays a violation: keep the levels the code mostly follows, and mark the edge with
  `# VIOLATION: reason`. Do not reorder levels, add adjacency, merge blocks, invent a shape or move an
  annotation to make `sbtel check` pass.
- Existing `@sbtel` annotations are a hypothesis. Verify each; report what you kept, changed, removed.
- Every edge has a location (`# path:line`). No edges from text matches alone. Say what you did not cover.
- Name a block as the code names the thing: a path for a directory or file, its own name for a
  package, type or function. `:type` on every block that maps to code, consistently.
- A level name or a sketch only where the code states it (a package doc, a README section).
- Ask before annotating: it edits many source files (comment lines only).

## How deep

Recover to the depth the task needs (sbtel-language, "What a view shows"). Default: directories and
packages at the top, files as leaves. Go to declarations only inside the block the task is about. A
strongly connected group of files is one block, whatever the directories say.

## Procedure

1. **Survey**: layout, build files, entry points, README. Note how the build assembles the code.
2. **Reference graph, mechanically**: the compiler's or language server's view. `scripts/sbtel_refs.mjs`
   (JS, TS), `scripts/sbtel_refs_go` (Go); other languages in extracting-bindings.md. Text search is a
   flagged fallback, each edge verified by reading its line.
3. **Mutually dependent groups first**: `scripts/sbtel_sccs.py`. One group is at most one block.
4. **Strands**: one sentence per candidate block. Record one that needs "and"; do not fix it here.
5. **Blocks and levels**: levels from the direction of the condensed graph (`sbtel_sccs.py` prints it).
   Then count: a bottom-level block is used by most of what is above it; one used by a single block
   belongs inside that block. A cycle between peers is `adjacent` or a violation. A shape only for
   what crosses without naming a counterpart: events, queues, routes, a registry, a callback. `sbtel lint`.
6. **Annotate** leaf blocks (annotations.md); `scripts/sbtel_owners.py spec.sbtel FILES` checks them.
7. **Edges**: `sbtel_owners.py --edges`, one line per caller, callee and file.
8. **Check**: `sbtel check spec.sbtel --bindings edges.txt`. Read each violating line. Either the spec
   misread the structure (fix it, say why) or the code breaks its own structure (keep the edge, put
   `# VIOLATION: …` above it). Done when the summary reads `N not allowed, N explained` with equal
   numbers and no warning.
9. **Show it**: `id=$(sbtel open spec.sbtel --bindings edges.txt)`. In chat: the levels, how the edges
   were extracted and what was not covered, the violations with your reading of each.

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
