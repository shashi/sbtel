package server

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/shashi/sbtel/internal/state"
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
	// A file named in a comment becomes readable too, as (ref …) or as a Markdown link; still nothing outside.
	if c, _, _ := get("unlisted.txt", ""); c != 404 {
		t.Fatalf("before the comment: %d", c)
	}
	body := `{"target":"block:A","targetLabel":"block A","text":"See (ref unlisted.txt:1) and [the page](page.html), not [this](../secret.txt) or (ref .env).","version":1,"source":""}`
	if r, b := h.req("POST", "/s/"+id+"/comment", body, nil); r.StatusCode != 200 {
		t.Fatalf("comment: %d %s", r.StatusCode, b)
	}
	if c, _, b := get("unlisted.txt", ""); c != 200 || !strings.Contains(b, "not named in the spec") {
		t.Errorf("a file named in a comment: %d %s", c, b)
	}
	for _, p := range []string{"../secret.txt", ".env"} {
		if c, _, _ := get(p, ""); c != 404 {
			t.Errorf("%q named in a comment: want 404, got %d", p, c)
		}
	}
	// A spec from stdin has no directory: nothing is served.
	id2 := h.create(`(block A (ref src/store.ts))`+"\n", nil)
	if r, _ := h.req("GET", "/s/"+id2+"/ref?path=src/store.ts", "", nil); r.StatusCode != 404 {
		t.Errorf("stdin spec: %d", r.StatusCode)
	}
}

