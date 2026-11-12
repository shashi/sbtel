# Changelog

All notable changes to sbtel. Versions follow the `VERSION` file and the `v*` release tags
(RELEASING.md).

## 0.4.1 (2026-11-10)

### Breaking

- **`--json` output says "shape".** The count in `lint --json` is `shapes` (was `messages`); an entry of
  `show --json` has `kind: "shape"` and `carriers.shapes`; a change in `diff --json` has
  `element: "shape"`; an info finding has `kind: "shape"`. Ids keep their `msg:` and `μ:` prefixes.

### Added
- **`sbtel ack <session> <comment-id> [emoji]`**: an agent can take a comment in without a reply. The
  emoji (👍 by default) shows as a reaction on the comment and nothing becomes unread, so "got it, will do"
  no longer calls you back. The skill tells agents to ack where a reply would only confirm.
- **A level can be filled by columns.** Settings, "Blocks in a level go: Down, then across": five blocks
  that fit three to a line read a c e over b d. A linked group stays in one column, its line going down;
  drop targets, the keyboard and the layout checks follow. A block too wide to have anything beside it
  (an open block that fills the row) takes a line to itself and the columns start again under it. Rows
  are still aligned across the columns.
- A level's name sits right of its line (Settings, Level names, puts it on the left). Only the name opens
  the level's editor; the line shows the name to click and does nothing more.
- The comment count on a block is a quiet chip, like the file count; it fills with the accent only
  while a reply in it is new.
- **A block's name may be a phrase.** `(block "Test that times out on CI" …)`: a string in the name's
  place is the block's name and identity, like a symbol. Runs of whitespace are one space; an empty
  string is not a name; lint warns past six words. A card wraps a phrase that does not fit, to three
  lines. Typing a phrase in the editor writes a string; `sbtel note` and comment targets take the
  phrase; a phrase in backticks in a reply links to the block. Shapes and behaviors keep one-word
  names. The skill now says: code keeps its own name, everything else gets a short phrase.
- **Finding your place in a conversation.** A block's name in a comment or reply is a link to the
  block (bare when it could not be a plain word, any name in backticks). The skill now says: answer
  where you were asked, and name the other block there.
- A thread with a new reply opens at your comment that the reply answers, so what you asked is read
  before what came back. (It opened at the reply, with your question scrolled out of sight.)
- A block that has an inside is opened and closed from its corner: the toggle sits beside the comment
  count, so closing a block to read everything said inside it is one move from where the counts are.
  The arrow under the title is gone; the count of blocks stays there and still toggles.
- **A closed block takes a drop.** Rest a dragged block on the middle of a closed block and, after
  0.7 s of holding still, that block opens under the pointer and its levels become drop zones; a card
  with nothing inside offers its first level. Passing over a block, or pausing briefly, does nothing,
  and until it opens the drag previews and drops as before. Leave without dropping and it closes again.
- **Escape closes what opened last, everywhere.** Each thing that opens over the canvas (an editor, a
  callout, a thread, a menu, a dialog, the file and code windows, a sheet, the help panel, the tour, a
  diagram or comparison shown over the page, a drag) joins one list when it opens and leaves it when it
  closes; Escape closes the last one, also from inside a text box. With nothing open it leaves the text
  box, then clears the selection. No surface has an Escape handler of its own.
- Settings has Spacing: compact, balanced (as before) or relaxed room between blocks, rows and levels.
  Relaxed also widens a row, so the same blocks still fit on it.
- **Keyboard.** The selection is the cursor. The arrows move to the nearest block that way;
  `Tab` and `Shift+Tab` go through every block in reading order and leave the canvas at either end;
  `Shift+Down` goes into a block (opening it) and `Shift+Up` out. On the selected block: `Space` opens or
  closes, `Enter` or `E` edits, `C` comments, `<` and `>` show what it takes and gives, `R` its files, `S`
  its text. `]` goes to the next new reply and `[` back (also `;` and `:`), leaving the typing box alone
  so the key can be pressed again; `F` fits, `+` and `-` zoom, `?` shows help, which lists the keys. The
  view pans to keep the selection in sight. A focused button keeps Space, Enter and Tab.
- Settings has Agent's name: what the agent is called in threads ("Agent" by default).
- Settings has Font: the name of a font installed on your computer, used for names and text (code keeps
  its own). Nothing is downloaded; if the font is not installed the built-in one is used and the setting says so.
- **A chat can be read large.** The button beside a chat's close button opens it as a tall window with
  bigger type; Escape (or a click beside it) makes it the small callout again, and a second Escape closes it.
