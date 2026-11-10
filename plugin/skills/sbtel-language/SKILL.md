---
name: sbtel-language
description: Read, write and fix sbtel architecture specs (.sbtel files, s-expressions built from block, level, adjacent, port, message, behavior, implements, refines, carries and sketch or its (~ … ~) sugar), and run the sbtel review loop with the human (sbtel open, inbox --wait, read the review, apply or merge its proposed spec, open --session, reply). Use whenever a .sbtel file is read, created or edited, when sbtel lint, query or check output needs interpreting, or when the user comments on an sbtel diagram.
---

# sbtel: the language and the tool loop

sbtel describes a system as nested **blocks** in ordered **levels**, the **messages** (data types) on
their ports, and the **behaviors** (shared port sets) they implement. The `sbtel` CLI checks a spec, and
it shows the spec to the human as a live diagram that they can edit and comment on.

Run `sbtel version` first. If the command is missing, give the user the install line,
`curl -fsSL https://raw.githubusercontent.com/shashi/sbtel/main/install.sh | sh`, rather than working
without lint.

## Syntax in one screen

```sbtel
; comment
(block Name :type "Module"                       ; :type, the one block keyword: the code artifact kind
  (sketch "One sentence: what this block is for.")
  (port :in Type)                                ; :in | :out, a message type in scope; named `type`
  (port :out Type :as cmd (~ What the type alone does not say. ~))   ; :as names it; sketch last
  (implements Behavior)                          ; one behavior; adds its ports
  (message Super :type "struct" (sketch "A general kind of data."))   ; :type: what it is in code
  (message Type (refines Super))                 ; is-a
  (message Pair (carries Type Super))            ; has-a; never changes what a port accepts
  (behavior Behavior :type "trait" (port :out Type :as p) (sketch "…"))   ; a block's grammar
  (behavior (Store T) (port :in T :as put))      ; parameter T; ports typed T are not checked
  (behavior Keeps (implements (Store Type)))     ; extends Store with T = Type; no blocks or levels inside
  (level :name "Screens" (block A) (block B))    ; the first level is the TOP; :name labels it
  (level (adjacent (~ Why they braid. ~)         ; C and D may bind each other
    (block C) (block D)))
  (block E))                                     ; bare blocks make an implicit level
```

Levels are written top to bottom but numbered from the bottom: level 1 is the lowest, so in check
output a lower level has a lower number (`Store (level 1 of App) binds upward to Orders (level 2)`).

- `(~ text ~)` is exactly `(sketch "text")`, with nothing special inside; for a text containing `~)`,
  use `(~~ … ~~)`, and so on. A tilde sketch keeps blank lines as paragraph breaks. Edit a sketch in
  the form it is written in.
- Sketches go on blocks, messages, behaviors, levels, adjacent groups and ports; one each. Write one
  sentence, and only what the structure does not already say.

- A port is `(port :in Type)` or `(port :out Type)`, named after its type with the first letter
  lowercased (`NoteSaved` → `noteSaved`; a qualified type's last component, `shell.Intent` →
  `intent`). Add `:as name` only when two ports of one block (inherited ones included) would get the
  same name: `(port :out Item)`, `(port :in Item :as backlog)`. Anchors, query, diff and the viewer use
  that name. The 0.2 form `(port name in Type)` is a lint warning; `sbtel fmt --migrate-ports spec.sbtel`
  rewrites it in place.
- Names are runs of characters other than whitespace, `( ) " ;`. **Name a block what its reader would
  call it**; no style is required. A directory or a file is best written as its path (`src/store/`,
  `src/store.ts`), a function as its name without the parentheses (`parseNote`), a service as it is
  called in the deploy (`billing-api`), a concept as its word. A dotted or CamelCase name
  (`Shell.Router`) suits a module that is called that in the code, and is not a rule. Block ids must
  be unique across the whole file, so qualify a name only where two blocks would otherwise share it.
- The file is an unnamed root block. Top-level blocks sit in its levels, and top-level messages and
  behaviors are visible everywhere.
- **Scope**: a message type or behavior declared in block D is usable in D and everything inside D,
  and nowhere else. For a behavior's ports, the scope is where the behavior is *declared*.
- **Levels**: inside each holder, a block may bind (name in code) blocks in **lower** levels, at any
  depth. It may never bind upward, or across its own level unless the two are `adjacent`. A level's
  `:name` is the vocabulary it offers upward; binding messages quote it (`level 2 "Routing" of Shell`).
