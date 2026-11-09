package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/shashi/sbtel"
)

// trickySpec has, in sketches, everything that could end or confuse an inline <script>: a closing tag in
// two cases, a comment opener followed by <script>, entities that must stay literal, a CR and a NUL.
const trickySpec = "(block Trick\n  (sketch \"ends with </script><script>alert(1)</script> and </SCRIPT >\")\n" +
	"  (level (block Trick.A (sketch \"<!-- <script> &lt; &amp; &#13; a & b < c\r\nnext\x00line\"))))\n"

// block returns the raw text of the inert <script ... id="id"> block, and whether there is one.
func block(t *testing.T, page, id string) (string, bool) {
	t.Helper()
	m := regexp.MustCompile(`<script type="[^"]+" id="` + id + `">([^<]*)</script>`).FindStringSubmatch(page)
	if m == nil {
		if regexp.MustCompile(`<script type="[^"]+" id="` + id + `">`).MatchString(page) {
			t.Fatalf("block %s is there but holds a < or does not end where it should", id)
		}
		return "", false
	}
	return m[1], true
}

// unescapeBlock mirrors play.js's unescape: &lt;, &amp; and numeric references.
func unescapeBlock(s string) string {
	return regexp.MustCompile(`&(?:lt|amp|#(\d+));`).ReplaceAllStringFunc(s, func(m string) string {
		switch m {
		case "&lt;":
			return "<"
		case "&amp;":
			return "&"
		}
		var n rune
		for _, c := range m[2 : len(m)-1] {
			n = n*10 + c - '0'
		}
		return string(n)
	})
}

type exportCfg struct {
	Title    string
	Readonly bool
	Embed    bool
	Version  string
}

func config(t *testing.T, page string) exportCfg {
	t.Helper()
	raw, ok := block(t, page, "sbtel-export")
	if !ok {
		t.Fatal("no sbtel-export block")
	}
	var c exportCfg
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		t.Fatalf("sbtel-export: %v in %q", err, raw)
	}
	return c
}

func TestExportWritesAFile(t *testing.T) {
	dir := t.TempDir()
	spec, _ := filepath.Abs(shellSpec)
	t.Chdir(dir)
	c, out, errs := runT("", "export", spec)
	if c != 0 || out != "" {
		t.Fatalf("exit %d, stdout %q, stderr %q", c, out, errs)
	}
	b, err := os.ReadFile("shell.html") // the default: the spec's base name with .html, here
	if err != nil {
		t.Fatal(err)
	}
	page := string(b)
	if !regexp.MustCompile(`sbtel export: wrote shell\.html \(\d+ bytes, \d+ KiB\)\n$`).MatchString(errs) {
		t.Errorf("stderr: %q", errs)
	}
	if !strings.Contains(page, "<!doctype html>") || !strings.Contains(page, "<title>Shell</title>") || strings.Contains(page, "sbtel Playground") {
		t.Errorf("not the viewer with its title: %.300q", page)
	}
	if got, ok := block(t, page, "sbtel-spec"); !ok || unescapeBlock(got) != mustRead(t, spec) {
		t.Error("the spec is not baked in as it is")
	}
	if c := config(t, page); c.Title != "Shell" || c.Readonly || c.Embed || c.Version == "" {
		t.Errorf("config %+v", c)
	}
	if _, ok := block(t, page, "sbtel-bindings"); ok {
		t.Error("bindings without --bindings")
	}
	// Self-contained: nothing that would make a request (§6.5's rule for the page holds for the export).
	if regexp.MustCompile(`(?i)<(?:link|script)\b[^>]*\b(?:href|src)\s*=\s*["']?(?:https?:)?//|url\(\s*["']?(?:https?:)?//`).MatchString(page) {
		t.Error("the page references a remote resource")
	}

	// -o, --out, -o=, and -o - for stdout.
	for _, args := range [][]string{{"-o", "a.html"}, {"--out", "b.html"}, {"-o=c.html"}} {
		if c, _, errs := runT("", append([]string{"export", spec}, args...)...); c != 0 {
			t.Errorf("%v: exit %d %q", args, c, errs)
		}
	}
	for _, f := range []string{"a.html", "b.html", "c.html"} {
		if _, err := os.Stat(f); err != nil {
			t.Error(err)
		}
	}
	c, out, errs = runT(mustRead(t, spec), "export", "-", "-o", "-")
	if c != 0 || !strings.HasPrefix(out, "<!-- @sbtel file App.Page -->") || !strings.Contains(errs, "to stdout") {
		t.Errorf("stdout: exit %d, %d bytes, %q", c, len(out), errs)
	}
}

