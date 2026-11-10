package server

import (
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The ref route serves a file only when the spec names it, and only from inside the spec's directory.
func TestRefRoute(t *testing.T) {
	h := start(t, Options{})
	outer := t.TempDir()
	dir := filepath.Join(outer, "proj")
	os.MkdirAll(filepath.Join(dir, "src"), 0o755)
	os.MkdirAll(filepath.Join(dir, ".git"), 0o755)
	os.WriteFile(filepath.Join(outer, "secret.txt"), []byte("outside"), 0o644)
	os.WriteFile(filepath.Join(dir, "src", "store.ts"), []byte("line1\nline2\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "a b.md"), []byte("# Title\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "page.html"), []byte("<script>alert(1)</script>"), 0o644)
	os.WriteFile(filepath.Join(dir, "unlisted.txt"), []byte("not named in the spec"), 0o644)
	os.WriteFile(filepath.Join(dir, ".env"), []byte("KEY=1"), 0o644)
	os.WriteFile(filepath.Join(dir, ".git", "config"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(dir, "pic.png"), []byte("\x89PNG\r\n\x1a\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "blob.bin"), []byte{0, 1, 2}, 0o644)
	linked := runtime.GOOS != "windows" && os.Symlink(filepath.Join(outer, "secret.txt"), filepath.Join(dir, "link.txt")) == nil
	src := `(block A (ref src/store.ts:1-2) (ref "a b.md#title" (~ Notes. ~)) (ref page.html) (ref ../secret.txt)
  (ref .env) (ref .git/config) (ref link.txt) (ref pic.png) (ref blob.bin) (ref missing.txt) (ref https://example.com/x))` + "\n"
	file := filepath.Join(dir, "x.sbtel")
	os.WriteFile(file, []byte(src), 0o644)
	id := h.create(src, &file)
	get := func(p, extra string) (int, string, string) {
		r, body := h.req("GET", "/s/"+id+"/ref?path="+url.QueryEscape(p)+extra, "", nil)
		return r.StatusCode, r.Header.Get("Content-Type"), body
	}
	if c, ct, b := get("src/store.ts", ""); c != 200 || !strings.HasPrefix(ct, "application/json") || !strings.Contains(b, `"text":"line1\nline2\n"`) {
		t.Errorf("a named file: %d %s %s", c, ct, b)
	}
	if c, _, b := get("a b.md", ""); c != 200 || !strings.Contains(b, "# Title") {
		t.Errorf("a quoted path with an anchor: %d %s", c, b)
	}
	// HTML comes back as JSON text, never as a page.
	if c, ct, b := get("page.html", ""); c != 200 || !strings.HasPrefix(ct, "application/json") || !strings.Contains(b, "script") {
		t.Errorf("html: %d %s %s", c, ct, b)
	}
	if c, ct, _ := get("page.html", "&raw=1"); c != 200 || !strings.HasPrefix(ct, "application/json") {
		t.Errorf("html raw: %d %s", c, ct)
	}
	if c, ct, b := get("pic.png", ""); c != 200 || !strings.Contains(b, `"image":true`) || !strings.HasPrefix(ct, "application/json") {
		t.Errorf("image info: %d %s %s", c, ct, b)
	}
	if c, ct, _ := get("pic.png", "&raw=1"); c != 200 || ct != "image/png" {
		t.Errorf("image raw: %d %s", c, ct)
	}
	if c, _, b := get("blob.bin", ""); c != 200 || !strings.Contains(b, `"binary":true`) || strings.Contains(b, "text") {
		t.Errorf("binary: %d %s", c, b)
	}
	for _, p := range []string{"unlisted.txt", "../secret.txt", ".env", ".git/config", "missing.txt", "https://example.com/x", "", "src", "/etc/passwd", "src/../unlisted.txt"} {
		if c, _, b := get(p, ""); c != 404 {
			t.Errorf("%q: want 404, got %d %s", p, c, b)
		}
	}
	if linked {
		if c, _, b := get("link.txt", ""); c != 404 {
			t.Errorf("a link out of the directory: want 404, got %d %s", c, b)
		}
	}
	// A spec from stdin has no directory: nothing is served.
	id2 := h.create(`(block A (ref src/store.ts))`+"\n", nil)
	if r, _ := h.req("GET", "/s/"+id2+"/ref?path=src/store.ts", "", nil); r.StatusCode != 404 {
		t.Errorf("stdin spec: %d", r.StatusCode)
	}
}
