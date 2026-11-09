---
name: sbtel-design
description: Design or restructure a system's architecture as an sbtel spec, in a loop with the human who reviews and comments on the live diagram. Applies SICP's levels of language (each level a vocabulary built from the levels below) and simple-made-easy (one strand per block), and red-teams the result. Use when the user asks to design, plan, architect, decompose, level or refactor a system, service, module or feature and sbtel is in use, or asks for a critique of an existing .sbtel spec.
---

# Designing a system in sbtel

Use the sbtel-language skill for syntax and commands. This skill covers *what* to write.

## Principles

1. **Levels of language** (SICP, 2.1.2). A level is a vocabulary built from the levels below it, and
   the line above it is an abstraction barrier. The bottom level holds primitives; each higher level
   speaks only in the words of the levels below; lower levels know nothing of higher ones. **Name each
   level for the vocabulary it offers upward** (`(level :name "Rational numbers as pairs" …)`). If a
   level's name does not already say where the barrier is, its sketch does: what the level above may
   know of it, and what it may not.
2. **Simple, not easy** (Rich Hickey, "Simple Made Easy"). Simple means one fold, one strand that is not
   braided with others. **One strand per block**: if a block's sketch needs "and" to say what it does,
   split the block.
3. **Adjacency is a declared braid**: an explicit, visible coupling between peers. Use it only when two
   peers really are one cooperation, and name the reason in the group's sketch, in a few words. Never
   use it to dodge the levels.
4. **Prefer messages over bindings when the counterpart should be chosen elsewhere.** A binding (A's
   code names B) fixes the partner at A. A message (A has an `out` port and B a matching `in` port)
   leaves the wiring to a higher level. Upward flow (events, callbacks, notifications) is *always* a
   message.
5. **Behaviors are bottom-level vocabulary.** They are promises (`Durable`, `Pure`, `Surface`) that
   many blocks share. **Declare vocabulary at the level that uses it**: each behavior and message type
   in the smallest block that holds every use (lint notes the ones that sit higher).
6. **Say no more than the spec needs.** Agents and people get a lot from one sentence once they have
   the spec. A sketch is one sentence where possible. Don't restate what the structure already says
   (levels, adjacency, ports, types), and leave implementation detail out. A port gets a sketch only
   when its type alone does not say what it promises. Prefer adding nothing over adding a form or a
   sentence "just in case".
7. **Ground blocks with `:type`.** Name the kind of code artifact each block maps to (`"Service"`,
   `"Module"`, `"File"`, `"Function"`), and keep the kinds consistent within a spec.

The reasoning behind each principle, with a before-and-after example, is in
[principles.md](principles.md).

## Procedure

1. **Start from the user's goals.** Collect what the system must do, for whom, the hard constraints and
   the non-goals. Ask when they are unclear. Put them in a `;` comment at the top of the spec.
2. **Name the strands.** List the independent concerns as one sentence each, with no "and". Each
   strand becomes a candidate block.
3. **Stratify.** Order the strands by what they need. Things that are needed but need nothing (data,
   storage, pure rules) go at the bottom. Composition, entry points and UI go at the top. Inside a big
   block, repeat the process: its children get levels of their own.
4. **Decide messages and bindings** for every interaction. A downward call to a fixed partner is a
   binding, and the levels allow it. When the partner should be chosen elsewhere, there are many
   partners, or the flow goes upward, use ports and a message type. Declare each type and behavior in
   the smallest block that holds all its uses.
5. **Write and lint**: `sbtel lint spec.sbtel` until it is clean.
6. **Red-team** the spec against [red-team.md](red-team.md). Fix what you can, and note what you chose
   to keep.
7. **Open it for the human**: `id=$(sbtel open spec.sbtel)`. In chat, summarise the design in a few
   lines, including the main trade-offs and what you want their opinion on.
8. **Iterate on reviews**: `sbtel inbox "$id" --wait`. The human sends a review: a message, comments
   and, when they edited the diagram, a proposed spec (its path and its diff against the version they
   started from). Apply or merge the proposal with your own changes (re-read the file first after a
   save event), answer each comment in the spec, lint, `sbtel open spec.sbtel --session "$id"`, and
   then `sbtel reply "$id" <cid> "<what changed>"` for each comment (`c7.1`, …), or `r7` for the
   review as a whole. Repeat until the human is satisfied.
9. When code gets written, keep it honest with the sbtel-recover skill: annotate the code, extract the
   edges, and run `sbtel check`.

## Red-team, short form

Read each block, each level, and then the whole spec:

- **Braided block**: its sketch says "and", "or", "manages" or "handles"; split it.
- **Upward dependency**: a lower block must call a higher one; turn the flow into a message.
- **God-block**: one block that everything binds, or a level with too many peers; split or stratify it.
- **Anaemic level**: a level that only forwards to the level below; merge it.
- **Unnameable level**: you can't name a level without "and" or "misc"; regroup it.
- **Adjacency used to dodge levels**: large groups or chains of adjacency; stratify them instead.
- **Fake message**: exactly one fixed sender and receiver; use a plain binding.
- **Unexplained braid**: an adjacent group without a sketch; say why, or remove the adjacency.
- **Braided data**: a message type that carries many unrelated types; split it.
- **Global vocabulary**: every type declared at the top; push declarations down (lint notes them).

The full checklist, with the question to ask and the fix for each item, is in
[red-team.md](red-team.md).
