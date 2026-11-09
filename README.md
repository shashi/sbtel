# sbtel: slightly better than the English language

sbtel is a language to design, understand, and collaborate on a system's architecture with AI.

**Why?** Designs usually start on a whiteboard, where two dimensions give you room to think. Then they get translated into maybe one snapshot the AI sees, and a whole bunch of prompts once questions come up. Eight hours of prompting later, the spec is refined, but it's hard to feel you have a full view of what you just designed.

On larger projects written by AI, trying to understand the system by prompting the AI again brings you back to the one-dimensional bandwidth of chat. The cost of going back to the drawing board becomes too high. You can ask it to draw a diagram, but then you still have to prompt it to change anything.

Subtler problems get simpler with a 2D view: duplicated invariants causing inconsistent behaviour, or the same assumption made inconsistently in different places. Looking at the system in 2D again gives you room to think and rearrange parts, so these problems can be solved decisively. And it gives you peace of mind that you understand what just happened.

**What:** sbtel is an opinionated but effective view of a system. It shows what is coupled and what is independent, which parts talk through messages, and which levels of language the system is built in. Implementation details stay in plain-language specs.

sbtel's blocks can map to anything: features, files, modules, functions. So AI can adapt it to whatever implementation language or level of detail it's working on. Its only job is to make the arrangement of the parts legible.

**How:** The language maps to a UI tool that any coding agent can talk to via a Go binary. Agents can propose changes, read your comments and reply to them. You can edit the view with a WYSIWYG editor and send the changes with a click.

## Install

macOS, Linux, or Git Bash/MSYS on Windows:

```sh
curl -fsSL https://raw.githubusercontent.com/shashi/sbtel/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/shashi/sbtel/main/install.ps1 | iex
```

Each installer downloads the release binary for your platform, verifies its SHA-256, and installs it to
`~/.local/bin` (on Windows, `%LOCALAPPDATA%\Programs\sbtel`). Set `SBTEL_INSTALL_DIR` to choose another
directory, `SBTEL_VERSION=v0.1.1` to pick a release, or `SBTEL_BASE_URL` to download from somewhere
else (a mirror, or a local build with `SBTEL_BASE_URL=file://$PWD/dist`, which needs curl rather than
wget); `SBTEL_BASE_URL` wins over `SBTEL_VERSION`. There is one static binary with no runtime
dependencies.

At run time, `sbtel` keeps its sessions and the shared server's state in `~/.sbtel`
(`%USERPROFILE%\.sbtel` on Windows), or in `$SBTEL_HOME` when that is set. `sbtel open` and
`sbtel open-diff` open a browser tab; pass `--no-browser`, or set `SBTEL_NO_BROWSER=1`, to only print
the URL (on a headless machine, in CI, or when the tab is already open).

From source: `make` (Go 1.24, node ≥ 18) builds `bin/sbtel`. `make test-all` runs every test,
including the browser tests (they need Chrome and Playwright) and `make selfcheck`, which holds the
viewer's own spec to its code (it needs python3, and npm once for a pinned, dev-only TypeScript).

