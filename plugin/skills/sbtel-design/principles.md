# Design principles, in depth

## Contents

- 1. Levels of language
- 2. Simple made easy
- 3. Adjacency is a declared braid
- 4. Messages or bindings
- 5. Behaviors and message types are vocabulary
- 6. Say no more than the spec needs
- 7. Before and after

## 1. Levels of language

*Structure and Interpretation of Computer Programs*, chapter 2, builds systems as **levels of
language**. Each level combines parts that are primitive at that level, and what it builds becomes the
primitives of the next level up. Between levels sit **abstraction barriers**. Code above a barrier uses
only what the level below offers publicly, so the level below can change its insides freely.

In sbtel, every block with levels is a small stratified design:

- The **bottom level** holds the primitives: data, storage, pure rules, adapters to the outside
  world.
- Each **higher level** is written in terms of the levels below it, and adds vocabulary that the levels
  above use.
- The **level boundary** is the barrier. A block may bind blocks in lower levels. Nothing below may
  bind anything above.
- A block in the top level should be describable entirely in the vocabulary of the levels below it
  (levels are numbered from the bottom: level 1 is the lowest).
  If its sketch has to mention how a lower block works inside, the barrier is leaking.

Stratification applies **recursively**. When a block grows more than a handful of children, give its
children levels too. Each block answers the question "what is this made of?" in one level of detail.

**Name each level** for the vocabulary it offers upward: SICP's rational-number example has the
levels "Programs that use rational numbers", "Rational numbers in the problem domain" and "Rational
numbers as numerators and denominators". In sbtel that is `(level :name "Rational numbers as pairs" …)`.
If you can't name a level without "and" or "misc", it is two levels or none: regroup it.

A level's sketch states its barrier: what the level above may know of it, and what not
(`(~ Above here, a rational is make-rat, numer and denom; never the pair. ~)`). Write one only when the
name does not already say it.

## 2. Simple made easy

Rich Hickey's talk distinguishes **simple** (from *simplex*, one fold: a strand not braided with
others) from **easy** (near at hand, familiar). **Complecting** is braiding independent strands
together, so that you can no longer reason about one without the other. Easy designs tend to complect;
simple designs keep strands apart, even when that takes more thought up front.

In sbtel:

- **One strand per block.** A block's sketch says what it is for, in one sentence, without "and". "Parses
  the config and watches the file for changes" is two strands: Config.Parse, and Config.Watch, which
  sends a message when the file changes.
- **Watch for braiding words** in sketches: "and", "or", "also", "as well as", "manages", "handles",
  "utilities", "common", "helpers". Each one is a place where two strands may be twisted together.
- **Data over objects.** Message types are values that cross boundaries. Prefer a block that takes a
  message and emits another to one that reaches into another block's state.
- **Simple is not small.** Splitting a braided block into three simple ones makes the spec longer and
  the system simpler. That is the right trade.

## 3. Adjacency is a declared braid

Peers in one level are independent by default, so neither may name the other. `(adjacent …)` declares
that they do know each other concretely. It is a braid, written down and visible in the diagram as a
line between them.

Use adjacency when two peers are genuinely one cooperation that you split for clarity: an editor and
its live preview that scroll together, or a parser and its error reporter. Then give the group a
sketch that names the reason in a few words (`(adjacent (~ They scroll together. ~) …)`). A group
without one is an unexplained braid.

Adjacency is wrong when:

- it joins blocks at different levels of abstraction. One is really built from the other, so put the
  other in a lower level;
- groups grow beyond two or three members, or chains of adjacency tie a whole level together, so the
  levels means nothing;
- it was added only to silence `sbtel check`. Find out why the code needs the binding first.

## 4. Messages or bindings

A **binding** is when code in A *names* B: it imports, calls, references or constructs it. The partner
is fixed at A. A **message** is data exchanged where neither side names the other. A has an `out` port,
B has an `in` port, and something else (a higher level, a router, a bus, configuration) connects them.

Choose a **binding** when:

- the partner is fixed and below you (a store, a pure library);
- there is exactly one sensible partner, and choosing it is A's job.

Choose a **message** when:

- the partner should be chosen elsewhere: by configuration, by a composing level, or at runtime;
- there are, or will be, several producers or consumers;
- the flow goes **upward**: a lower level reports an event to whoever cares. It may not bind upward,
  so it emits a message and a higher level subscribes;