// A dropped file lands in .sbtel/files beside the spec under a cleaned name, is served back without being
// named, and never replaces a different file. What is said in the session is also logged in .sbtel/comments.
func TestFileRoute(t *testing.T) {
	h := start(t, Options{})
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, ".git"), 0o755)
	file := filepath.Join(dir, "x.sbtel")
	src := "(block A)\n"
	os.WriteFile(file, []byte(src), 0o644)
	id := h.create(src, &file)
	put := func(name, data string) (int, string) {
		r, b := h.req("POST", "/s/"+id+"/file", `{"name":`+strconv.Quote(name)+`,"data":"`+base64.StdEncoding.EncodeToString([]byte(data))+`"}`, nil)
		return r.StatusCode, b
	}
	for _, c := range []struct{ name, data, want string }{
		{"Screen Shot (1).png", "one", ".sbtel/files/Screen-Shot-1-.png"},
		{"Screen Shot (1).png", "one", ".sbtel/files/Screen-Shot-1-.png"},   // the same file again
		{"Screen Shot (1).png", "two", ".sbtel/files/Screen-Shot-1--2.png"}, // other contents: a new name
		{"../../etc/passwd", "p", ".sbtel/files/passwd"},
		{`C:\Users\me\..\.env`, "e", ".sbtel/files/env"},
		{"..", "d", ".sbtel/files/file"},
		{"", "n", ".sbtel/files/file-2"},
	} {
		code, b := put(c.name, c.data)
		if code != 200 || !strings.Contains(b, `"path":"`+c.want+`"`) {
			t.Errorf("%q: %d %s, want %s", c.name, code, b, c.want)
		}
	}
	ents, _ := os.ReadDir(filepath.Join(dir, ".sbtel", "files"))
	if len(ents) != 6 {
		t.Errorf("%d files in .sbtel/files, want 6", len(ents))
	}
	if all, _ := filepath.Glob(filepath.Join(dir, "*")); len(all) != 4 { // .git, .gitignore, .sbtel and x.sbtel; nothing escaped
		t.Errorf("files beside the spec: %v", all)
	}
	if gi, _ := os.ReadFile(filepath.Join(dir, ".gitignore")); string(gi) != ".sbtel/\n" {
		t.Errorf(".gitignore: %q", gi)
	}
	if r, b := h.req("GET", "/s/"+id+"/ref?path="+url.QueryEscape(".sbtel/files/passwd"), "", nil); r.StatusCode != 200 || !strings.Contains(b, `"text":"p"`) {
		t.Errorf("served back: %d %s", r.StatusCode, b)
	}
	os.MkdirAll(filepath.Join(dir, ".sbtel", "files", "sub"), 0o755)
	os.WriteFile(filepath.Join(dir, ".sbtel", "files", "sub", "deep.txt"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(dir, ".sbtel", "files", ".hidden"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(dir, ".sbtel", "other.txt"), []byte("x"), 0o644)
	for _, p := range []string{".sbtel/files/sub/deep.txt", ".sbtel/files/.hidden", ".sbtel/other.txt", ".sbtel/comments/x.sbtel.jsonl", ".sbtel/files/../other.txt", ".sbtel/files/nope"} {
		if r, _ := h.req("GET", "/s/"+id+"/ref?path="+url.QueryEscape(p), "", nil); r.StatusCode != 404 {
			t.Errorf("%s: %d, want 404", p, r.StatusCode)
		}
	}
	if code, _ := put("a.txt", strings.Repeat("x", fileMaxBytes+1)); code != 413 {
		t.Errorf("too large: %d", code)
	}
	if r, _ := h.req("POST", "/s/"+id+"/file", `{"name":"a","data":"!!"}`, nil); r.StatusCode != 400 {
		t.Errorf("bad base64: %d", r.StatusCode)
	}
	if r, _ := h.req("POST", "/s/"+id+"/file", `{"name":"a","data":""}`, map[string]string{"Origin": "https://evil.example"}); r.StatusCode == 200 {
		t.Error("another origin could write a file")
	}
	// A spec from stdin has no folder.
	sid := h.create(src, nil)
	if r, _ := h.req("POST", "/s/"+sid+"/file", `{"name":"a","data":""}`, nil); r.StatusCode != 409 {
		t.Errorf("stdin spec: %d", r.StatusCode)
	}
	// The comment log.
	if r, b := h.req("POST", "/s/"+id+"/comment", `{"target":"block:A","targetLabel":"block A","text":"hello there","version":1,"source":""}`, nil); r.StatusCode != 200 {
		t.Fatalf("comment: %d %s", r.StatusCode, b)
	}
	if log, _ := os.ReadFile(filepath.Join(dir, ".sbtel", "comments", "x.sbtel.jsonl")); !strings.Contains(string(log), "hello there") {
		t.Errorf("comment log: %q", log)
	}
}

// A ref to another spec opens as a session on that file: a new one first, the same one after.
func TestOpenRef(t *testing.T) {
	h := start(t, Options{})
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "projects"), 0o755)
	os.WriteFile(filepath.Join(dir, "projects", "site.sbtel"), []byte("(block Site)\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "projects", "other.sbtel"), []byte("(block Other)\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "notes.md"), []byte("x"), 0o644)
	file := filepath.Join(dir, "all.sbtel")
	src := "(block All (block Site (ref projects/site.sbtel)) (ref notes.md) (ref projects/gone.sbtel) (ref ../up.sbtel))\n"
	os.WriteFile(file, []byte(src), 0o644)
	id := h.create(src, &file)
	open := func(p string) (int, string) {
		c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		r, err := c.Get(h.base() + "/s/" + id + "/open?path=" + url.QueryEscape(p))
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		return r.StatusCode, r.Header.Get("Location")
	}
	code, loc := open("projects/site.sbtel")
	if code != 303 || !strings.Contains(loc, "/s/") || strings.Contains(loc, id) {
		t.Fatalf("open: %d %q", code, loc)
	}
	if r, b := h.req("GET", strings.TrimPrefix(loc, h.base())+"spec", "", nil); r.StatusCode != 200 || !strings.Contains(b, "block Site") {
		t.Errorf("the opened session: %d %s", r.StatusCode, b)
	}
	if _, again := open("projects/site.sbtel"); again != loc {
		t.Errorf("a second open made another session: %q, then %q", loc, again)
	}
	for _, p := range []string{"projects/other.sbtel", "notes.md", "projects/gone.sbtel", "../up.sbtel", "all.sbtel", ""} {
		if code, _ := open(p); code != 404 {
			t.Errorf("%q: %d, want 404", p, code)
		}
	}
}

