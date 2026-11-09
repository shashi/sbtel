package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const oldPorts = "(message KeyChord)\n(message Intent)\n(block A\n  (port chord in KeyChord (~ Opens it. ~)) ; keep this comment\n  (port intent out Intent))\n"
const newPorts = "(message KeyChord)\n(message Intent)\n(block A\n  (port :in KeyChord :as chord (~ Opens it. ~)) ; keep this comment\n  (port :out Intent))\n"

func TestFmtMigratePorts(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.sbtel")
	if err := os.WriteFile(p, []byte(oldPorts), 0o600); err != nil {
		t.Fatal(err)
	}
	// --check writes nothing and exits 1.
	c, out, _ := runT("", "fmt", "--migrate-ports", "--check", p)
	if b, _ := os.ReadFile(p); c != 1 || string(b) != oldPorts || !strings.HasSuffix(out, p+": 2 ports in the 0.2 form\n") {
		t.Errorf("--check: exit %d, %q", c, out)
	}
	c, out, _ = runT("", "fmt", "--migrate-ports", p)
	b, _ := os.ReadFile(p)
	if c != 0 || string(b) != newPorts {
		t.Errorf("rewrite: exit %d, got\n%s", c, b)
	}
	if !strings.Contains(out, ":4:3: (port chord in KeyChord …) -> (port :in KeyChord :as chord …)\n") || !strings.HasSuffix(out, ": rewrote 2 ports\n") {
		t.Errorf("rewrite report: %q", out)
	}
	if info, _ := os.Stat(p); info.Mode().Perm() != 0o600 {
		t.Errorf("mode changed to %v", info.Mode().Perm())
	}
	// Idempotent: nothing left to rewrite, and the result lints clean.
	if c, out, _ = runT("", "fmt", "--migrate-ports", "--check", p); c != 0 || !strings.HasSuffix(out, ": 0 ports in the 0.2 form\n") {
		t.Errorf("second --check: exit %d, %q", c, out)
	}
	if c, out, _ = runT("", "lint", p); c != 0 {
		t.Errorf("lint after migrating: exit %d, %q", c, out)
	}
	// stdin: the spec on stdout, the report on stderr.
	c, out, errs := runT(oldPorts, "fmt", "--migrate-ports", "-")
	if c != 0 || out != newPorts || !strings.HasSuffix(errs, "<stdin>: rewrote 2 ports\n") {
		t.Errorf("stdin: exit %d, out %q, err %q", c, out, errs)
	}
	// A file that does not read is an error; fmt without a rewrite is a usage error.
	if c, _, errs = runT("(block A", "fmt", "--migrate-ports", "-"); c != 2 || !strings.Contains(errs, "error: Missing \")\"") {
		t.Errorf("unreadable: exit %d, %q", c, errs)
	}
	if c, _, errs = runT("", "fmt", p); c != 2 || !strings.Contains(errs, "--migrate-ports") {
		t.Errorf("no rewrite: exit %d, %q", c, errs)
	}
}