- Settings has Corners: how round the boxes are, from square to very round.
- **Names show without what the picture already says.** A block named `store/index` inside `store`, or
  `slow-login/evidence` linked beside `slow-login`, shows as `index` or `evidence`; moved elsewhere it shows
  its whole name again. The name itself is unchanged, so threads and checks still follow it. The design
  skill now asks for kebab-case names (the code's own name when a block stands for code) and this prefix.
- **`sbtel note <session> <target> <text>`**: an agent can start a thread on a block, a shape, a behavior
  or the whole file, for when you ask it to comment on things you have not commented on. It shows as a
  thread with an unread dot; you answer in it as usual. The skill tells agents to use it only when asked.
- **Comment on a file.** The file viewer has a comment box. The comment goes on the thread of the block
  that names the file (or, for a file opened from a comment, on that comment's thread) and carries the
  file as a ref. Select lines in the source to send `file:9-11`; select words on a rendered page to quote them.
- **Replies are quiet.** An agent's reply is not announced: it puts a dot on its thread's bubble and on the
  toolbar's forward arrow (a reply to a whole review puts one on Review). The forward arrow walks the
  threads with new replies, by place by default (the diagram's reading order from where you are, so
  neighbours come together); the back arrow returns through the threads you have read, and forward goes
  on from there. The count between them opens the order. The default, "Nearest, then where I was", finishes
  the place you are in (the block, then its neighbours, then outward) before taking you elsewhere, and
  then prefers the region you were in before; "Nearest, then from the beginning" and "From the beginning"
  follow the arrangement of blocks instead; newest first and longest waiting remain. The arrow's tooltip
  names the thread the next press opens.
- **A closed block is one concept.** Its bubble counts every thread inside it, and its chat shows them
  together in the order they were written, each run under the name of its part. Pressing a part's name
  opens the block and shows that thread alone. The walk treats a closed block as one stop.
- **Files open as what they are.** In the file viewer a Markdown file is a page, an HTML file is shown in a
  frame that can run no script, an SVG is a picture, a PDF opens in the browser's own reader, and a
  calendar invite (`.ics`) is a card with the time in your zone and an **Add to calendar** button. "Show
  source" gives the text; a ref to lines (`file.md:10-20`) opens as text with the lines marked.
- The playground shows files that sit beside an example; the Notes example names four.
- A web address in a comment, a reply or a sketch is a link.
- Icons are now Lucide's (ISC licence, listed in `THIRD_PARTY_NOTICES`), put in by the build (`@@icon name@@`).

- **A tour.** A first visit starts a six-stop tour in place of the panel of gestures: a ring goes round
  a real thing of the diagram (a block, a level's name, a block inside a block, an ear, a block to
  comment on) and a card says one thing about it; the last stop opens the Source panel, the text an
  agent reads. Next, Back, the arrow keys, Escape. A stop the diagram has nothing for is passed over.
  The `?` button opens "Take the tour" and the gestures, now under Move around, Edit and Comment.
  The browser remembers the stop reached: a tour left halfway picks up there on the next visit, and
  one finished or skipped does not come back by itself.
- **Sent and Seen.** A sent comment shows one tick and "Sent"; when `sbtel inbox` has handed it to the
  agent it shows two and "Seen by the agent", with nothing for the agent to do. `inbox --peek` does not
  count. A comment made in a spec opened over another page is seen when that page's agent reads it.
- **A type can pulse.** In a type's colour picker, "Pulse its dot" makes the dot of every block of that
  type send out a soft ring: for what is in progress.
- **Attach a file.** Drop a file on a block and the block gets a `ref` to it, as an edit in your draft.
  Drop or paste a file into a comment, or use the paperclip in the comment box (the way to attach on a
  phone), and the comment's text gets the `ref`. The file is stored in `.sbtel/files/` beside the spec,
  under a name cleaned to letters, digits, `.`, `-` and `_`; it never replaces a different file, and it
  may be up to 16 MB. The standalone page has no folder, so it says to use `sbtel open`.
- **The project folder `.sbtel/`.** Beside the spec it holds the attached files (`files/`) and a log of
  every comment, reply and review about that spec (`comments/<spec file>.jsonl`, one JSON event per
  line). When the spec is inside a git repository, `sbtel open` adds `.sbtel/` to the repository's
  `.gitignore` if it is not ignored there yet, and says so on stderr.
- **A ref to another spec opens as a diagram, over the page.** `(ref projects/site.sbtel)` on a block
  shows an arrow at the card's corner; it, or the same ref in a comment, opens that spec over the page
  you are on. The header is a trail (`all.sbtel › site.sbtel`): a spec opened from inside moves the
  same overlay on and lengthens the trail, and "Open in a tab" gives it a tab of its own. The spec has
  its own session (the one already showing that file, else a new one), so one file has one thread. The
  rule is the one for reading a file: named in the spec or in a comment, inside the spec's folder.
- **What you send says where you sent it from.** A comment, review or save made in a spec shown over
  another spec's page records that page's session (`from`). `sbtel inbox` of that session shows it,
  headed `in <file> (session <id>; answer with sbtel reply <id> …)`; the inbox of the spec's own session
  does not, so two agents never get the same comment. When the agent replies, the first page says so
  and the block's arrow shows a dot until you open it.
- **Drag a file from a comment onto a block.** A file named in a comment or a reply is a chip you can
  drag onto a block; the block gets the `ref` as an edit in your draft. The file viewer opened from a
  chat has an "Add to <block>" button that does the same, which is the way on a phone.
- **All comments in one list.** A Comments button in the toolbar, with a dot when a reply is unread,
  lists every thread of the session, unread first; choosing one goes to its block and opens the chat.
  The `C` key opens the list, or the comment box of the selected block.
- **Chat about the whole file.** A Chat button in the toolbar opens the comments on the file as a whole,
  in the same callout a block's comments use, above the toolbar; on a phone it is the bottom sheet. It
  was only in the canvas's right-click menu before.
- **The version in Settings.** The Settings panel ends with the sbtel version that built the page.
- **Comments come back.** A new session on a spec file starts with what was said about that file in
  earlier sessions, from `.sbtel/comments/`: the comments, the reviews (without their proposed specs) and
  the replies, under ids of the new session. They are marked old, so `sbtel inbox` does not deliver them
  again; a reply to one works as to any comment.
- **The help panel has a Close button.**
- **A starting example for a hosted page.** `<meta name="sbtel-example" content="notes-tour">` in the
  standalone page makes `examples/notes-tour.sbtel` what it opens with, where the built-in Shell sample
  was; the Sample button then loads it too. The project's playground uses it.

### Changed
- The local server no longer exits after 30 idle minutes: it stays up until `sbtel serve --stop`. Set
  `SBTEL_IDLE_MINUTES` (or `--idle` on the server) to have it exit when unused.
- The agent's name in a thread has an icon and its own colour (it had none: the colour it asked for was not
  defined, which also left links and a few labels in the text colour).
- The built-in font for names and text is Commissioner (SIL OFL 1.1), in place of Hanken Grotesk. Card widths
  shift slightly.
- Card outlines are fainter and open blocks a little firmer than cards; shapes keep the full line. The ears
  of a tinted card now take its outline's colour.
- The duplicate block name warning says why names must differ and what to do.
- The design skill asks for small yet beautiful specs and for one thing per card, typed in the human's
  own words (code kinds, findings and evidence, statuses, roles, features), so the type colours carry
  meaning. When the subject is not code, a linked group may read left to right: a thing, then what details it.
- The toolbar has no primary button: Review looks like the rest and shows a count when something waits in it.
  The Shapes button is gone (the table still opens from a shape's Table action).
- The comments button turns off when no new reply is left. `C` still lists every comment. Its dot no longer
  stays on after everything is read.
- Sent and Seen are drawn ticks.

- **Lines move with their blocks.** The lines between adjacent blocks, the band rules and the `+`
  buttons slide to their new places in step with the blocks. They were redrawn in place and faded out
  and in on every change.
- **A dragged block keeps its links.** Each line to a neighbour follows the block as a slack cable. Over
  a spot that would part the pair it snaps, the halves springing back; over a spot that keeps the pair
  it joins again. The line used to vanish the moment the block was picked up.
- **An open block travels whole.** Dragging an open block carries its level lines and the links between
  its blocks with it; they stayed behind, or vanished, before. A `+` that would sit on a link handle of
  the selected block steps aside while the block is selected.
- **The new-version notice** is a dark bar with a live dot, in the manner of the one on the home page:
  "Version 2 from your agent", See changes, Reload, and a close button where "Later" was.
- **Types you can tell apart.** A block's type is drawn in a colour of its own with a dot, chosen from
  the type's text (the language says nothing of colour) and spread so that the types of one diagram
  differ clearly; each theme sets how light the colours are. Point at a type and every block of that
  type stays lit while the rest dim; a click keeps it so until the next click or Escape. Settings has
  "Tint cards by type", which washes each typed card in its colour: a status board at a glance.
  Click a type to choose its colour: a ring of hues to drag around, the twelve standard hues, and
  Automatic. The blocks recolour as you move. The choice is kept in the browser for that spec file, and
  is the hue only, so it suits both themes.
- **A shape's dot and a behavior's badge can be given a colour**, in that shape's or behavior's Edit
  dialog only: twelve hues, a hue slider, and Automatic. It applies as you choose and is kept in the
  browser for that spec file, by the thing's name; it is not part of the spec.
- **Link handles stand just outside a block's edge**, all four alike. An open block of a type takes a
  fainter wash of its hue when cards are tinted.
- **An ear joins its card without a line.** The card's border no longer shows across the join.
- **Inline editors have a Save button**, and the save key is the same in every field: Ctrl/⌘-Enter. The
  port editor said "Enter saves", which was false in its sketch. Its direction buttons read "takes" and
  "gives".
- **The dotted ground moves with the canvas.** It pans and zooms with everything else, where it stood
  still behind a moving diagram.
- **A thread opens at what is new.** Opening comments that have an unread reply shows the start of the
  first unread reply, marked "new", where it showed the end of the thread. A redraw no longer moves you
  from where you were reading.
- **Comments are notes beside the block.** The callout stands beside what it is about, with a tail
  pointing at it, and no longer covers it; it keeps clear of the toolbar. A thread reads as text: your
  comment, what became of it in small type, the agent's answer set in from a rule. One field holds the
  text, the paperclip, Add to review and Send. A comment kept in your review says "In your review".
- **A block's type follows its name.** `Editor module` on one line, the type in quiet type, where a
  coloured pill sat above every name. Cards are shorter for it. Names are set a weight heavier.
- **Quieter at rest.** A `+` is faint until the pointer is near it. Section labels in panels, menus and
  cards are in sentence case at one size, where small capitals were.
- **The toolbar makes room.** When a side panel is open or the window is small, it drops its words and
  then the zoom and open/close-all controls, before it would scroll.
- **One word per thing.** A block's own text is "Source" in the selection bar and the menu, as in the
  toolbar (it said "Code" and "Show source"). Key hints name this computer's keys (Ctrl on Windows and
  Linux). "Store now takes Note" where it said "Added port Note in Note to Store". Escape closes a spec
  opened over the page from inside it.

- **Paragraphs in a sketch sit half a line apart** on a card, where a whole blank line stood between
  them. A sketch too long for its card is clipped to whole lines without the breaks.

## 0.4.0 (2026-11-09)

### Breaking

- **`shape` replaces `message`.** `(shape NoteSaved)` declares what a port takes or gives. The word
  "message" suggested a queue; a shape is only what two ports must share to fit.
- **`takes` and `gives` replace `port`.** `(takes NoteSaved)` and `(gives Note :as text)`, where 0.3
  wrote `(port :in NoteSaved)` and `(port :out Note :as text)`.
- **No compatibility with 0.3 or 0.2 specs.** Nothing was released on them, so `(port …)`, `(message …)`
  and the older `(layer …)` and `(either …)` are simply unknown forms now, and `sbtel fmt` (which only
  migrated ports) is gone.
- Lint, check, query and diff say "shape" where they said "message type". JSON output keeps its keys
  (`messages`, `"kind": "message"`) and the `μ:` and `msg:` id prefixes.
- The code anchor is `@sbtel shape Name`.

### Added

- **`ref`.** `(ref src/store.ts:40-60 (~ why ~))` in a block, a behavior or a shape names a file it
  stands for or rests on: a path beside or below the spec, with optional lines or a `#heading`, or a URL.
  A card with refs shows a count at its lower right corner; it opens the file in a modal that closes
  only with Close or Escape, with the named lines highlighted. The server serves a file only when the
  pushed spec names it, only from inside the spec's directory (no `..`, no dot-files, no links out), and
  only as text or an image, never as a page. A standalone page or an export shows the paths. The
  language has twelve forms.
- **Unread replies.** A reply that arrives while its chat is closed puts a dot on the block's comment
  count until you open the chat. What you have read is remembered per session.
- **See changes.** The new-version toast has a second button beside Reload: it shows the diff between
  the version you have and the one that arrived, over the page, with Back and Reload.

### Changed

- **The skills are rewritten** as short operational guidance: what a view shows and how deep to go by
  task, and a counting step in design and recovery (a lower-level block is used by most of what is
  above it; one used by a single block moves inside it).
- **Comments are a chat.** A block's comments and the box to write one are now a single popover: the
  thread, scrolled to its newest message, over an input. It stays open after you send, and the agent's
  replies appear in it as they arrive. ⌘/Ctrl+Enter sends the comment now; Shift+Enter adds it to your
  review (Save, in the standalone page); Enter is a new line. Send is the primary button and Add to
  review the secondary one. Text you typed but did not send comes back when you open the chat again.
  On a phone the chat is a sheet at the bottom, above the keyboard.
- Comment text is larger (15px; 16px for the input on touch screens, where a smaller one makes iOS zoom
  the page).
- The server sends `X-Frame-Options: SAMEORIGIN` instead of `DENY`, so the page can frame its own diff
  view. No other origin can frame it.
- Skills and reference: block names need no particular style. A directory or file is best named by its
  path; the sbtel-language skill no longer tells agents to use dotted names.

## 0.3.0 (2026-11-08)

Ports are named after their type.

### Breaking

- **A new port syntax.** `(port name in Type)` / `(port name out Type)` is now `(port :in Type)` /
  `(port :out Type)`, with an optional `:as name` and an optional sketch last:
  `(port :in NoteSaved)`, `(port :in Item :as backlog)`, `(port :in NoteSaved (~ Refresh after a save. ~))`.
  Without `:as`, the port's name is its type's name with the first letter lowercased (`NoteSaved` →
  `noteSaved`); a qualified type gives its last component (`shell.Intent` → `intent`), a parameterized
  one its head (`List<Item>` → `list`), and a behavior parameter `T` gives `t`. LANGUAGE.md §3.5 has
  the rule; the viewer's Shift-attach and Add port name new ports the same way.
- **The 0.2 form is a lint warning** with the exact text to write, e.g. `(port chord in KeyChord) is the
  0.2 form; write (port :in KeyChord :as chord)` (`:as` only when the name is not the default one).
  Specs in the old form still draw in the viewer, and lint exits 1 on them.
- **Two ports with one name** on a block or behavior are a lint warning that suggests `:as`, counting
  the ports it gets from behaviors (own vs own, own vs inherited, two inherited). Before, only two own
  ports were reported, and only by the CLI; the viewer shows these now too.
- Anchors (`@sbtel port Block.name`), `sbtel query`, `sbtel diff` and the viewer use the effective name.
  In a diff, writing the default name out with `:as`, or dropping it, is no change. Renaming a message
  type renames the ports named after it.
- Lint messages for malformed ports changed: `port direction must be :in or :out` (with `(write :in, not
  in)` for a bare direction), `port needs a message type after :in: (port :in Type [:as name])`, `unknown
  keyword :k in a port; a port takes only :as name`, `keyword :as of a port needs a name`, `port p has
  more than one :as`, and `has two ports named p; tell them apart with :as`.
- The parse model's port nodes carry `as` (the name as written, or null) beside `name` (the effective
  name), and `legacy` for a 0.2 port.

