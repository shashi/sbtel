package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/shashi/sbtel/internal/state"
)

// Determinism rules for these tests (they run under -race on loaded machines):
//   - nothing sleeps for a fixed time to let something happen; tests wait for the condition itself
//     (waitFor), for a channel, or for an SSE event;
//   - every wait is bounded by `long`, which is generous because it only costs time when a test fails;
//   - no health probe on a short timeout decides a test's path: the harness reads server.json and
//     builds its client directly, and servers that must see each other get a long Options.Health;
//   - t.Fatal is called only from the test goroutine.
const long = 60 * time.Second

// unixModes: file permission bits mean something here (not on Windows).
var unixModes = runtime.GOOS != "windows"

// hc is the test's HTTP client: bounded, so a stuck server fails the test instead of hanging it.
var hc = &http.Client{Timeout: long}

type harness struct {
	t    *testing.T
	s    *Server
	home string
	c    *Client
	done chan struct{} // closed when Run returns
	err  error
}

func start(t *testing.T, o Options) *harness {
	t.Helper()
	if o.Home == "" {
		o.Home = t.TempDir()
	}
	if o.Version == "" {
		o.Version = "test"
	}
	if !o.PortSet && o.PreferPort == 0 {
		o.PortSet = true
	}
	if o.Tick == 0 {
		o.Tick = 50 * time.Millisecond
	}
	if o.Health == 0 {
		o.Health = long
	}
	o.ViewerHTML = "<!doctype html><title>viewer</title>"
	h := &harness{t: t, s: New(o), home: o.Home, done: make(chan struct{})}
	go func() { h.err = h.s.Run(context.Background()); close(h.done) }()
	select {
	case <-h.s.Ready():
	case <-h.done:
		t.Fatalf("server did not start: %v", h.err)
	case <-time.After(long):
		t.Fatal("server did not start")
	}
	// Ready means server.json is written. Build the client from it rather than through Connect, whose
	// 1 s health probe can time out on a loaded machine.
	info, err := state.ReadServer(state.Paths{Home: o.Home})
	if err != nil || info == nil || info.Port != h.s.Port() {
		t.Fatalf("server.json after Ready: %+v %v", info, err)
	}
	h.c = &Client{Info: info, hc: hc}
	t.Cleanup(func() { h.s.Stop(); <-h.done })
	return h
}

func (h *harness) base() string { return "http://127.0.0.1:" + strconv.Itoa(h.s.Port()) }

