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
  (takes Type)                                  ; :in or :out, then a shape; named `type`
  (gives Type :as cmd (~ Only what the type does not say. ~))   ; :as names it; a sketch comes last
  (implements Behavior)                            ; one behavior name; its ports become this block's
  (shape Super :type "struct" (sketch "A general kind of data."))   ; :type: what it is in code
  (shape Type (refines Super))                   ; is-a: a Type is a Super
  (shape Pair (carries Type Super))              ; has-a: a Pair holds a Type and a Super
  (behavior Behavior :type "trait"                 ; a block's grammar: :type, sketch, ports, implements
    (takes Type :as p) (sketch "…"))            ; shared vocabulary, visible here and below
  (behavior (Store T) (takes T :as put))        ; a behavior with a parameter T
  (behavior Keeps (implements (Store Type)))       ; extends Store, with T = Type
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
| `(ref path [sketch])` | block, behavior, shape | a file the declaration stands for or rests on: `src/store.ts`, `src/store.ts:40-60` (lines), `"docs/a note.md#rollout"` (a heading) or a URL. A path is relative to the spec file and stays beside or below it. The viewer shows a count on the card and opens the file in a modal; `sbtel check` does not read refs |
| `(takes Shape [:as name] [sketch])` / `(gives Shape …)` | block, behavior | a port: what the block takes, or gives; named after its type (`NoteSaved` → `noteSaved`) unless `:as` names it |
| `(shape Name [:type "T"] …)` | file, block | a data type; `(sketch)`, `(refines T)`, `(carries A B…)` inside |
| `(behavior Name [:type "T"] …)` / `(behavior (Name P…) …)` | file, block | a named set of ports a block can promise; `(sketch)`, `(port …)`, `(implements …)` inside |
| `(implements Name)` / `(implements (Name Arg…))` | block, behavior | the block (or behavior) has that behavior's ports, and counts as implementing it |
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
  B may also be a **behavior**: code that calls through an interface binds the behavior, not its
  implementers, and that is allowed when the behavior is in A's scope (`abstraction`).
- **Messages** are data exchanged where neither side names the other: the counterpart is chosen
  elsewhere. Ports are typed with messages. `accepts(U, T)`: an `in U` port takes an `out T` value when
  U = T or T refines U (transitively). `carries` (has-a) never changes what a port accepts.
- **Scope.** A behavior or shape declared in block D is usable in D and everything inside D.
  Declared at file level, it is usable everywhere. Declare it where its users meet (lint notes it when
  it sits higher).
- **Ports.** `(takes NoteSaved)` is named `noteSaved`: the type's name with its first letter
  lowercased (§3.5). Write `:as name` only when that name is taken, as when two ports have one type:
  `(takes Item :as backlog)`. Port names are unique per block, inherited ports included.
- **`:type`** grounds a block, a behavior or a shape in code: what it is there (a module, a
  trait, a struct…). It shows as a pill. Keep the kinds consistent within a spec.
- **Names** are any run of characters without whitespace, `(`, `)`, `"` or `;`, so a path
  (`src/store.ts`), a kebab-case service (`billing-api`) and a dotted name (`Shell.Router`) are all
  names. No style is required: name a block what its reader would call it. Duplicate block names get ids `Name#2`, `Name#3`… and a warning.

**Checks** (`sbtel lint`): parse errors; model warnings (duplicates, two ports with one name, bad port
direction, `adjacent` with fewer than 2 members, empty level); structure warnings
(unknown or misplaced forms and keywords, stray words, malformed ports, levels and `carries`, second
sketches, blocks, levels and declarations inside a behavior…); six rules: every implemented behavior is
declared, behaviors are used in scope, every port's type is declared, shapes are used in scope,
`refines`/`carries` name declared types, and no behavior implements itself;
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
  (shape Edit (sketch "A change to one note's text."))
  (shape Saved (sketch "A note was written to disk."))
  (behavior Durable
    (takes Edit)
    (sketch "Keeps every accepted edit until it is on disk."))

  (level :name "Editing"
    (adjacent (~ The preview scrolls with the editor. ~)
      (block Notes.Editor
        (gives Edit)
        (sketch "The text area where the user types."))
      (block Notes.Preview
        (sketch "Renders the note beside the editor."))))
  (level :name "Storage"
    (~ Editing sends Edits; it never touches files. ~)
    (block Notes.Store
      :type "Store"
      (implements Durable)
      (gives Saved)
      (sketch "Writes notes to disk and reloads them on launch."))))
