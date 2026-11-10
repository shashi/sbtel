---
name: sbtel-language
description: Read, write and fix sbtel specs (.sbtel files: block, level, adjacent, takes, gives, shape, behavior, implements, refines, carries, ref, sketch), choose what a view shows, and run the review loop with the human (sbtel lint, open, inbox, reply, query, diff, check, export). Use whenever a .sbtel file or the sbtel CLI is involved, or the user wants to see, design, understand, debug or review a system, a document, a prompt or a process as blocks in levels.
---

# sbtel: the language, the view and the loop

A spec is nested **blocks** in ordered **levels**. A block means whatever the human works with: a
feature, a module, a directory, a file, a function; an article, a prompt, a note; a role, a task, an
agent. The human reads the spec as a diagram, points at parts of it and comments; you read and write
the text.

Run `sbtel version` first. If it is missing: `curl -fsSL https://raw.githubusercontent.com/shashi/sbtel/main/install.sh | sh`.

## Syntax

```sbtel
; comment
(block Name :type "Module"                 ; :type: what the block means (optional)
  (~ One sentence: what it is for. ~)      ; a sketch; (sketch "…") is the same thing
  (takes Shape)                            ; a port in; named after the shape (noteSaved)
  (gives Shape :as cmd (~ … ~))            ; a port out; :as only to tell two ports apart
  (implements Behavior)                    ; adds the behavior's ports
  (ref src/store.ts:40-60 (~ … ~))         ; a file it stands for or rests on; the human opens it
  (shape Note (~ … ~))                     ; what a port takes or gives
  (shape Saved (refines Note))             ; is-a: fits wherever a Note fits
  (shape Page (carries Note Saved))        ; has-a
  (behavior Durable :type "trait" (gives Saved))   ; ports many blocks promise
  (behavior (Store T) (takes T :as put))   ; with a parameter
  (level :name "Screens" (block A) (block B))      ; the first level written is the top
  (level (adjacent (~ Why. ~) (block C) (block D)))
  (block E))                               ; bare blocks make one implicit level
```

- A name is any run of characters without whitespace, `( ) " ;`. Use the name the reader uses: a path
  for a directory or file (`src/store.ts`), a function's name without parentheses, a service's deploy
  name, a plain word for an idea. Block names are unique in a file.
- Levels are written top to bottom and numbered from the bottom (level 1 is the lowest).
- A block may use blocks in lower levels of its holder, at any depth, and its `adjacent` peers. Not
  upward, not across its own level, not its container.
- A shape or behavior is visible in the block that declares it and everything inside.
- A `takes U` port fits a `gives T` port when T is U or refines it.
- A `ref` is a path beside or below the spec (`file`, `file:40-60`, `"a file.md#heading"`) or a URL. Use
  it for the code a block maps to, and for evidence: an eval output, a log, a document. The human
  reads it in the viewer once you push the version that names it.
- `(port :in T)`, `(port :out T)` and `(message T)` are the 0.3 forms: `sbtel fmt --migrate spec.sbtel`.

Grammar, every lint message and the binding table: [reference.md](reference.md).

## What a view shows

One spec is one view. Write it to the depth the task needs and no deeper; make a second spec for a
second concern.

- **Start** at the granularity the human spoke in, with everything they named and what those rest on.
- **First version**: the whole subject at one depth, two or three levels, a handful of blocks per level.
- **Open a block** (give it levels of its own) when the task changes something inside it, a comment
  asks about it, a violation points into it, or the human opens the subject. Leave the rest as leaves.
- **Grounded in code**: stop at files unless the task is inside one; go to functions only in the block
  being changed or debugged. Give `:type` to what maps to code.
- **Not grounded** (ideas, prompts, processes): stop where one sentence says what a block is.
- **By task**: understanding: broad and shallow, then deeper where asked. Debugging: the path the
  shape or call in question takes, deep; everything else closed. Review: what changed and what it
  uses (`sbtel query … --with-deps`). Design: top-down, one level of depth per round of review.

## Write, lint, show

```sh
sbtel lint spec.sbtel                     # until clean; exit 1 when anything is wrong
id=$(sbtel open spec.sbtel)               # shows it; stdout is only the session id
sbtel inbox "$id" --wait --timeout 540    # blocks until a review, a comment or a save
sbtel open spec.sbtel --session "$id"     # pushes your new version to the same tab
sbtel reply "$id" c7.1 "What changed."    # answer each comment; r7 answers a review as a whole
```

- A **comment** arrives alone when the human sends it from a block's chat. Act on it and reply; they
  may send several while you work.
- A **review** is one unit: a message, comments (`c7.1`, …) and, when they edited the diagram, a
  proposed spec (a path and its diff). The proposal is not in your file: apply or merge it, lint, push.
- A **save** means the human wrote the file from the browser. Re-read it before you edit.
- Keep `--timeout` under your shell's limit; on a timeout, wait again.
- Reply to every comment with what changed or why nothing did.

## Other commands

- `sbtel query spec.sbtel Id… [--with-deps]`: the named elements as a fragment that lints on its own.
  Read this instead of the whole file in a large spec. Ids: a block name, `beh:Name`, `msg:Name`.
- `sbtel check spec.sbtel --bindings edges.txt`: judges `A -> B  # file:line` lines against the levels
  (sbtel-recover makes the file).
- `sbtel diff a b`, `sbtel open-diff a b`: what changed, as text or in the browser.
- `sbtel export spec.sbtel -o spec.html`: one self-contained page (`--readonly`, `--embed`).
- `--json` on anything that prints results. Exit codes: 0 ok, 1 findings, 2 usage or IO.