// req sends a browser-style request. hdr "Origin" defaults to the server's own origin for POSTs and
// "Content-Type" to application/json; pass "" to omit.
func (h *harness) req(method, path, body string, hdr map[string]string) (*http.Response, string) {
	h.t.Helper()
	r, _ := http.NewRequest(method, h.base()+path, strings.NewReader(body))
	if method == "POST" {
		r.Header.Set("Origin", h.base())
		r.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		if k == "Host" {
			r.Host = v
		} else if v == "" {
			r.Header.Del(k)
		} else {
			r.Header.Set(k, v)
		}
	}
	resp, err := hc.Do(r)
	if err != nil {
		h.t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(b)
}

func (h *harness) create(src string, path *string) string {
	h.t.Helper()
	var r struct{ ID string }
	err := h.c.Do("POST", "/control/sessions", map[string]any{"kind": "spec", "label": "t", "spec": map[string]any{"path": path, "name": "t.sbtel", "src": src}}, &r)
	if err != nil {
		h.t.Fatal(err)
	}
	return r.ID
}

func (h *harness) spec(id string) (v int, hash, src string) {
	h.t.Helper()
	resp, body := h.req("GET", "/s/"+id+"/spec", "", nil)
	if resp.StatusCode != 200 {
		h.t.Fatalf("spec: %d", resp.StatusCode)
	}
	var j struct {
		Version   int
		Hash, Src string
	}
	json.Unmarshal([]byte(body), &j)
	return j.Version, j.Hash, j.Src
}

func TestSecurityHeadersAndRouting(t *testing.T) {
	h := start(t, Options{})
	id := h.create("(block A)", nil)
	for _, p := range []string{"/", "/s/", "/s/" + id, "/s/" + strings.ToUpper(id) + "/", "/s/" + id[:31] + "/", "/s/" + state.NewID() + "/", "/s/" + id + "/nope", "/s/../server.json", "/control"} {
		resp, body := h.req("GET", p, "", nil)
		if resp.StatusCode != 404 || body != "" {
			t.Errorf("GET %s: %d %q, want 404 empty", p, resp.StatusCode, body)
		}
	}
	for _, p := range []string{"/", "/s/" + id + "/", "/s/" + id + "/meta", "/s/" + id + "/spec", "/s/" + id + "/log"} {
		resp, _ := h.req("GET", p, "", nil)
		want := map[string]string{"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"}
		for k, v := range want {
			if got := resp.Header.Get(k); got != v {
				t.Errorf("%s: %s = %q, want %q", p, k, got, v)
			}
		}
		for k := range resp.Header {
			if strings.HasPrefix(strings.ToLower(k), "access-control-") {
				t.Errorf("%s: CORS header %s", p, k)
			}
		}
	}
	resp, body := h.req("GET", "/s/"+id+"/", "", nil)
	if resp.StatusCode != 200 || !strings.Contains(body, "viewer") || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
		t.Errorf("page: %d %q", resp.StatusCode, body)
	}
	resp, _ = h.req("GET", "/s/"+id+"/diff", "", nil)
	if resp.StatusCode != 200 || resp.Request.URL.Path != "/s/"+id+"/" {
		t.Errorf("diff path on a spec session should redirect to /s/<id>/: %d %s", resp.StatusCode, resp.Request.URL.Path)
	}
	// OPTIONS (CORS preflight) is 405 with no Access-Control headers.
	resp, _ = h.req("OPTIONS", "/s/"+id+"/comment", "", map[string]string{"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
	if resp.StatusCode != 405 || resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("OPTIONS: %d", resp.StatusCode)
	}
}

func TestHostAndOriginRejection(t *testing.T) {
	h := start(t, Options{})
	id := h.create("(block A)", nil)
	port := strconv.Itoa(h.s.Port())
	for _, host := range []string{"evil.example:" + port, "127.0.0.1", "localhost", "127.0.0.1:1", "127.0.0.1.evil.example:" + port, "[::1]:" + port} {
		resp, body := h.req("GET", "/s/"+id+"/spec", "", map[string]string{"Host": host})
		if resp.StatusCode != 421 || body != "" {
			t.Errorf("Host %q: %d %q, want 421", host, resp.StatusCode, body)
		}
	}
	if resp, _ := h.req("GET", "/s/"+id+"/meta", "", map[string]string{"Host": "localhost:" + port}); resp.StatusCode != 200 {
		t.Errorf("Host localhost: %d", resp.StatusCode)
	}
	cm := `{"target":"block:A","text":"hi","version":1}`
	cases := []struct {
		name string
		hdr  map[string]string
		want int
	}{
		{"own origin", nil, 200},
		{"localhost origin", map[string]string{"Origin": "http://localhost:" + port}, 200},
		{"no origin", map[string]string{"Origin": ""}, 403},
		{"evil origin", map[string]string{"Origin": "http://evil.example"}, 403},
		{"null origin", map[string]string{"Origin": "null"}, 403},
		{"other port", map[string]string{"Origin": "http://127.0.0.1:1"}, 403},
		{"https", map[string]string{"Origin": "https://127.0.0.1:" + port}, 403},
		{"text/plain", map[string]string{"Content-Type": "text/plain"}, 403},
		{"form", map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, 403},
		{"no content type", map[string]string{"Content-Type": ""}, 403},
		{"json charset", map[string]string{"Content-Type": "application/json; charset=utf-8"}, 200},
		{"rebinding host", map[string]string{"Host": "evil.example:" + port, "Origin": "http://evil.example:" + port}, 421},
	}
	for _, c := range cases {
		if resp, body := h.req("POST", "/s/"+id+"/comment", cm, c.hdr); resp.StatusCode != c.want {
			t.Errorf("%s: %d %s, want %d", c.name, resp.StatusCode, body, c.want)
		}
	}
	// Control API: needs the token and no Origin.
	if resp, _ := h.req("GET", "/control/status", "", map[string]string{"Origin": ""}); resp.StatusCode != 403 {
		t.Errorf("control without token: %d", resp.StatusCode)
	}
	tok := "Bearer " + h.c.Info.Token
	if resp, _ := h.req("GET", "/control/status", "", map[string]string{"Authorization": tok}); resp.StatusCode != 200 {
		t.Errorf("control with token: %d", resp.StatusCode)
	}
	if resp, _ := h.req("GET", "/control/status", "", map[string]string{"Authorization": tok, "Origin": h.base()}); resp.StatusCode != 403 {
		t.Errorf("control with token and Origin: %d", resp.StatusCode)
	}
	if resp, _ := h.req("GET", "/control/status", "", map[string]string{"Authorization": "Bearer " + state.NewID()}); resp.StatusCode != 403 {
		t.Errorf("control with a wrong token: %d", resp.StatusCode)
	}
	// Body limit: 64 MiB for browser writes, the same as control bodies (§5.2).
	big := `{"target":"block:A","text":"` + strings.Repeat("x", 64<<20) + `"}`
	if resp, _ := h.req("POST", "/s/"+id+"/comment", big, nil); resp.StatusCode != 413 {
		t.Errorf("64 MiB + body: %d, want 413", resp.StatusCode)
	}
	// A save well over the old 4 MiB limit goes through.
	_, hash, _ := h.spec(id)
	src := "(block A (sketch \"" + strings.Repeat("y", 5<<20) + "\"))"
	sb, _ := json.Marshal(map[string]string{"base": hash, "src": src})
	if resp, body := h.req("POST", "/s/"+id+"/save", string(sb), nil); resp.StatusCode != 200 {
		t.Errorf("5 MiB save: %d %s", resp.StatusCode, body)
	}
	if _, _, got := h.spec(id); got != src {
		t.Errorf("5 MiB save: spec has %d bytes, want %d", len(got), len(src))
	}
}

func TestSaveConflictAndDisk(t *testing.T) {
	h := start(t, Options{})
	dir := t.TempDir()
	file := filepath.Join(dir, "x.sbtel")
	os.WriteFile(file, []byte("(block A)\n"), 0o640)
	id := h.create("(block A)\n", &file)
	v, hash, _ := h.spec(id)
	if v != 1 || hash != state.Hash([]byte("(block A)\n")) {
		t.Fatalf("v1: %d %s", v, hash)
	}
	save := func(base, src string) (int, string) {
		b, _ := json.Marshal(map[string]string{"base": base, "src": src})
		resp, body := h.req("POST", "/s/"+id+"/save", string(b), nil)
		return resp.StatusCode, body
	}
	if code, body := save(hash, "(block B)\n"); code != 200 || !strings.Contains(body, `"version":2`) {
		t.Fatalf("save: %d %s", code, body)
	}
	if b, _ := os.ReadFile(file); string(b) != "(block B)\n" {
		t.Errorf("file after save: %q", b)
	}
	// Unix file modes; Windows has only a read-only bit (the user-profile ACL protects the files, §4.2).
	if fi, _ := os.Stat(file); unixModes && fi.Mode().Perm() != 0o640 {
		t.Errorf("save changed the file mode to %v", fi.Mode().Perm())
	}
	// A stale base is 409 with the current version and hash, and writes nothing.
	code, body := save(hash, "(block C)\n")
	if code != 409 || !strings.Contains(body, `"version":2`) || !strings.Contains(body, state.Hash([]byte("(block B)\n"))) {
		t.Errorf("stale save: %d %s", code, body)
	}
	if b, _ := os.ReadFile(file); string(b) != "(block B)\n" {
		t.Errorf("file after refused save: %q", b)
	}
	// An agent edits the file: the next request sees it as a disk version, and a save on the old base is refused.
	os.WriteFile(file, []byte("(block D)\n"), 0o640)
	v, h3, src := h.spec(id)
	if v != 3 || src != "(block D)\n" {
		t.Errorf("after disk edit: v%d %q", v, src)
	}
	if code, _ := save(state.Hash([]byte("(block B)\n")), "(block E)\n"); code != 409 {
		t.Errorf("save over a disk edit: %d", code)
	}
	// A vanished file is not an error; a save recreates it.
	os.Remove(file)
	if v2, _, src := h.spec(id); v2 != 3 || src != "(block D)\n" {
		t.Errorf("vanished file: v%d %q", v2, src)
	}
	if code, _ := save(h3, "(block F)\n"); code != 200 {
		t.Errorf("save to a vanished file: %d", code)
	}
	if b, _ := os.ReadFile(file); string(b) != "(block F)\n" {
		t.Errorf("recreated file: %q", b)
	}
	evs, _ := state.ReadEvents(state.Paths{Home: h.home}, id)
	var kinds []string
	for i, e := range evs {
		if e.Seq != i+1 {
			t.Errorf("event %d has seq %d", i+1, e.Seq)
		}
		kinds = append(kinds, e.Kind+":"+e.By)
	}
	if got := strings.Join(kinds, " "); got != "version:agent save:user version:disk save:user" {
		t.Errorf("events: %s", got)
	}
	// Saving to an unwritable place is a 500 that records nothing.
	if unixModes && os.Getuid() != 0 { // root writes anyway; on Windows chmod does not stop writes
		os.Chmod(dir, 0o500)
		defer os.Chmod(dir, 0o700)
		_, cur, _ := h.spec(id)
		if code, _ := save(cur, "(block G)\n"); code != 500 {
			t.Errorf("unwritable: %d, want 500", code)
		}
	}
	// Diff sessions do not save.
	var r struct{ ID string }
	h.c.Do("POST", "/control/sessions", map[string]any{"kind": "diff", "label": "d", "diff": map[string]any{"a": map[string]any{"name": "a", "src": "(block A)"}, "b": map[string]any{"name": "b", "src": "(block B)"}}}, &r)
	if resp, _ := h.req("POST", "/s/"+r.ID+"/save", `{"base":"x","src":""}`, nil); resp.StatusCode != 405 {
		t.Errorf("diff save: %d", resp.StatusCode)
	}
	resp, body := h.req("GET", "/s/"+r.ID+"/diff.json", "", nil)
	if resp.StatusCode != 200 || !strings.Contains(body, `"src":"(block B)"`) {
		t.Errorf("diff.json: %d %s", resp.StatusCode, body)
	}
	if resp, _ := h.req("GET", "/s/"+r.ID+"/", "", nil); resp.Request.URL.Path != "/s/"+r.ID+"/diff" {
		t.Errorf("diff session page should redirect to /diff, got %s", resp.Request.URL.Path)
	}
}

// stream is one SSE connection read in the background. openSSE returns once the response headers
// have arrived, and the server registers the subscription before it writes them, so the tab is
// counted and receives broadcasts from that moment on.
type stream struct {
	events chan string // "<id>/<event>", closed when the stream ends
	cancel context.CancelFunc
}

func openSSE(t *testing.T, url string, hdr map[string]string) *stream {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), long)
	r, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(r) // bounded by ctx; hc's Timeout would also cut the body
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		cancel()
		t.Fatalf("events: HTTP %d", resp.StatusCode)
	}
	st := &stream{events: make(chan string, 64), cancel: cancel}
	go func() {
		defer close(st.events)
		defer resp.Body.Close()
		sc := bufio.NewScanner(resp.Body)
		id := ""
		for sc.Scan() {
			l := sc.Text()
			switch {
			case strings.HasPrefix(l, "id: "):
				id = l[4:]
			case strings.HasPrefix(l, "event: "):
				st.events <- id + "/" + l[7:]
				id = ""
			}
		}
	}()
	t.Cleanup(cancel)
	return st
}

