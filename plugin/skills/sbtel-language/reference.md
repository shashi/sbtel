# sbtel language reference (compact)

This is the agent's copy of the language reference. The repository's `docs/LANGUAGE.md` is the long
version, with a failing example for every check.

## Contents

- Lexical syntax
- Forms
- Levels, adjacency and bindings
- Scope
- `accepts`
- Lint messages
- Bindings file and `sbtel check`
- Annotations

## Lexical syntax

- Tokens: `(`, `)`, strings `"…"` (a backslash takes the next character literally; strings may span
  lines), symbols (runs without whitespace, `(`, `)`, `"` or `;`), and tilde sketches.
- **Tilde sketch**: `(` and a run of k tildes open it; the first k tildes followed by `)` close it.
  Nothing inside is special (quotes, `;`, `#`, parens, backslashes). It reads as `(sketch "text")`, the
  text trimmed and whitespace runs collapsed to one space, except a run with two or more line breaks,
  which is a paragraph break (`\n\n`). `(sketch "…")` collapses every run. An opener with no closer is
  a parse error at the opener.
- `;` starts a comment that runs to the end of the line.
- A form is `(head …)`, where head is one of: `block level adjacent port message refines carries
  behavior implements sketch`.
- Positions are `line:col`, both 1-based.

## Forms

| Form | Allowed in | Notes |
|---|---|---|
| `(block Name [:type T] body…)` | file, block, level, adjacent | `:type` (the kind of code artifact) is the only keyword. Body: sketch, port, implements, message, behavior, level, adjacent, block |
| `(level [:name "N"] m…)` | file, block | members are blocks and adjacent groups, at least one block, plus one sketch. Levels run **top to bottom** in source order. `:name` is a label: any non-empty string, never referenced |
| bare blocks and adjacent groups | file, block | consecutive ones form one *implicit level*; an explicit `(level)` ends the run |
| `(adjacent m…)` | file, block, level, adjacent | at least 2 members, plus one sketch; nested groups flatten into one (their sketch is the outer group's) |
| `(takes Shape [:as name] [sketch])` / `(gives Shape …)` | block, behavior | the shape, an optional `:as name`, then at most a sketch. The name defaults to the type's name with its first letter lowercased (`NoteSaved` → `noteSaved`; a qualified type's last component after `.` or `:`; type arguments `<…>`/`[…]` dropped; a behavior parameter `T` → `t`). Port names are unique per element, inherited ports included; write `:as` only to tell two apart. A behavior's port sketches go to its implementers |
| `(shape Name [:type T] …)` | file, block | `:type` (the data shape in code) is the only keyword; holds `sketch`, `refines`, `carries` |
| `(refines Super)` | message | is-a; exactly one name |
| `(carries A B …)` | message | has-a; one or more names, each once, in scope where the message is declared; a subtype carries what its supertype carries; cycles are fine |
| `(behavior Name [:type T] …)` / `(behavior (Name P…) …)` | file, block | read with a block's grammar: `:type` (the abstraction in code) is the only keyword; holds `port`, `sketch`, `implements`, never blocks, levels, adjacent groups or declarations; ports typed with a parameter P are not checked |
| `(implements Name)` / `(implements (Name Arg…))` | block, behavior | the block or behavior gains the behavior's ports (and those of what it extends) and counts as implementing it; arguments, one per parameter, retype the ports typed with it (a behavior may pass its own parameters on) |
| `(sketch "text")`, `(~ text ~)` | block, message, behavior, level, adjacent, port | only the first sketch counts |

A duplicate block name gets the id `Name#2`, `Name#3`, and so on. For a duplicate message or behavior,
the later declaration wins.

## Levels, adjacency and bindings

A binding means code in block A names block B. Let c be the nearest common holder of A and B (a block,
or the file), and a2, b2 the children of c on the way down to A and B.

