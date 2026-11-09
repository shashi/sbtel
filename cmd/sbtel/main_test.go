package main

import (
	"bytes"
	"strings"
	"testing"
)

func runT(stdin string, args ...string) (int, string, string) {
	var out, errb bytes.Buffer
	code := run(args, env{strings.NewReader(stdin), &out, &errb})
	return code, out.String(), errb.String()
}

func TestVersionAndUsage(t *testing.T) {
	if c, out, _ := runT("", "version"); c != 0 || !strings.HasPrefix(out, "sbtel ") {
		t.Errorf("version: %d %q", c, out)
	}
	if c, _, _ := runT(""); c != 2 {
		t.Errorf("no args: exit %d", c)
	}
	if c, _, _ := runT("", "frobnicate"); c != 2 {
		t.Errorf("unknown command: exit %d", c)
	}
}

func TestLintEndToEnd(t *testing.T) {
	c, out, _ := runT("", "lint", "../../examples/shell.sbtel", "../../examples/viewer.sbtel", "../../examples/sbtel.sbtel")
	if c != 0 || strings.Count(out, ": ok (") != 3 {
		t.Errorf("examples: exit %d\n%s", c, out)
	}
	if c, _, _ := runT("", "lint", "../../conformance/specs/bad-scope.sbtel"); c != 1 {
		t.Errorf("bad-scope: exit %d, want 1", c)
	}
	if c, out, _ := runT("(block A)", "--json" /* flag before command is not allowed */); c != 2 {
		t.Errorf("flag as command: exit %d %q", c, out)
	}
	c, out, _ = runT("(block A (port :in Nope :as p))", "lint", "--json", "-")
	if c != 1 || !strings.Contains(out, `"file":"<stdin>"`) || strings.Count(out, "\n") != 1 {
		t.Errorf("stdin json: exit %d %q", c, out)
	}
	if c, _, errs := runT("", "lint", "nope.sbtel"); c != 2 || !strings.Contains(errs, "nope.sbtel") {
		t.Errorf("missing file: exit %d %q", c, errs)
	}
	if c, _, _ := runT("", "lint", "-x", "a"); c != 2 {
		t.Errorf("short flag: exit %d", c)
	}
}

func TestParseArgs(t *testing.T) {
	f, err := parseArgs([]string{"a", "--json", "--session=abc", "-", "--label", "x y", "--", "--json"}, []string{"json"}, []string{"session", "label"})
	if err != nil {
		t.Fatal(err)
	}
	s, _ := f.val("session")
	l, _ := f.val("label")
	if strings.Join(f.pos, "|") != "a|-|--json" || !f.has("json") || s != "abc" || l != "x y" {
		t.Errorf("got %+v", f)
	}
	for _, bad := range [][]string{{"--nope"}, {"--json=1"}, {"--session"}, {"-j"}} {
		if _, err := parseArgs(bad, []string{"json"}, []string{"session"}); err == nil {
			t.Errorf("%v: want error", bad)
		}
	}
}

// DESIGN.md §3.1: diagnostics start "sbtel <cmd>: ", including IO errors from reading inputs.
func TestInputErrorsNameTheCommand(t *testing.T) {
	for _, args := range [][]string{
		{"lint", "/no/such/spec.sbtel"},
		{"query", "/no/such/spec.sbtel", "A"},
		{"check", "/no/such/spec.sbtel", "--bindings", "/no/such/edges.txt"},
		{"diff", "/no/such/a.sbtel", "/no/such/b.sbtel"},
	} {
		c, _, errs := runT("", args...)
		if c != 2 || !strings.HasPrefix(errs, "sbtel "+args[0]+": ") {
			t.Errorf("%v: exit %d, stderr %q", args, c, errs)
		}
	}
	if c, _, errs := runT("(block A)", "lint", "-", "-"); c != 2 || !strings.HasPrefix(errs, "sbtel lint: - (stdin)") {
		t.Errorf("lint - -: exit %d, stderr %q", c, errs)
	}
	if _, out, _ := runT("", "help"); !strings.Contains(out, "sbtel check <spec>|- --bindings <edges.txt>|- ") {
		t.Errorf("check usage should show that - is accepted:\n%s", out)
	}
}

// Every command answers --help and -h (anywhere before "--") with its own usage, on stdout, exit 0;
// `sbtel help <command>` prints the same.
func TestCommandHelp(t *testing.T) {
	t.Setenv("SBTEL_HOME", t.TempDir())
	t.Setenv("SBTEL_NO_BROWSER", "1")
	for name, c := range commands {
		if c.hidden {
			continue
		}
		for _, args := range [][]string{{name, "--help"}, {name, "-h"}, {name, "x", "--json", "--help"}, {"help", name}} {
			code, out, errs := runT("", args...)
			if code != 0 || errs != "" || !strings.HasPrefix(out, "usage: sbtel "+name+" ") && out != "usage: sbtel "+name+"\n\n"+c.help+"\n" {
				t.Errorf("%v: exit %d, stdout %q, stderr %q", args, code, out, errs)
			}
			if c.help == "" || !strings.Contains(out, c.help) {
				t.Errorf("%v: help text missing:\n%s", args, out)
			}
		}
	}
	if code, _, errs := runT("", "reply", "s", "c1", "--", "--help"); code != 2 || !strings.Contains(errs, "sbtel reply: ") {
		t.Errorf(`--help after "--" is an argument: exit %d %q`, code, errs)
	}
	if code, _, _ := runT("", "help", "frobnicate"); code != 2 {
		t.Errorf("help on an unknown command: exit %d", code)
	}
}