// take returns the next n events, failing if the stream ends or `long` passes first.
func (st *stream) take(t *testing.T, n int) []string {
	t.Helper()
	var out []string
	deadline := time.After(long)
	for len(out) < n {
		select {
		case e, ok := <-st.events:
			if !ok {
				t.Fatalf("stream ended after %v, want %d events", out, n)
			}
			out = append(out, e)
		case <-deadline:
			t.Fatalf("timed out after %v, want %d events", out, n)
		}
	}
	return out
}

// ended waits for the stream to end, failing on any further event.
func (st *stream) ended(t *testing.T) {
	t.Helper()
	select {
	case e, ok := <-st.events:
		if ok {
			t.Fatalf("unexpected event %s", e)
		}
	case <-time.After(long):
		t.Fatal("stream did not end")
	}
}

func TestSSEReplayReplyAndClose(t *testing.T) {
	h := start(t, Options{})
	id := h.create("(block A)", nil)
	resp, body := h.req("POST", "/s/"+id+"/comment", `{"target":"block:A","targetLabel":"block A","text":"multi\nline ✓","version":1,"source":"(block A)"}`, nil)
	if resp.StatusCode != 200 || !strings.Contains(body, `"id":"c2"`) {
		t.Fatalf("comment: %d %s", resp.StatusCode, body)
	}
	var out map[string]any
	if err := h.c.Do("POST", "/control/sessions/"+id+"/reply", map[string]string{"to": "c2", "text": "ok"}, &out); err != nil {
		t.Fatal(err)
	}
	if err := h.c.Do("POST", "/control/sessions/"+id+"/reply", map[string]string{"to": "c9", "text": "ok"}, nil); err == nil || err.(*HTTPError).Code != 404 {
		t.Errorf("reply to a missing comment: %v", err)
	}
	// Replay after seq 1: the reply (seq 3). Without Last-Event-ID: hello only.
	for _, c := range []struct {
		q   string
		hdr map[string]string
	}{{"", map[string]string{"Last-Event-ID": "1"}}, {"?after=2", nil}} {
		st := openSSE(t, h.base()+"/s/"+id+"/events"+c.q, c.hdr)
		if got := st.take(t, 2); strings.Join(got, " ") != "/hello 3/reply" {
			t.Errorf("replay %v%s: %v", c.hdr, c.q, got)
		}
		st.cancel()
	}
	// The replay readers are gone, but the server notices a closed connection asynchronously. Wait
	// until it has, so the tab count below is exactly the live tab's (this was a flake: a lingering
	// replay subscription satisfied "tabs == 1" before the live tab had connected, and the version
	// went to the dying connection instead).
	waitFor(t, func() bool { return h.tabs(id) == 0 })
	// Live: a version push and a close reach a connected tab.
	live := openSSE(t, h.base()+"/s/"+id+"/events", nil)
	if got := live.take(t, 1); got[0] != "/hello" {
		t.Fatalf("live: first event %v", got)
	}
	if n := h.tabs(id); n != 1 {
		t.Fatalf("tabs with the live tab connected: %d", n)
	}
	if err := h.c.Do("POST", "/control/sessions/"+id+"/version", map[string]any{"spec": map[string]any{"name": "t.sbtel", "src": "(block A2)"}}, &out); err != nil {
		t.Fatal(err)
	}
	if out["tabs"].(float64) != 1 || out["version"].(float64) != 2 {
		t.Errorf("version: %v", out)
	}
	if err := h.c.Do("POST", "/control/sessions/"+id+"/close", map[string]any{}, nil); err != nil {
		t.Fatal(err)
	}
	if got := live.take(t, 2); strings.Join(got, " ") != "4/version /closed" {
		t.Errorf("live: %v", got)
	}
	live.ended(t) // the server ends the stream after `closed`
	if _, err := os.Stat(state.Paths{Home: h.home}.Session(id)); !os.IsNotExist(err) {
		t.Errorf("session dir still there: %v", err)
	}
	if resp, _ := h.req("GET", "/s/"+id+"/meta", "", nil); resp.StatusCode != 404 {
		t.Errorf("closed session meta: %d", resp.StatusCode)
	}
	if err := h.c.Do("POST", "/control/sessions/"+id+"/close", map[string]any{}, nil); err == nil {
		t.Error("closing twice should be 404")
	}
}

