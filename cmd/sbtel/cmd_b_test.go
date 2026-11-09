package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/shashi/sbtel/internal/server"
	"github.com/shashi/sbtel/internal/state"
)

// When `open` starts a detached server from a test, os.Executable() is this test binary; with
// SBTEL_TEST_AS_CLI=1 it behaves as the sbtel CLI instead of running tests.
func init() {
	if os.Getenv("SBTEL_TEST_AS_CLI") == "1" && len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-test.") {
		os.Exit(run(os.Args[1:], env{os.Stdin, os.Stdout, os.Stderr}))
	}
}

// foreground runs `serve --foreground --port 0` in-process on a fresh SBTEL_HOME.
func foreground(t *testing.T, extra ...string) (home string, stop func()) {
	t.Helper()
	home = t.TempDir()
	t.Setenv("SBTEL_HOME", home)
	t.Setenv("SBTEL_NO_BROWSER", "1")
	done := make(chan int, 1)
	go func() {
		// Not runT: the server logs from its request goroutines, and runT's bytes.Buffer is not safe
		// for concurrent writes (go test -race). io.Discard is.
		done <- run(append([]string{"serve", "--foreground", "--port", "0"}, extra...), env{strings.NewReader(""), io.Discard, io.Discard})
	}()
	waitFor(t, func() bool { info, _ := server.Running(state.Paths{Home: home}); return info != nil })
	stopped := false
	stop = func() {
		if stopped {
			return
		}
		stopped = true
		runT("", "serve", "--stop")
		select {
		case <-done:
		case <-time.After(long):
			t.Error("server did not stop")
		}
	}
	t.Cleanup(stop)
	return home, stop
}

// long bounds every wait in these tests. It only costs time when a test fails, so it is generous:
// the tests run under -race on loaded machines.
const long = 60 * time.Second

// waitFor polls a condition (never a fixed sleep standing in for one) until it holds or `long` passes.
func waitFor(t *testing.T, f func() bool) {
	t.Helper()
	for end := time.Now().Add(long); time.Now().Before(end); time.Sleep(10 * time.Millisecond) {
		if f() {
			return
		}
	}
	t.Fatal("timed out")
}

func postComment(t *testing.T, home, id, text string) string {
	t.Helper()
	info, _ := state.ReadServer(state.Paths{Home: home})
	b, _ := json.Marshal(map[string]any{"target": "block:A", "targetLabel": "block A", "text": text, "version": 1, "source": "(block A)"})
	base := "http://127.0.0.1:" + itoa(info.Port)
	resp, err := httpPost(base+"/s/"+id+"/comment", base, string(b))
	if err != nil {
		t.Fatal(err)
	}
	var r struct{ ID string }
	json.Unmarshal([]byte(resp), &r)
	return r.ID
}