### Added

- **`sbtel fmt --migrate-ports [--check] <spec>|- ...`** rewrites every 0.2 port in the 0.3 form in place,
  changing only the head of each port (sketches, comments and spacing stay byte for byte); `--check`
  only reports and exits 1 if a file has one (DESIGN.md §3.15). `__api.migratePorts(src)` in core/api.js.
- The viewer's port editor and Edit dialog write the 0.3 form, with `:as` only when the name differs from
  the type's default; renaming a port to its default name drops `:as`, and a name that is the default
  follows a change of type. Any edit of a block's ports rewrites its 0.2 ports.
- Conformance: `v3-ports.sbtel` (default names, `:as`, the 0.2 form, clashes, malformed ports) with
  port edits that round-trip (sketch, rename, rename to the default, type and direction changes,
  delete, Shift-attach, message renames), and diff cases `ports-implicit` and `ports-same`. accept6 tests
  the editors' default-name handling; sbtel_owners.py reads the new form (with a test).

### Fixed

- **The checks pill no longer reads "1 failing" when every binding violation is explained.** Explained
  violations fail nothing: the pill says "◦ N explained" in a neutral style, the check is not failing,
  and beside a failing check the pill adds "· N explained". The popover still lists each violation with
  its reason. `sbtel check` still exits 1 for any violation, explained or not. accept12 tests both pills.