func (h *harness) tabs(id string) int {
	var r struct {
		Sessions []struct {
			ID   string
			Tabs int
		}
	}
	if err := h.c.Do("GET", "/control/sessions", nil, &r); err != nil {
		h.t.Fatal(err)
	}
	for _, s := range r.Sessions {
		if s.ID == id {
			return s.Tabs
		}
	}
	return 0
}

func waitFor(t *testing.T, f func() bool) {
	t.Helper()
	for end := time.Now().Add(long); time.Now().Before(end); time.Sleep(10 * time.Millisecond) {
		if f() {
			return
		}
	}
	t.Fatal("timed out")
}

func TestIdleExitAndServerJSON(t *testing.T) {
	home := t.TempDir()
	s := New(Options{Home: home, PortSet: true, Version: "test", Idle: 300 * time.Millisecond, Tick: 50 * time.Millisecond})
	done := make(chan error, 1)
	start := time.Now()
	go func() { done <- s.Run(context.Background()) }()
	select {
	case <-s.Ready():
	case err := <-done:
		t.Fatalf("server did not start: %v", err)
	case <-time.After(long):
		t.Fatal("server did not start")
	}
	p := state.Paths{Home: home}
	info, _ := state.ReadServer(p)
	if info == nil || info.Port != s.Port() || info.PID != os.Getpid() || len(info.Token) != 32 {
		t.Fatalf("server.json: %+v", info)
	}
	if fi, _ := os.Stat(p.ServerJSON()); unixModes && fi.Mode().Perm() != 0o600 {
		t.Errorf("server.json mode %v", fi.Mode().Perm())
	}
	select {
	case <-done:
	case <-time.After(long):
		s.Stop()
		t.Fatal("no idle exit")
	}
	if d := time.Since(start); d < 300*time.Millisecond {
		t.Errorf("exited after %v, before the idle time", d)
	}
	if _, err := os.Stat(p.ServerJSON()); !os.IsNotExist(err) {
		t.Error("server.json not removed on idle exit")
	}
}