```

**Reading a slice.** `sbtel query` prints the named elements as a **fragment**: one spec that lints
clean on its own. It holds the elements' own source, their enclosing blocks as skeletons (header,
first sketch, and only the levels that lead to what is shown, with their names and sketches), and every
behavior and shape the shown text uses (the types they carry too), in the block that declares it. `--with-deps` also adds the blocks
the selection may bind to (lower levels and adjacent peers, of the element and of each of its
ancestors) as collapsed stubs. `sbtel query spec.sbtel Notes.Editor --with-deps` prints:

```text query Notes.Editor --with-deps
; sbtel query spec.sbtel Notes.Editor --with-deps
; Notes.Editor: block in Notes, lines 13-15
; may bind to (collapsed): Notes.Preview, Notes.Store
(block Notes :type "App"
  (sketch "Write notes, see them rendered, keep them on disk.")
  (shape Edit (sketch "A change to one note's text."))
  (shape Saved (sketch "A note was written to disk."))
  (behavior Durable
    (takes Edit)
    (sketch "Keeps every accepted edit until it is on disk."))
  (level :name "Editing"
    (adjacent
      (~ The preview scrolls with the editor. ~)
      (block Notes.Editor
        (gives Edit)
        (sketch "The text area where the user types."))
      (block Notes.Preview
        (sketch "Renders the note beside the editor."))))
  (level :name "Storage"
    (~ Editing sends Edits; it never touches files. ~)
    (block Notes.Store :type "Store"
      (implements Durable)
      (gives Saved)
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
  (`:type`, and the port directions `:in` and `:out`) are symbols. Unicode letters are fine.

A `;` outside a string starts a comment that runs to the end of the line. Whitespace is anything
JavaScript's `\s` matches, including Unicode spaces.

**The tilde sketch.** `(` followed directly by a run of k tildes opens one; the text runs to the first
k tildes followed by `)`. Nothing inside is special: quotes, `;`, `#`, backslashes, unbalanced parens,
`(~5 ms)` and `~/.sbtel/` are all text. For a text that contains `~)`, use more tildes on both ends:
`(~~ … ~~)` ends only at `~~)`, `(~~~ … ~~~)` only at `~~~)`, and so on. The tilde run is as long as it
goes, so put a space after it: `(~ ~)` is the empty sketch. An opener with no closer is a parse error at
the opener (§7.1).

Every form is a parenthesised list whose first item is a symbol naming the form. The twelve forms are
`block`, `level`, `adjacent`, `takes`, `gives`, `shape`, `refines`, `carries`, `behavior`, `implements`,
`ref` and `sketch`. Anything else is reported by lint (§7.3) and otherwise ignored.

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
(shape Request (sketch "An HTTP request."))
(level
  (block Frontend (gives Request :as call) (sketch "The browser app.")))
(level
  (block Backend (takes Request :as serve) (sketch "The API server.")))
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
warning; the viewer picks its own colours. Behaviors (§3.7) and shapes (§3.6) take `:type` the
same way, with the same warnings: a block says which code artifact it is, a behavior which abstraction
(`"trait"`, `"interface"`, `"Protocol"`, `"typeclass"`), a shape which data shape (`"struct"`,
`"record"`, `"protobuf message"`, `"JSON schema"`). It is optional: write it where it helps a reader
find the thing in the code.

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
(shape Path (~ A file path, like ~/.sbtel/sessions or "C:\Temp" (quotes and all). ~))
(shape Note (~~ Ends with ~) inside, so it takes two tildes. ~~))
(shape Long (~
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
(takes Type [:as name] [sketch])
(gives Type [:as name] [sketch])
```

A typed input or output of a block or a behavior. The direction keyword comes first, then `Type`, a
shape in scope (§4) or, in a behavior with parameters, one of its parameters. After the type, a
port may have `:as name`, then one sketch: write the sketch only when the type alone does not say what
the port promises (`(takes KeyChord (~ Opens the palette. ~))`).

**The port's name.** Without `:as`, a port is named after its type: the type's name with its first
letter lowercased, exactly as written otherwise.

| Type | Name |
|---|---|
| `NoteSaved` | `noteSaved` |
| `URL` | `uRL` |
| `Élan` | `élan` (Unicode lowercase of the first character) |
| `shell.Intent`, `pkg::Intent` | `intent` (a qualified type: its last component, after the last `.` or `:`) |
| `List<Item>`, `Map[K,V]` | `list`, `map` (a parameterized type: its arguments are dropped first) |
| `T` (a behavior's parameter) | `t`, whatever the implementer passes for `T` |

The viewer names a port it adds the same way (and adds `2`, `3`… when the name is taken). Write
`:as name` only when the default does not fit, typically because two ports of one block have the
same type: `(gives Item)` and `(takes Item :as backlog)`. `:as` with the default name
(`(takes Item :as item)`) is allowed and means the same; the viewer drops it when it rewrites the
port. Port names are unique within a block or behavior, counting the ports it gets from the behaviors
it implements: two ports with one name are a lint warning that says to tell them apart with `:as`.
The name is what everything else uses: anchors (`@sbtel port Block.noteSaved`, §9), `sbtel query`,
`sbtel diff` (writing the default name out with `:as`, or dropping it, is no change) and the viewer.
Renaming a shape renames the ports named after it, so give a port `:as` when its name must not
change with its type.

A block's ports are its own ports followed by the ports of every behavior it implements, sketches
included.

### 3.6 `message`, `refines`, `carries`

```lisp
(shape Name [:type "T"] [sketch] [(refines Super)] [(carries A B …)])
```

A shape is a kind of data. Two relations between types, and only these two:

- **is-a**: `(refines Super)` makes `Name` a subtype of `Super`: a port that takes `Super` also takes
  `Name`. A union is a supertype that each alternative refines .
- **has-a**: `(carries A B …)` says a value of `Name` holds values of `A`, `B`…: types only, no field
  names or counts (the sketch says those). A subtype carries what its supertype carries. Recursion and
  cycles are fine (a `Turn` may carry `Turn`s). `carries` never changes what a port accepts.

Each names declared shapes; a carried type must be in scope where the message is declared, as a
port's type must be (§4). `:type` says what the data is in code (§3.1): `(shape Edit :type "struct")`. Only the first `refines` and the first `carries` count; a name twice in one
`carries` is a warning.

```sbtel
(shape Event (sketch "Something the user did."))
(shape Click (refines Event))
(shape Key (refines Event))
(shape Selection (sketch "The selected ids."))
(shape Camera (sketch "Pan and zoom."))
(shape Snapshot (carries Selection Camera) (~ What undo restores. ~))
```

Who carries a type, transitively, and which ports and blocks use those carriers, is the core's
`carriers`: `sbtel query spec msg:Camera` prints it under the type, and hovering a type in the viewer
outlines them.

### 3.7 `behavior` and `implements`

```lisp
(behavior Name [:type "T"] (port …)… [(implements Other)…] [(sketch "…")])
(behavior (Name Param …) (takes Param :as p)… [(sketch "…")])
(implements Name)
(implements (Name Arg …))
```

A behavior is a named promise: a set of ports plus a sketch of what holds when a block has them. A
block that `implements` it gains its ports. Several blocks implementing the same behavior share that
vocabulary. A behavior is read with a block's grammar, keeping what has a meaning for a promise: the
name, `:type` (what the abstraction is in code: a trait, an interface, a Protocol…; §3.1), a sketch,
ports and `implements`.

**Extension.** `(implements Other)` inside a behavior extends Other, as a Rust supertrait, Java's
`interface A extends B` or a protocol built on another do. The behavior has Other's ports too, and a
block that implements it counts as implementing Other, transitively, everywhere "implementers of"
matters: scope, placement notes, the viewer's outline and port partners. Other must be in scope where
the behavior is declared (§4). A behavior that implements itself, through any chain (`A` implements `B`
implements `A`), fails the rule "No behavior implements itself" (§7.4).

**Parameters.** A behavior may take parameters, written `(Name P …)`. A port typed with a parameter is
not checked against declared shapes. `(implements Name)` leaves the parameters as they are (the
ports keep the parameter as their type). `(implements (Name Arg …))` passes one argument per parameter,
in order: each port typed with a parameter takes the argument's type, in the ports the implementer gets.
An argument is a shape in scope, or, inside a behavior with parameters, one of its own
parameters, which its own implementer's argument replaces in turn: `(behavior (Cache K) (implements
(Store K)))` and `(implements (Cache Entry))` give Store's ports the type Entry. Arguments must fill
every parameter (a warning otherwise).

**What a behavior does not contain.** Blocks, levels, adjacent groups, shapes and behaviors are
not allowed inside a behavior; each is a warning at its position, `behaviors don't contain blocks,
levels or declarations; declare … beside the behavior instead`, and is left out of the model.

```sbtel
(shape Event :type "struct" (sketch "One state change."))
(behavior (Store T) :type "trait"
  (takes T :as put)
  (gives T :as get)
  (sketch "Keeps values of T and returns them on request."))
(behavior Durable :type "trait"
  (implements (Store Event))
  (sketch "A Store of events that keeps every accepted one until it is acknowledged."))
(block Log
  (implements Durable)
  (sketch "An append-only event log."))
```

Log has the ports `put in Event` and `get out Event` (from Store, through Durable), and implements both
Durable and Store.

## 4. Scope

Behaviors and shapes are **scoped**. A declaration inside block D is visible in D and in every
block nested in D, at any depth. A declaration at file level is visible everywhere.

- A block may implement only behaviors in its scope; a behavior, only those in scope where it is
  declared. The shapes passed as arguments (`(implements (Store Event))`) follow the same rule.
- A block's ports may use only shapes in its scope.
- A behavior's ports may use only shapes in scope **where the behavior is declared** (not where
  it is implemented).
- A shape may carry only shapes in scope where it is declared.
- Code may bind a behavior only where the behavior is in scope (§8, the `abstraction` rule).

Scope follows nesting, not levels: a shape declared in a block is visible to all of its
children in every level, and to none of its siblings.

```sbtel
(block App
  (shape Order (sketch "A customer's order."))
  (level
    (block App.Checkout
      (shape CardToken (sketch "Opaque payment token; never leaves Checkout."))
      (gives Order)
      (level
        (block App.Checkout.Form (gives CardToken :as token)))
      (level
        (block App.Checkout.Gateway (takes CardToken :as token)))))
  (level
    (block App.Fulfilment (takes Order))))
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

Ports are typed with shapes, and `accepts(U, T)` decides whether an `in U` port can receive
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

A duplicate block name (the second block's id becomes `A#2`):

```sbtel fails
(block A)
(block A)
```

```text
spec.sbtel:2:1: warning: Duplicate block name A: a name identifies a block wherever it moves, so each needs its own (a more specific name, or parent/A)
spec.sbtel: 1 problem (2 blocks, 0 behaviors, 0 shapes)
```

A duplicate shape or behavior (the later declaration wins):

```sbtel fails
(shape M)
(shape M)
(behavior B)
(behavior B)
```

```text
spec.sbtel:2:1: warning: Duplicate shape M
spec.sbtel:4:1: warning: Duplicate behavior B
spec.sbtel:2:1: info: M is never used.
spec.sbtel:4:1: info: B is never used.
spec.sbtel: 2 problems (0 blocks, 1 behavior, 1 shape)
```

Two ports of one block or behavior with the same name: its own ports, its own and one it gets from a
behavior, or two from behaviors. A clash inside a behavior is reported on the behavior, not again on
every block that implements it:

```sbtel fails
(shape Item)
(behavior Feed (gives Item))
(block Queue
  (implements Feed)
  (takes Item)
  (takes Item))
(block Mixer (implements Feed) (implements Other))
(behavior Other (gives Item))
```

```text
spec.sbtel:6:3: warning: block Queue has two ports named item; tell them apart with :as
spec.sbtel:5:3: warning: block Queue has two ports named item: its own and one from behavior Feed; tell them apart with :as
spec.sbtel:7:32: warning: block Mixer has two ports named item, from behaviors Feed and Other; tell them apart with :as
spec.sbtel:8:1: info: Other is declared at the top level but only used within Mixer; it could live there.
spec.sbtel: 3 problems (2 blocks, 2 behaviors, 1 shape)
```

An adjacent group with one member:

```sbtel fails
(block Top
  (adjacent (block A)))
```

```text
spec.sbtel:2:3: warning: adjacent needs two or more members
spec.sbtel: 1 problem (2 blocks, 0 behaviors, 0 shapes)
```

What a behavior does not contain, and arguments that do not fill a behavior's parameters:

```sbtel fails
(shape M)
(behavior (Box T) (takes T :as b))
(behavior Durable
  (block Inner)
  (level (block L))
  (shape Mm)
  (implements (Box M M)))
```

```text
spec.sbtel:4:3: warning: behavior Durable: behaviors don't contain blocks, levels or declarations; declare block Inner beside the behavior instead
spec.sbtel:5:3: warning: behavior Durable: behaviors don't contain blocks, levels or declarations; declare the level beside the behavior instead
spec.sbtel:6:3: warning: behavior Durable: behaviors don't contain blocks, levels or declarations; declare shape Mm beside the behavior instead
spec.sbtel:7:3: warning: (implements (Box M M)) passes 2 arguments, but Box takes 1
spec.sbtel:3:1: info: Durable is never used.
spec.sbtel: 4 problems (0 blocks, 2 behaviors, 1 shape)
```

A level with no block:

```sbtel fails
(block Top
  (level))
```

```text
spec.sbtel:2:3: warning: level needs at least one block
spec.sbtel: 1 problem (1 block, 0 behaviors, 0 shapes)
```

### 7.3 Structure warnings

Lint also reports text the model builder would otherwise drop silently.

An unknown form (often a typo):

```sbtel fails
(block A (skecth "typo"))
```

```text
spec.sbtel:1:10: warning: unknown form (skecth) in block A
spec.sbtel: 1 problem (1 block, 0 behaviors, 0 shapes)
```

A form in a place where it has no meaning:

```sbtel fails
(takes Nothing :as loose)
(block Top
  (level (implements Nothing))
  (adjacent (block A) (block B) (takes X :as p)))
```

```text
spec.sbtel:3:3: warning: level needs at least one block
spec.sbtel:1:1: warning: (takes) is not allowed in the file
spec.sbtel:3:10: warning: (implements) is not allowed in a level
spec.sbtel:4:33: warning: (takes) is not allowed in an adjacent group
spec.sbtel: 4 problems (3 blocks, 0 behaviors, 0 shapes)
```

A word or string that is not inside a form:

```sbtel fails
(block A "a stray string" oops)
```

```text
spec.sbtel:1:10: warning: stray string in block A (expected a form)
spec.sbtel:1:27: warning: stray oops in block A (expected a form)
spec.sbtel: 2 problems (1 block, 0 behaviors, 0 shapes)
```

A list that does not start with a form name, and an empty list:

```sbtel fails
(block A ("sketch") ())
```

```text
spec.sbtel:1:10: warning: a form must start with its name in block A
spec.sbtel:1:21: warning: empty form () in block A
spec.sbtel: 2 problems (1 block, 0 behaviors, 0 shapes)
```

A keyword after the body has started:

```sbtel fails
(block A (sketch "x") :type "Late")
```

```text
spec.sbtel:1:23: warning: keyword :type must come right after the name of block A
spec.sbtel: 1 problem (1 block, 0 behaviors, 0 shapes)
```

A keyword without a value. The core takes the next item as the value, so the `sketch` here is lost:

```sbtel fails
(block A :type (sketch "x"))
```

```text
spec.sbtel:1:10: warning: keyword :type of block A needs a value
spec.sbtel: 1 problem (1 block, 0 behaviors, 0 shapes)
```

A block, shape or behavior without a name:

```sbtel fails
(block)
(shape)
(behavior)
```

```text
spec.sbtel:1:1: warning: block needs a name
spec.sbtel:2:1: warning: shape needs a name
spec.sbtel:3:1: warning: behavior needs a name, or (Name Param ...)
spec.sbtel: 3 problems (1 block, 1 behavior, 1 shape)
```

A port without a type, an extra item after the type (a single word gets a hint), an unknown keyword,
`:as` without a name, and so two ports with one name (both `m`):

```sbtel fails
(shape M)
(block A
  (takes)
  (gives M :as y extra)
  (takes M :as w :sort 1)
  (takes M :as)
  (gives M source))
```

```text
spec.sbtel:7:3: warning: block A has two ports named m; tell them apart with :as
spec.sbtel:3:3: warning: takes needs a shape: (takes Shape [:as name])
spec.sbtel:4:18: warning: port y has extra items after its shape
spec.sbtel:5:18: warning: unknown keyword :sort in a port; a port takes only :as name
spec.sbtel:6:12: warning: keyword :as of a port needs a name
spec.sbtel:7:12: warning: port m has extra items after its shape (to name it, write :as source)
spec.sbtel:1:1: info: M is declared at the top level but only used within A; it could live there.
spec.sbtel: 6 problems (1 block, 0 behaviors, 1 shape)
```

A second `:as` counts once too (`port w has more than one :as; only the first counts`).

`implements` with anything but one name or one `(Name Arg …)` list, and `refines` with anything but
one name:

```sbtel fails
(shape M)
(shape N (refines M M))
(behavior (Store T) (takes T :as put))
(block A (implements Store Store))
```

```text
spec.sbtel:2:10: warning: refines names exactly one shape
spec.sbtel:4:10: warning: implements names exactly one behavior, as Name or (Name Arg ...)
spec.sbtel:2:1: info: N is never used.
spec.sbtel:3:1: info: Store is declared at the top level but only used within A; it could live there.
spec.sbtel: 2 problems (1 block, 1 behavior, 2 shapes)
```

A keyword a block, a behavior or a shape does not take (`:type` is the only one):

```sbtel fails
(block A :fill "blue" :owner "team-a")
(behavior B :kind "trait")
(shape C :fill "red")
```

```text
spec.sbtel:1:10: warning: unknown keyword :fill in block A; a block takes only :type
spec.sbtel:1:23: warning: unknown keyword :owner in block A; a block takes only :type
spec.sbtel:2:13: warning: unknown keyword :kind in behavior B; a behavior takes only :type
spec.sbtel:3:10: warning: unknown keyword :fill in shape C; a shape takes only :type
spec.sbtel:2:1: info: B is never used.
spec.sbtel:3:1: info: C is never used.
spec.sbtel: 4 problems (1 block, 1 behavior, 1 shape)
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
spec.sbtel: 6 problems (5 blocks, 0 behaviors, 0 shapes)
```

A second sketch on a level, on a port or anywhere else (in either form), something other than a sketch
after a port's type, and a sketch on a nested adjacent group:

```sbtel fails
(shape M)
(level (~ one ~) (sketch "two")
  (block A (takes M :as p (~ a ~) (~ b ~)) (takes M :as q extra))
  (adjacent (block B) (adjacent (~ nested ~) (block C) (block D))))
```

```text
spec.sbtel:2:18: warning: a level has more than one (sketch); only the first counts
spec.sbtel:3:35: warning: port p has more than one (sketch); only the first counts
spec.sbtel:3:59: warning: port q has extra items after its shape
spec.sbtel:4:33: warning: a nested adjacent group has no sketch of its own; put it in the outer (adjacent)
spec.sbtel:1:1: info: M is declared at the top level but only used within A; it could live there.
spec.sbtel: 4 problems (4 blocks, 0 behaviors, 1 shape)
```

A `carries` with no name, the same name twice, and a second `carries`:

```sbtel fails
(shape A)
(shape B (carries))
(shape C (carries A A) (carries B))
```

```text
spec.sbtel:2:10: warning: carries names one or more shapes
spec.sbtel:3:21: warning: carries names A twice
spec.sbtel:3:24: warning: shape C has more than one (carries); only the first counts
spec.sbtel:2:1: info: B is never used.
spec.sbtel:3:1: info: C is never used.
spec.sbtel: 3 problems (0 blocks, 0 behaviors, 3 shapes)
```

A `sketch` without a string, and a second sketch:

```sbtel fails
(block A (sketch (block B)))
(block C (sketch "one") (sketch "two"))
```

```text
spec.sbtel:1:10: warning: sketch takes a "string"
spec.sbtel:2:25: warning: block C has more than one (sketch); only the first counts
spec.sbtel: 2 problems (2 blocks, 0 behaviors, 0 shapes)
```

### 7.4 The six rules

**Every implemented behavior is declared.**

```sbtel fails
(block A (implements Missing))
```

```text
spec.sbtel: Every implemented behavior is declared: A → Missing
spec.sbtel: 1 problem (1 block, 0 behaviors, 0 shapes)
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
spec.sbtel: 1 problem (2 blocks, 1 behavior, 0 shapes)
```

**Every port uses a declared shape** (block ports and behavior ports; behavior parameters
excepted):

```sbtel fails
(block A (takes Nothing :as x))
(behavior B (gives Nowhere :as y))
```

```text
spec.sbtel: Every port uses a declared shape: A.x: Nothing
spec.sbtel: Every port uses a declared shape: B.y: Nowhere
spec.sbtel:2:1: info: B is never used.
spec.sbtel: 2 problems (1 block, 1 behavior, 0 shapes)
```

**Shapes are used only inside the block that declares them.** For a behavior, and for a
message that carries the type, the scope that counts is where the behavior or message is declared:

```sbtel fails
(block Left
  (shape Secret (sketch "Left's own data.")))
(block Right (takes Secret :as s))
(behavior Leak (gives Secret :as s))
(shape Bundle (carries Secret))
```

```text
spec.sbtel: Shapes are used only inside the block that declares them: Right.s uses Secret, declared in Left
spec.sbtel: Shapes are used only inside the block that declares them: Leak.s uses Secret, declared in Left
spec.sbtel: Shapes are used only inside the block that declares them: Bundle carries Secret, declared in Left
spec.sbtel:4:1: info: Leak is never used.
spec.sbtel:5:1: info: Bundle is never used.
spec.sbtel: 3 problems (2 blocks, 1 behavior, 2 shapes)
```

**No behavior implements itself**, through any chain of `implements`. Each cycle is reported once,
from its first behavior in the file:

```sbtel fails
(behavior A (implements B))
(behavior B (implements C))
(behavior C (implements A))
(behavior Self (implements Self))
```

```text
spec.sbtel: No behavior implements itself: A → B → C → A
spec.sbtel: No behavior implements itself: Self → Self
spec.sbtel:4:1: info: Self is never used.
spec.sbtel: 2 problems (0 blocks, 4 behaviors, 0 shapes)
```

**`refines` and `carries` name declared types.**

```sbtel fails
(shape A (refines Ghost))
(shape B (carries A Phantom))
```

```text
spec.sbtel: refines and carries name declared types: A → Ghost
spec.sbtel: refines and carries name declared types: B → Phantom
spec.sbtel:2:1: info: B is never used.
spec.sbtel: 2 problems (0 blocks, 0 behaviors, 2 shapes)
```

### 7.5 Placement notes

A shape or behavior belongs in the lowest block that holds all its users (the lowest common
ancestor; the file counts, as the top). Lint notes a declaration that sits higher than that, or that
nothing uses. Notes are information: they are not problems, never change the exit code, and the viewer
shows them in the checks popover, muted, with a "Move to …" that makes the move (one undo step). Lint
never suggests moving below the common ancestor: that is a scope failure.

- **Users of a shape T**: blocks with a port of type T (inherited from behaviors too); blocks
  with a port of a type that carries T (transitively) or refines T; and the places that must see T: where
  each such type, and each behavior with a port of one of them, is declared.
- **Users of a behavior**: the blocks that implement it, directly or through behaviors that extend it,
  and the places where each behavior that implements it directly is declared (it must be visible
  there). Lint does not read bindings, so a behavior that code calls through (§8) and that is
  declared where its callers can see it may still get a note that it could live lower, beside its
  implementers: keep it where the callers see it, and say why in a `;` comment.

```sbtel
(shape Deep (sketch "Carried by Note at the top: it must stay where Note can see it."))
(shape Note (carries Deep))
(shape Unused)
(block Shell
  (shape Selection (sketch "Only Shell.View uses it."))
  (level (block Shell.View (takes Selection :as sel)))
  (level (block Shell.Log (takes Note :as n))))
(block Other (gives Note :as n))
```

```text
spec.sbtel:3:1: info: Unused is never used.
spec.sbtel:5:3: info: Selection is declared in Shell but only used within Shell.View; it could live there.
spec.sbtel: ok (4 blocks, 0 behaviors, 4 shapes)
```

`--json` gives each note as `{severity: "info", message, line, col, kind, name, in, home}`, where `home`
is the block id it could move to (`""` for the file) or null when nothing uses it.

## 8. Bindings and `sbtel check`

A **bindings file** lists who names whom in the code, one edge per line:

```lisp
Caller -> Callee            # optional location, e.g. src/caller.ts:12
```

- `Caller` is a block id. `Callee` is a block id or a behavior's name (`beh:Name` names the behavior
  explicitly). Spaces around `->` are optional; `A->B` is fine.
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
| `abstraction` | yes | B is a behavior in A's scope: declared in A, in an ancestor of A, or in the file |
| `scope` | **no** | B is a behavior declared outside A's scope |
| `unknown` | **no** | A is not a block, B is neither a block nor a behavior (shape types are neither), or a block is not placed in a level |

**Calls through an abstraction.** When code in A calls through an interface, trait or protocol that a
behavior stands for, the binding is `A -> Behavior`, not A to whichever block implements it: A names
the abstraction only. The composition root, the code that builds the implementer and hands it to A,
binds the implementer. That is dependency inversion, and `abstraction` makes it checkable: A may bind
the behavior wherever its scope reaches, whatever level the implementers sit in. A block and a
behavior may share a name (they are separate namespaces): a bare name binds the block, with a warning,
and `beh:Name` binds the behavior. An unknown name gets a "did you mean" over blocks and behaviors.

```sbtel
(block Notes
  (behavior Durable :type "interface" (sketch "Keeps edits until they are on disk."))
  (level (block Notes.Root (sketch "Makes the store and hands it to the editor.")))
  (level (block Notes.Editor (sketch "Saves through a Durable it is given.")))
  (level (block Notes.Store (implements Durable))))
(block Tools)
```

```edges
Notes.Editor -> Durable      # src/editor.ts:7  calls d.save()
Notes.Root -> Notes.Editor   # src/main.ts:3
Notes.Root -> Notes.Store    # src/main.ts:3   the composition root
Tools -> Durable             # tools/dump.ts:2
Tools -> Durabel
```

```text
edges.txt:4: Tools -> Durable: scope: Tools binds Durable, declared in Notes: a behavior is used only inside the block that declares it  (tools/dump.ts:2)
edges.txt:5: Tools -> Durabel: unknown: Durabel is not a block or a behavior in the spec (did you mean Durable?)
spec.sbtel: 5 bindings, 2 not allowed, 0 explained
```

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
edges.txt:14: App -> Stor: unknown: Stor is not a block or a behavior in the spec (did you mean Store?)
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
| `@sbtel Name` | the next declaration (function, class, type, constant…) belongs to block `Name`, or to behavior `Name` when it is an interface, trait, protocol or typedef that the behavior stands for (`beh:Name` when a block has that name too). One per declaration: a second one before the same declaration is an error |
| `@sbtel begin Name` … `@sbtel end Name` | the region between belongs to `Name`. Regions nest; the innermost wins. The `end` name must match its `begin` |
| `@sbtel file Name` | from here to the end of the file belongs to `Name` |
| `@sbtel shape Name` | anchor: where shape `Name` is defined in code. It owns no code |
| `@sbtel port Block.port` | anchor: where port `port` of block `Block` is handled; `port` is the port's name, the default one when it has no `:as` (`Shell.Router.intent` for `(takes Intent)`). It owns no code |

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
anchor's unknown shape or port; an `end` without a `begin` or with a different name; a `begin`
never ended; code in no block; code owned only by a container block (one with child levels), since
code belongs to leaves; and a second `@sbtel Name` before one declaration, or a second `@sbtel file`
in one file. Anything else after `@sbtel` is an error too: there is no long form. An `@sbtel` inside a
string literal is not an annotation, and a multi-line string literal stays in its declaration.
The sbtel-recover skill's `sbtel_owners.py` is such a checker.

To extract bindings, find every reference in code owned by block A to a declaration owned by block B
(A ≠ B), and write `A -> B  # file:line` for each. A reference to a declaration owned by a behavior X
is `A -> X` (a call through the abstraction, §8), except one that states that A implements X (`impl
Durable for Store`, `class Store implements Durable`, Go's `var _ Durable = (*Store)(nil)`): that is an
implements relation, not a binding, and the spec should say `(implements X)` in A. The code of a
behavior's own declaration binds nothing: its signature is the behavior's ports. Extraction is per language and lives outside the
binary: the sbtel-recover skill
([extracting-bindings.md](../plugin/skills/sbtel-recover/extracting-bindings.md)) has the recipes,
with or without an import graph, and helper scripts. A `# VIOLATION: reason` comment line directly
above an edge explains why the code breaks the levels there; `sbtel check` prints it under the
violation and `sbtel open --bindings` shows it beside it (§8). [DESIGN.md §8](DESIGN.md) is the contract for the annotation forms.

## 10. The tool loop

| Command | Use |
|---|---|
| `sbtel lint spec.sbtel…` | every check of §7. Run it after every edit |
| `sbtel query spec.sbtel Id… [--with-deps]` | print the named elements (ids: block ids, `beh:Name`, `msg:Name`; headers print these as `β:Name` and `μ:Name`, which are accepted too) as a fragment that lints clean on its own, with the behaviors and shapes they use (carried ones too); a shape's header line says which types carry it and which blocks' ports use those; `--with-deps` adds the blocks they may bind to as collapsed stubs. An unknown id is exit 2 |
| `sbtel check spec.sbtel --bindings edges.txt` | judge code bindings (§8) |
| `sbtel diff a.sbtel b.sbtel` | what changed between two versions |
| `sbtel open spec.sbtel` | open the diagram for the human; prints a session id |
| `sbtel inbox <id> --wait` | wait for, then print, what the human sent: reviews, comments, saves |
| `sbtel reply <id> <comment-id> "text"` | answer a comment (`c7`, `c7.1`) or a review (`r7`) in the open tab |
| `sbtel open spec.sbtel --session <id>` | push a new version to the open tab |

Every command, flag, output format and exit code is specified in [DESIGN.md §3](DESIGN.md).