- The e2e test "the overwrite prompt after an agent push" was flaky (about 1 run in 6): it wrote the
  session's spec file and then pushed it, and when the server's disk poll saw the write first it
  recorded the version as a disk change and the push as a no-op. The agent now pushes its version from a
  new file, which the poll cannot see before the push; the test checks the same prompt.

### Changed

- Every spec in the repository (examples, conformance specs and fixtures, docs, skills, tests, the
  viewer's built-in sample) is in the 0.3 form; `conformance/diff/gen-big.mjs` writes it.
- The source view highlights `:in`, `:out` and `:as` as keywords, and no longer highlights the words
  `in` and `out` in sketches.

## 0.2.5 (2026-11-08)

A diagram you can share as one file.

### Added

- **`sbtel export <spec>|- [-o out.html] [--readonly] [--embed] [--bindings f] [--title t]`** writes one
  self-contained HTML file: the viewer with the spec baked in, interactive in any browser, with nothing
  to install and no network request. Email it, commit it or host it anywhere; edits, undo and comments
  stay in the reader's browser, kept per spec. `--readonly` turns editing off in the full viewer,
  `--embed` gives the chromeless layout for an iframe, `--bindings` shows the edges' violations in the
  checks pill and a behavior's "uses" outline (as `open --bindings` does), and `--title` names the page
  (default: the top block's name). The spec is linted first: warnings and binding violations go to
  stderr and the file is still written; a spec that does not parse writes nothing and exits 2. The file
  size is printed on stderr (about 600 KB, most of it the embedded fonts). `-o -` writes to stdout.
- The page reads an exported file's baked blocks (`#sbtel-export`, `#sbtel-spec`, `#sbtel-bindings`);
  `#src` and `#example` still win. In an exported embed, **Open in playground ↗** is **Open full view
  ↗**, the same file at the new `?embed=off`; the "sbtel" home link opens the project's page in a new tab.
- Read-only in the full viewer (for `--readonly`): nothing edits, the source is read-only, and Comment and
  the message table stay.
- `__api.topBlocks(src)` in core/api.js: the file's top-level blocks.
- Tests: Go tests for export (the file, the escaping of `</script>`, `<!--`, CR and NUL, the flags, a
  parse error writing nothing), and viewer/test accept12 (exported files from disk: rendering, no
  network, read-only, bindings, undo per spec). `make accept` now builds bin/sbtel for it.
- The sbtel-language skill tells agents they can export a shareable HTML file for humans.

### Changed

- The bindings view (the extra check, the popover's Bindings section, the "uses" outline) moved from
  server.js into viewer/src/bindings.js (block `Viewer.Bindings`), shared by server mode and exported
  files; server mode behaves as before. Read-only moved out of embed mode into one function; in embed
  mode it behaves as before.

## 0.2.4 (2026-11-08)

Embedded diagrams come out at a readable size.

### Changed

- **Embed mode fits what is drawn.** It fits the diagram's own bounds (cards with the ears they draw,
  level lines and names, the message band, and the + buttons where it edits) with 12 px around it and
  room for the dock, instead of the layout's canvas width with the full app's margins; the zoom stops at
  100%. A typical docs example (one block with levels and a message band) went from about 40-55% to
  60-100% in a docs frame.

### Added

- **`sbtel:size`**: in a frame, the viewer posts `{ type: 'sbtel:size', width, height }` to its parent,
  the diagram's natural size in CSS pixels at zoom 1 with padding and toolbar, after the first layout and
  after any relayout that changes it, so the host page can size the frame. It goes only to a same-origin
  parent (target origin `'/'`); a framed page on another origin, or an unframed page, gets nothing.
- **`&focus=<Block>`** in embed mode fits one block (an id or a name) instead of the whole file.
- `contentBox(lay, id, plus)` in core/core.js (Core.Layout): the box a layout draws, used by the fit and
  by the website's build to give each embed its starting height.
- viewer/test: accept11 (the tight fit, `sbtel:size`, `&focus`, nothing across origins or unframed, and
  the release after a click on a card).

### Fixed

- An embedded viewer clicked on a card (rather than on empty canvas) never took focus, so a click on the
  page did not release it and it kept the wheel. A press now focuses the frame.

### Docs

- README "Embedding the viewer": `&focus` and a host-side `sbtel:size` listener. DESIGN.md §6.9 and §11
  entries 104-106.

## 0.2.3 (2026-11-08)

The viewer embeds in docs pages, loads a spec from its URL, and links home.

### Added

- **A spec from the URL**: `#src=<base64url of the UTF-8 text>` or `#example=<name>` (fetches
  `examples/<name>.sbtel` beside the page) instead of the sample. Each such spec keeps its undo
  history, settings and comments under keys with a hash of its initial text, apart from other specs
  and from the playground. Text that cannot be decoded or loaded, or a spec that does not parse, shows
  the parse-error UI (the source sheet with the message), never a blank page.
- **Embed mode** for docs pages: `?embed` hides the brand chip, help and side panels, keeps a small
  toolbar (undo, redo, zoom, Fit, **Open in playground ↗**), fits the diagram to the frame on load and
  resize, and draws on a transparent background. `?embed=readonly` makes it view-only; `&theme=light`
  or `&theme=dark` fixes the theme. The wheel zooms and pans only after the frame is clicked or focused,
  so the page scrolls over it, with a "Click to interact" hint; nothing takes focus or asks before
  unload.
- **Home link**: in the playground, "sbtel" in the top-left chip links to the project's home page
  (`<meta name="sbtel-home" content="…">`, else https://shashi.biz/sbtel/), with a small ↗ on hover.
  Server and diff mode are unchanged.
- viewer/test: accept9 (URL parameters, embed mode, the home link) and accept10 (a page with three
  embedded viewers: separate histories, no scroll trapping, no console errors).

### Changed

- viewer/dist/index.html is a full document: `<!doctype html>`, `<html lang="en">`, `<meta
  charset="utf-8">` and a device-width viewport, so phones lay it out at their width without help from
  the host. accept5, accept6 and the diff viewer test no longer prepend a viewport tag.
- The viewer's spec has a new block, Viewer.Play (viewer/src/play.js), in "Page modes";
  examples/sbtel.sbtel has Sbtel.Viewer.Play.

### Fixed

- The page no longer draws the text `// @sbtel begin Viewer.Boot` under the canvas: the annotation above
  `<script>` is an HTML comment now.

### Docs

- README: "Embedding the viewer". DESIGN.md: §6.9 (the URL, embed mode, the home link) and §11
  entries 97-103.

## 0.2.2 (2026-11-08)

Behaviors read like blocks, and code that calls through an interface is checkable.

### Added

- **Behaviors take a block's grammar**: `(behavior Durable :type "trait" (implements Store) (port …)
  (sketch …))`. One parser path reads block, behavior and message heads. Blocks, levels, adjacent
  groups and declarations inside a behavior are reported where they are (`behavior B: behaviors don't
  contain blocks, levels or declarations; declare block X beside the behavior instead`) and left out.
- **`:type` on behaviors and message types** (`"trait"`, `"interface"`, `"struct"`, `"JSON schema"`…),
  shown as a pill on their cards, as on blocks. Query's Element has `type` for every kind; the diff
  compares it.
- **A behavior may implement (extend) others**: it gets their ports, and a block that implements it
  counts as implementing them, transitively, for scope, placement notes, the viewer's outline and every
  "implementers of". Cycles fail a sixth lint rule, `No behavior implements itself: A → B → A`. The
  extended behavior must be in scope where the extending one is declared.
- **Arguments for parameterized behaviors**: `(implements (Store Event))`, in blocks and behaviors,
  retypes Store's ports typed with its parameter; a behavior may pass its own parameter on
  (`(behavior (Cache K) (implements (Store K)))`). Arguments must fill every parameter.
- **`sbtel check` allows a binding to a behavior** in the caller's scope: rule `abstraction`; out of
  scope it is `scope`. A bare name that is both a block's and a behavior's binds the block, with a
  warning; `beh:Name` binds the behavior. "Did you mean" suggests behaviors for callees.
- **The viewer outlines who implements and who uses a behavior**: hovering a behavior card or badge
  outlines its implementers ("implements", solid) and, with `open --bindings`, the blocks that bind it
  ("uses", dashed), in the behavior's colour. The Edit dialog edits a behavior's and a message type's
  type, and what a behavior extends.
- **The recover skill's helpers map interfaces to behaviors**: `@sbtel Durable` above an interface,
  trait, protocol or typedef; a reference to it is `A -> Durable`; `class Store implements Durable`, Go's
  `var _ Durable = (*Store)(nil)` and embedded interfaces are tagged `implements` and checked against
  the spec instead of becoming edges. sbtel_refs.mjs reads JSDoc types and typedefs. The skill has a
  section "Calls through an abstraction".
- **sbtel's own seams**: core.js declares the layout's measurer as a JSDoc typedef, MeasuresText, and
  the Go server's injected diff function is the named type `DiffFunc` (behavior DiffsSpecs); both are
  now `abstraction` edges in examples/*.edges.txt.

### Changed

- An unknown callee reads `X is not a block or a behavior in the spec`. LintResult's `checks` has six
  entries (`cycle`). `implements` with a `(Name Arg …)` list is no longer a warning.
- `make selfcheck` treats an edges file as stale only when an edge or a comment (a `# VIOLATION:`
  note) changes; line numbers that drift with an edit print a note instead of failing.
- sbtel_owners.py: comment lines between `@sbtel Name` and its declaration belong to the declaration;
  "unknown block X" is "unknown block or behavior X" for ownership forms.

### Fixed

- macOS: sbtel_refs_go resolves links in `--dir` (temp dirs under /var gave `../../private/...` paths);
  the JS helper and sbtel_owners.py match files by real path too.
- Windows: `.gitattributes` keeps LF; the byte-comparing checks (viewer build, conformance, docs,
  notices) read `\r\n` as `\n`; the server retries its previous port for 1.5 s before a random one.

### Docs

- LANGUAGE.md: the cheat sheet, §3.7 (extension, arguments, what a behavior does not contain), §7
  (the sixth rule, the new warnings), §8 (the `abstraction` and `scope` rows, calls through an
  abstraction), §9 (behavior annotations). DESIGN §2.5, §6.8, §8 and §11 entries 78-96. The language,
  design and recover skills say what `:type` is for on each kind.

## 0.2.1 (2026-11-08)

Reviews, as on GitHub, and an undo history that survives the browser. **Level numbers now count from
the bottom**: see "Changed" first.

### Changed

- **Levels are numbered from the bottom.** Level 1 is the lowest level of a holder, so a lower level has
  a lower number, as in "low-level": `Store (level 1 of App) binds upward to Orders (level 2)`. Levels
  are still written top to bottom. This changes every level number: `sbtel check` and the viewer's
  binding texts, `sbtel diff` text, the diff JSON's `Place.level` and `Fields.levels[].level` (now
  the same 1-based numbers as the text, and `Place.level` is the block's own level), the viewer's level
  editor, callouts and change list, the docs, and the recover skill's `sbtel_sccs.py`. `apiVersion`
  stays 2.
- **Save is a secondary action, and never overwrites silently.** It still writes the tab's text to the
  spec file (and records a `save` event), but when the spec changed since the tab's base it asks "The
  spec changed since you started (agent pushed a new version). Overwrite it with yours?", with
  Overwrite, View their changes (a diff of your base and their version, in a new tab) and Cancel. An
  overwrite is marked in the event (`force: true`) and in `sbtel inbox` ("which the user overwrote
  without merging").
- The standalone page's title is "sbtel Playground".

### Added

- **Reviews.** In a session, the comment composer's primary action is **Add to review** (**Send now**
  still sends one comment at once). Pending comments show on the canvas with a "pending" badge and stay
  editable and deletable. **Review (N)** in the toolbar (N: pending comments plus edits) opens the
  Review panel: the edits since the version you started from, as the diff view's change list, with
  **Open the full diff**; the pending comments; an optional overall message; and **Send review**. A
  review is one `review` event: the message, the comments with their anchors (ids `c<seq>.<k>`) and,
  with edits, the whole proposed spec, stored in `sessions/<id>/proposals/<seq>.sbtel` with its base and
  its `sbtel diff` text. A review never writes the spec file; the proposed edits stay in the tab,
  marked "proposed, awaiting agent", until the agent pushes a version. Editing after a review starts a
  new draft on top of the proposal, which replaces it when sent. A diff session's review has comments
  and a message.
- **`sbtel inbox` prints a review as one unit**: header, message, the diff, the proposed spec's path,
  then the comments; `--json` has all of it. `inbox --wait` wakes only on what was sent, never on a
  draft. **`sbtel reply`** answers a review's comment (`c7.1`) or the review as a whole (`r7`).
- **The draft persists**: pending comments, the message and the edited text are kept in localStorage per
  session, survive a reload, and leaving the page with a non-empty draft asks first.
- **Undo and redo persist** in localStorage, per session (and one history for the standalone
  playground), as patches between steps, under about 2 MB per history (oldest steps go first). After
  closing the browser, ⌘/Ctrl-Z continues back through earlier edits, past versions the agent pushed:
  a new version, a disk change and "Discard my edits and reload" are ordinary steps, and undoing them
  is only a draft. A full or blocked localStorage never breaks editing: the page stops writing and logs
  once. `sbtel close` clears what the page kept, and so does loading a session that no longer exists;
  keys of other sessions the server does not know are pruned.
- Server routes `POST /s/<id>/review` and `GET /s/<id>/versions/<n>`, and `force` on `save` (DESIGN
  §5.2); the 409 says who made the newer version.
- Tests: e2e checks for the review flow (inbox prints one review, the file is unchanged, the proposal
  file, replies, a second review that replaces the first, the agent's push), `inbox --wait` staying
  asleep while a draft grows, every choice of the overwrite prompt, the draft across a reload, undo
  across a closed and reopened browser context past two agent pushes, a localStorage that throws on
  every write, and a review in a diff session; accept7 (standalone undo across a browser restart);
  Go tests for the review event, proposals, forced saves, `versions/<n>` and inbox formatting.

### Docs

- The README tour sends a review and shows its inbox; DESIGN §6.7 describes reviews, drafts and the
  history on disk, §3.9 the review's shape, §11 entries 61-77 the decisions. The sbtel-language and
  sbtel-design skills describe the loop: open, `inbox --wait`, read the review, apply or merge the
  proposed spec with your own changes, `open --session`, reply. LANGUAGE.md says "Levels are numbered
  from the bottom: level 1 is the lowest."
- examples/viewer.sbtel gains App.History, Viewer.Review and Viewer.Changes; examples/sbtel.sbtel the
  Review event and Sbtel.Viewer.Review.

## 0.2.0 (2026-11-08)

The language pass. **This release breaks specs written for 0.1**: see "Breaking" first.

### Breaking

- **`(layer …)` is now `(level …)`**, with no alias, after SICP's "levels of language": a level is a
  vocabulary built from the levels below it. A spec that still says `layer` loses those blocks and gets
  `unknown form (layer) in … (did you mean level?)` from lint and in the viewer. The rename is
  everywhere: the binding rules are `lower-level` and `same-level`, messages say `level 2 of Shell`,
  the viewer's menus say "Insert a level above" and "Add a block to this level", and `sbtel diff
  --json` moves are `Place.level`.
- **`(either A B …)` is removed.** A union is a supertype that each alternative refines;
  `accepts(U, T)` is now U = T or T refines U. A spec that uses `either` gets `either was removed in
  0.2; declare each alternative with (refines Union) instead`.
- **`:fill` and free `:key value` keywords are removed.** A block's one keyword is `:type`, the kind of
  code artifact it maps to, shown as a pill; any other keyword is `unknown keyword :k in block X; a
  block takes only :type`. The viewer picks its own colours.
- **The JSON API is `apiVersion` 2.** `sbtel query --json` Elements have `levels` (each with `name`,
  `sketch` and units with their `sketch` and `blocks`) instead of `layers`, ports have `sketch`, and
  `fill`, `keywords` and `either` are gone (message types have `carries` and `carriers`). `sbtel diff
  --json` Fields lose `fill` and `either` and gain `levels` and `carries`, and a change may have
  `element: "file"`. Lint results gain `info`.

### Added

- **Level names**: `(level :name "Rational numbers as pairs" …)`, a label (never referenced, spaces
  allowed, not unique). The viewer draws it at the left of the level's separator line, `sbtel check`
  quotes it (`Shell.Toast (level 2 "Feedback" of Shell) binds upward to Shell.Router (level 1
  "Routing")`), `sbtel query` keeps it, and `sbtel diff` reports a rename as a change of the holder.
- **Sketches on levels, ports and adjacent groups**: `(level :name "…" (sketch "…") …)`, `(port chord in
  KeyChord (sketch "…"))`, `(adjacent (sketch "…") (block A) (block B))`. A behavior's port sketches
  go to the blocks that implement it. `sbtel diff` word-diffs them.
- **`(~ … ~)`** is `(sketch "…")` with nothing special inside: quotes, `;`, `#`, backslashes and
  unbalanced parens are text, and `(~~ … ~~)` takes a `~)`. Blank lines are paragraph breaks. Both
  forms stay; the viewer keeps whichever a sketch is written in, and writes new sketches as `(~ … ~)`.
- **`(carries T1 T2 …)`** in a message type: has-a, beside `refines` (is-a). A subtype carries what its
  supertype carries; cycles are fine; it never changes what a port accepts. `sbtel query` prints what
  carries a type, and the core's `carriers()` (also `__api.carriers`) says which types, ports and blocks
  hold it.
- **Placement notes**: lint notes a message type or behavior declared above the lowest block that holds
  all its users (`Selection is declared in Shell but only used within Shell.SessionView; it could live
  there.`) or used by nothing (`X is never used.`). They are information (`info:` lines, `severity:
  "info"` in `--json`) and never change the exit code. The viewer lists them, muted, with "Move to …".
- **The viewer shows sketches where they belong.** Hovering a port in a drawer shows its sketch beside
  the drawer, at once, and outlines the blocks it can talk to (that took a click before). Clicking the
  port edits it in place: name, direction, type, sketch, or Delete, as one undo step, with a name clash
  or an out-of-scope type shown as you type. A level's name and an adjacency line show their sketches
  on hover and edit on click; an unnamed level offers "Name this level". Inherited ports open read-only
  with a way to their behavior. On a touch screen a tap shows the callout, with an Edit button. Message
  cards show the types they carry as dots, and hovering a type outlines everything that carries it.
  The Edit dialog's port rows have a sketch field. The diff view marks renamed levels and changed
  port, level and group sketches, and shows their word diffs.
- Lint warnings for the new forms: a level's `:name` (not a string, empty, twice, misplaced, or another
  keyword), a second sketch on a level, port or group, a sketch on a nested adjacent group, `carries`
  with no name or a name twice, and an unterminated `(~` (a parse error at the opener).
- Tests: conformance in node and goja for all of it, including viewer edits that round-trip through
  a parse (`~)`, `~~)`, quotes, backslashes, unbalanced parens, unicode, empty and multi-line text);
  accept6, a browser suite for callouts, editors, level labels and carried types with real mouse and
  real touch input.

### Changed

- A collapsed card says how many blocks it holds, at any depth ("23 blocks"), without the nesting
  depth; so do `sbtel query --with-deps` stubs.
- The sample spec and examples name their levels and use `(~ … ~)`; the repo's own specs moved four
  declarations to where lint's placement notes said they belong.
- The design skill speaks of levels of language, asks to name each level for the vocabulary it offers
  upward, and to say no more than the spec needs; the recover skill records level names, sketches and
  `carries` only where the code makes them evident.
- sbtel_owners.py reads `(~ … ~)` sketches.

## 0.1.2 (2026-11-08)

### Fixed

- **The viewer no longer calls Google Fonts.** The page loaded Hanken Grotesk and JetBrains Mono from
  fonts.googleapis.com on every open, a request to a third party from a localhost tool, and fell back
  to a wider system font offline or behind a proxy. The same font files (the variable woff2 subsets,
  119 KB, SIL OFL 1.1, from @fontsource-variable 5.3.0) are now in `viewer/fonts` and inlined into the
  page, so standalone, server and diff mode look exactly as before and make no request outside the
  sbtel server. `THIRD_PARTY_NOTICES` (and `sbtel licenses`) include the fonts' licenses; the e2e test
  fails on any request to a host other than 127.0.0.1, and the viewer build refuses remote resources.
- **`--help` and `-h` on every command** print that command's usage, what it does and its flags, and
  exit 0 (they were rejected as unknown flags with exit 2). `sbtel help <command>` does the same.
- **Singular counts.** The comment bubble's label says "1 comment", and the page's block count, checks
  pill and code panel say "1 block", "1 check" and "1 line". So do the selfcheck tools and
  `sbtel_sccs.py`.
- **`sbtel check` shows the `# VIOLATION:` explanations.** Each explained violation is followed by
  `  VIOLATION: <reason>`, `--json` gives every violation its `note`, and the summary says
  `N not allowed, N explained`. A note on an allowed edge, or one that explains no edge (a blank line,
  another note, a non-edge line or the end of the file comes first), is a warning; warnings do not
  change the exit code. So "every violation is explained" can be checked without the browser.
  `parseBindings` returns the unattached notes as `orphans`.
- **sbtel_owners.py** no longer ends a declaration at a raw string's line in column 0 (Go backtick
  strings, Python triple-quoted strings), no longer reads `@sbtel` inside a string literal as an
  annotation, and reports two `@sbtel Name` lines before one declaration, or two `@sbtel file` lines
  in one file, as errors instead of silently keeping the last.