- **Bindings** allowed: `same`, `descendant`, `lower-level`, `adjacent`, and `abstraction`: the callee
  is a behavior in the caller's scope (code calling through an interface binds the behavior, not its
  implementers). Forbidden: `ancestor` (a part naming its container), `same-level`, `upward`, `scope`
  (a behavior out of the caller's scope) and `unknown`.
- **`:type`** grounds an element in code: for a block the code artifact (`"Module"`), for a behavior
  the abstraction (`"trait"`, `"interface"`), for a message type the data shape (`"struct"`). Optional;
  keep the kinds consistent within a spec.
- A behavior that `implements` another **extends** it: it has its ports, and its implementers count as
  implementing both. No behavior may implement itself through a chain (lint's `cycle` rule).
- A **message** is data exchanged where neither side names the other, so the counterpart is chosen
  elsewhere. `accepts(U, T)`: an `in U` port takes an `out T` value when U = T or T refines U
  (through a chain). A union is a supertype its alternatives refine.
- 0.2 renamed `(layer …)` to `(level …)` and removed `either`, `:fill` and free `:key value`
  keywords; lint says what to write instead.

The exact grammar, every lint message and the binding table are in [reference.md](reference.md).
Read it before you fix a warning you don't recognise.

## The write loop

1. Edit the `.sbtel` file.
2. Run `sbtel lint spec.sbtel`. It prints warnings as `file:line:col: warning: …`, rule failures as
   `file: <rule>: <detail>`, placement notes as `file:line:col: info: …`, and then `file: ok (…)` or
   `file: N problems (…)`. The exit code is 1 when anything is wrong; notes never change it.
3. Fix everything and lint again. Don't hand a spec with problems to the human without saying so.

Typical fixes:

- `X uses Y, declared in Z`: move the declaration up to the smallest block that holds every use.
- `A.p: T` (undeclared type): declare `(message T …)` in scope, or fix the typo.
- `unknown form (…)`: usually a typo, such as `skecth` for `sketch`.
- `info: X is declared in A but only used within B; it could live there.`: move the declaration into
  B, unless you have a reason to keep it (say it in a `;` comment).

## Reading only what you need

Large specs don't need to be read whole. `sbtel query spec.sbtel Id… [--with-deps]` always prints the
named elements as a fragment that lints clean on its own: their source, their enclosing blocks as
skeletons, and the behaviors and message types the shown text uses, each in its declaring block.
Ids are block ids, `beh:Name` or `msg:Name`, and a bare name is tried as a block, then a behavior,
then a message type. Output headers print the same ids with the model's own prefixes, `β:Name` for a
behavior and `μ:Name` for a message type (`; μ:Intent: message in Shell, lines 5-5`); both spellings
are accepted as input. `--with-deps` adds the blocks the selection may bind to (lower levels and
adjacent peers) as collapsed stubs, which is what you need before changing who calls whom. The `;`
header lines say where each element is (`lines 14-16`), and for a message type, what carries it. An unknown id goes to stderr with "did you
mean" suggestions, and the exit code is 2. Use `--json` when you need the line numbers as data
(`lines.start`, `lines.end`) to edit the file precisely.

## Working with the human

The human works like a GitHub reviewer: comments and edits gather in a draft in the browser, and they
send it as one **review**. Nothing in the draft reaches you until it is sent.

```sh
id=$(sbtel open spec.sbtel)            # opens the diagram; stdout is only the session id
sbtel inbox "$id" --wait --timeout 540 # blocks until the human sends a review, a comment or a save
# … read the review; apply or merge its proposed spec with your own changes; sbtel lint …
sbtel open spec.sbtel --session "$id"  # pushes the result; the tab offers Reload
sbtel reply "$id" c7.1 "Split into Turn.Render and Turn.State."   # one comment of review r7
sbtel reply "$id" r7 "Applied your edits, and answered both questions."   # the review as a whole
```

- `open` exits 0 even when the spec has problems; they appear on stderr. Fix them and push again.
- Keep `--timeout` under your shell tool's limit, or run the wait in the background. A timeout prints
  `nothing new after …` on stderr and exits 0. Then simply wait again.
- A **review** (`r7 review of version 3 …`) prints as one unit: the human's overall message, then, when
  they edited the diagram, `sbtel diff` of their edits against the version they started from and the
  path of the **proposed spec** (`…/sessions/<id>/proposals/7.sbtel`, the whole text), then each
  comment (`c7.1`, `c7.2`, …) with its target and the element's source. The proposal is not in your
  spec file: **you apply it**. If you did not change the spec since that version, copy the proposal
  over it; otherwise merge the diff into your current text (`sbtel diff spec.sbtel <proposal>` shows
  all differences). Then lint and push with `open --session`. A later review whose proposal "replaces
  the proposed spec of r7" holds the whole text again: take the latest one.
- A **comment** on its own (`c7 comment on block Shell.Turn …`) was sent with Send now. Each comment
  shows its target (`block Shell.Turn`, `beh:Name`, `msg:Name`, or a line between two blocks), the
  version it was written against, and that element's source (from the proposed spec, in a review with
  edits).
- A **save** event means the human wrote the spec file from the browser. **Re-read the file before you
  edit it**, or you will overwrite their work. A save that "the user overwrote without merging"
  replaced a version you pushed: re-read it and redo what of yours is missing.
- Answer every comment with `reply`, saying what you changed or why you didn't; a review's message can
  be answered with its id. Push the new version with `open --session`. The tab never reloads by itself.
- `sbtel inbox "$id" --peek` reads without moving the cursor; `--json` gives each event as an object
  (a review has `message`, `comments` and `proposal: {path, hash, base, baseVersion, diffText}`).
  `sbtel sessions` lists sessions, and `sbtel close "$id"` ends one.

## Other commands

- `sbtel check spec.sbtel --bindings edges.txt`: judges `Caller -> Callee  # file:line` edges against
  the levels (see the sbtel-recover skill).
- `sbtel diff a.sbtel b.sbtel` shows what changed. `sbtel open-diff a b` shows the same in the browser.
- `sbtel fmt --migrate-ports spec.sbtel` rewrites a 0.2 spec's ports, `(port chord in KeyChord)`, as
  `(port :in KeyChord :as chord)` in place (`:as` only when needed); `--check` only reports.
- `sbtel export spec.sbtel -o spec.html` writes one self-contained HTML file of the diagram (no server, no
  network) to share with humans who don't have sbtel; `--readonly`, `--bindings edges.txt`, `--embed`.
- The commands that print results take `--json`. Exit codes: 0 ok, 1 check failures, 2 usage or IO error.
