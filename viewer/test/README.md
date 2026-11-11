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
| accept8 | Playwright, real mouse | v0.2.2: behavior and message type pills, a behavior's badge for what it extends, hovering a behavior or its badge outlines its implementers ("implements"; nothing "uses" without bindings), and a behavior's Edit dialog (type, extends, a cycle refused) (13, plus pageErrors) |
| accept9 | Playwright, real mouse, over HTTP | v0.2.3: `#src` (and its own undo history across a reload), `#example`, the parse-error UI for bad base64, a missing example and an unparsable spec, `?embed` (no chrome, the toolbar, fitted on load and resize, transparent, Open in playground with the edited text, port editor, no comments), `?embed=readonly` (no delete, drag or editor), `&theme`, standards mode, and the home link with and without `<meta name="sbtel-home">` (31, plus pageErrors) |
| accept10 | Playwright, real mouse, over HTTP | v0.2.3: a docs page with three embedded viewers: no focus taken, each fitted, the page scrolls over an idle frame, a clicked frame takes the wheel until the page is clicked, an edit stays in its frame's history, one key per spec, nothing from a read-only frame or in the playground (12, plus consoleErrors) |
| accept11 | Playwright, real mouse, over HTTP | v0.2.4: embed mode fits what is drawn with 12 px around it, and posts `sbtel:size` to its parent: the natural size in sane numbers, once per layout, zoom 1 at that height, again after an edit, never during a drag preview; `&focus=<Block>` fits and reports that block alone; a click on a card focuses the frame so a click on the page releases the wheel; a parent on another origin and an unframed page hear nothing (10, plus consoleErrors) |
| accept12 | Playwright, real mouse, file:// | v0.2.5: files made by `sbtel export` (with `bin/sbtel`, or `$SBTEL_BIN`, which must embed this page), opened from disk: the spec renders and round-trips exactly (`</script>`, `<!--` and a CR in it), its title in the tab and the chip, no sample buttons, the home link in a new tab; an edit survives a reload in that spec's own undo history, apart from another exported spec; `--readonly` (no delete, cut, drag, editor, edit menu items, typing in the source, or history written); `--bindings` (the pill fails, the popover lists the violations with their notes, a behavior's "uses" outline); `--embed` (its link opens the same file in full view); no network request from any of them (25, plus network and pageErrors) |
| accept13 | Playwright, keys through the page's handler | v0.4.1: the keyboard. Moving by sight with the arrows along rows and up and down, Tab in reading order and out of the canvas at the end, in and out, Space, Enter, the ears, Caps Lock is not Shift, a focused button keeps Space, typing is left alone, and the pan that keeps the selection in view. |

Any change to viewer/src or core must keep `make accept` green. v0.2 changed two regexes in accept and accept2 (the sample's group now starts with its sketch) and renamed layer to level in test names. Server and diff modes must leave
standalone mode untouched, so these suites stay valid as they are.
