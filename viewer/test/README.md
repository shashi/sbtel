# Viewer acceptance suites

Copies of the Marquee playground's browser suites (they predate the rename and need no changes:
none of them names "marquee"). `run.sh` runs them all in parallel against `viewer/dist/index.html`
in standalone mode and compares each `RESULT` line with `expected.txt`.

| suite | runner | checks |
|---|---|---|
| accept | Chrome --dump-dom | multi-select, delete dialog, line cut (10) |
| accept2 | Chrome --dump-dom | drag into blocks, edit, rename, shift-attach (18) |
| accept3, accept3b, accept3c | Chrome --dump-dom | joining groups, sketch expansion, reorder |
| redo | Chrome --dump-dom | undo/redo of a move |
| accept4 | Playwright, real time | bounce-back, menus, separators, animation (16) |
| accept5 | Playwright + CDP touch, iPhone 13 | touch selection and drags (11, plus pageErrors) |
| accept6 | Playwright mouse, then CDP touch, iPhone 13 | v0.2: instant port callouts and the hover outline, inline port editor (one undo, Esc, live validation), inherited ports, level labels (render, alignment at zoom 0.5/1/2, edit), adjacency sketch, `(~ ~)` kept through edits, carried types, touch Edit button (12, plus pageErrors) |
| accept7 | Playwright, a persistent browser profile | v0.2.1: the standalone undo history survives closing and restarting the browser (Ctrl-Z and Ctrl-Shift-Z after a restart), stored as patches; the title is "sbtel Playground" (4, plus pageErrors) |

Any change to viewer/src or core must keep `make accept` green. v0.2 changed two regexes in accept and accept2 (the sample's group now starts with its sketch) and renamed layer to level in test names. Server and diff modes must leave
standalone mode untouched, so these suites stay valid as they are.