- `sbtel sessions` shows a diff session's two absolute paths (`/abs/a.sbtel -> /abs/b.sbtel`, or
  `stdin` for a side read from stdin), as it does for spec sessions, instead of the bare file names.

### Changed

- A collapsed card's count line, and the stub comments of `sbtel query --with-deps`, say "3 blocks" or
  "9 blocks, 3 deep" instead of "3 blocks in 1 level": depth is nesting, and the language has no
  levels.
- DESIGN.md and LANGUAGE.md open with the README's first sentence: "sbtel is a language to design,
  understand, and collaborate on a system's architecture with AI."
- The README says which commands accept `--json` (not every one does) and points to `--help`.
- **examples/sbtel.sbtel** now holds the Go binary in detail, recovered from the code (CLI, server,
  engine, state and assets.go, 27 blocks), with the viewer beside the server rather than below it (no
  Go code names the page) and assets.go as `Sbtel.Assets`. The Go sources carry comment-only `@sbtel`
  annotations, and `examples/sbtel.edges.txt` holds their bindings: 39 edges, 3 explained violations.
- `install.sh` prints the PATH hint on stderr, with its other messages.
- Recover skill: Go guidance (a Go package is a no-imports namespace; take file-level SCCs inside each
  package, since Go forbids import cycles; load every GOOS and tag set; `callgraph` misses type and
  field references; gopls may not install behind a proxy), where `@sbtel file` goes in a Go file, one
  line each on Rust, Python and Java, what to do with no human in the loop, and a strip recipe that
  leaves no `.bak` files.