func TestPortReuseStartRaceAndWatchdog(t *testing.T) {
	home := t.TempDir()
	a := start(t, Options{Home: home})
	port := a.s.Port()
	// A second server for the same home, while the first is healthy: exits at once (start race).
	// Its health probe gets a long timeout: with the default 1 s, a loaded machine could make it
	// think the first server is dead, take over, and serve for 30 minutes (the old 600 s hang).
	b := New(Options{Home: home, Version: "test", Tick: 50 * time.Millisecond, Health: long})
	bdone := make(chan error, 1)
	go func() { bdone <- b.Run(context.Background()) }()
	select {
	case err := <-bdone:
		if err != ErrAnotherServer {
			t.Errorf("second server: %v, want ErrAnotherServer", err)
		}
	case <-time.After(long):
		b.Stop()
		<-bdone
		t.Fatal("second server did not give way to the healthy one")
	}
	a.s.Stop()
	<-a.done
	// The next server retries the previous port (server.json was removed; PreferPort carries it).
	c := start(t, Options{Home: home, PortSet: false, PreferPort: port})
	if c.s.Port() != port {
		t.Errorf("restart on port %d, want %d", c.s.Port(), port)
	}
	// A stale server.json (kill -9) also carries the port.
	c.s.keepJSON.Store(true)
	c.s.Stop()
	<-c.done
	d := start(t, Options{Home: home, PortSet: false, PreferPort: -1})
	if d.s.Port() != port {
		// Windows can keep a just-used port unbindable for minutes (TIME_WAIT without
		// SO_REUSEADDR); the server then falls back to a fresh port, which is the documented
		// best-effort behaviour, so only Linux and macOS insist on the same port here.
		if runtime.GOOS == "windows" {
			t.Logf("after a stale server.json: port %d, want %d (best effort on Windows)", d.s.Port(), port)
		} else {
			t.Errorf("after a stale server.json: port %d, want %d", d.s.Port(), port)
		}
	}
	// Port in use: --port fails, a preferred port falls back to a random one.
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	busy := ln.Addr().(*net.TCPAddr).Port
	bctx, bcancel := context.WithTimeout(context.Background(), long) // bounded even if the bind were to succeed
	defer bcancel()
	if err := New(Options{Home: t.TempDir(), PortSet: true, Port: busy}).Run(bctx); err == nil {
		t.Error("--port on a busy port should fail")
	}
	e := start(t, Options{Home: t.TempDir(), PortSet: false, PreferPort: busy})
	if e.s.Port() == busy || e.s.Port() == 0 {
		t.Errorf("busy preferred port: got %d", e.s.Port())
	}
	// Watchdog: server.json naming another server makes this one exit without deleting it.
	other := state.ServerInfo{PID: 1, Port: 1, Version: "x", Started: "now", Token: state.NewID()}
	state.WriteJSONAtomic(state.Paths{Home: d.home}.ServerJSON(), other)
	select {
	case <-d.done:
	case <-time.After(long):
		t.Fatal("watchdog did not stop the server")
	}
	if cur, _ := state.ReadServer(state.Paths{Home: d.home}); cur == nil || cur.Token != other.Token {
		t.Error("the exiting server removed another server's server.json")
	}
}