func TestSessionLoop(t *testing.T) {
	home, _ := foreground(t)
	dir := t.TempDir()
	spec := filepath.Join(dir, "a.sbtel")
	os.WriteFile(spec, []byte("(block A)\n"), 0o644)

	c, out, errs := runT("", "open", spec)
	id := strings.TrimSpace(out)
	if c != 0 || !state.ValidID(id) || !strings.Contains(errs, "sbtel open: http://127.0.0.1:") || !strings.HasSuffix(strings.TrimSpace(errs), "/s/"+id+"/") {
		t.Fatalf("open: %d %q %q", c, out, errs)
	}
	m, _ := state.ReadMeta(state.Paths{Home: home}, id)
	if m.Label != "a.sbtel" || *m.Spec.Path != spec || m.Version != 1 {
		t.Errorf("meta: %+v", m)
	}
	// Lint problems are printed but open still exits 0.
	c, out, errs = runT("(block B (port :in Nope :as p))", "open", "-", "--json")
	var oj map[string]any
	json.Unmarshal([]byte(out), &oj)
	if c != 0 || oj["created"] != true || oj["version"].(float64) != 1 || !strings.Contains(errs, "<stdin>:") {
		t.Errorf("open - with problems: %d %q %q", c, out, errs)
	}
	stdinID := oj["session"].(string)

	// inbox: empty, then a comment; --peek keeps it unread.
	if c, out, _ := runT("", "inbox", id); c != 0 || out != "" {
		t.Errorf("empty inbox: %d %q", c, out)
	}
	cid := postComment(t, home, id, "multi\nline ünï")
	c, out, _ = runT("", "inbox", id, "--peek")
	if c != 0 || !strings.HasPrefix(out, cid+" comment on block A (version 1, ") || !strings.Contains(out, "  > multi\n  > line ünï\n  source:\n    (block A)\n") {
		t.Errorf("inbox --peek: %q", out)
	}
	if c, out2, _ := runT("", "inbox", id, "--json"); c != 0 || !strings.Contains(out2, `"text":"multi\nline ünï"`) {
		t.Errorf("inbox --json: %q", out2)
	}
	if c, out, _ := runT("", "inbox", id); c != 0 || out != "" {
		t.Errorf("inbox after read: %q", out)
	}
	// --wait returns as soon as something arrives; times out quietly with exit 0. The comment is
	// posted from the test goroutine while inbox waits in another; the pause only makes it likely that
	// inbox is already polling, and the outcome is the same if it is not. The timeout is far beyond any
	// load, so returning before it proves the comment woke the wait.
	type res struct {
		c   int
		out string
	}
	waited := make(chan res, 1)
	go func() { c, out, _ := runT("", "inbox", id, "--wait", "--timeout", "600"); waited <- res{c, out} }()
	time.Sleep(300 * time.Millisecond)
	postComment(t, home, id, "later")
	select {
	case r := <-waited:
		if r.c != 0 || !strings.Contains(r.out, "  > later") {
			t.Errorf("inbox --wait: %d %q", r.c, r.out)
		}
	case <-time.After(long):
		t.Fatal("inbox --wait did not return after a comment arrived")
	}
	if c, out, errs := runT("", "inbox", id, "--wait", "--timeout", "0.3"); c != 0 || out != "" || errs != "sbtel inbox: nothing new after 0.3s\n" {
		t.Errorf("inbox --wait timeout: %d %q %q", c, out, errs)
	}
	if c, _, _ := runT("", "inbox", state.NewID()); c != 2 {
		t.Errorf("unknown session: %d", c)
	}
	if c, _, _ := runT("", "inbox", "../../etc"); c != 2 {
		t.Errorf("bad id: %d", c)
	}

	// reply: ok, unknown comment, empty text, from stdin.
	if c, out, errs := runT("", "reply", id, cid, "done"); c != 0 || out != "" {
		t.Errorf("reply: %d %q %q", c, out, errs)
	}
	if c, _, _ := runT("", "reply", id, "c999", "x"); c != 2 {
		t.Errorf("reply to missing comment: %d", c)
	}
	if c, _, _ := runT("  \n", "reply", id, cid, "-"); c != 2 {
		t.Errorf("empty reply: %d", c)
	}
	if c, _, _ := runT("from stdin\n", "reply", id, cid, "-"); c != 0 {
		t.Errorf("reply -: %d", c)
	}

	// open --session: a new version; the same content again is no new version.
	os.WriteFile(spec, []byte("(block A2)\n"), 0o644)
	c, out, _ = runT("", "open", spec, "--session", id, "--json", "--label", "renamed")
	json.Unmarshal([]byte(out), &oj)
	if c != 0 || oj["version"].(float64) != 2 || oj["created"] != false {
		t.Errorf("open --session: %d %q", c, out)
	}
	if c, out, _ := runT("", "open", spec, "--session", id, "--json"); c != 0 || !strings.Contains(out, `"version":2`) {
		t.Errorf("open --session unchanged: %q", out)
	}
	if c, _, _ := runT("", "open", spec, "--session", state.NewID()); c != 2 {
		t.Errorf("open --session unknown: %d", c)
	}
	edges := filepath.Join(dir, "e.txt")
	os.WriteFile(edges, []byte("A2 -> A2\n"), 0o644)
	if c, out, _ := runT("", "open", spec, "--session", id, "--bindings", edges, "--json"); c != 0 || !strings.Contains(out, `"version":3`) {
		t.Errorf("open --bindings: %q", out)
	}
	if b, _ := os.ReadFile(state.Paths{Home: home}.Bindings(id)); string(b) != "A2 -> A2\n" {
		t.Errorf("bindings.txt: %q", b)
	}

	// open-diff, and kind mismatches.
	c, out, _ = runT("(block B)", "open-diff", spec, "-", "--json")
	json.Unmarshal([]byte(out), &oj)
	diffID, _ := oj["session"].(string)
	if c != 0 || !strings.HasSuffix(oj["url"].(string), "/s/"+diffID+"/diff") {
		t.Errorf("open-diff: %d %q", c, out)
	}
	if dm, _ := state.ReadMeta(state.Paths{Home: home}, diffID); dm == nil || dm.Label != "a.sbtel → stdin" {
		t.Errorf("diff label: %+v", dm)
	}
	if c, _, _ := runT("", "open", spec, "--session", diffID); c != 2 {
		t.Errorf("open --session on a diff session: %d", c)
	}
	if c, _, _ := runT("", "open-diff", spec, spec, "--session", id); c != 2 {
		t.Errorf("open-diff --session on a spec session: %d", c)
	}

	// sessions: newest first, with tabs (0) while the server runs.
	c, out, _ = runT("", "sessions")
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if c != 0 || len(lines) != 3 || !strings.HasPrefix(lines[0], diffID+"  diff  a.sbtel → stdin  v1  0 unread  updated ") || !strings.HasSuffix(lines[0], "  "+spec+" -> stdin") {
		t.Errorf("sessions: %q", out)
	}
	if !strings.Contains(out, id+"  spec  renamed  v3  0 unread  updated ") || !strings.Contains(out, stdinID+"  spec  stdin  v1  0 unread") || !strings.HasSuffix(lines[1], "  "+spec) && !strings.HasSuffix(lines[2], "  "+spec) {
		t.Errorf("sessions rows: %q", out)
	}
	c, out, _ = runT("", "sessions", "--json")
	if c != 0 || strings.Count(out, `"tabs":0`) != 3 {
		t.Errorf("sessions --json: %q", out)
	}

	// close.
	if c, _, errs := runT("", "close", id); c != 0 {
		t.Errorf("close: %d %q", c, errs)
	}
	if _, err := os.Stat(spec); err != nil {
		t.Error("close removed the spec file")
	}
	if c, _, _ := runT("", "close", id); c != 2 {
		t.Errorf("close twice: %d", c)
	}

	// serve --status.
	c, out, _ = runT("", "serve", "--status")
	if c != 0 || !strings.HasPrefix(out, "running pid ") {
		t.Errorf("status: %d %q", c, out)
	}
	c, out, _ = runT("", "serve", "--status", "--json")
	if c != 0 || !strings.Contains(out, `"running":true`) || strings.Contains(out, "token") {
		t.Errorf("status --json: %q", out)
	}
}

