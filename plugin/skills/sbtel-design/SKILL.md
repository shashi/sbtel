---
name: sbtel-design
description: Design or restructure something as an sbtel spec with the human reviewing the live diagram: a system, service, module or feature, and equally a document, a prompt or a process. Stratified design (SICP), simple not easy (Hickey). Use when the user asks to design, plan, architect, decompose, level, simplify or refactor, or to critique an existing .sbtel spec, and sbtel is in use.
---

# Designing in sbtel

Syntax, what a view shows and the review loop are in sbtel-language. This is what to write.

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

## When the subject is not code

The same method. A prompt: the task at the top, the judgements it makes below, the vocabulary those
use at the bottom. A document: the claim, the argument, what the reader must already know. A process:
the outcome, the steps, the roles and tools the steps draw on. `:type` says what a block is
("Prompt", "Section", "Role").

## When code exists or follows

sbtel-recover grounds a spec in code and keeps `sbtel check` honest. Use it before redesigning
existing code, and after writing new code.