The repository is [shashi/sbtel](https://github.com/shashi/sbtel). [RELEASING.md](RELEASING.md) says
how to cut a release.

## A 60-second tour

**1. Write a spec.** Blocks sit in levels, top to bottom: a level is built from the ones below it, and
its name is the vocabulary it offers upward. `(~ … ~)` is a sketch, like `(sketch "…")`. Save this
as `notes.sbtel`:

```lisp
(block Notes
  (sketch "Write notes, see them rendered, keep them on disk.")
  (message Edit (sketch "A change to one note's text."))
  (level :name "Editing"
    (adjacent (~ The preview follows the editor. ~)
      (block Notes.Editor (port edit out Edit) (sketch "The text area."))
      (block Notes.Preview (sketch "Renders the note beside the editor."))))
  (level :name "Storage"
    (block Notes.Store (port edit in Edit) (sketch "Writes notes to disk."))))
```

**2. Lint it.**

```console
$ sbtel lint notes.sbtel
notes.sbtel: ok (4 blocks, 0 behaviors, 1 message type)
```

**3. Open it.** The browser shows the diagram; the command prints a session id.

```console
$ id=$(sbtel open notes.sbtel)
sbtel open: http://127.0.0.1:52817/s/3f9c…/
```

**4. Read, comment and edit in the browser, then send it as one review.** Point at a port in a drawer,
a level's name or the line between adjacent blocks to read its sketch; click it to edit it in place.
Click `Notes.Store` to select it, press **Comment** in the bar that appears (or ⌘/Ctrl-click the
block), write "Keep a backup of the last version", and press **Add to review**. Edit the diagram too:
click `Notes.Preview`, choose Edit and sharpen its sketch. Comments and edits gather in your draft
review, as on GitHub; **Review (2)** in the toolbar opens it. Add an overall message and press **Send
review**. A review never writes the spec file: your edits go to the agent as a proposed spec, and stay
in the tab, marked "proposed", until the agent pushes a version. (**Send now** sends one comment at
once; **Save** writes your text to the file directly.)

**5. The agent reads the inbox,** applies or merges the proposed spec, pushes the result and answers:

```console
$ sbtel inbox $id --wait
r2 review of version 1 by user, 2026-11-08T09:30:12Z: a message, 1 comment, proposed edits
  > Looks good. One question, and a sketch I sharpened.
  edits against version 1 (sbtel diff):
    ~ block Notes.Preview: sketch [-editor.-] {+editor, as you type.+}
    1 change (0 added, 0 removed, 0 moved, 0 renamed, 1 changed), 0 affected ports
  proposed spec: /home/you/.sbtel/sessions/3f9c…/proposals/2.sbtel
  c2.1 comment on block Notes.Store
    > Keep a backup of the last version
    source:
      (block Notes.Store (port edit in Edit) (sketch "Writes notes to disk."))

$ cp ~/.sbtel/sessions/$id/proposals/2.sbtel notes.sbtel   # take the proposal, then add Notes.Backup
$ sbtel open notes.sbtel --session $id      # the tab offers "Reload" for version 2
$ sbtel reply $id c2.1 "Added Notes.Backup below Store."
```

That loop (lint, open, inbox, open --session, reply) is how a human and an agent design together.
To keep code honest, list who calls whom in an edges file and run `sbtel check`:

```console
$ cat edges.txt
Notes.Store -> Notes.Editor   # src/store.ts:40
$ sbtel check notes.sbtel --bindings edges.txt
edges.txt:1: Notes.Store -> Notes.Editor: upward: Notes.Store (level 1 "Storage" of Notes) binds upward to Notes.Editor (level 2 "Editing")  (src/store.ts:40)
notes.sbtel: 1 binding, 1 not allowed, 0 explained
```

## Commands

| Command | What it does |
|---|---|
| `sbtel lint <spec>…` | parse errors, warnings and the spec rules |
| `sbtel query <spec> <id>… [--with-deps]` | print elements as a fragment that lints clean on its own; `--with-deps` adds the blocks they may bind to as stubs |
| `sbtel check <spec> --bindings <edges.txt>` | code bindings that the levels forbid |
| `sbtel diff <a> <b>` | what changed between two specs |
| `sbtel open <spec> [--session id]` | open the diagram in the browser, or push a new version to it |
| `sbtel open-diff <a> <b>` | open a visual diff |
| `sbtel inbox <session> [--wait]` | what the human sent: reviews (message, comments and a proposed spec), comments sent on their own, saves |
| `sbtel reply <session> <id> <text>` | answer a comment (`c2`, `c7.1`) or a review (`r7`) in the open tab |
| `sbtel sessions` / `sbtel close <session>` | list or end sessions |
| `sbtel serve --status` / `--stop` | the shared localhost server |
| `sbtel version` | the version |
| `sbtel licenses` | sbtel's license (MIT) and the licenses of the third-party code in the binary |

`sbtel <command> --help` describes a command and its flags. The commands that print results accept
`--json`. Exit codes: 0 ok, 1 check failures, 2 usage or IO errors. The full
contract (flags, formats, the server, the state directory) is in [docs/DESIGN.md](docs/DESIGN.md).

## Documentation

- [docs/LANGUAGE.md](docs/LANGUAGE.md): the language reference, with a one-page cheat sheet and every
  check's exact message.
- [docs/DESIGN.md](docs/DESIGN.md): the architecture and the contract between the parts.
- [RELEASING.md](RELEASING.md): cutting a release, and the CI and release workflows.
- [examples/](examples/): sample specs: [shell.sbtel](examples/shell.sbtel) (an app shell, the
  viewer's built-in sample), [sbtel.sbtel](examples/sbtel.sbtel) (sbtel's own architecture, with the
  Go binary recovered from its code; bindings in [sbtel.edges.txt](examples/sbtel.edges.txt)) and
  [viewer.sbtel](examples/viewer.sbtel) (the viewer page, recovered from its code; bindings in
  [viewer.edges.txt](examples/viewer.edges.txt)). `make selfcheck` keeps each spec, the code's
  `@sbtel` annotations and the edges in agreement.
- [CHANGELOG.md](CHANGELOG.md): what changed in each release.

## Embedding the viewer

The viewer is one HTML file (`viewer/dist/index.html`). Opened from a file or any web server, it is
the playground, and its URL can pick the spec and the presentation:

| URL part | What it does |
|---|---|
| `#src=<base64url>` | shows that spec: base64url of its UTF-8 text |
| `#example=<name>` | fetches `examples/<name>.sbtel` next to the page (served over HTTP), for long specs |
| `?embed` | for an iframe: no side panels, a small toolbar (undo, zoom, fit, **Open in playground ↗**), fitted to the frame, transparent background |
| `?embed=readonly` | the same, with nothing editable |
| `&theme=light` or `&theme=dark` | a fixed theme instead of the system's |
| `&focus=<Block>` | in embed mode, fit that block instead of the whole file |

```html
<iframe src="/sbtel/play/?embed=readonly#example=shell" width="100%" height="360"
        style="border:0" title="sbtel demo"></iframe>
```

In JavaScript, `btoa(String.fromCharCode(...new TextEncoder().encode(spec))).replace(/\+/g, '-')
.replace(/\//g, '_').replace(/=+$/, '')` makes the `#src` value. An embedded viewer scrolls with the
page until it is clicked, and each spec keeps its own undo history and settings in the browser, apart
from other demos and from the playground. A spec that cannot be read shows its error in place.

In a frame, the viewer fits what it draws, and tells a page on the same origin its natural size, so the
page can size the frame to the diagram:

```js
addEventListener('message', e => {
  if (e.origin !== location.origin || e.data?.type !== 'sbtel:size') return;
  const f = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source);
  if (f) f.style.height = Math.min(720, Math.max(220, f.clientWidth * e.data.height / e.data.width)) + 'px';
});
```

`width` and `height` are CSS pixels at zoom 1, padding and toolbar included. The message goes only to a
same-origin parent (target origin `'/'`); a page on another origin gets nothing and keeps its own height.

[docs/DESIGN.md §6.9](docs/DESIGN.md) has the details. A copy of the page with `<meta name="sbtel-home"
content="…">` points the playground's "sbtel" link at that address.

## Claude Code plugin

The repo is a Claude Code plugin marketplace. The `sbtel` plugin adds three skills:
**sbtel-language** (reading and writing specs, the tool loop), **sbtel-design** (designing a system as a
spec, with the human in the loop) and **sbtel-recover** (recovering a spec from an existing codebase
and checking the code against it).

```
/plugin marketplace add shashi/sbtel
/plugin install sbtel@sbtel
```

## License

[MIT](LICENSE). The binary bundles third-party code under its own licenses: `sbtel licenses` prints
them, and [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) has the same text.