func TestServeStatusStopAndUsage(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SBTEL_HOME", home)
	if c, out, _ := runT("", "serve", "--status"); c != 1 || out != "not running\n" {
		t.Errorf("status: %d %q", c, out)
	}
	if c, out, _ := runT("", "serve", "--status", "--json"); c != 1 || out != "{\"running\":false}\n" {
		t.Errorf("status --json: %d %q", c, out)
	}
	if c, _, _ := runT("", "serve", "--stop"); c != 0 {
		t.Errorf("stop with no server: %d", c)
	}
	// A stale server.json (a killed server) is "not running".
	state.WriteJSONAtomic(state.Paths{Home: home}.ServerJSON(), state.ServerInfo{PID: 999999, Port: 1, Version: "x", Token: state.NewID()})
	if c, _, _ := runT("", "serve", "--status"); c != 1 {
		t.Errorf("stale status: %d", c)
	}
	for _, a := range [][]string{{"serve"}, {"serve", "--status", "--stop"}, {"inbox"}, {"inbox", "x", "--timeout", "soon"}, {"reply", "a", "b"}, {"open"}, {"open", "a", "b"}, {"open-diff", "-", "-"}, {"sessions", "x"}, {"close"}} {
		if c, _, _ := runT("", a...); c != 2 {
			t.Errorf("%v: exit %d, want 2", a, c)
		}
	}
	if c, _, _ := runT("", "open", filepath.Join(home, "missing.sbtel")); c != 2 {
		t.Errorf("open missing file: %d", c)
	}
}