| rule | ok | when | text (for failures) |
|---|---|---|---|
| `same` | yes | A is B | |
| `descendant` | yes | B is inside A | |
| `lower-level` | yes | a2's level is above b2's in c | |
| `adjacent` | yes | a2 and b2 are in one adjacent group | |
| `ancestor` | no | A is inside B | `A is inside B: a part may not bind to the block that encloses it` |
| `same-level` | no | same level, different groups | `a2 and b2 share level N of c but are not adjacent` |
| `upward` | no | a2's level is below b2's | `a2 (level N of c) binds upward to b2 (level M)` |
| `abstraction` | yes | B is a behavior in A's scope | |
| `scope` | no | B is a behavior out of A's scope | `A binds B, declared in D: a behavior is used only inside the block that declares it` |
| `unknown` | no | not a block (caller), not a block or behavior (callee), or not placed in a level | `X is not a block in the spec`, `X is not a block or a behavior in the spec` (plus a hint), `X is not in a level of c` |

A named level reads `level N "Name"` in these texts.

"c" is a block name, or `the file`.

## Scope

A shape or behavior declared in block D is visible in D and in every block nested in D. A
file-level declaration is visible everywhere. Blocks may implement behaviors, and type their ports
with messages, only from their scope. A behavior's port types must be in scope where the behavior is
declared, and a message's carried types where the message is declared.

## `accepts`

`accepts(U, T)`: an `in U` port can receive from an `out T` port when one of these holds:

1. U = T.
2. T refines U, directly or through a chain.

`carries` plays no part.

Lint doesn't require ports to be connected. `accepts` drives the viewer's "who can talk to whom"
highlight, and the affected ports in `sbtel diff`.

```sbtel
(shape Event)
(shape Click (refines Event))
(shape Key (refines Event))
(block Source (gives Click :as out1))
(block Sink (takes Event :as in1))
```

Here `Sink.in1` accepts `Source.out1`, because Click refines Event.

## Lint messages

Output order: warnings (`file:L:C: warning: …`), then rule failures (`file: <label>: <failure>`), then
placement notes (`file:L:C: info: …`), then a summary line. A parse error prints only
`file:L:C: error: …`.

**Parse errors**: `Unclosed string`; `Missing ")" for "("` (at the unclosed `(`); `Unexpected ")"`;
`Unterminated (~: no closing ~)` (at the opener; more tildes as written).

**Model warnings**:

- `Duplicate block name X`
- `Duplicate message X`
- `Duplicate behavior X`
- `port direction must be :in or :out` (with ` (write :in, not in)` for a bare `in` or `out`)
- `(port chord in KeyChord) is the 0.2 form; write (takes KeyChord :as chord)`: `:as` only when the
  name is not the default one, `…` before the `)` when the port has a sketch (`sbtel fmt
  --migrate-ports spec.sbtel` rewrites them all)
- `block X has two ports named p; tell them apart with :as`, `block X has two ports named p: its own and
  one from behavior B; tell them apart with :as`, `block X has two ports named p, from behaviors B and C;
  tell them apart with :as` (likewise `behavior X`; a clash inside a behavior is reported only there)
- `adjacent needs two or more members`
- `level needs at least one block`
- `unknown form (layer) in W (did you mean level?)`
- `either was removed in 0.2; declare each alternative with (refines Union) instead`
- `behavior B: behaviors don't contain blocks, levels or declarations; declare block X beside the
  behavior instead` (or `the level`, `the adjacent group`, `message M`, `behavior N`)
- `(implements (Store A B)) passes 2 arguments, but Store takes 1`

**Structure warnings** (W is `the file`, `block X`, `a level`, `an adjacent group`, `message X`,
`behavior X`):

- `unknown form (h) in W`
- `(h) is not allowed in W`
- `stray string in W (expected a form)`, or `stray <symbol> in W (expected a form)` for a bare word
- `a form must start with its name in W`, `empty form () in W`
- `keyword :k must come right after the name of block X`, `keyword :k of block X needs a value`,
  `unknown keyword :k in block X; a block takes only :type` (likewise `behavior X` and `message X`)
- `unknown keyword :k in a level; a level takes only :name`, `a level has more than one :name; only
  the first counts`, `level :name takes a "string"`, `level :name is empty`, `keyword :name of a level
  needs a value`, `keyword :k must come right after (level`
