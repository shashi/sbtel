package state

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureIgnored(t *testing.T) {
	root := t.TempDir()
	spec := filepath.Join(root, "docs", "arch", "a.sbtel")
	os.MkdirAll(filepath.Dir(spec), 0o755)
	// No repository: nothing is written.
	if gi, err := EnsureIgnored(spec); gi != "" || err != nil {
		t.Fatalf("no repo: %q %v", gi, err)
	}
	if _, err := os.Stat(filepath.Join(root, ".gitignore")); err == nil {
		t.Fatal("wrote a .gitignore without a repository")
	}
	os.Mkdir(filepath.Join(root, ".git"), 0o755)
	os.WriteFile(filepath.Join(root, ".gitignore"), []byte("node_modules"), 0o644) // no final newline
	gi, err := EnsureIgnored(spec)
	if err != nil || gi != filepath.Join(root, ".gitignore") {
		t.Fatalf("first: %q %v", gi, err)
	}
	b, _ := os.ReadFile(gi)
	if string(b) != "node_modules\n.sbtel/\n" {
		t.Fatalf("got %q", b)
	}
	if gi, _ := EnsureIgnored(spec); gi != "" {
		t.Fatal("added it twice")
	}
	// A .git file (worktree, submodule) counts, and the nearest one wins.
	sub := filepath.Join(root, "docs")
	os.WriteFile(filepath.Join(sub, ".git"), []byte("gitdir: x"), 0o644)
	if gi, _ := EnsureIgnored(spec); gi != filepath.Join(sub, ".gitignore") {
		t.Fatalf("nearest repo: %q", gi)
	}
}

func TestAppendProjectComment(t *testing.T) {
	spec := filepath.Join(t.TempDir(), "a.sbtel")
	for _, text := range []string{"one", "two"} {
		if err := AppendProjectComment(spec, "s1", Event{Seq: 1, Kind: "comment", Text: text}); err != nil {
			t.Fatal(err)
		}
	}
	b, err := os.ReadFile(filepath.Join(filepath.Dir(spec), ".sbtel", "comments", "a.sbtel.jsonl"))
	if err != nil || strings.Count(string(b), "\n") != 2 || !strings.Contains(string(b), `"two"`) {
		t.Fatalf("%q %v", b, err)
	}
}
