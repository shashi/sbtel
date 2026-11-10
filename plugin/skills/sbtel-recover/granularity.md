# Granularity: SCCs, block sizes and levels

How big a block should be, and how to find levels that the code actually follows. Do this after you
have a reference graph (extracting-bindings.md) and before you write the spec.

## Contents

- Find the SCCs first
- Rules for choosing blocks
- Target sizes
- Signs a block is too fine
- Signs a block is too coarse
- From the condensed graph to levels
- A worked example: one global script

## Find the SCCs first

A strongly connected component (SCC) is a set of declarations (or files) that all reach each other by
references: A uses B, B uses C, C uses A. Levels are a strict order, so no ordering of levels can put the
members of one SCC in different levels without at least one upward edge. Compute them before you
choose any block:

```sh
# declaration level: one node per top-level unit (JS/TS with sbtel_refs.mjs, Go with sbtel_refs_go)
node scripts/sbtel_refs.mjs --units $FILES | python3 scripts/sbtel_sccs.py
go -C scripts/sbtel_refs_go run . --dir "$PWD" --units ./... | python3 scripts/sbtel_sccs.py
# file level, from any "from_file:line to_file:line" pairs (refs.txt from either helper)
python3 scripts/sbtel_sccs.py --by-file < refs.txt
# block level, on a draft: the edges of a draft spec
python3 scripts/sbtel_sccs.py edges.txt
```

`sbtel_sccs.py` prints each SCC with more than one node, then the levels of the condensed graph (each
SCC as one node), top first, and the nodes with no edges at all. Without the helper, any graph library
has the algorithm (networkx `strongly_connected_components`, Go `gonum/graph/topo`, `tarjan` crates).

Run it twice:

1. on the **declaration graph**, before choosing blocks. Its SCCs are the code's own knots;
2. on the **block graph of your draft** (the draft's edges). Every block-level SCC larger than one
   block either is a declared cooperation (`adjacent`) or contains violations. A draft whose block
   graph is one big SCC is the wrong cut, however natural its names look.

**Go** is different at the first step. The compiler forbids import cycles, so the package graph has
no SCCs, and declaration-level SCCs are often empty too (one Go recovery found 0 across 179
declarations), so "an SCC is at most one block" gives no signal. Run `--by-file` on each package's
references instead: a struct declared in one file and its methods in others make file-level SCCs,
and those are where the blocks and the violations are (a struct field that names a type of a higher
block is the typical one). A condensed declaration graph of a Go package can also be a dozen levels
deep; treat it as data, not as a proposal, and cut by files and types.

## Rules for choosing blocks

- **An SCC is at most one block.** Put each declaration-level SCC inside one leaf block. You may split
  an SCC only when its parts are clearly different strands (a page state and the canvas that redraws
  it). Then at least one edge inside it is a violation, which you record and explain. Never split one
  to get a nicer picture.
- **Merge or split until the levels hold.** Start from the code's own boundaries (packages,
  modules, files, `// ---- Section ----` headers). Merge blocks whose block-level SCC has no
  explanation you could write in one line. Split a block whose sentence needs "and" when the two
  strands have different callers. Stop when every remaining upward edge is one you can explain as a
  defect of the code.
- **Prefer the coarser cut when in doubt.** Ten violations of one kind ("features call `render()`
  back") read better as one explained pattern on a coarse block than as a 13-level chain of
  single-block levels that no one would draw.
- **Each SCC that you keep inside one block is fine.** It is the code's business how a block works
  inside; the spec states what it is for and what it may use.

## Target sizes

These are rough, for a first cut; the code's real seams win over the numbers.

- **Per holder**: 3 to 7 children, in 2 to 5 levels. More than about 7 peers in one level is an
  overfull level (sbtel-design red-team.md).
- **Per leaf block**: something one person can hold in their head. That is often one file or package
  of a few hundred lines, or one section of a large file. In a single-file app of 2,000 lines, 8 to 15
  leaf blocks is typical.
- **Whole spec**: 15 to 40 blocks for a system a team works on. Hundreds of blocks are a code map,
  not an architecture: recover the top two levels first and go deeper only where the human asks.

## Signs a block is too fine

- It is a single function or a few lines, and every caller of it also calls its neighbour.
- Many levels hold one block each, and each only forwards to the next (anaemic levels).
- The block graph has big SCCs, or most of your violations run between two siblings: they are one
  strand.
- Sketches turn into walk-throughs of the code (red-team.md: "container with code-level detail").
- You need a shape with one fixed producer and one fixed consumer to dodge an edge.

## Signs a block is too coarse

- Its sentence needs "and", and the two halves have different callers or change for different
  reasons.
- Most of the system binds it (a god-block), or it has far more ports than its peers.
- It hides a seam the code has: a parameter or interface whose implementation is chosen elsewhere, a
  pure core that never touches IO, a separate file that the build only concatenates.
- A violation you record is really "half of this block calls the other half upward".

## From the condensed graph to levels

`sbtel_sccs.py` levels the condensed graph by dependency direction: the top level holds what nothing
depends on, and each node sits one level below the lowest thing that depends on it. It numbers the
levels from the bottom, as sbtel does: level 1 is the lowest. Use it as a first
proposal, then shape it:

- **Isolated nodes** (no edges, such as a test-only generator or a parser that only the CLI calls)
  satisfy "nothing depends on it" and "it depends on nothing" at once. Place them by what they are
  for: next to what they serve, or in the bottom level if they are shared primitives. Say so in a `;`
  comment, because the graph does not decide it.
- **Merge thin levels.** A level per node is what the algorithm gives; a level per vocabulary is what
  a reader wants. Put peers that never bind each other in one level.
- **Keep data stores low.** A state object that most features read goes below them even when it calls
  back up (`setSource()` calls `render()`): the callback is the violation, not the reads.
- **Order the remaining back edges.** When an SCC spans blocks, choose the order with the fewest
  back edges, and among those the order that matches the code's own structure (its sections, its
  file order, its comments). Record every back edge as a violation.

## A worked example: one global script

sbtel's own viewer is about 4,000 lines that `viewer/build.mjs` inlines into one `<script>`. Every
top-level name is a global; there is no import at all.

- The declaration graph (`sbtel_refs.mjs --units`) has only three small SCCs. The largest ties
  `setSource()`, `render()`, `paint()`, `paintSeps()` and `edit()` together: the page state and the
  canvas that redraws it.
- A first cut by the code's section headers gives about 20 blocks, 16 of them in one block-level SCC:
  almost everything reads the global `state`, and almost everything calls `render()`. Levels that
  literally gives a 13-level chain.
- The recovered spec (examples/viewer.sbtel; in a blind recovery of sbtel itself, read it only after
  you finish) uses 13 app blocks instead, puts the page state below
  everything that reads it, declares one cooperation (comments with the message table), and records
  the 9 remaining back edges as violations, nearly all of them "a lower feature calls `render()`".
  It splits the one declaration SCC above (App.Document and App.Canvas are different strands), and
  that split is one of the 9: `setSource()` calls `render()`.
  The pure language core sits below the app, with the `Pure` behavior on each of its blocks and the
  text measurer as a real port: `layout(model, opts, M)` takes the measurer as a parameter.
