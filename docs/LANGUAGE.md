# The sbtel language

sbtel is a language to design, understand, and collaborate on a system's architecture with AI. A spec
describes the system as nested **blocks** in ordered **levels**, the **messages** they exchange and the
**behaviors** they share. This page describes the language exactly as `core/core.js` and
`core/api.js` read it, for humans and agents alike. Every example on this page is checked against the
`sbtel` binary (`make docs-check`): blocks marked clean lint clean, and every output shown is the
binary's real output.

[DESIGN.md](DESIGN.md) is the contract for the tools (CLI, server, viewer). This page covers the
language.

- [Cheat sheet](#cheat-sheet)
- [1. Lexical syntax](#1-lexical-syntax)
- [2. The file](#2-the-file)
- [3. Forms](#3-forms)
- [4. Scope](#4-scope)
- [5. Levels and adjacency](#5-levels-and-adjacency)
- [6. Messages, bindings and `accepts`](#6-messages-bindings-and-accepts)
- [7. Lint: every check](#7-lint-every-check)
- [8. Bindings and `sbtel check`](#8-bindings-and-sbtel-check)
- [9. Annotations](#9-annotations)
- [10. The tool loop](#10-the-tool-loop)

---

## Cheat sheet

```sbtel
; comment to end of line                       "string" with \" and \\ escapes
(block Name :type "Module"                         ; :type is a block's only keyword: what it maps to
  (~ One sentence: what this block is for. ~)      ; = (sketch "…"); nothing inside is special
  (port name in Type)                              ; direction is in or out; Type is a message type
  (port cmd out Type (~ Only what the type does not say. ~))   ; a port may have a sketch
  (implements Behavior)                            ; one behavior name; its ports become this block's
  (message Super (sketch "A general kind of data."))
  (message Type (refines Super))                   ; is-a: a Type is a Super
  (message Pair (carries Type Super))              ; has-a: a Pair holds a Type and a Super
  (behavior Behavior (port p in Type) (sketch "…")); shared vocabulary, visible here and below
  (behavior (Store T) (port put in T))             ; a behavior with a parameter T
  (level :name "Screens"                           ; first level, the top; :name labels it
    (~ What the level above may know of it. ~)     ; a level may have a sketch
    (block A) (block B))
  (level (adjacent (~ Why C and D braid. ~)        ; lower level; C and D are adjacent peers
           (block C) (block D)))
  (block E))                                       ; bare blocks form an implicit level
```

| Form | Where | Meaning |
|---|---|---|
| `(block Name [:type "T"] body…)` | file, block, level, adjacent | a part of the system; it may contain levels |
| `(level [:name "N"] block-or-adjacent…)` | file, block | one level; levels are ordered **top to bottom** |
| `(adjacent block-or-adjacent…)` | file, block, level, adjacent | peers in one level that may bind each other (≥ 2 members) |
| `(port name in\|out Type [sketch])` | block, behavior | a typed input or output |
| `(message Name …)` | file, block | a data type; `(sketch)`, `(refines T)`, `(carries A B…)` inside |
| `(behavior Name …)` / `(behavior (Name P…) …)` | file, block | a named set of ports a block can promise |
| `(implements Name)` | block | the block has that behavior's ports |
| `(sketch "text")` or `(~ text ~)` | block, message, behavior, level, adjacent, port | the prose description |
| `(refines T)` | message | is-a: a subtype of T |
| `(carries A B…)` | message | has-a: a value holds values of A, B… |

**Rules in one breath.**

- **Levels.** Inside a block (or the file), levels run top to bottom. Higher levels are built from lower
  ones: a block may bind blocks in **lower** levels, never upward, and never a same-level block unless
  they are **adjacent**. A level's `:name` is a label for the vocabulary it offers upward.
- **Bindings** (code in A names B) are allowed when B is: A itself, inside A, in a lower level of the
  nearest common holder (at any depth below it), or in A's adjacent group there. They are forbidden when
  B encloses A (`ancestor`), is in the same level but not adjacent (`same-level`), or is in a higher level (`upward`).
- **Messages** are data exchanged where neither side names the other: the counterpart is chosen
  elsewhere. Ports are typed with messages. `accepts(U, T)`: an `in U` port takes an `out T` value when
  U = T or T refines U (transitively). `carries` (has-a) never changes what a port accepts.
- **Scope.** A behavior or message type declared in block D is usable in D and everything inside D.
  Declared at file level, it is usable everywhere. Declare it where its users meet (lint notes it when
  it sits higher).
- **Names** are any run of characters without whitespace, `(`, `)`, `"` or `;`. Dots (`Shell.Router`)
  are a naming convention only. Duplicate block names get ids `Name#2`, `Name#3`… and a warning.

**Checks** (`sbtel lint`): parse errors; model warnings (duplicates, bad port direction, `adjacent`
with fewer than 2 members, empty level, the old `(layer …)` and `(either …)`); structure warnings
(unknown or misplaced forms and keywords, stray words, malformed ports, levels and `carries`, second
sketches…); five rules: every implemented behavior is declared, behaviors are used in scope, every
port's type is declared, message types are used in scope, and `refines`/`carries` name declared types;
and placement notes (information, never a failure). `sbtel check spec --bindings edges.txt` applies the
binding rules to `Caller -> Callee  # file:line` edges.

**The loop.** Write the spec → `sbtel lint spec.sbtel` → fix → `sbtel query spec.sbtel Id --with-deps`
to read just a slice → `id=$(sbtel open spec.sbtel)` for the human → `sbtel inbox $id --wait` (the
human's review: a message, comments and a proposed spec) → apply or merge the proposal and edit →
`sbtel open spec.sbtel --session $id` → `sbtel reply $id c7.1 "done"`.

A complete, clean spec:

```sbtel
; A small notes app.
(block Notes
  :type "App"
  (sketch "Write notes, see them rendered, keep them on disk.")
  (message Edit (sketch "A change to one note's text."))
  (message Saved (sketch "A note was written to disk."))
  (behavior Durable
    (port edit in Edit)
    (sketch "Keeps every accepted edit until it is on disk."))

  (level :name "Editing"
    (adjacent (~ The preview scrolls with the editor. ~)
      (block Notes.Editor
        (port edit out Edit)
        (sketch "The text area where the user types."))
      (block Notes.Preview
        (sketch "Renders the note beside the editor."))))
  (level :name "Storage"
    (~ Editing sends Edits; it never touches files. ~)
    (block Notes.Store
      :type "Store"
      (implements Durable)
      (port saved out Saved)
      (sketch "Writes notes to disk and reloads them on launch."))))
```

**Reading a slice.** `sbtel query` prints the named elements as a **fragment**: one spec that lints
clean on its own. It holds the elements' own source, their enclosing blocks as skeletons (header,
first sketch, and only the levels that lead to what is shown, with their names and sketches), and every
behavior and message type the shown text uses (the types they carry too), in the block that declares it. `--with-deps` also adds the blocks
the selection may bind to (lower levels and adjacent peers, of the element and of each of its
ancestors) as collapsed stubs. `sbtel query spec.sbtel Notes.Editor --with-deps` prints:

```text query Notes.Editor --with-deps
; sbtel query spec.sbtel Notes.Editor --with-deps
; Notes.Editor: block in Notes, lines 13-15
; may bind to (collapsed): Notes.Preview, Notes.Store
(block Notes :type "App"
  (sketch "Write notes, see them rendered, keep them on disk.")
  (message Edit (sketch "A change to one note's text."))
  (message Saved (sketch "A note was written to disk."))
  (behavior Durable
    (port edit in Edit)
    (sketch "Keeps every accepted edit until it is on disk."))
  (level :name "Editing"
    (adjacent
      (~ The preview scrolls with the editor. ~)
      (block Notes.Editor
        (port edit out Edit)
        (sketch "The text area where the user types."))
      (block Notes.Preview
        (sketch "Renders the note beside the editor."))))
  (level :name "Storage"
    (~ Editing sends Edits; it never touches files. ~)
    (block Notes.Store :type "Store"
      (implements Durable)
      (port saved out Saved)
      (sketch "Writes notes to disk and reloads them on launch."))))
```

Notes.Store, a stub here, brings in `Saved` and `Durable` with it. An id that names nothing goes to
stderr with suggestions (`sbtel query: no element Notes.Stor (did you mean Notes.Store?)`), and the
exit code is 2; the elements that were found are still printed.

---

## 1. Lexical syntax

The reader turns text into four kinds of token:

- **Parens** `(` and `)`.
- **Tilde sketches** `(~ text ~)`, read exactly as `(sketch "text")` (§3.2).
- **Strings** `"…"`. A backslash takes the next character literally, so `\"` is a quote and `\\` a
  backslash. There are no other escapes (`\n` is the letter `n`). A string may span lines.
- **Symbols**: any run of characters that are not whitespace, `(`, `)`, `"` or `;`. Names, keywords
  (`:type`) and port directions are symbols. Unicode letters are fine.

A `;` outside a string starts a comment that runs to the end of the line. Whitespace is anything
JavaScript's `\s` matches, including Unicode spaces.

**The tilde sketch.** `(` followed directly by a run of k tildes opens one; the text runs to the first
k tildes followed by `)`. Nothing inside is special: quotes, `;`, `#`, backslashes, unbalanced parens,
`(~5 ms)` and `~/.sbtel/` are all text. For a text that contains `~)`, use more tildes on both ends:
`(~~ … ~~)` ends only at `~~)`, `(~~~ … ~~~)` only at `~~~)`, and so on. The tilde run is as long as it
goes, so put a space after it: `(~ ~)` is the empty sketch. An opener with no closer is a parse error at
the opener (§7.1).

Every form is a parenthesised list whose first item is a symbol naming the form. The ten forms are
`block`, `level`, `adjacent`, `port`, `message`, `refines`, `carries`, `behavior`, `implements` and
`sketch`. Anything else is reported by lint (§7.3) and otherwise ignored. 0.2 renamed `layer` to
`level` and removed `either`; both are reported with what to write instead (§7.2).

Positions in messages are `line:col`, both 1-based; `col` counts UTF-16 code units, so for ASCII it is
the byte column.

## 2. The file

A file is a sequence of top-level forms: `block`, `level`, `adjacent`, `message` and `behavior`. The
file behaves as an unnamed root block:

- top-level blocks are laid out in the file's levels, exactly as children are inside a block (bare
  top-level blocks form an implicit level, §3.3);
- top-level `message` and `behavior` declarations are in scope everywhere;
- in binding messages the file is called "the file" (`level 1 of the file`).

Most specs have one top-level block. Several are fine:

```sbtel
(message Request (sketch "An HTTP request."))
(level
  (block Frontend (port call out Request) (sketch "The browser app.")))
(level
  (block Backend (port serve in Request) (sketch "The API server.")))
```

## 3. Forms

### 3.1 `block`

```lisp
(block Name [:type "T"] body…)
```

A block is a part of the system. `Name` is its id; ids must be unique (a duplicate gets the id
`Name#2` and a warning). The body holds, in any order: `sketch`, `port`, `implements`, `message`,
`behavior`, `level`, `adjacent` and `block`.

**`:type "Kind"`** is a block's one keyword, right after the name. It says what kind of code artifact
the block maps to (`"Service"`, `"Module"`, `"File"`, `"Function"`…) and shows as a pill in the viewer.
Keep the kinds consistent within a spec, so the pills mean something. The value may be a string or a
symbol. Any other keyword (0.1's `:fill` included), or a keyword after the body has started, is a
warning; the viewer picks its own colours.

A block that contains levels is a **container**; its children are its parts. A block with no levels is
a **leaf**.

### 3.2 `sketch`

```lisp
(sketch "What this element is for, in a sentence.")
(~ The same, as a tilde sketch: no quoting, no escapes. ~)
```

The prose description of a block, message, behavior, level, adjacent group or port. The two forms are
equal in every respect but whitespace:

- `(sketch "…")`: every run of whitespace is one space, so the text is one paragraph.
- `(~ … ~)`: the text is trimmed, and every run of whitespace is one space, except a run that holds two
  or more line breaks (a blank line): that is one paragraph break. `\r\n` and `\r` count as one line
  break. So a long tilde sketch can have paragraphs; the viewer shows them.

Only the first sketch of an element counts (a second one, in either form, is a warning). Neither form
needs the other: write whichever reads better. Say one thing, in as few words as it takes; see the
`sbtel-design` skill.

```sbtel
(message Path (~ A file path, like ~/.sbtel/sessions or "C:\Temp" (quotes and all). ~))
(message Note (~~ Ends with ~) inside, so it takes two tildes. ~~))
(message Long (~
  First paragraph.

  Second paragraph. ~))
```

### 3.3 `level` and the implicit level

```lisp
(level [:name "Name"] [sketch] block-or-adjacent…)
```

A block's (or the file's) levels are ordered top to bottom in source order. **Higher levels are built
from lower ones**: the first level is the top. A level holds blocks and adjacent groups (and its
sketch) only, and needs at least one block.

`:name "…"` labels the level: a string that is never referenced, may contain spaces and need not be
unique. Name a level for the vocabulary it offers to the levels above it. A level's sketch states its
abstraction barrier: what the level above may know of it, and what not. The viewer draws the name at
the left of the line above the level. An implicit level has no name; write `(level …)` to give it one.

```sbtel
(block Rationals
  (level :name "Programs that use rationals"
    (block Calc))
  (level :name "Rational numbers as pairs"
    (~ Above here, a rational is make-rat, numer and denom; never the pair. ~)
    (block Rat)))
```

Bare `block` and `adjacent` forms written directly in a block form an **implicit level**. Consecutive
bare forms share one implicit level, and an explicit `(level …)` ends the run. So this block has three
levels, top to bottom `[A B]`, `[C]`, `[D]`:

```sbtel
(block Top
  (block A)
  (block B)
  (level (block C))
  (block D))
```

Levels do not nest directly: a level's members are blocks, and each block has its own levels.

### 3.4 `adjacent`

```lisp
(adjacent block-or-adjacent…)
```

An adjacent group is a set of peers in one level that may bind each other (§5). It needs at least two
members. A nested `adjacent` is flattened into its parent group, so
`(adjacent (block A) (adjacent (block B) (block C)))` is one group of A, B and C. A group may have a
sketch, first or anywhere among its members: say why the peers are braided, in a few words. A nested
group has no sketch of its own (lint warns); the outermost group's counts.

In the viewer, adjacent blocks sit side by side joined by a line.

### 3.5 `port`

```lisp
(port name in Type [sketch])
(port name out Type [sketch])
```

A typed input or output of a block or a behavior. `Type` names a message type in scope (§4), or, in a
behavior with parameters, one of its parameters. Port names are unique within their block or behavior.
After the type, a port may have one sketch: write it only when the type alone does not say what the
port promises (`(port chord in KeyChord (~ Opens the palette. ~))`).

A block's ports are its own ports followed by the ports of every behavior it implements, sketches
included.

### 3.6 `message`, `refines`, `carries`

```lisp
(message Name [sketch] [(refines Super)] [(carries A B …)])
```

A message type is a kind of data. Two relations between types, and only these two:

- **is-a**: `(refines Super)` makes `Name` a subtype of `Super`: a port that takes `Super` also takes
  `Name`. A union is a supertype that each alternative refines (0.1's `either` is gone).
- **has-a**: `(carries A B …)` says a value of `Name` holds values of `A`, `B`…: types only, no field
  names or counts (the sketch says those). A subtype carries what its supertype carries. Recursion and
  cycles are fine (a `Turn` may carry `Turn`s). `carries` never changes what a port accepts.

Each names declared message types; a carried type must be in scope where the message is declared, as a
port's type must be (§4). Only the first `refines` and the first `carries` count; a name twice in one
`carries` is a warning.

```sbtel
(message Event (sketch "Something the user did."))
(message Click (refines Event))
(message Key (refines Event))
(message Selection (sketch "The selected ids."))
(message Camera (sketch "Pan and zoom."))
(message Snapshot (carries Selection Camera) (~ What undo restores. ~))
```

Who carries a type, transitively, and which ports and blocks use those carriers, is the core's
`carriers`: `sbtel query spec msg:Camera` prints it under the type, and hovering a type in the viewer
outlines them.

### 3.7 `behavior` and `implements`

```lisp
(behavior Name (port …)… [(sketch "…")])
(behavior (Name Param …) (port p in Param)… [(sketch "…")])
(implements Name)
```

A behavior is a named promise: a set of ports plus a sketch of what holds when a block has them. A
block that `implements` it gains its ports. Several blocks implementing the same behavior share that
vocabulary.

A behavior may take **parameters**, written `(Name P …)`. A port typed with a parameter is not checked
against declared message types. `implements` names the behavior only (`(implements Store)`); there is
no syntax for arguments, and the ports keep the parameter as their type.

```sbtel
(message Event (sketch "One state change."))
(behavior (Store T)
  (port put in T)
  (port get out T)
  (sketch "Keeps values of T and returns them on request."))
(behavior Durable
  (port event in Event)
  (sketch "Retains every accepted event until it is acknowledged."))
(block Log
  (implements Store)
  (implements Durable)
  (sketch "An append-only event log."))
```

## 4. Scope

Behaviors and message types are **scoped**. A declaration inside block D is visible in D and in every
block nested in D, at any depth. A declaration at file level is visible everywhere.

- A block may implement only behaviors in its scope.
- A block's ports may use only message types in its scope.
- A behavior's ports may use only message types in scope **where the behavior is declared** (not where
  it is implemented).
- A message type may carry only message types in scope where it is declared.

Scope follows nesting, not levels: a message type declared in a block is visible to all of its
children in every level, and to none of its siblings.

```sbtel
(block App
  (message Order (sketch "A customer's order."))
  (level
    (block App.Checkout
      (message CardToken (sketch "Opaque payment token; never leaves Checkout."))
      (port order out Order)
      (level
        (block App.Checkout.Form (port token out CardToken)))
      (level
        (block App.Checkout.Gateway (port token in CardToken)))))
  (level
    (block App.Fulfilment (port order in Order))))
```

Declare a type in the smallest block that holds every use of it. Declaring everything at the top
works, but it hides which parts of the system share which data; lint notes each declaration that could
live lower (§7.5).

## 5. Levels and adjacency

Levels are the main idea. Read each block as a small **stratified design**: each level is a language
built from the levels below it, and the boundary between levels is an abstraction barrier.

- **Order.** Inside one holder (a block, or the file), levels are written top to bottom, and each
  level is built from the ones below it. Levels are numbered from the bottom: level 1 is the lowest.
  Code in level *i* may use level *j* only when *j* < *i*: a lower level has a lower number, as in
  "low-level". Lower levels know nothing of higher ones.
- **Same level.** Blocks in the same level are independent of each other, unless they are
  **adjacent**.
- **Names and sketches.** A level's `:name` is the vocabulary it offers upward ("Rational numbers as
  pairs"); its sketch, when the name does not already say it, is the barrier: what the level above may
  know of it. Binding messages name both: `level 2 "Routing" of Shell`.
- **Adjacency** is a declared coupling: an explicit, visible statement that these peers know each other
  concretely. Use it when two peers really are one cooperation split for clarity (an editor and its
  live preview). Use it sparingly; it is a braid you chose, not a way around the levels. Its sketch
  says why, in a few words.
- **Depth.** The rule is applied at the nearest common holder of the two blocks. A block deep inside
  level 2 may bind a block deep inside level 1 of the same holder.

## 6. Messages, bindings and `accepts`

There are two ways for parts to depend on each other:

- A **binding** is when code in block A *names* block B: it imports, calls, references or constructs
  it. Bindings must follow the levels (§8).
- A **message** is data exchanged where **neither side names the other**: A has an `out` port, B has
  an `in` port, and the counterpart is chosen elsewhere (by a higher level, a router, configuration, a
  bus). Messages are how levels and peers talk without binding.

Ports are typed with message types, and `accepts(U, T)` decides whether an `in U` port can receive
from an `out T` port:

1. U and T are the same type; or
2. T `refines` U, directly or through a chain (`DoubleClick` refines `Click` refines `Event`).

`carries` plays no part: a port that takes a `Snapshot` does not take the `Camera` inside it. With the
types of §3.6 (and `DoubleClick` refining `Click`):

| in U | out T | accepts | why |
|---|---|---|---|
| Event | Event | yes | same |
| Event | DoubleClick | yes | refines chain |
| Click | Event | no | refines goes one way |
| Key | Click | no | siblings |
| Camera | Snapshot | no | has-a is not is-a |

Lint does not require every port to be connected. `accepts` drives the viewer (selecting a port
highlights every block that can talk to it) and `sbtel diff`'s affected ports.

## 7. Lint: every check

`sbtel lint spec.sbtel` reports, in this order: warnings with positions
(`file:line:col: warning: …`), then rule failures (`file: <rule>: <failure>`), then placement notes
(`file:line:col: info: …`, §7.5), then a summary line. A parse error stops everything and prints one
line. The exit code is 1 when a warning, a failure or a parse error is reported; notes never change it.
Below, every check with a minimal failing spec and its exact output (the file is called `spec.sbtel`).

### 7.1 Parse errors

An unclosed string:

```sbtel fails
(block A (sketch "never closed))
```

```text
spec.sbtel:1:18: error: Unclosed string
```

A missing `)`; the position is the `(` that was never closed:

```sbtel fails
(block A
  (block B)
```

```text
spec.sbtel:1:1: error: Missing ")" for "("
```

An extra `)`:

```sbtel fails
(block A))
```

```text
spec.sbtel:1:10: error: Unexpected ")"
```

A tilde sketch with no closer; the position is the opener:

```sbtel fails
(block A
  (~ never closed ))
```

```text
spec.sbtel:2:3: error: Unterminated (~: no closing ~)
```

### 7.2 Model warnings

The forms 0.2 renamed or removed. `(layer …)` is now `(level …)`, with no alias; a union is a supertype
that each alternative refines. The viewer shows these too:

```sbtel fails
(block A
  (layer (block B)))
(message Input (either Click Key))
```

```text
spec.sbtel:2:3: warning: unknown form (layer) in block A (did you mean level?)
spec.sbtel:3:16: warning: either was removed in 0.2; declare each alternative with (refines Union) instead
spec.sbtel:3:1: info: Input is never used.
spec.sbtel: 2 problems (1 block, 0 behaviors, 1 message type)
```

A duplicate block name (the second block's id becomes `A#2`):

```sbtel fails
(block A)
(block A)
```

```text
spec.sbtel:2:1: warning: Duplicate block name A
spec.sbtel: 1 problem (2 blocks, 0 behaviors, 0 message types)
```

A duplicate message type or behavior (the later declaration wins):

```sbtel fails
(message M)
(message M)
(behavior B)
(behavior B)
```

```text
spec.sbtel:2:1: warning: Duplicate message M
spec.sbtel:4:1: warning: Duplicate behavior B
spec.sbtel:2:1: info: M is never used.
spec.sbtel:4:1: info: B is never used.
spec.sbtel: 2 problems (0 blocks, 1 behavior, 1 message type)
```

A port direction other than `in` or `out`:

```sbtel fails
(message M)
(block A (port x sideways M))
```

```text
spec.sbtel:2:10: warning: port direction must be in or out
spec.sbtel:1:1: info: M is declared at the top level but only used within A; it could live there.
spec.sbtel: 1 problem (1 block, 0 behaviors, 1 message type)
```

An adjacent group with one member:

```sbtel fails
(block Top
  (adjacent (block A)))
```

```text
spec.sbtel:2:3: warning: adjacent needs two or more members
spec.sbtel: 1 problem (2 blocks, 0 behaviors, 0 message types)
```

A level with no block:

```sbtel fails
(block Top
  (level))
```

```text
spec.sbtel:2:3: warning: level needs at least one block
spec.sbtel: 1 problem (1 block, 0 behaviors, 0 message types)
```

### 7.3 Structure warnings

Lint also reports text the model builder would otherwise drop silently.

An unknown form (often a typo):

```sbtel fails
(block A (skecth "typo"))
```

```text
spec.sbtel:1:10: warning: unknown form (skecth) in block A
spec.sbtel: 1 problem (1 block, 0 behaviors, 0 message types)
```

A form in a place where it has no meaning:

```sbtel fails
(port loose in Nothing)
(block Top
  (level (implements Nothing))
  (adjacent (block A) (block B) (port p in X)))
```

```text
spec.sbtel:3:3: warning: level needs at least one block
spec.sbtel:1:1: warning: (port) is not allowed in the file
spec.sbtel:3:10: warning: (implements) is not allowed in a level
spec.sbtel:4:33: warning: (port) is not allowed in an adjacent group
spec.sbtel: 4 problems (3 blocks, 0 behaviors, 0 message types)
```

A word or string that is not inside a form:

```sbtel fails
(block A "a stray string" oops)
```

```text
spec.sbtel:1:10: warning: stray string in block A (expected a form)
spec.sbtel:1:27: warning: stray oops in block A (expected a form)
spec.sbtel: 2 problems (1 block, 0 behaviors, 0 message types)
```

A list that does not start with a form name, and an empty list:

```sbtel fails
(block A ("sketch") ())
```

```text
spec.sbtel:1:10: warning: a form must start with its name in block A
spec.sbtel:1:21: warning: empty form () in block A
spec.sbtel: 2 problems (1 block, 0 behaviors, 0 message types)
```

A keyword after the body has started:

```sbtel fails
(block A (sketch "x") :type "Late")
```

```text
spec.sbtel:1:23: warning: keyword :type must come right after the name of block A
spec.sbtel: 1 problem (1 block, 0 behaviors, 0 message types)
```

A keyword without a value. The core takes the next item as the value, so the `sketch` here is lost:

```sbtel fails
(block A :type (sketch "x"))
```

```text
spec.sbtel:1:10: warning: keyword :type of block A needs a value
spec.sbtel: 1 problem (1 block, 0 behaviors, 0 message types)
```

A block, message or behavior without a name:

```sbtel fails
(block)
(message)
(behavior)
```

```text
spec.sbtel:1:1: warning: block needs a name
spec.sbtel:2:1: warning: message needs a name
spec.sbtel:3:1: warning: behavior needs a name, or (Name Param ...)
spec.sbtel: 3 problems (1 block, 1 behavior, 1 message type)
```

A malformed port, an extra item after the type, and two ports with one name:

```sbtel fails
(message M)
(block A
  (port x in)
  (port y out M extra)
  (port z in M)
  (port z out M))
```

```text
spec.sbtel:3:3: warning: port needs a name, a direction and a message type: (port name in|out Type)
spec.sbtel:4:17: warning: port y has extra items after its message type
spec.sbtel:6:3: warning: block A has two ports named z
spec.sbtel:1:1: info: M is declared at the top level but only used within A; it could live there.
spec.sbtel: 3 problems (1 block, 0 behaviors, 1 message type)
```

`implements` with anything but one name (arguments included), and `refines` with anything but one
name:

```sbtel fails
(message M)
(message N (refines M M))
(behavior (Store T) (port put in T))
(block A (implements (Store M)))
```

```text
spec.sbtel:2:12: warning: refines names exactly one message type
spec.sbtel:4:10: warning: implements names exactly one behavior
spec.sbtel:2:1: info: N is never used.
spec.sbtel:3:1: info: Store is declared at the top level but only used within A; it could live there.
spec.sbtel: 2 problems (1 block, 1 behavior, 2 message types)
```

A keyword a block does not take (`:type` is its only one):

```sbtel fails
(block A :fill "blue" :owner "team-a")
```

```text
spec.sbtel:1:10: warning: unknown keyword :fill in block A; a block takes only :type
spec.sbtel:1:23: warning: unknown keyword :owner in block A; a block takes only :type
spec.sbtel: 2 problems (1 block, 0 behaviors, 0 message types)
```

A level's keywords: `:name` is its only one, once, as a non-empty string, right after `level`:

```sbtel fails
(level :name "Top" :name "Again" :kind "x" (block A))
(level :name Bare (block B))
(level :name "" (block C))
(level :name (block D))
(level (block E) :name "late")
```

```text
spec.sbtel:1:20: warning: a level has more than one :name; only the first counts
spec.sbtel:1:34: warning: unknown keyword :kind in a level; a level takes only :name
spec.sbtel:2:14: warning: level :name takes a "string"
spec.sbtel:3:14: warning: level :name is empty
spec.sbtel:4:8: warning: keyword :name of a level needs a value
spec.sbtel:5:18: warning: keyword :name must come right after (level
spec.sbtel: 6 problems (5 blocks, 0 behaviors, 0 message types)
```

A second sketch on a level, on a port or anywhere else (in either form), something other than a sketch
after a port's type, and a sketch on a nested adjacent group:

```sbtel fails
(message M)
(level (~ one ~) (sketch "two")
  (block A (port p in M (~ a ~) (~ b ~)) (port q in M extra))
  (adjacent (block B) (adjacent (~ nested ~) (block C) (block D))))
```

```text
spec.sbtel:2:18: warning: a level has more than one (sketch); only the first counts
spec.sbtel:3:33: warning: port p has more than one (sketch); only the first counts
spec.sbtel:3:55: warning: port q has extra items after its message type
spec.sbtel:4:33: warning: a nested adjacent group has no sketch of its own; put it in the outer (adjacent)
spec.sbtel:1:1: info: M is declared at the top level but only used within A; it could live there.
spec.sbtel: 4 problems (4 blocks, 0 behaviors, 1 message type)
```

A `carries` with no name, the same name twice, and a second `carries`:

```sbtel fails
(message A)
(message B (carries))
(message C (carries A A) (carries B))
```

```text
spec.sbtel:2:12: warning: carries names one or more message types
spec.sbtel:3:23: warning: carries names A twice
spec.sbtel:3:26: warning: message C has more than one (carries); only the first counts
spec.sbtel:2:1: info: B is never used.
spec.sbtel:3:1: info: C is never used.
spec.sbtel: 3 problems (0 blocks, 0 behaviors, 3 message types)
```

A `sketch` without a string, and a second sketch:

```sbtel fails
(block A (sketch (block B)))
(block C (sketch "one") (sketch "two"))
```

```text
spec.sbtel:1:10: warning: sketch takes a "string"
spec.sbtel:2:25: warning: block C has more than one (sketch); only the first counts
spec.sbtel: 2 problems (2 blocks, 0 behaviors, 0 message types)
```

### 7.4 The five rules

**Every implemented behavior is declared.**

```sbtel fails
(block A (implements Missing))
```

```text
spec.sbtel: Every implemented behavior is declared: A → Missing
spec.sbtel: 1 problem (1 block, 0 behaviors, 0 message types)
```

**Behaviors are used only inside the block that declares them.** `Private` is visible in `Left` and
its descendants only:

```sbtel fails
(block Left
  (behavior Private (sketch "Only for Left and what is inside it.")))
(block Right (implements Private))
```

```text
spec.sbtel: Behaviors are used only inside the block that declares them: Right uses Private, declared in Left
spec.sbtel: 1 problem (2 blocks, 1 behavior, 0 message types)
```

**Every port uses a declared message type** (block ports and behavior ports; behavior parameters
excepted):

```sbtel fails
(block A (port x in Nothing))
(behavior B (port y out Nowhere))
```

```text
spec.sbtel: Every port uses a declared message type: A.x: Nothing
spec.sbtel: Every port uses a declared message type: B.y: Nowhere
spec.sbtel:2:1: info: B is never used.
spec.sbtel: 2 problems (1 block, 1 behavior, 0 message types)
```

**Message types are used only inside the block that declares them.** For a behavior, and for a
message that carries the type, the scope that counts is where the behavior or message is declared:

```sbtel fails
(block Left
  (message Secret (sketch "Left's own data.")))
(block Right (port s in Secret))
(behavior Leak (port s out Secret))
(message Bundle (carries Secret))
```

```text
spec.sbtel: Message types are used only inside the block that declares them: Right.s uses Secret, declared in Left
spec.sbtel: Message types are used only inside the block that declares them: Leak.s uses Secret, declared in Left
spec.sbtel: Message types are used only inside the block that declares them: Bundle carries Secret, declared in Left
spec.sbtel:4:1: info: Leak is never used.
spec.sbtel:5:1: info: Bundle is never used.
spec.sbtel: 3 problems (2 blocks, 1 behavior, 2 message types)
```

**`refines` and `carries` name declared types.**

```sbtel fails
(message A (refines Ghost))
(message B (carries A Phantom))
```

```text
spec.sbtel: refines and carries name declared types: A → Ghost
spec.sbtel: refines and carries name declared types: B → Phantom
spec.sbtel:2:1: info: B is never used.
spec.sbtel: 2 problems (0 blocks, 0 behaviors, 2 message types)
```

### 7.5 Placement notes

A message type or behavior belongs in the lowest block that holds all its users (the lowest common
ancestor; the file counts, as the top). Lint notes a declaration that sits higher than that, or that
nothing uses. Notes are information: they are not problems, never change the exit code, and the viewer
shows them in the checks popover, muted, with a "Move to …" that makes the move (one undo step). Lint
never suggests moving below the common ancestor: that is a scope failure.

- **Users of a message type T**: blocks with a port of type T (inherited from behaviors too); blocks
  with a port of a type that carries T (transitively) or refines T; and the places that must see T: where
  each such type, and each behavior with a port of one of them, is declared.
- **Users of a behavior**: the blocks that implement it.

```sbtel
(message Deep (sketch "Carried by Note at the top: it must stay where Note can see it."))
(message Note (carries Deep))
(message Unused)
(block Shell
  (message Selection (sketch "Only Shell.View uses it."))
  (level (block Shell.View (port sel in Selection)))
  (level (block Shell.Log (port n in Note))))
(block Other (port n out Note))
```

```text
spec.sbtel:3:1: info: Unused is never used.
spec.sbtel:5:3: info: Selection is declared in Shell but only used within Shell.View; it could live there.
spec.sbtel: ok (4 blocks, 0 behaviors, 4 message types)
```

`--json` gives each note as `{severity: "info", message, line, col, kind, name, in, home}`, where `home`
is the block id it could move to (`""` for the file) or null when nothing uses it.

## 8. Bindings and `sbtel check`

A **bindings file** lists who names whom in the code, one edge per line:

```lisp
Caller -> Callee            # optional location, e.g. src/caller.ts:12
```

- `Caller` and `Callee` are block ids. Spaces around `->` are optional; `A->B` is fine.
- Everything after the first `#` that follows whitespace is the location, free text. Put the file and
  line there: a reviewer needs it to judge the edge.
- Blank lines and lines whose first non-blank character is `#` are ignored. Any other line that is not
  exactly one edge (`A -> B -> C`, prose) is an error.
- A comment line `# VIOLATION: reason` directly above an edge is that edge's explanation: why the code
  breaks the levels there. Comment lines after it, up to the edge, continue the reason (joined with
  spaces); a blank line, another `# VIOLATION:`, a line that is not an edge or the end of the file ends
  it without explaining anything. `sbtel check` still counts the edge, prints the reason under it and
  counts the explained violations; the viewer (`sbtel open --bindings`) shows the reason beside it. A
  note that explains no edge, or sits on an allowed edge, is a warning: it is stale or misplaced.

```lisp
# VIOLATION: the store refreshes the UI itself; it should emit Changed.
Notes.Store -> Notes.Editor # src/store.ts:40
```

`sbtel check spec.sbtel --bindings edges.txt` judges every edge with the rule below. Let c be the
nearest common holder of A and B (a block, or the file), and a2, b2 the children of c on the way to A
and B.

| rule | allowed | when |
|---|---|---|
| `same` | yes | A is B |
| `descendant` | yes | B is inside A, at any depth |
| `lower-level` | yes | a2's level is above b2's level in c |
| `adjacent` | yes | a2 and b2 are in the same adjacent group |
| `ancestor` | **no** | A is inside B: a part may not bind the block that encloses it |
| `same-level` | **no** | a2 and b2 share a level of c but are not adjacent |
| `upward` | **no** | a2's level is below b2's |
| `unknown` | **no** | A or B is not a block of the spec (behaviors and message types are not blocks), or a block is not placed in a level |

Why is `ancestor` forbidden? A container is the composition of its parts. If a part names its
container, it depends on everything the container holds, including itself and the levels above it.
When a part needs something the container provides, that thing belongs in a lower level (or a message
type) of the container, where the part may reach it.

The output is one line per violation, `edges.txt:<line>: <caller> -> <callee>: <rule>: <text>`
(plus `  (<location>)`, and its reason on the next line when it has one), one line per invalid line,
one line per warning, then a summary that counts the bindings, the violations and the explained
violations. The exit code is 2 for invalid lines, otherwise 1 for violations (explained or not),
otherwise 0; warnings do not change it.

```sbtel
(block App
  (level
    (block UI
      (level (block Screen))
      (level (block Widgets)))
    (block CLI))
  (level
    (adjacent
      (block Orders)
      (block Billing))
    (block Audit))
  (level
    (block Store)))
(block Tools)
```

```edges
# allowed
UI -> Screen         # descendant
Screen -> Widgets    # lower level inside UI
Screen -> Store      # lower level of App, from deep inside UI
Orders -> Billing    # adjacent
Billing -> Orders    # adjacent works both ways
Store -> Store       # same
# not allowed
Screen -> UI         # src/ui/screen.ts:4
Store -> Orders      # src/store.go:88
Orders -> Audit      # src/orders/audit.go:12
UI -> CLI
App -> Tools
App -> Stor
this is not an edge
```

```text
edges.txt:9: Screen -> UI: ancestor: Screen is inside UI: a part may not bind to the block that encloses it  (src/ui/screen.ts:4)
edges.txt:10: Store -> Orders: upward: Store (level 1 of App) binds upward to Orders (level 2)  (src/store.go:88)
edges.txt:11: Orders -> Audit: same-level: Orders and Audit share level 2 of App but are not adjacent  (src/orders/audit.go:12)
edges.txt:12: UI -> CLI: same-level: UI and CLI share level 3 of App but are not adjacent
edges.txt:13: App -> Tools: same-level: App and Tools share level 1 of the file but are not adjacent
edges.txt:14: App -> Stor: unknown: Stor is not a block in the spec (did you mean Store?)
edges.txt:15: error: not an edge: this is not an edge
spec.sbtel: 12 bindings, 6 not allowed, 0 explained
```

With explanations, a stale one and one that a blank line cuts off. These levels are named, so the
messages name them too:

```sbtel
(block Notes
  (level :name "Editing" (block Notes.Editor))
  (level :name "Storage" (block Notes.Store)))
```

```edges
# VIOLATION: the store refreshes the UI itself;
#   it should emit Changed instead.
Notes.Store -> Notes.Editor   # src/store.ts:40
# VIOLATION: left over from an old levels
Notes.Editor -> Notes.Store   # src/editor.ts:9
# VIOLATION: cut off by the blank line below

Notes.Store -> Notes.Editor   # src/store.ts:77
```

```text
edges.txt:3: Notes.Store -> Notes.Editor: upward: Notes.Store (level 1 "Storage" of Notes) binds upward to Notes.Editor (level 2 "Editing")  (src/store.ts:40)
  VIOLATION: the store refreshes the UI itself; it should emit Changed instead.
edges.txt:8: Notes.Store -> Notes.Editor: upward: Notes.Store (level 1 "Storage" of Notes) binds upward to Notes.Editor (level 2 "Editing")  (src/store.ts:77)
edges.txt:5: warning: VIOLATION note on an allowed edge: Notes.Editor -> Notes.Store (lower-level)
edges.txt:6: warning: VIOLATION note explains no edge: a blank line follows it
spec.sbtel: 3 bindings, 2 not allowed, 1 explained
```

## 9. Annotations

Annotations tie code to spec elements, so that a tool or an agent can extract the bindings between
blocks. An annotation is the token `@sbtel` inside a line comment, in any language (`//`, `#`, `--`,
`;`, `%`, `'`, `<!-- … -->`, or `/* … */` on one line). There are four ownership forms and two
anchors, and no others:

| Form | Meaning |
|---|---|
| `@sbtel Name` | the next declaration (function, class, type, constant…) belongs to block `Name`. One per declaration: a second one before the same declaration is an error |
| `@sbtel begin Name` … `@sbtel end Name` | the region between belongs to `Name`. Regions nest; the innermost wins. The `end` name must match its `begin` |
| `@sbtel file Name` | from here to the end of the file belongs to `Name` |
| `@sbtel message Name` | anchor: where message type `Name`'s shape is defined in code. It owns no code |
| `@sbtel port Block.port` | anchor: where port `port` of block `Block` is handled. It owns no code |

An anchor changes no ownership: the lines after it belong to whoever owned them anyway, and an
`@sbtel Name` directly above an anchor still applies to the declaration below it.

```js
// @sbtel file Shell.Router
import { notify } from '../notices.js';

// @sbtel Shell.Keymap
export function chord(event) { /* … */ }

// @sbtel begin Shell.Clipboard
function copy(text) { /* … */ }
function paste() { /* … */ }
// @sbtel end Shell.Clipboard

// @sbtel Shell.Router
// @sbtel message Intent
// @sbtel port Shell.Router.intent
export function route(intent) { /* … */ }
```

```python
# @sbtel file Billing.Invoices
```

```html
<!-- @sbtel file App.Page -->
```

```go
//go:build linux

// @sbtel file Server.Detach

// Package server runs the shared localhost server.
package server
```

In Go, `@sbtel file` goes before the `package` clause (after any `//go:build` line), with a blank line
between it and the package doc comment so that godoc does not include it.

Each of these names a leaf block (here, the leaf blocks Billing.Invoices and App.Page): `@sbtel file`
with a container's name would make the whole file container code, which is an error (below).

Names use the spec's name syntax. An annotation checker reports: an unknown block name, or an
anchor's unknown message type or port; an `end` without a `begin` or with a different name; a `begin`
never ended; code in no block; code owned only by a container block (one with child levels), since
code belongs to leaves; and a second `@sbtel Name` before one declaration, or a second `@sbtel file`
in one file. Anything else after `@sbtel` is an error too: there is no long form. An `@sbtel` inside a
string literal is not an annotation, and a multi-line string literal stays in its declaration.
The sbtel-recover skill's `sbtel_owners.py` is such a checker.

To extract bindings, find every reference in code owned by block A to a declaration owned by block B
(A ≠ B), and write `A -> B  # file:line` for each. Extraction is per language and lives outside the
binary: the sbtel-recover skill
([extracting-bindings.md](../plugin/skills/sbtel-recover/extracting-bindings.md)) has the recipes,
with or without an import graph, and helper scripts. A `# VIOLATION: reason` comment line directly
above an edge explains why the code breaks the levels there; `sbtel check` prints it under the
violation and `sbtel open --bindings` shows it beside it (§8). [DESIGN.md §8](DESIGN.md) is the contract for the annotation forms.

## 10. The tool loop

| Command | Use |
|---|---|
| `sbtel lint spec.sbtel…` | every check of §7. Run it after every edit |
| `sbtel query spec.sbtel Id… [--with-deps]` | print the named elements (ids: block ids, `beh:Name`, `msg:Name`; headers print these as `β:Name` and `μ:Name`, which are accepted too) as a fragment that lints clean on its own, with the behaviors and message types they use (carried ones too); a message type's header line says which types carry it and which blocks' ports use those; `--with-deps` adds the blocks they may bind to as collapsed stubs. An unknown id is exit 2 |
| `sbtel check spec.sbtel --bindings edges.txt` | judge code bindings (§8) |
| `sbtel diff a.sbtel b.sbtel` | what changed between two versions |
| `sbtel open spec.sbtel` | open the diagram for the human; prints a session id |
| `sbtel inbox <id> --wait` | wait for, then print, what the human sent: reviews, comments, saves |
| `sbtel reply <id> <comment-id> "text"` | answer a comment (`c7`, `c7.1`) or a review (`r7`) in the open tab |
| `sbtel open spec.sbtel --session <id>` | push a new version to the open tab |

Every command, flag, output format and exit code is specified in [DESIGN.md §3](DESIGN.md).
