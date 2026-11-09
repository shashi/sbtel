// @sbtel file Sbtel.Cli.ExportCommand

package main

// sbtel export (DESIGN.md §3.14): one self-contained HTML file, the viewer page with the spec, its
// options and its bindings baked in, to share with people who have no sbtel. No server is involved, and
// the page requests nothing (§6.5); the standalone boot (viewer/src/play.js) reads the baked blocks.

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"strings"

	"github.com/shashi/sbtel"
	"github.com/shashi/sbtel/internal/engine"
)

// exportAnchor is the viewer's <title> line; the export replaces it with its own title and the baked
// blocks, so they sit in the head, before the page's script runs.
const exportAnchor = "<title>sbtel Playground</title>\n"

// exportPage is what one exported file carries.
type exportPage struct {
	title, spec        string
	bindings           *string
	readonly, embedded bool
}

// scriptText escapes text for an inert <script> block: & and < as entities, so nothing in a spec can end
// the block (</script) or open a comment (<!--); CR and NUL as numeric references, which the HTML parser
// would otherwise turn into LF and U+FFFD. play.js undoes exactly these. Invalid UTF-8 becomes U+FFFD
// here, as the browser would read it.
var scriptText = strings.NewReplacer("&", "&amp;", "<", "&lt;", "\r", "&#13;", "\x00", "&#0;")

func escapeScriptText(s string) string { return scriptText.Replace(strings.ToValidUTF8(s, "�")) }

// exportHTML is the viewer page with p baked in.
func exportHTML(viewer string, p exportPage) (string, error) {
	if strings.Count(viewer, exportAnchor) != 1 {
		return "", errors.New("the embedded viewer page has no " + strings.TrimSpace(exportAnchor) + " line to replace")
	}
	cfg, err := json.Marshal(map[string]any{"title": p.title, "readonly": p.readonly, "embed": p.embedded, "version": sbtel.Version()})
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("<title>" + html.EscapeString(p.title) + "</title>\n")
	b.WriteString(`<meta name="generator" content="sbtel export ` + html.EscapeString(sbtel.Version()) + `">` + "\n")
	// encoding/json writes <, > and & as <, > and &, so the JSON is safe as it is.
	b.WriteString(`<script type="application/json" id="sbtel-export">` + string(cfg) + "</script>\n")
	b.WriteString(`<script type="text/sbtel" id="sbtel-spec">` + escapeScriptText(p.spec) + "</script>\n")
	if p.bindings != nil {
		b.WriteString(`<script type="text/plain" id="sbtel-bindings">` + escapeScriptText(*p.bindings) + "</script>\n")
	}
	return strings.Replace(viewer, exportAnchor, b.String(), 1), nil
}

// shortOut turns -o into --out: the one short flag (§3.1), as compilers spell it.
func shortOut(args []string) []string {
	out := make([]string, 0, len(args))
	for i, a := range args {
		if a == "--" {
			return append(out, args[i:]...)
		}
		if a == "-o" {
			a = "--out"
		} else if strings.HasPrefix(a, "-o=") {
			a = "--out=" + a[3:]
		}
		out = append(out, a)
	}
	return out
}

// exportLintLimit: larger specs are not linted (goja needs seconds per MiB), as with open (§3.7).
const exportLintLimit = 1 << 20

// parseError is api.js's Located: where a spec stops parsing.
type parseError struct {
	Message   string
	Line, Col int
}

// topName is the name of the spec's first top-level block ("" when it has none), or its parse error.
func topName(en *engine.Engine, src string) (string, *parseError, error) {
	s, err := en.Call("topBlocks", src)
	if err != nil {
		return "", nil, err
	}
	var r struct {
		Error  *parseError
		Blocks []struct{ ID, Name string }
	}
	if err := json.Unmarshal([]byte(s), &r); err != nil {
		return "", nil, err
	}
	if r.Error != nil || len(r.Blocks) == 0 {
		return "", r.Error, nil
	}
	return r.Blocks[0].Name, nil, nil
}