func TestBrowserCommand(t *testing.T) {
	t.Setenv("SBTEL_BROWSER", "my-browser --new-tab")
	if got := fmt.Sprint(BrowserCommand("http://x/")); got != "[my-browser --new-tab http://x/]" {
		t.Errorf("SBTEL_BROWSER: %s", got)
	}
	t.Setenv("SBTEL_BROWSER", "")
	if got := BrowserCommand("u"); len(got) < 2 || got[len(got)-1] != "u" {
		t.Errorf("default: %v", got)
	}
}

// Two sessions on one file: a save in one is a disk version in the other, and the other's next
// save on its old base is refused.
func TestTwoSessionsOneFile(t *testing.T) {
	h := start(t, Options{})
	file := filepath.Join(t.TempDir(), "x.sbtel")
	os.WriteFile(file, []byte("(block A)\n"), 0o644)
	a, b := h.create("(block A)\n", &file), h.create("(block A)\n", &file)
	_, ha, _ := h.spec(a)
	body, _ := json.Marshal(map[string]string{"base": ha, "src": "(block FromA)\n"})
	if resp, _ := h.req("POST", "/s/"+a+"/save", string(body), nil); resp.StatusCode != 200 {
		t.Fatalf("save a: %d", resp.StatusCode)
	}
	body, _ = json.Marshal(map[string]string{"base": ha, "src": "(block FromB)\n"})
	if resp, _ := h.req("POST", "/s/"+b+"/save", string(body), nil); resp.StatusCode != 409 {
		t.Errorf("save b on the old base: %d, want 409", resp.StatusCode)
	}
	if v, _, src := h.spec(b); v != 2 || src != "(block FromA)\n" {
		t.Errorf("b sees v%d %q", v, src)
	}
	evs, _ := state.ReadEvents(state.Paths{Home: h.home}, b)
	if last := evs[len(evs)-1]; last.Kind != "version" || last.By != "disk" {
		t.Errorf("b's last event: %+v", last)
	}
}

