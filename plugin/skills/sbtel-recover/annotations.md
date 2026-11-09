# Annotations

`@sbtel` comment lines tie code to the spec's leaf blocks. This file has the forms, what to do with
annotations that are already in the code, and when moving one is a fix rather than a way to make
`sbtel check` pass.

## Contents

- The forms
- Existing annotations
- Moving ownership: fix or gaming
- Patterns without a direct reference

## The forms

An annotation is the token `@sbtel` in a line comment of the code's own syntax (`//`, `#`, `--`, `;`,
`%`, `'`, `<!-- … -->`, `/* … */` on one line). There are no other forms:

| Form | Meaning |
|---|---|
| `@sbtel file Name` | from here to the end of the file belongs to Name (the common case) |
| `@sbtel begin Name` … `@sbtel end Name` | a region; regions nest, and the innermost wins |
| `@sbtel Name` | the next declaration belongs to Name (one per declaration) |
| `@sbtel message Name` | anchor: where a message type's shape is defined; owns no code |
| `@sbtel port Block.port` | anchor: where a block's port is handled; owns no code |

Names are leaf blocks: code owned only by a container block is an error, and so is code in no block.
Comment-only and blank lines need no owner. `scripts/sbtel_owners.py spec.sbtel FILES` checks all of
this (Python 3.8+, if available) and prints the owner ranges. For example, in an HTML page whose
markup belongs to one leaf block and whose script has regions of its own:

```html
<!-- @sbtel file App.Page -->
<!doctype html>
…
<script>
// @sbtel begin App.Kit
const $ = id => document.getElementById(id);
// @sbtel end App.Kit
```

In Go, `@sbtel file` goes before the `package` clause, after any `//go:build` line, and a blank line
keeps it out of the package doc comment (after `package`, the package line would be code in no block):

```go
//go:build windows

// @sbtel file Server.Detach

// Package server runs the shared localhost server.
package server
```

## Existing annotations

The code may already carry `@sbtel` lines, from an earlier recovery or written by hand. They may name
blocks of a spec that no longer exists, or a spec that has drifted from the code.

- **Treat them as a hypothesis.** Run `sbtel_owners.py` with the spec they claim to match: every
  unknown name or container is a sign of drift. Then verify each region against the code, as you
  would your own: does the code under it really serve that block's strand?
- **Keep, change or remove each one**, and say which in your report: "kept 40 regions; renamed
  Reader to Core.Reader; moved glyphFor from App.Canvas to App.Document (it is a page-state query);
  removed 12 that named blocks of the old spec".
- **For a blind or independent recovery** (a second opinion, a review, an exercise), strip them
  before you read the code, so they cannot steer you, and compare only at the end:

  ```sh
  # in a scratch copy, never in the user's tree; no backup files, so later greps see no stale copies
  grep -rlE '@sbtel\b' src | while read -r f; do
    sed -E '/^\s*(\/\/|#|--|;|%|<!--|\/\*)\s*@sbtel\b/d' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
  ```

  Then compare your spec with theirs by hand (`sbtel diff` matches by name, so it says little when
  every name differs).

## Moving ownership: fix or gaming

Moving an annotation changes which block owns a declaration, and so which edges are violations. That
is the easiest way to make `sbtel check` pass, so draw the line before you move anything.

**A legitimate fix**: the declaration really belongs to the other strand. You would move it even if
`check` did not care. Tests for that:

- its purpose, in one sentence, is the other block's sentence (a page-state query that sits among
  canvas helpers is page state);
- its callers are the other block's callers, or the other block's own code;
- it reads or writes the other block's data, not its neighbours';
- a reader who knows the code would agree without being told about the violation.

When the move goes against the code's own structure (its section headers, its file), leave a
comment next to the annotation that says why, and list the move in your report.

**Gaming** (forbidden): moving a declaration only because its current owner makes an edge upward.
Signs: the declaration's purpose still matches its old block; the move creates a block that owns an
odd mix ("Document: page state, plus the settings dialog's render call"); you are moving one line out
of a function or region that otherwise stays put; or you would not make the move if the edge were
allowed. In that case leave the annotation, keep the edge, and record it:

```
# VIOLATION: the settings dialog calls render() when an option changes.
App.Modals -> App.Canvas  # src/settings.js:40 (+1 more)
```

The same line holds for the spec: reordering levels, adding adjacency or merging blocks only to
silence an edge is gaming too (SKILL.md, Rules).

## Patterns without a direct reference

Some couplings do not show up as a reference from caller to callee:

- **Reassigned functions** (a module replaces `render = myRender`, or monkey-patches a method). The
  reference is downward (the module names what it replaces), the runtime flow is upward (the app now
  calls the module). Model the static reference as the binding, and write the hook in the module's
  sketch or a `;` comment. It is not a message: the module names its target.
- **Parameters and interfaces whose implementation is chosen elsewhere** (`layout(model, opts,
  measurer)`): a real seam. Model the interface as a behavior and annotate its declaration with the
  behavior's name (in plain JavaScript a JSDoc `@typedef`, typing the parameter with `@param`); the
  caller binds the behavior, the implementer says `(implements …)`, and the composition root binds the
  implementer (SKILL.md, "Calls through an abstraction").
- **Registries and string-keyed dispatch** (`modes[name].boot()`, `data-action="save"`): no static
  tool sees them. Find the registration sites; a key or an interface that is named is a message, a
  concrete implementation that is named is a binding.