// sbtel export <spec>|- [-o out.html] [--readonly] [--bindings edges.txt] [--title text] [--embed]  (§3.14)
func cmdExport(e env, args []string) int {
	const cmd = "export"
	f, err := parseArgs(shortOut(args), []string{"readonly", "embed"}, []string{"out", "bindings", "title"})
	if err != nil {
		return usageErr(e, cmd, err)
	}
	if len(f.pos) != 1 {
		return usageErr(e, cmd, errors.New("need exactly one spec (a file or -)"))
	}
	specArg := f.pos[0]
	out, hasOut := f.val("out")
	switch {
	case hasOut && out == "":
		return usageErr(e, cmd, errors.New("-o needs a file name (or - for stdout)"))
	case !hasOut && specArg == "-":
		return usageErr(e, cmd, errors.New("the spec is read from stdin: name the output with -o"))
	case !hasOut:
		base := filepath.Base(specArg)
		out = strings.TrimSuffix(base, filepath.Ext(base)) + ".html"
	}
	bind, hasBind := f.val("bindings")
	if hasBind && bind == "" {
		return usageErr(e, cmd, errors.New("--bindings needs an edges file (or -)"))
	}
	if hasBind && bind == "-" && specArg == "-" {
		return usageErr(e, cmd, errTwoStdin)
	}
	title, hasTitle := f.val("title")
	if hasTitle && strings.TrimSpace(title) == "" {
		return usageErr(e, cmd, errors.New("--title is empty"))
	}
	if out != "-" && specArg != "-" {
		a, _ := filepath.Abs(specArg)
		b, _ := filepath.Abs(out)
		if a == b {
			return usageErr(e, cmd, fmt.Errorf("the output %s is the spec itself", out))
		}
	}
	in := []string{specArg}
	if hasBind {
		in = append(in, bind)
	}
	files, code := readInputs(e, cmd, in)
	if code != 0 {
		return code
	}
	spec := files[0]

	// Validate first: a spec that does not parse writes nothing (exit 2, like diff); lint problems and
	// binding violations are printed in lint's and check's formats, and the file is still written.
	en, err := engine.New()
	if err != nil {
		return exportErr(e, err)
	}
	top, perr, err := topName(en, spec.Src)
	if err != nil {
		return exportErr(e, err)
	}
	if perr != nil {
		fmt.Fprintf(e.stderr, "sbtel %s: %s:%d:%d: error: %s (nothing written)\n", cmd, spec.Name, perr.Line, perr.Col, perr.Message)
		return 2
	}
	if len(spec.Src) > exportLintLimit {
		fmt.Fprintf(e.stderr, "sbtel %s: %s: larger than 1 MiB, not linted (run sbtel lint)\n", cmd, spec.Name)
	} else {
		if r, err := en.CLI("lint", map[string]any{"files": files[:1], "json": false}); err == nil && r.Exit != 0 {
			fmt.Fprint(e.stderr, r.Stdout)
		}
		if hasBind {
			bindingsToStderr(e, en, files[0], files[1])
		}
	}

	p := exportPage{title: strings.TrimSpace(title), spec: spec.Src, readonly: f.has("readonly"), embedded: f.has("embed")}
	if p.title == "" {
		p.title = top
	}
	if p.title == "" {
		if specArg == "-" {
			p.title = "stdin"
		} else {
			p.title = filepath.Base(specArg)
		}
	}
	if hasBind {
		p.bindings = &files[1].Src
	}
	page, err := exportHTML(sbtel.ViewerHTML, p)
	if err != nil {
		return exportErr(e, err)
	}
	if out == "-" {
		if _, err := fmt.Fprint(e.stdout, page); err != nil {
			return exportErr(e, err)
		}
		fmt.Fprintf(e.stderr, "sbtel %s: %s to stdout\n", cmd, exportSize(len(page)))
		return 0
	}
	if err := writeAtomic(out, page); err != nil {
		return exportErr(e, err)
	}
	fmt.Fprintf(e.stderr, "sbtel %s: wrote %s (%s)\n", cmd, out, exportSize(len(page)))
	return 0
}

// bindingsToStderr prints what `sbtel check` says of the bindings: all of it when a violation is not
// explained or a line is not an edge or a note is misplaced, else only its summary line, which counts the
// explained violations (the page shows them all).
func bindingsToStderr(e env, en *engine.Engine, spec, bind engine.File) {
	r, err := en.CLI("check", map[string]any{"files": []engine.File{spec}, "bindings": bind, "json": false})
	if err != nil {
		return
	}
	s, err := en.Call("check", spec.Src, bind.Src)
	if err != nil {
		return
	}
	var c struct {
		Violations []json.RawMessage
		Invalid    []json.RawMessage
		Warnings   []json.RawMessage
		Explained  int
	}
	if json.Unmarshal([]byte(s), &c) == nil && len(c.Invalid) == 0 && len(c.Warnings) == 0 && c.Explained == len(c.Violations) {
		lines := strings.Split(strings.TrimRight(r.Stdout, "\n"), "\n")
		fmt.Fprintln(e.stderr, lines[len(lines)-1])
		return
	}
	fmt.Fprint(e.stderr, r.Stdout)
}

// exportErr prints an IO or engine error; exit 2.
func exportErr(e env, err error) int {
	fmt.Fprintf(e.stderr, "sbtel export: %v\n", err)
	return 2
}

func exportSize(n int) string { return fmt.Sprintf("%d bytes, %d KiB", n, (n+1023)/1024) }

// writeAtomic writes through a temporary file in the same directory and renames it, so a failed export
// never leaves half a page where an older one was.
func writeAtomic(path, text string) error {
	t, err := os.CreateTemp(filepath.Dir(path), ".sbtel-export-*")
	if err != nil {
		return err
	}
	defer os.Remove(t.Name()) // a no-op after the rename
	if _, err := t.WriteString(text); err != nil {
		t.Close()
		return err
	}
	if err := t.Close(); err != nil {
		return err
	}
	if err := os.Chmod(t.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(t.Name(), path)
}