### Added

- **`sbtel_refs_go`**, a Go reference helper for the recover skill
  (`plugin/skills/sbtel-recover/scripts/sbtel_refs_go/`, a standalone module on the standard library:
  `go -C <dir> run . --dir "$PWD" ./...`). It loads every GOOS (and `--tags` set), resolves every
  identifier with go/types, and prints calls, type, field, method, constant and variable references in
  `sbtel_refs.mjs`'s format, or the declaration graph with `--units`. Tested in `make test-owners` and CI.
- `make selfcheck` also checks the Go code against `examples/sbtel.sbtel`: annotations, regenerated
  edges against the committed file, and `sbtel check` with every violation explained and no warning.
- `make docs-check` (`tools/docs/snippets.mjs`): every spec in the docs must lint as marked, and every
  lint, query and check output shown, and the README tour's `sbtel lint` and `sbtel check`
  transcripts, must be exactly what `bin/sbtel` prints. It runs in `make test-all`, CI (Linux) and the
  release workflow; `--fill` rewrites the outputs after an intended change.

## 0.1.1 (2026-11-08)

### Fixed

- **Comments in diff sessions.** In a tab opened by `sbtel open-diff`, a sent comment now keeps its
  bubble and its thread, also after a reload, and an agent's reply (`sbtel reply`) appears in the
  comment's thread as well as in a toast, exactly as in a spec session. Server and diff mode now share
  one implementation, `viewer/src/session.js`. Covered by the diff viewer test and the e2e test.

