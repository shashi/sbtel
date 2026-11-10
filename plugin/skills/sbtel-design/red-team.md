# Red-team checklist for an sbtel design

Run this after the spec lints clean and before you show it to the human. For each item, ask the
question. If the answer is bad, apply the fix, or keep the design and note why in the block's sketch or
a `;` comment. Tell the human which items you kept.

## Contents

- Blocks
- Levels
- Adjacency
- Messages, bindings and ports
- Vocabulary (behaviors and shapes)
- The whole spec

## Blocks

- **Braided block.** Does its sketch need "and", "or", "also", "manages", "handles" or "deals with"?
  Does it have two reasons to change? *Fix*: split it into one block per strand.
- **God-block.** Does every other block bind it? Does it have far more ports than its peers? Is it
  named `Core`, `Manager`, `Utils`, `Common` or `Helpers`? *Fix*: split it by strand. Shared pure
  pieces go to the bottom level, each with its own name.
- **Vague sketch.** Could the sketch describe a different block equally well? Is it missing? *Fix*:
  write what the block is *for*, in one sentence, in the user's terms.
- **Container with code-level detail.** Does a container's sketch describe how its children work? *Fix*:
  describe what the container provides to its holder, and leave the how to its children.
- **Depth imbalance.** Is one branch five levels deep while its siblings are leaves? *Fix*: either the
  deep branch is the real system and the siblings belong inside it, or the deep branch is
  over-decomposed.

## Levels

- **Upward dependency.** Does a lower block need to call, notify or construct a higher one? *Fix*:
  give the lower block an `out` port and make the flow a message. The higher level subscribes or wires
  it.
- **Anaemic level.** Does a level only forward to the level below, adding no vocabulary of its own? Is
  it a single block that wraps a single block? *Fix*: merge it with its neighbour.
- **Unnameable level.** Can you name the level for the vocabulary it offers upward, without "and" or
  "misc"? *Fix*: regroup the blocks so that each level adds one kind of vocabulary, then name it.
- **Silent barrier.** If the level's name does not say what the level above may know of it, does its
  sketch? *Fix*: one sentence on the barrier. When the name says it, add nothing.
- **Overfull level.** Are there more than about seven peers in one level? *Fix*: group them into
  blocks with levels of their own, or find the hidden ordering between them.
- **Wrong way up.** Is a block that changes often below one that rarely changes? Lower levels should
  be the more stable ones. *Fix*: invert the dependency through a message, or move the block.
- **Ancestor reach.** Does a child need something from its container? Binding the container is
  forbidden (`ancestor`). *Fix*: the needed thing is a lower-level block (or a shape) inside the
  container. Make it explicit.

## Adjacency

- **Adjacency used to dodge levels.** Was a pair made adjacent because one needs the other? *Fix*:
  put the needed one in a lower level. Adjacency is for mutual cooperation, not one-way use.
- **Large or chained groups.** Does a group have more than three members, or do groups chain across
  most of a level? *Fix*: stratify. A level that is one big clique has no structure.
- **Unexplained braid.** Does an adjacent group lack a sketch? *Fix*: name the reason for the braid in
  a few words in the group's sketch (`(adjacent (~ The preview scrolls with the editor. ~) …)`), or
  remove the adjacency.

## Messages, bindings and ports

- **Fake message.** Does a shape have exactly one producer and one consumer, fixed at design
  time? *Fix*: use a binding (if the levels allow it), or explain why the counterpart must stay
  open.
- **Hidden binding.** Does a port pair stand for a direct call that the code will make anyway? *Fix*:
  model it as a binding, and let `sbtel check` see it.
- **Unconnectable port.** Does any `in` port have no `out` port that it `accepts`, or the other way
  round? That is fine for the system's edges (user input, the network), and a smell inside it. *Fix*:
  connect it, or name its external source in the sketch.
- **Port soup.** Does a block have many ports of the same type? *Fix*: it may be two blocks, or the type
  may need refining.
- **Unsaid promise.** Does a port promise something its shape does not say (it opens the
  palette; it is the only writer)? *Fix*: give the port a one-sentence sketch. If the type says it all,
  the port needs none.

## Vocabulary (behaviors and shapes)

- **Global vocabulary.** Is every shape and behavior declared in the top block? *Fix*: move each
  one down to the smallest block that holds every use. Lint notes each one that could live lower, and
  the viewer's checks popover moves it in one click.
- **One-implementer behavior.** Does only one block implement a behavior? *Fix*: inline its ports into
  that block, unless more implementers are planned (say so in its sketch).
- **Verb types.** Is a shape named like an action (`SaveNote`)? *Fix*: name the data it carries
  (`NoteEdit`), or make it a command type deliberately and say so.
- **Misused refines.** Is a refining type not really a kind of its supertype (is-a), but a part of it
  (has-a)? *Fix*: use `carries` for has-a, `refines` for is-a.
- **Braided data.** Does a shape carry many unrelated types? *Fix*: split it into the messages
  its users actually need.
- **Missing sketches.** Does any shape lack a sketch saying what it is for, beyond its name
  and what it carries? *Fix*: add one sentence.

## The whole spec

- **Goals traced.** Can you point to the block or blocks that serve each of the user's goals? Is there a
  block that serves no goal? *Fix*: add what is missing, and remove or justify the rest.
- **Read it top-down.** Reading only the top level of each block, does the system make sense one level
  at a time? *Fix*: whatever forces you to look deeper is a leaking barrier.
- **Explain one change.** Pick a likely future change. How many blocks does it touch? If the answer is
  "most of them", strands are braided somewhere.
- **Lint is clean.** `sbtel lint` reports nothing. With code, `sbtel check` is clean too, or each
  violation is explained.