- `a nested adjacent group has no sketch of its own; put it in the outer (adjacent)`
- `carries names one or more shapes`, `carries names X twice`
- `block needs a name`, `message needs a name`, `behavior needs a name, or (Name Param ...)`
- `port needs a shape after :in: (takes Type [:as name])` (likewise `:out`)
- `port p has extra items after its shape`, plus ` (to name it, write :as w)` when the one extra
  item is a word
- `unknown keyword :k in a port; a port takes only :as name`, `keyword :as of a port needs a name`,
  `port p has more than one :as; only the first counts`
- `implements names exactly one behavior, as Name or (Name Arg ...)`, `refines names exactly one shape`
- `sketch takes a "string"`, `W has more than one (sketch); only the first counts` (likewise for
  `refines` and `carries`; W may be `a level`, `an adjacent group` or `port p`)

**Rules** (label: failure):

- `Every implemented behavior is declared: A → Name`
- `Behaviors are used only inside the block that declares them: A uses B, declared in D`
- `Every port uses a declared shape: A.port: Type`
- `Shapes are used only inside the block that declares them: A.port uses T, declared in D` (or
  `M carries T, declared in D`)
- `refines and carries name declared types: M → Name`
- `No behavior implements itself: A → B → A`

**Placement notes** (information; never a problem or an exit code): `X is declared in A but only used
within B; it could live there.` (A and B may be `the top level`), and `X is never used.` Users of a
shape: blocks with ports of it, of a type that carries it, or of a subtype; and where those
types, and behaviors with such ports, are declared. Users of a behavior: its implementers (through
behaviors that extend it too) and where those extending behaviors are declared. Lint reads no bindings,
so a behavior declared where its callers see it may be noted as one that could live lower: keep it.

## Bindings file and `sbtel check`

```lisp
# comment lines and blank lines are ignored
Caller -> Callee              # free-text location, e.g. src/a.ts:12
A->B
# VIOLATION: why the code breaks the levels here;
#   further comment lines continue the reason.
Low -> High                   # src/low.ts:7
```

Callers are block ids; a callee is a block id or a behavior (`beh:Name` when a block has the same
name: a bare name binds the block, with a warning). The location starts at the first `#` that follows whitespace. Any
other line that isn't exactly one edge is `invalid`, which makes the exit code 2. A `# VIOLATION:`
line explains the edge right under its run of comment lines; a blank line, another `# VIOLATION:`,
a non-edge line or the end of the file before an edge leaves it explaining nothing.

`sbtel check spec --bindings edges.txt` prints:

- one line per violation: `edges.txt:N: A -> B: <rule>: <text>  (<location>)`, and under it
  `  VIOLATION: <reason>` when it is explained;
- one line per invalid line: `edges.txt:N: error: not an edge: <text>`;
- one line per warning: `edges.txt:N: warning: VIOLATION note explains no edge: ...` or
  `... VIOLATION note on an allowed edge: A -> B (<rule>)` (a stale or misplaced reason);
- a summary: `spec: N bindings, N not allowed`, plus `, N explained` when some are not allowed.

The exit code is 2 for invalid lines, 1 for violations (explained or not), and 0 otherwise; warnings
do not change it. `--json` gives each violation its `note`, and `warnings` and `explained`.

## Annotations

These are all the forms, inside any line comment (`//`, `#`, `--`, `;`, `%`, `'`, `<!-- -->`, or
`/* */` on one line). There is no long form.

- `@sbtel Name`: the next declaration belongs to block Name, one per declaration (a second is an error).
  Name may be a behavior, for the interface, trait, protocol or typedef it stands for.
- `@sbtel begin Name` … `@sbtel end Name`: a region. Regions nest, the innermost wins, and the names
  must match.
- `@sbtel file Name`: from here to the end of the file.
- `@sbtel message Name`: anchor where shape Name's shape is defined. It owns no code.
- `@sbtel port Block.port`: anchor where a block's port is handled (its `:as` name, or the default one). It owns no code.

An anchor changes no ownership, and a pending `@sbtel Name` above it still applies to the next
declaration. Unknown shapes and ports in anchors are errors.

Code belongs to leaf blocks. Code owned only by a container (a block with levels) is an error, as is
code in no block.