func TestIdleExit(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SBTEL_HOME", home)
	start := time.Now()
	c, _, errs := runT("", "serve", "--foreground", "--port", "0", "--idle", "0.01") // 0.6 s
	if c != 0 || !strings.Contains(errs, "exiting: idle") || time.Since(start) < 500*time.Millisecond {
		t.Errorf("idle: %d %q after %v", c, errs, time.Since(start))
	}
	if _, err := os.Stat(filepath.Join(home, "server.json")); !os.IsNotExist(err) {
		t.Error("server.json left behind")
	}
}

// A server on another version is stopped and replaced by a detached one (this test binary acting
// as the CLI), which comes back on the same port.
func TestVersionMismatchRestart(t *testing.T) {
	home := t.TempDir()
	t.Setenv("SBTEL_HOME", home)
	t.Setenv("SBTEL_NO_BROWSER", "1")
	t.Setenv("SBTEL_TEST_AS_CLI", "1")
	old := server.New(server.Options{Home: home, PortSet: true, Version: "0.0.0-old", ViewerHTML: "x"})
	done := make(chan error, 1)
	go func() { done <- old.Run(context.Background()) }()
	select {
	case <-old.Ready():
	case err := <-done:
		t.Fatalf("old server did not start: %v", err)
	case <-time.After(long):
		t.Fatal("old server did not start")
	}
	oldPort := old.Port()
	p := state.Paths{Home: home}
	t.Cleanup(func() { runT("", "serve", "--stop") })

	c, out, errs := runT("(block A)", "open", "-")
	if c != 0 {
		t.Fatalf("open: %d %q %q", c, out, errs)
	}
	select {
	case <-done:
	case <-time.After(long):
		t.Fatal("old server still running")
	}
	info, st := server.Running(p)
	if info == nil || st.Version == "0.0.0-old" || info.PID == os.Getpid() {
		t.Fatalf("new server: %+v %+v", info, st)
	}
	if info.Port != oldPort {
		t.Errorf("new server on port %d, want the old port %d", info.Port, oldPort)
	}
	if !strings.Contains(errs, "127.0.0.1:"+itoa(oldPort)) {
		t.Errorf("url: %q", errs)
	}
	if b, _ := os.ReadFile(p.ServerLog()); !strings.Contains(string(b), "listening on") {
		t.Errorf("server.log: %q", b)
	}
	// `serve --stop` stops the detached server.
	if c, _, _ := runT("", "serve", "--stop"); c != 0 {
		t.Error("stop")
	}
	if info, _ := server.Running(p); info != nil {
		t.Error("detached server still running after --stop")
	}
}

func itoa(n int) string { return strconv.Itoa(n) }

func httpPost(url, origin, body string) (string, error) {
	req, _ := http.NewRequest("POST", url, strings.NewReader(body))
	req.Header.Set("Origin", origin)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return string(b), err
}
