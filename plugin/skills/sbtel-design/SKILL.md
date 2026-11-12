---
name: sbtel-design
description: Design or restructure something as an sbtel spec with the human reviewing the live diagram: a system, service, module or feature, and equally a document, a prompt or a process. Stratified design (SICP), simple not easy (Hickey). Use when the user asks to design, plan, architect, decompose, level, simplify or refactor, or to critique an existing .sbtel spec, and sbtel is in use.
---

# Designing in sbtel

Syntax, what a view shows and the review loop are in sbtel-language. This is what to write.

Aim for small yet beautiful: the fewest blocks, levels and types that say the thing, each one earning
its place. A spec that grows should be able to say what each new part is for.

## The method

Stratified design (SICP 2.2.4) and Simple Made Easy (Hickey), applied literally:

1. **A level is a language.** Each level is built only from the levels below it. Name each level for
   what it offers the level above.
2. **Lower levels are small and used by everything.** A bottom level holds few primitives, and most
   blocks above use each of them: a collections library is the model. Going up, levels get wider and
   each block has fewer users.
3. **One strand per block.** One sentence, no "and".
4. **Coupling is declared.** Peers in a level are independent. Two that work as one are `adjacent`,
   with the reason as the group's sketch.
5. **`takes` and `gives` when the counterpart is chosen elsewhere.** An abstract type, a callback a
   higher level implements, an event going up. A plain call downward needs nothing written: the levels
   already allow it.
6. **Say no more than the spec needs.** No sketch where the name and the structure say it.

Worked reasoning for each: [principles.md](principles.md).

## Procedure

1. Write the goal, the constraints and the non-goals as a `;` comment at the top. Ask if unclear.
2. List the strands, one sentence each.
3. Stratify: what is needed by many and needs nothing goes to the bottom; composition and entry
   points go to the top.
4. Count. For each lower-level block, count the blocks above that use it.
   - Used by one: move it inside that block.
   - Used by none: delete it.
   - A lower level with more blocks than the level above it: regroup, or it is not one level.
5. For each interaction that is not a plain downward call, declare a shape and the ports.
6. Declare each shape and behavior in the smallest block that holds every use (lint says where).
7. `sbtel lint` until clean. Run [red-team.md](red-team.md) over it.
8. Open it. In chat: the levels in one line each, the trade-offs, the question you want answered.
9. Take one round of review before going a level deeper. Stop adding depth when the human stops
   opening blocks.

## Before showing it

- Every level has a name, and no name needs "and" or "misc".
- No level only forwards to the one below.
- No block is used by everything above and below it.
- No adjacent group of more than three, and none without a sketch.
- No shape with exactly one fixed giver and one fixed taker that could be a plain call.
- The spec has fewer blocks than the last version, or you can say what each new one is for.

## A card is read cold

The human comes back to a card hours later, having forgotten the conversation that made it. Write
the card for that reader.

- The name says what the thing is in words the human would use for it. Not a label you coined while
  working, and not an id: `slow-ci-test` means something to you today and nothing tomorrow;
  `"Test that times out on CI"` says it.
- The sketch's first sentence says what the thing is and why it is on the board, complete without
  the conversation: "A test that fails on slow CI machines. It blocked our PR three times and is not
  caused by our change." Ticket and PR numbers come last, if at all; they are for looking up, not for
  understanding.
- The viewer shows about two lines of a sketch before it cuts off. Put what matters in those.
- Before you send a reply that points at a card, read the card's name and first sentence as if you had
  never seen it. If they do not tell you what it is, fix the card first.

## One card, one thing

- A block stands for one thing of one kind. If a card holds a claim and its evidence, make two cards.
- Give every block a `:type` that says its kind. The viewer colours cards by type, so the reader sees
  at a glance which cards are evidence, which are complaints and which are excerpts. Use few types in
  a view, three to six, and the same word every time.
- Take the types from the subject, in the human's own words:
  - code: what the thing is in code (module, function, table)
  - a process or an investigation: the kinds of thing the human talks about (finding, evidence,
    excerpt, recommendation)
  - progress: statuses (todo, doing, done, blocked)
  - people and schedules: roles or teams, weeks or milestones
  - a product: features
- Keep a card short: a name and a sentence or two.
- When a block stands for something in code, use the code's own name (`AtomicWrite`, `store.ts`).
  When it stands for anything else (a claim, a question, a task, a piece of evidence), name it with a
  short phrase in plain words, written as a string: `(block "Test that times out on CI" …)`. A phrase
  is a noun phrase of six words or fewer; the sentence goes in the sketch. Where a phrase would be
  awkward and one word will do, lowercase words joined by hyphens (`atomic-write`) are fine.
- A name is a block's identity and must be unique in the spec. Where a name would repeat, put what it
  belongs to in front with a slash: a card that details another is `<thing>/<detail>`
  (`slow-login/evidence` beside `slow-login`), and two that clash take their parents (`store/index`,
  `ui/index`), unless a more specific name is better. A card inside or linked beside the block its
  prefix names shows only the rest, so write the prefix freely.

## When the subject is not code

The same method. A prompt: the task at the top, the judgements it makes below, the vocabulary those
use at the bottom. A document: the claim, the argument, what the reader must already know. A process:
the outcome, the steps, the roles and tools the steps draw on.

Here, and only here, an `adjacent` group may also read left to right: the left card is the thing and
the ones to its right detail it (a finding, then its evidence, then the excerpt it points at). Keep
the same order of types in every such group. In a spec of code, adjacency keeps its strict meaning:
peers that work as one.

## When code exists or follows

sbtel-recover grounds a spec in code and keeps `sbtel check` honest. Use it before redesigning
existing code, and after writing new code.