// Reviews (§5.2): validation, the proposals file, comment ids, diff text from Options.DiffText, the
// spec file left alone; GET versions/<n>; a 409 names who made the newer version; a forced save.
func TestReviewVersionsAndForce(t *testing.T) {
	var diffArgs [2]string
	h := start(t, Options{DiffText: func(a, b string) string { diffArgs = [2]string{a, b}; return "~ block A: sketch\n" }})
	file := filepath.Join(t.TempDir(), "x.sbtel")
	v1 := "(block A)\n"
	os.WriteFile(file, []byte(v1), 0o644)
	id := h.create(v1, &file)
	post := func(route string, body any) (int, string) {
		b, _ := json.Marshal(body)
		resp, out := h.req("POST", "/s/"+id+"/"+route, string(b), nil)
		return resp.StatusCode, out
	}
	h1 := state.Hash([]byte(v1))
	for _, bad := range []map[string]any{
		{},
		{"message": " \n"},
		{"comments": []map[string]any{{"target": "block:A", "text": " "}}},
		{"proposal": map[string]any{"src": "(block B)\n", "base": h1, "baseVersion": 2}},
		{"proposal": map[string]any{"src": "(block B)\n", "base": "nope", "baseVersion": 1}},
		{"proposal": map[string]any{"src": v1, "base": h1, "baseVersion": 1}}, // no edits after all: empty
	} {
		if code, out := post("review", bad); code != 400 {
			t.Errorf("review %v: %d %s", bad, code, out)
		}
	}
	code, out := post("review", map[string]any{"message": "Hi", "comments": []map[string]any{{"target": "block:A", "targetLabel": "block A", "text": "x", "source": "(block A)"}},
		"proposal": map[string]any{"src": "(block B)\n", "base": h1, "baseVersion": 1}, "supersedes": "r1"})
	if code != 200 || !strings.Contains(out, `"id":"r2"`) || !strings.Contains(out, `"comments":["c2.1"]`) {
		t.Fatalf("review: %d %s", code, out)
	}
	p := state.Paths{Home: h.home}
	if b, _ := os.ReadFile(p.Proposal(id, 2)); string(b) != "(block B)\n" || diffArgs != [2]string{v1, "(block B)\n"} {
		t.Errorf("proposal %q, diff of %q", b, diffArgs)
	}
	if b, _ := os.ReadFile(file); string(b) != v1 {
		t.Errorf("a review wrote the spec file")
	}
	evs, _ := state.ReadEvents(p, id)
	e := evs[len(evs)-1]
	if e.Kind != "review" || e.ID != "r2" || e.Proposal == nil || e.Proposal.DiffText != "~ block A: sketch\n" || e.Proposal.BaseVersion != 1 || e.Supersedes != "r1" || e.Version != 1 || len(e.Comments) != 1 || !e.IsUser() {
		t.Errorf("review event: %+v", e)
	}
	if v, _, _ := h.spec(id); v != 1 {
		t.Errorf("a review made a version: v%d", v)
	}
	// Reply to the review's comment and to the review.
	for _, to := range []string{"c2.1", "r2"} {
		if err := h.c.Do("POST", "/control/sessions/"+id+"/reply", map[string]any{"to": to, "text": "ok"}, nil); err != nil {
			t.Errorf("reply %s: %v", to, err)
		}
	}
	// versions/<n>: the bytes of version n; anything else is 404.
	os.WriteFile(file, []byte("(block C)\n"), 0o644) // a disk version (v2) made by "disk"
	resp, body := h.req("GET", "/s/"+id+"/versions/1", "", nil)
	if resp.StatusCode != 200 || !strings.Contains(body, `"src":"(block A)\n"`) || !strings.Contains(body, h1) {
		t.Errorf("versions/1: %d %s", resp.StatusCode, body)
	}
	for _, bad := range []string{"versions/0", "versions/9", "versions/01", "versions/x", "versions/"} {
		if resp, _ := h.req("GET", "/s/"+id+"/"+bad, "", nil); resp.StatusCode != 404 {
			t.Errorf("%s: %d", bad, resp.StatusCode)
		}
	}
	// A save on the old base: 409 naming the disk; with force, written and marked.
	code, out = post("save", map[string]any{"base": h1, "src": "(block Mine)\n"})
	if code != 409 || !strings.Contains(out, `"by":"disk"`) || !strings.Contains(out, `"version":2`) {
		t.Errorf("stale save: %d %s", code, out)
	}
	code, out = post("save", map[string]any{"base": h1, "src": "(block Mine)\n", "force": true})
	if b, _ := os.ReadFile(file); code != 200 || string(b) != "(block Mine)\n" {
		t.Errorf("forced save: %d %s %q", code, out, b)
	}
	evs, _ = state.ReadEvents(p, id)
	if e := evs[len(evs)-1]; e.Kind != "save" || !e.Force || e.Prev != state.Hash([]byte("(block C)\n")) {
		t.Errorf("forced save event: %+v", e)
	}
	// A save on the current base is not forced, even when force is asked.
	_, hNow, _ := h.spec(id)
	post("save", map[string]any{"base": hNow, "src": "(block Mine2)\n", "force": true})
	evs, _ = state.ReadEvents(p, id)
	if e := evs[len(evs)-1]; e.Force {
		t.Errorf("a save on the current base is marked forced")
	}
	// A diff session's review takes comments and a message, never a proposal.
	var dr struct{ ID string }
	h.c.Do("POST", "/control/sessions", map[string]any{"kind": "diff", "label": "d", "diff": map[string]any{"a": map[string]any{"name": "a", "src": "(block A)"}, "b": map[string]any{"name": "b", "src": "(block B)"}}}, &dr)
	id = dr.ID
	if code, out := post("review", map[string]any{"message": "Why?", "version": 1}); code != 200 || !strings.Contains(out, `"proposal":null`) {
		t.Errorf("diff review: %d %s", code, out)
	}
	if code, _ := post("review", map[string]any{"proposal": map[string]any{"src": "x", "base": "y", "baseVersion": 1}}); code != 400 {
		t.Errorf("diff review with a proposal: %d", code)
	}
}