### Added

- The checks popover (`sbtel open --bindings`) lists every binding violation with its rule, its
  location and its explanation from the bindings file, a `# VIOLATION: reason` comment directly above
  the edge, or says that it has none. `parseBindings` (core.js, `__api.parseBindings`) returns that
  explanation as each edge's `note`; `sbtel check`'s output is unchanged.
- `examples/viewer.sbtel`: the viewer's own spec, recovered from its code with the sbtel-recover skill
  (33 blocks; the language core as `Pure` blocks, the text measurer as a real port, and 9 explained
  violations). It replaces `examples/playground.sbtel`, which was stale and chose its layering so that
  every binding passed. The code's `@sbtel` annotations now match it, and
  `examples/viewer.edges.txt` holds its bindings.
- `make selfcheck` (also in CI and the release workflow): lints the viewer's spec and
  `examples/sbtel.sbtel`, checks the annotations with `sbtel_owners.py`, regenerates the edges and
  fails if they differ from the committed file, and runs `sbtel check`, failing on any violation
  without a `# VIOLATION:` explanation. `make edges` regenerates the file and keeps the explanations.
  The extractor (`tools/selfcheck/`) uses a pinned TypeScript checker installed with npm; it is
  dev-only and never used by the binary.
- sbtel-recover skill: find the strongly connected components of the reference graph before choosing
  blocks, with guidance on granularity (`granularity.md`); recipes for code without imports, compiler
  or language-server references first and ctags plus scoped search only as a flagged fallback
  (`extracting-bindings.md`); what to do with existing annotations, and when moving one is a fix rather
  than gaming `sbtel check` (`annotations.md`). New optional helpers `scripts/sbtel_refs.mjs`
  (JS and TS references through the TypeScript checker) and `scripts/sbtel_sccs.py` (SCCs and the
  condensed layering).