func TestExportEscapesTheSpec(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "trick.sbtel")
	if err := os.WriteFile(p, []byte(trickySpec), 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "trick.html")
	if c, _, errs := runT("", "export", p, "-o", out, "--title", `T </title><script>x()</script> & "q"`); c != 0 {
		t.Fatalf("exit %d %q", c, errs)
	}
	page := string(must(os.ReadFile(out)))
	raw, ok := block(t, page, "sbtel-spec")
	if !ok {
		t.Fatal("no spec block")
	}
	if strings.ContainsAny(raw, "<\r\x00") {
		t.Errorf("unescaped text in the block: %q", raw)
	}
	if got := unescapeBlock(raw); got != trickySpec {
		t.Errorf("round trip:\n got %q\nwant %q", got, trickySpec)
	}
	if !strings.Contains(page, "<title>T &lt;/title&gt;&lt;script&gt;x()&lt;/script&gt; &amp; &#34;q&#34;</title>") {
		t.Errorf("title not escaped: %q", regexp.MustCompile(`<title>.*`).FindString(page))
	}
	if c := config(t, page); c.Title != `T </title><script>x()</script> & "q"` {
		t.Errorf("config title %q", c.Title)
	}
	// The page's own script is intact: the one that holds the app still ends the document.
	if n := strings.Count(strings.ToLower(page), "</script"); n != strings.Count(strings.ToLower(sbtel.ViewerHTML), "</script")+2 {
		t.Errorf("%d </script in the page", n)
	}
}

func TestExportReadonlyEmbedAndBindings(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "s.html")
	bind := "# VIOLATION: a test edge </script>\nShell.Router -> Shell.Composer  # a.ts:1\n"
	c, _, errs := runT(bind, "export", shellSpec, "-o", out, "--readonly", "--embed", "--bindings", "-")
	if c != 0 {
		t.Fatalf("exit %d %q", c, errs)
	}
	page := string(must(os.ReadFile(out)))
	if c := config(t, page); !c.Readonly || !c.Embed {
		t.Errorf("config %+v", c)
	}
	if got, ok := block(t, page, "sbtel-bindings"); !ok || unescapeBlock(got) != bind {
		t.Errorf("bindings block %q", got)
	}
	// All violations explained: only check's summary line.
	if !strings.Contains(errs, "1 binding, 1 not allowed, 1 explained") || strings.Contains(errs, "upward") {
		t.Errorf("stderr: %q", errs)
	}
	// An unexplained violation prints check's text; still written, exit 0.
	c, _, errs = runT("Shell.Router -> Shell.Composer\n", "export", shellSpec, "-o", out, "--bindings", "-")
	if c != 0 || !strings.Contains(errs, "Shell.Router -> Shell.Composer:") || !strings.Contains(errs, "wrote ") {
		t.Errorf("unexplained: exit %d %q", c, errs)
	}
	if c := config(t, string(must(os.ReadFile(out)))); c.Readonly || c.Embed {
		t.Errorf("flags carried over: %+v", c)
	}
}

func TestExportValidation(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "x.html")
	// A parse error writes nothing, and leaves an older file alone.
	c, _, errs := runT("(block A (sketch \"x\")", "export", "-", "-o", out)
	if c != 2 || !strings.Contains(errs, "<stdin>:1:1: error:") || !strings.Contains(errs, "nothing written") {
		t.Errorf("parse error: exit %d %q", c, errs)
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Errorf("a file was written: %v", err)
	}
	if err := os.WriteFile(out, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if c, _, _ := runT("(block A", "export", "-", "-o", out); c != 2 || string(must(os.ReadFile(out))) != "old" {
		t.Errorf("parse error overwrote the file (exit %d)", c)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".sbtel-export-*")); len(left) != 0 {
		t.Errorf("temporary files left: %v", left)
	}
	// Warnings go to stderr in lint's format and the file is still written.
	c, _, errs = runT("(blok A)\n(block B)\n", "export", "-", "-o", out)
	if c != 0 || !strings.Contains(errs, "<stdin>:1:1: warning: unknown form (blok)") || string(must(os.ReadFile(out))) == "old" {
		t.Errorf("warning: exit %d %q", c, errs)
	}
	if c := config(t, string(must(os.ReadFile(out)))); c.Title != "B" {
		t.Errorf("default title %q, want the top block's name", c.Title)
	}
	// No block at all: the file name.
	empty := filepath.Join(dir, "empty.sbtel")
	os.WriteFile(empty, []byte("; nothing yet\n"), 0o644)
	if c, _, _ := runT("", "export", empty, "-o", out); c != 0 || config(t, string(must(os.ReadFile(out)))).Title != "empty.sbtel" {
		t.Errorf("empty spec: exit %d", c)
	}
	for _, tc := range []struct {
		name string
		args []string
	}{
		{"stdin without -o", []string{"export", "-"}},
		{"no spec", []string{"export"}},
		{"two specs", []string{"export", shellSpec, shellSpec}},
		{"empty -o", []string{"export", shellSpec, "-o", ""}},
		{"empty title", []string{"export", shellSpec, "-o", out, "--title", " "}},
		{"two stdin", []string{"export", "-", "-o", out, "--bindings", "-"}},
		{"the spec itself", []string{"export", empty, "-o", empty}},
		{"unknown flag", []string{"export", shellSpec, "--json"}},
		{"missing spec", []string{"export", "nope.sbtel", "-o", out}},
		{"missing bindings", []string{"export", shellSpec, "-o", out, "--bindings", "nope.txt"}},
	} {
		if c, _, errs := runT("", tc.args...); c != 2 || !strings.HasPrefix(errs, "sbtel export: ") {
			t.Errorf("%s: exit %d %q", tc.name, c, errs)
		}
	}
	if string(must(os.ReadFile(empty))) != "; nothing yet\n" {
		t.Error("the spec was overwritten")
	}
}

func must(b []byte, err error) []byte {
	if err != nil {
		panic(err)
	}
	return b
}
