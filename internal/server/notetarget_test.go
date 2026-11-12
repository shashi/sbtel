package server

import "testing"

// A note names a block by its name; a phrase for a name is matched to the string in the spec.
func TestNoteTargetPhrase(t *testing.T) {
	src := []byte("(block \"Why CI failed\"\n  (level (block \"Test that  times out on CI\" (~ Slow. ~)) (block merge-queue)))\n")
	for _, c := range []struct {
		in, key string
		ok      bool
	}{
		{"Test that times out on CI", "block:Test that times out on CI", true},
		{"block:Why CI failed", "block:Why CI failed", true},
		{"merge-queue", "block:merge-queue", true},
		{"Test that times out", "", false},
		{"Why CI failed (again)", "", false},
		{"shape:Two words", "", false},
	} {
		key, _, ok := noteTarget(c.in, src)
		if ok != c.ok || key != c.key {
			t.Errorf("noteTarget(%q) = %q, %v; want %q, %v", c.in, key, ok, c.key, c.ok)
		}
	}
}