### Changed

- **License: MIT** (`Copyright (c) 2026 Shashi Gowda`), replacing the WTFPL; the plugin and
  marketplace manifests say so.
- **Third-party notices.** `THIRD_PARTY_NOTICES` holds the full license text of every module the
  binary links (goja, regexp2, sourcemap, pprof, golang.org/x/text) and of the Go standard library,
  copied from the module sources by `scripts/third-party-notices.sh`. The binary embeds it, the new
  `sbtel licenses` command prints sbtel's license and the notices, and every release ships the file
  beside the binaries (eight assets; `checksums.txt` covers it). CI and release.sh fail when it is
  stale.
- **The repository is `shashi/sbtel`.** The install URLs, the plugin manifests and the docs name it,
  replacing the placeholder owner of 0.1.0. The Go module path is `github.com/shashi/sbtel`.
- The README opens with a new introduction (what sbtel is for, and why), and the plugin manifests and
  the viewer's help panel use its first sentence: "sbtel is a language to design, understand, and
  collaborate on a system's architecture with AI."

### Docs

- README: `SBTEL_BASE_URL`, `SBTEL_HOME`, `--no-browser` and `SBTEL_NO_BROWSER`; the tour now says to
  press Comment after selecting a block.
- LANGUAGE.md: the HTML annotation example names a leaf block; the `# VIOLATION:` explanation syntax;
  extraction points to the sbtel-recover skill; query ids are printed as `β:`/`μ:`.
- sbtel-design principles.md: the worked example's sketches now match its own "no and" claim.
- sbtel-language skill: query headers print `β:Name` and `μ:Name`; both spellings are accepted.

## 0.1.0 (2026-11-08)

The first release.

- The language: nested blocks in ordered layers, adjacent groups, ports, message types (with
  `refines` and `either`), behaviors (with parameters), sketches and keywords, with one implementation
  in `core/core.js` that the binary (in goja) and the viewer (in the browser) share, proven identical
  by node and goja conformance.
- The `sbtel` binary for Linux, macOS and Windows (amd64 and arm64): `lint`, `query` (fragments that
  lint clean on their own, `--with-deps`), `check` (code bindings against the layering), `diff`,
  `open` and `open-diff` (a shared localhost server with sessions), `inbox` (`--wait`, `--peek`),
  `reply`, `sessions`, `close`, `serve --status`/`--stop` and `version`; `--json` everywhere.
- The viewer: one self-contained page with a standalone playground, server mode (comments, saves,
  versions with a Reload toast, bindings in the checks popover) and diff mode (ghosts, marks, a change
  list, Before and After).
- `install.sh` and `install.ps1` with SHA-256 verification; the CI and release workflows.
- The Claude Code plugin with the sbtel-language, sbtel-design and sbtel-recover skills, and the
  `sbtel_owners.py` annotation helper.