// A comment sent from another session's page stays in the session of the spec it is about, tagged with
// the sender; the sender gets a copy for its inbox and page, and a copy of the agent's reply.
func TestSentFrom(t *testing.T) {
	h := start(t, Options{})
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "projects"), 0o755)
	mapFile, siteFile := filepath.Join(dir, "all.sbtel"), filepath.Join(dir, "projects", "site.sbtel")
	os.WriteFile(mapFile, []byte("(block All (ref projects/site.sbtel))\n"), 0o644)
	os.WriteFile(siteFile, []byte("(block Site)\n"), 0o644)
	parent := h.create("(block All (ref projects/site.sbtel))\n", &mapFile)
	child := h.create("(block Site)\n", &siteFile)
	say := func(text, from string) {
		t.Helper()
		if r, b := h.req("POST", "/s/"+child+"/comment", `{"target":"block:Site","targetLabel":"block Site","text":"`+text+`","version":1,"source":"","from":"`+from+`"}`, nil); r.StatusCode != 200 {
			t.Fatalf("comment: %d %s", r.StatusCode, b)
		}
	}
	say("from the map", parent)
	say("from its own page", "")
	say("from nowhere real", "0123456789abcdef0123456789abcdef")
	say("from itself", child)
	heard := func(id string) (out []string) {
		evs, err := state.ReadEvents(h.s.paths, id)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range evs {
			if !e.IsUser() {
				continue
			}
			if e.Kind == "ref" {
				out = append(out, e.File+"@"+e.Session[:4]+":"+e.Ref.ID+":"+e.Ref.Text)
			} else {
				out = append(out, e.Text)
			}
		}
		return out
	}
	if got := strings.Join(heard(child), "|"); got != "from its own page|from nowhere real|from itself" {
		t.Errorf("the spec's own inbox: %s", got)
	}
	if got, want := strings.Join(heard(parent), "|"), "projects/site.sbtel@"+child[:4]+":c2:from the map"; got != want {
		t.Errorf("the map's inbox: %s, want %s", got, want)
	}
	// The reply goes to the child session; the map's page hears of it.
	if err := h.c.Do("POST", "/control/sessions/"+child+"/reply", map[string]string{"to": "c2", "text": "done"}, nil); err != nil {
		t.Fatal(err)
	}
	if err := h.c.Do("POST", "/control/sessions/"+child+"/reply", map[string]string{"to": "c3", "text": "own"}, nil); err != nil {
		t.Fatal(err)
	}
	evs, _ := state.ReadEvents(h.s.paths, parent)
	last := evs[len(evs)-1]
	if last.Kind != "ref" || last.By != "agent" || last.Ref == nil || last.Ref.Kind != "reply" || last.Ref.Text != "done" || last.IsUser() {
		t.Errorf("the map's copy of the reply: %+v", last)
	}
	if n := len(heard(parent)); n != 1 {
		t.Errorf("the map hears %d things, want 1", n)
	}
}

