package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The 0.2 port form, the 0.3 one and the 0.3 (message): all three are rewritten in the 0.4 forms.
const oldPorts = "(message KeyChord)\n(shape Intent)\n(block A\n  (port chord in KeyChord (~ Opens it. ~)) ; keep this comment\n  (port :out Intent)\n  (takes Intent :as again))\n"
const newPorts = "(shape KeyChord)\n(shape Intent)\n(block A\n  (takes KeyChord :as chord (~ Opens it. ~)) ; keep this comment\n  (gives Intent)\n  (takes Intent :as again))\n"

func TestFmtMigratePorts(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.sbtel")
	if err := os.WriteFile(p, []byte(oldPorts), 0o600); err != nil {
		t.Fatal(err)
	}
	// --check writes nothing and exits 1.
	c, out, _ := runT("", "fmt", "--migrate", "--check", p)
	if b, _ := os.ReadFile(p); c != 1 || string(b) != oldPorts || !strings.HasSuffix(out, p+": 3 forms in an older form\n") {
		t.Errorf("--check: exit %d, %q", c, out)
	}
	c, out, _ = runT("", "fmt", "--migrate", p)
	b, _ := os.ReadFile(p)
	if c != 0 || string(b) != newPorts {
		t.Errorf("rewrite: exit %d, got\n%s", c, b)
	}
	if !strings.Contains(out, ":4:3: (port chord in KeyChord …) -> (takes KeyChord :as chord …)\n") || !strings.Contains(out, ":1:1: (message KeyChord) -> (shape KeyChord)\n") || !strings.HasSuffix(out, ": rewrote 3 forms\n") {
		t.Errorf("rewrite report: %q", out)
	}
	// Windows has no Unix permission bits (files report 0666), so only check the mode elsewhere.
	if info, _ := os.Stat(p); runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Errorf("mode changed to %v", info.Mode().Perm())
	}
	// Idempotent: nothing left to rewrite, and the result lints clean.
	if c, out, _ = runT("", "fmt", "--migrate-ports", "--check", p); c != 0 || !strings.HasSuffix(out, ": 0 forms in an older form\n") {
		t.Errorf("second --check: exit %d, %q", c, out)
	}
	if c, out, _ = runT("", "lint", p); c != 0 {
		t.Errorf("lint after migrating: exit %d, %q", c, out)
	}
	// stdin: the spec on stdout, the report on stderr.
	c, out, errs := runT(oldPorts, "fmt", "--migrate-ports", "-") // the 0.3 flag name still works
	if c != 0 || out != newPorts || !strings.HasSuffix(errs, "<stdin>: rewrote 3 forms\n") {
		t.Errorf("stdin: exit %d, out %q, err %q", c, out, errs)
	}
	// A file that does not read is an error; fmt without a rewrite is a usage error.
	if c, _, errs = runT("(block A", "fmt", "--migrate-ports", "-"); c != 2 || !strings.Contains(errs, "error: Missing \")\"") {
		t.Errorf("unreadable: exit %d, %q", c, errs)
	}
	if c, _, errs = runT("", "fmt", p); c != 2 || !strings.Contains(errs, "--migrate") {
		t.Errorf("no rewrite: exit %d, %q", c, errs)
	}
}