- the data crosses a process, network or trust boundary.

Message types make the coupling explicit and checkable: `accepts` tells you which ports can be wired,
and `sbtel diff` tells you which ports a type change affects.

A message with exactly one fixed producer and one fixed consumer, both chosen at design time, is often a
binding in disguise. Either make it a binding, or say in the sketch why the counterpart must stay
open.

## 5. Behaviors and message types are vocabulary

The viewer draws behaviors and message types in bands *below* a block's levels, because they are the
vocabulary the levels are written in. Treat them as the bottom level's words:

- A **behavior** is a promise many blocks make: `Durable` ("retains every accepted event until
  acknowledged"), `Pure`, `Surface`. If only one block implements a behavior, it is probably just that
  block's ports.
- A **message type** names a kind of data. Use nouns (`Intent`, `SessionEvent`), not verbs. When a
  value holds values of other types, say so with `(carries A B)`; the sketch says the rest. A type that
  carries many unrelated types is braided data.
- Declare each in the **smallest block that holds every use**. Declaring everything at the top works,
  but it hides which parts share which data, and it makes the top block a dumping ground.
- Use `refines` for is-a, where every value of the subtype is a value of the supertype (a union is a
  supertype that each alternative refines), and `carries` for has-a.

## 6. Say no more than the spec needs

Agents and people get a lot from one sentence, as long as they have the spec. So:

- A sketch is one sentence where possible.
- Don't restate what the structure already says: the levels, the adjacency, the ports and their types.
- Leave implementation detail out; the code holds it.
- A port gets a sketch only when its type alone does not say what it promises; a level only when its
  name does not convey the barrier; an adjacent group in a few words, naming the reason for the braid.
- Prefer adding nothing over adding a form or a sentence "just in case".

## 7. Before and after

A first draft from a goal statement ("an app to write notes, preview markdown, keep them on disk and
sync them to the cloud") often looks like this:

```sbtel
(block Notes
  (sketch "Edits notes, renders markdown, saves them to disk and syncs with the cloud.")
  (level
    (block Notes.App
      (sketch "The whole app: editor, preview, storage and sync."))))
```

It lints clean, and it is complected: four strands in one block. Name the strands, stratify them, and
let the flow upward from storage be a message:

```sbtel
; Goals: write notes; see them rendered; never lose an edit; sync across devices.
; Non-goals: collaboration in real time.
(block Notes
  (sketch "Write notes, see them rendered, keep them on disk, sync them across devices.")
  (message Edit (sketch "A change to one note's text, with the note's id."))
  (message Changed (sketch "A stored note changed, from whichever side."))
  (behavior Durable
    (port :in Edit)
    (sketch "Keeps every accepted edit until it is on disk."))

  (level :name "The app"
    (block Notes.Shell
      (sketch "Composes the app: wires the editor, the store and sync to each other.")))
  (level :name "Notes as text"
    (adjacent (~ They scroll together. ~)
      (block Notes.Editor
        (port :out Edit)
        (sketch "The text area where the user types."))
      (block Notes.Preview
        (port :in Changed)
        (sketch "Renders the current note beside the editor.")))
    (block Notes.Sync
      (port :in Changed)
      (port :out Edit :as remote)
      (sketch "Exchanges edits with the cloud copy.")))
  (level :name "Stored notes"
    (block Notes.Store
      :type "Store"
      (implements Durable)
      (port :out Changed)
      (sketch "Keeps the notes on disk, so they survive a restart."))
    (block Notes.Markdown
      (sketch "Turns markdown text into a document tree."))))
```

What changed, and why:

- Each block has one strand, and its sketch has no "and" except in Shell, whose single strand is
  composition.
- Store sits at the bottom and knows nobody. It reports changes with an `out Changed` port, and Shell
  wires that port to Preview and Sync. That is the upward flow, as a message.
- Editor and Preview are adjacent. They are one cooperation, and the group's sketch says why in four
  words. Preview's own sketch no longer repeats it.
- Each level is named for what it offers upward. None needs a sketch: the names say the barriers.
- Sync and Editor are not adjacent. They never name each other: both emit `Edit`, and Shell routes
  both into Store.
- Preview binds Markdown, which is in a lower level, so the binding is allowed.
- Message types and the behavior sit in Notes, the smallest block that holds every use.