// A new session on a spec file starts with what was said about it in earlier sessions, renumbered and
// marked old; no inbox delivers it again, and a reply to it works.
func TestCommentsRestored(t *testing.T) {
	h := start(t, Options{})
	dir := t.TempDir()
	file := filepath.Join(dir, "x.sbtel")
	src := "(block A)\n"
	os.WriteFile(file, []byte(src), 0o644)
	first := h.create(src, &file)
	post := func(id, route, body string) {
		t.Helper()
		if r, b := h.req("POST", "/s/"+id+"/"+route, body, nil); r.StatusCode != 200 {
			t.Fatalf("%s: %d %s", route, r.StatusCode, b)
		}
	}
	post(first, "comment", `{"target":"block:A","targetLabel":"block A","text":"first thing","version":1,"source":""}`)
	post(first, "review", `{"message":"overall","version":1,"comments":[{"target":"block:A","targetLabel":"block A","text":"in a review","source":""}]}`)
	for to, text := range map[string]string{"c2": "answer one", "c3.1": "answer two"} {
		if err := h.c.Do("POST", "/control/sessions/"+first+"/reply", map[string]string{"to": to, "text": text}, nil); err != nil {
			t.Fatal(err)
		}
	}
	second := h.create(src, &file)
	evs, _ := state.ReadEvents(h.s.paths, second)
	var got []string
	for _, e := range evs[1:] {
		if !e.Old || e.IsUser() {
			t.Errorf("restored event is not old, or an inbox would deliver it: %+v", e)
		}
		switch e.Kind {
		case "comment":
			got = append(got, e.ID+" "+e.Text)
		case "review":
			got = append(got, e.ID+" "+e.Message+" ["+e.Comments[0].ID+" "+e.Comments[0].Text+"]")
		case "reply":
			got = append(got, "->"+e.To+" "+e.Text)
		}
	}
	sort.Strings(got[2:]) // the two replies were sent in map order
	want := "c2 first thing|r3 overall [c3.1 in a review]|->c2 answer one|->c3.1 answer two"
	if strings.Join(got, "|") != want {
		t.Errorf("restored: %s\nwant:     %s", strings.Join(got, "|"), want)
	}
	// New things continue the numbering, and are logged once: a third session has five old events.
	post(second, "comment", `{"target":"block:A","targetLabel":"block A","text":"new","version":1,"source":""}`)
	if err := h.c.Do("POST", "/control/sessions/"+second+"/reply", map[string]string{"to": "c2", "text": "late answer"}, nil); err != nil {
		t.Fatal(err)
	}
	third := h.create(src, &file)
	evs, _ = state.ReadEvents(h.s.paths, third)
	if len(evs) != 1+6 {
		t.Errorf("third session has %d events, want 7", len(evs))
	}
}

// What an inbox has handed over is seen: a session's own comments up to its cursor, and a comment sent
// from another session's page once that session's cursor has passed its copy.
func TestSeen(t *testing.T) {
	h := start(t, Options{})
	dir := t.TempDir()
	mapFile, siteFile := filepath.Join(dir, "all.sbtel"), filepath.Join(dir, "site.sbtel")
	os.WriteFile(mapFile, []byte("(block All (ref site.sbtel))\n"), 0o644)
	os.WriteFile(siteFile, []byte("(block Site)\n"), 0o644)
	parent := h.create("(block All (ref site.sbtel))\n", &mapFile)
	child := h.create("(block Site)\n", &siteFile)
	say := func(text, from string) {
		t.Helper()
		if r, b := h.req("POST", "/s/"+child+"/comment", `{"target":"block:Site","targetLabel":"block Site","text":"`+text+`","version":1,"source":"","from":"`+from+`"}`, nil); r.StatusCode != 200 {
			t.Fatalf("comment: %d %s", r.StatusCode, b)
		}
	}
	say("own", "")         // c2 in the child
	say("via map", parent) // c3 in the child, copied to the parent as its event 2
	seen := func() string {
		_, b := h.req("GET", "/s/"+child+"/log", "", nil)
		var out struct{ Seen []string }
		json.Unmarshal([]byte(b), &out)
		sort.Strings(out.Seen)
		return strings.Join(out.Seen, ",")
	}
	if got := seen(); got != "" {
		t.Errorf("before any inbox: %q", got)
	}
	state.WriteCursor(h.s.paths, child, 3) // the child's inbox has read everything of its own
	if got := seen(); got != "c2" {
		t.Errorf("after the child's inbox: %q, want c2", got)
	}
	state.WriteCursor(h.s.paths, parent, 2) // the map's inbox has read the copy
	if err := h.c.Do("POST", "/control/sessions/"+parent+"/seen", map[string]any{}, nil); err != nil {
		t.Fatal(err)
	}
	if got := seen(); got != "c2,c3" {
		t.Errorf("after the map's inbox: %q, want c2,c3", got)
	}
}
