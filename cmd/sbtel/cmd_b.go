// @sbtel file Sbtel.Cli.SessionCommands

package main

// Workstream B (DESIGN.md §10.B): open, open-diff, inbox, reply, sessions, close, serve
// (including the hidden `serve --foreground`). The server itself is internal/server; the
// on-disk layout is internal/state.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/shashi/sbtel"
	"github.com/shashi/sbtel/internal/engine"
	"github.com/shashi/sbtel/internal/server"
	"github.com/shashi/sbtel/internal/state"
)

const lintLimit = 1 << 20

// serverExe is the binary `open` starts as the detached server (tests may replace it).
var serverExe = func() (string, error) { return os.Executable() }

func paths(e env, cmd string) (state.Paths, bool) {
	h, err := state.Home()
	if err != nil {
		fmt.Fprintf(e.stderr, "sbtel %s: %v\n", cmd, err)
		return state.Paths{}, false
	}
	return state.Paths{Home: h}, true
}

func ensureServer(e env, cmd string, p state.Paths) *server.Client {
	exe, err := serverExe()
	if err == nil {
		var c *server.Client
		if c, err = server.Ensure(p, sbtel.Version(), exe); err == nil {
			return c
		}
	}
	fmt.Fprintf(e.stderr, "sbtel %s: %v\n", cmd, err)
	return nil
}

// sessionMeta reads a session's meta.json, or reports a usage error (exit 2, nil) for a malformed or
// unknown session id.
func sessionMeta(e env, cmd string, p state.Paths, id string) *state.Meta {
	m, err := state.ReadMeta(p, id)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			fmt.Fprintf(e.stderr, "sbtel %s: no session %s\n", cmd, id)
		} else {
			fmt.Fprintf(e.stderr, "sbtel %s: %v\n", cmd, err)
		}
		return nil
	}
	return m
}

func controlErr(e env, cmd string, err error) int {
	fmt.Fprintf(e.stderr, "sbtel %s: %v\n", cmd, err)
	return 2
}

// input is one spec argument, read.
type input struct {
	name string  // as messages call it: the path as typed, or <stdin>
	base string  // file base name, or "stdin"
	path *string // absolute path; nil for stdin
	src  string
}

func readSpecArg(e env, arg string) (input, error) {
	if arg == "-" {
		b, err := io.ReadAll(e.stdin)
		return input{name: "<stdin>", base: "stdin", src: string(b)}, err
	}
	b, err := os.ReadFile(arg)
	if err != nil {
		return input{}, err
	}
	abs, err := filepath.Abs(arg)
	if err != nil {
		return input{}, err
	}
	return input{name: arg, base: filepath.Base(arg), path: &abs, src: string(b)}, nil
}

// lintToStderr prints lint problems for files in lint's format on stderr (open never fails on them).
// Specs over lintLimit are not linted here (goja needs seconds per MiB); a note says so.
func lintToStderr(e env, files ...input) {
	for _, f := range files {
		if len(f.src) > lintLimit {
			fmt.Fprintf(e.stderr, "sbtel open: %s: larger than 1 MiB, not linted (run sbtel lint)\n", f.name)
			return
		}
	}
	en, err := engine.New()
	if err != nil {
		return
	}
	var fs []engine.File
	for _, f := range files {
		fs = append(fs, engine.File{Name: f.name, Src: f.src})
	}
	r, err := en.CLI("lint", map[string]any{"files": fs, "json": false})
	if err == nil && r.Exit != 0 {
		fmt.Fprint(e.stderr, r.Stdout)
	}
}

func browse(e env, cmd, url string, skip bool) {
	if skip || os.Getenv("SBTEL_NO_BROWSER") == "1" {
		return
	}
	if err := server.OpenBrowser(url); err != nil {
		fmt.Fprintf(e.stderr, "sbtel %s: could not open a browser (%v); open %s\n", cmd, err, url)
	}
}

type openResult struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	URL     string `json:"url"`
	Tabs    int    `json:"tabs"`
}

func printOpen(e env, cmd string, asJSON bool, id string, r openResult, created bool) {
	if asJSON {
		b, _ := json.Marshal(map[string]any{"session": id, "url": r.URL, "version": r.Version, "created": created})
		fmt.Fprintln(e.stdout, string(b))
	} else {
		fmt.Fprintln(e.stdout, id)
	}
	fmt.Fprintf(e.stderr, "sbtel %s: %s\n", cmd, r.URL)
}

// sbtel open <spec>|- [--session id] [--label text] [--bindings edges.txt] [--no-browser] [--json]  (§3.7)
func cmdOpen(e env, args []string) int {
	const cmd = "open"
	f, err := parseArgs(args, []string{"no-browser", "json"}, []string{"session", "label", "bindings"})
	if err != nil {
		return usageErr(e, cmd, err)
	}
	if len(f.pos) != 1 {
		return usageErr(e, cmd, errors.New("need exactly one spec (a file or -)"))
	}
	in, err := readSpecArg(e, f.pos[0])
	if err != nil {
		return controlErr(e, cmd, err)
	}
	var bindings *string
	if bf, ok := f.val("bindings"); ok {
		var b []byte
		if bf == "-" {
			if in.path == nil {
				return usageErr(e, cmd, errors.New("the spec and --bindings cannot both be -"))
			}
			b, err = io.ReadAll(e.stdin)
		} else {
			b, err = os.ReadFile(bf)
		}
		if err != nil {
			return controlErr(e, cmd, err)
		}
		s := string(b)
		bindings = &s
	}
	p, ok := paths(e, cmd)
	if !ok {
		return 2
	}
	label, _ := f.val("label")
	sid, withSession := f.val("session")
	if withSession {
		m := sessionMeta(e, cmd, p, sid)
		if m == nil {
			return 2
		}
		if m.Kind != "spec" {
			return usageErr(e, cmd, fmt.Errorf("session %s is a %s session (use open-diff)", sid, m.Kind))
		}
	}
	lintToStderr(e, in)
	c := ensureServer(e, cmd, p)
	if c == nil {
		return 2
	}
	spec := map[string]any{"path": in.path, "name": in.base, "src": in.src}
	var r openResult
	if withSession {
		body := map[string]any{"spec": spec, "label": label}
		if bindings != nil {
			body["bindings"] = *bindings
		}
		if err := c.Do("POST", "/control/sessions/"+sid+"/version", body, &r); err != nil {
			return controlErr(e, cmd, err)
		}
		printOpen(e, cmd, f.has("json"), sid, r, false)
		browse(e, cmd, r.URL, f.has("no-browser") || r.Tabs > 0)
		return 0
	}
	if label == "" {
		label = in.base
	}
	body := map[string]any{"kind": "spec", "label": label, "spec": spec}
	if bindings != nil {
		body["bindings"] = *bindings
	}
	if err := c.Do("POST", "/control/sessions", body, &r); err != nil {
		return controlErr(e, cmd, err)
	}
	printOpen(e, cmd, f.has("json"), r.ID, r, true)
	browse(e, cmd, r.URL, f.has("no-browser"))
	return 0
}

// sbtel open-diff <a> <b> [--session id] [--label text] [--no-browser] [--json]  (§3.8)
func cmdOpenDiff(e env, args []string) int {
	const cmd = "open-diff"
	f, err := parseArgs(args, []string{"no-browser", "json"}, []string{"session", "label"})
	if err != nil {
		return usageErr(e, cmd, err)
	}
	if len(f.pos) != 2 {
		return usageErr(e, cmd, errors.New("need two specs, a and b"))
	}
	if f.pos[0] == "-" && f.pos[1] == "-" {
		return usageErr(e, cmd, errors.New("only one side may be -"))
	}
	var sides [2]input
	for i := range sides {
		if sides[i], err = readSpecArg(e, f.pos[i]); err != nil {
			return controlErr(e, cmd, err)
		}
	}
	p, ok := paths(e, cmd)
	if !ok {
		return 2
	}
	label, _ := f.val("label")
	sid, withSession := f.val("session")
	if withSession {
		m := sessionMeta(e, cmd, p, sid)
		if m == nil {
			return 2
		}
		if m.Kind != "diff" {
			return usageErr(e, cmd, fmt.Errorf("session %s is a %s session (use open)", sid, m.Kind))
		}
	}
	c := ensureServer(e, cmd, p)
	if c == nil {
		return 2
	}
	side := func(in input) map[string]any { return map[string]any{"name": in.base, "path": in.path, "src": in.src} }
	diff := map[string]any{"a": side(sides[0]), "b": side(sides[1])}
	var r openResult
	if withSession {
		if err := c.Do("POST", "/control/sessions/"+sid+"/version", map[string]any{"diff": diff, "label": label}, &r); err != nil {
			return controlErr(e, cmd, err)
		}
		printOpen(e, cmd, f.has("json"), sid, r, false)
		browse(e, cmd, r.URL, f.has("no-browser") || r.Tabs > 0)
		return 0
	}
	if label == "" {
		label = sides[0].base + " → " + sides[1].base
	}
	if err := c.Do("POST", "/control/sessions", map[string]any{"kind": "diff", "label": label, "diff": diff}, &r); err != nil {
		return controlErr(e, cmd, err)
	}
	printOpen(e, cmd, f.has("json"), r.ID, r, true)
	browse(e, cmd, r.URL, f.has("no-browser"))
	return 0
}

func shortTime(at string) string {
	if t, err := time.Parse(time.RFC3339Nano, at); err == nil {
		return t.UTC().Format(time.RFC3339)
	}
	return at
}

func indent(s, pre string) string {
	s = strings.TrimRight(s, "\n")
	return pre + strings.ReplaceAll(s, "\n", "\n"+pre)
}

func printEvent(w io.Writer, p state.Paths, id string, ev state.Event) {
	switch ev.Kind {
	case "comment":
		what := ev.TargetLabel
		if what == "" {
			what = ev.Target
		}
		fmt.Fprintf(w, "%s comment on %s (version %d, %s)\n", ev.ID, what, ev.Version, shortTime(ev.At))
		fmt.Fprintln(w, indent(ev.Text, "  > "))
		if strings.TrimSpace(ev.Source) != "" {
			fmt.Fprintln(w, "  source:")
			fmt.Fprintln(w, indent(ev.Source, "    "))
		}
	case "save":
		where := p.Spec(id)
		if ev.Path != nil {
			where = *ev.Path
		}
		was := fmt.Sprintf("was %d", ev.Version-1)
		if ev.Force {
			was += ", which the user overwrote without merging"
		}
		fmt.Fprintf(w, "save version %d by user (%s), %s, written to %s\n", ev.Version, was, shortTime(ev.At), where)
	case "review":
		printReview(w, ev)
	}
}

// printReview prints a review as one unit (§3.9): the header, the message, the diff of the proposal
// against its base, the proposed spec's path, then each comment as a comment event prints, indented.
func printReview(w io.Writer, ev state.Event) {
	var parts []string
	if ev.Message != "" {
		parts = append(parts, "a message")
	}
	if n := len(ev.Comments); n > 0 {
		parts = append(parts, plural(n, "comment"))
	}
	if ev.Proposal != nil {
		parts = append(parts, "proposed edits")
	}
	fmt.Fprintf(w, "%s review of version %d by user, %s: %s\n", ev.ID, ev.Version, shortTime(ev.At), strings.Join(parts, ", "))
	if ev.Message != "" {
		fmt.Fprintln(w, indent(ev.Message, "  > "))
	}
	if pr := ev.Proposal; pr != nil {
		switch {
		case strings.TrimSpace(pr.DiffText) == "" || strings.EqualFold(strings.TrimSpace(pr.DiffText), "no changes"):
			fmt.Fprintf(w, "  edits against version %d: formatting or comments only, no change to any element\n", pr.BaseVersion)
		default:
			fmt.Fprintf(w, "  edits against version %d (sbtel diff):\n", pr.BaseVersion)
			fmt.Fprintln(w, indent(pr.DiffText, "    "))
		}
		fmt.Fprintf(w, "  proposed spec: %s\n", pr.Path)
		if ev.Supersedes != "" {
			fmt.Fprintf(w, "  it replaces the proposed spec of %s\n", ev.Supersedes)
		}
	}
	for _, c := range ev.Comments {
		what := c.TargetLabel
		if what == "" {
			what = c.Target
		}
		fmt.Fprintf(w, "  %s comment on %s\n", c.ID, what)
		fmt.Fprintln(w, indent(c.Text, "    > "))
		if strings.TrimSpace(c.Source) != "" {
			fmt.Fprintln(w, "    source:")
			fmt.Fprintln(w, indent(c.Source, "      "))
		}
	}
}

func plural(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return strconv.Itoa(n) + " " + word + "s"
}

// diffText is the server's Options.DiffText: `sbtel diff base proposal`, through a fresh engine. The
// text is what `sbtel diff` prints; a side that does not parse gives its error line instead.
var _ server.DiffFunc = diffText

func diffText(a, b string) string {
	if len(a)+len(b) > 8<<20 {
		return "(not computed: the specs are larger than 8 MiB; run sbtel diff on the proposed spec)"
	}
	en, err := engine.New()
	if err != nil {
		return ""
	}
	r, err := en.CLI("diff", map[string]any{"files": []engine.File{{Name: "base", Src: a}, {Name: "proposal", Src: b}}, "json": false})
	if err != nil {
		return ""
	}
	if r.Exit == 2 {
		return strings.TrimSpace(strings.TrimPrefix(r.Stderr, "sbtel diff: "))
	}
	return r.Stdout
}

// sbtel inbox <session> [--wait] [--timeout s] [--peek] [--json]  (§3.9). Reads the disk only.
func cmdInbox(e env, args []string) int {
	const cmd = "inbox"
	f, err := parseArgs(args, []string{"wait", "peek", "json"}, []string{"timeout"})
	if err != nil {
		return usageErr(e, cmd, err)
	}
	if len(f.pos) != 1 {
		return usageErr(e, cmd, errors.New("need one session id"))
	}
	timeout := 600.0
	if v, ok := f.val("timeout"); ok {
		if timeout, err = strconv.ParseFloat(v, 64); err != nil || timeout < 0 {
			return usageErr(e, cmd, fmt.Errorf("--timeout wants seconds, got %q", v))
		}
	}
	p, ok := paths(e, cmd)
	if !ok {
		return 2
	}
	id := f.pos[0]
	if sessionMeta(e, cmd, p, id) == nil {
		return 2
	}
	start := time.Now()
	var unread []state.Event
	last := 0
	cursor := 0
	for {
		evs, err := state.ReadEvents(p, id)
		if err != nil {
			return controlErr(e, cmd, err)
		}
		cursor = state.ReadCursor(p, id)
		unread = unread[:0]
		for _, ev := range evs {
			if ev.Seq > cursor && ev.IsUser() {
				unread = append(unread, ev)
			}
		}
		if n := len(evs); n > 0 {
			last = evs[n-1].Seq
		}
		if len(unread) > 0 || !f.has("wait") {
			break
		}
		if timeout > 0 && time.Since(start).Seconds() >= timeout {
			fmt.Fprintf(e.stderr, "sbtel inbox: nothing new after %ss\n", strconv.FormatFloat(timeout, 'f', -1, 64))
			return 0
		}
		time.Sleep(250 * time.Millisecond)
		if _, err := os.Stat(p.Meta(id)); err != nil {
			fmt.Fprintf(e.stderr, "sbtel inbox: session %s was closed\n", id)
			return 2
		}
	}
	for i, ev := range unread {
		if f.has("json") {
			b, _ := json.Marshal(ev)
			fmt.Fprintln(e.stdout, string(b))
			continue
		}
		if i > 0 {
			fmt.Fprintln(e.stdout)
		}
		printEvent(e.stdout, p, id, ev)
	}
	if !f.has("peek") && last > cursor {
		if err := state.WriteCursor(p, id, last); err != nil {
			return controlErr(e, cmd, err)
		}
	}
	return 0
}

// sbtel reply <session> <comment-id> <text>|-  (§3.10)
func cmdReply(e env, args []string) int {
	const cmd = "reply"
	f, err := parseArgs(args, nil, nil)
	if err != nil {
		return usageErr(e, cmd, err)
	}
	if len(f.pos) != 3 {
		return usageErr(e, cmd, errors.New("need a session, a comment id and the text"))
	}
	id, to, text := f.pos[0], f.pos[1], f.pos[2]
	if text == "-" {
		b, err := io.ReadAll(e.stdin)
		if err != nil {
			return controlErr(e, cmd, err)
		}
		text = strings.TrimRight(string(b), "\r\n")
	}
	if strings.TrimSpace(text) == "" {
		return usageErr(e, cmd, errors.New("the reply text is empty"))
	}
	p, ok := paths(e, cmd)
	if !ok || sessionMeta(e, cmd, p, id) == nil {
		return 2
	}
	c := ensureServer(e, cmd, p)
	if c == nil {
		return 2
	}
	if err := c.Do("POST", "/control/sessions/"+id+"/reply", map[string]any{"to": to, "text": text}, nil); err != nil {
		return controlErr(e, cmd, err)
	}
	return 0
}

// sbtel sessions [--json]  (§3.11)
func cmdSessions(e env, args []string) int {
	const cmd = "sessions"
	f, err := parseArgs(args, []string{"json"}, nil)
	if err != nil {
		return usageErr(e, cmd, err)
	}
	if len(f.pos) != 0 {
		return usageErr(e, cmd, errors.New("takes no arguments"))
	}
	p, ok := paths(e, cmd)
	if !ok {
		return 2
	}
	ids, err := state.ListIDs(p)
	if err != nil {
		return controlErr(e, cmd, err)
	}
	var tabs map[string]int
	if c := server.Connect(p); c != nil {
		var r struct {
			Sessions []struct {
				ID   string
				Tabs int
			}
		}
		if c.Do("GET", "/control/sessions", nil, &r) == nil {
			tabs = map[string]int{}
			for _, s := range r.Sessions {
				tabs[s.ID] = s.Tabs
			}
		}
	}
	type row struct {
		m      *state.Meta
		unread int
	}
	var rows []row
	for _, id := range ids {
		m, err := state.ReadMeta(p, id)
		if err != nil {
			continue
		}
		evs, _ := state.ReadEvents(p, id)
		cur, n := state.ReadCursor(p, id), 0
		for _, ev := range evs {
			if ev.Seq > cur && ev.IsUser() {
				n++
			}
		}
		rows = append(rows, row{m, n})
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].m.Updated > rows[j].m.Updated })
	for _, r := range rows {
		m := r.m
		var path *string
		where := "stdin"
		if m.Spec != nil && m.Spec.Path != nil {
			path, where = m.Spec.Path, *m.Spec.Path
		}
		if m.Diff != nil {
			// The absolute paths, as for a spec session; "stdin" for a side read from stdin.
			side := func(path *string) string {
				if path != nil {
					return *path
				}
				return "stdin"
			}
			where = side(m.Diff.A.Path) + " -> " + side(m.Diff.B.Path)
			if m.Diff.B.Path != nil {
				path = m.Diff.B.Path
			}
		}
		if f.has("json") {
			var t *int
			if tabs != nil {
				n := tabs[m.ID]
				t = &n
			}
			b, _ := json.Marshal(map[string]any{"id": m.ID, "kind": m.Kind, "label": m.Label, "version": m.Version, "unread": r.unread,
				"created": m.Created, "updated": m.Updated, "path": path, "tabs": t})
			fmt.Fprintln(e.stdout, string(b))
			continue
		}
		fmt.Fprintf(e.stdout, "%s  %s  %s  v%d  %d unread  updated %s  %s\n", m.ID, m.Kind, m.Label, m.Version, r.unread, shortTime(m.Updated), where)
	}
	return 0
}

// sbtel close <session>  (§3.12)
func cmdClose(e env, args []string) int {
	const cmd = "close"
	f, err := parseArgs(args, nil, nil)
	if err != nil {
		return usageErr(e, cmd, err)
	}
	if len(f.pos) != 1 {
		return usageErr(e, cmd, errors.New("need one session id"))
	}
	p, ok := paths(e, cmd)
	if !ok || sessionMeta(e, cmd, p, f.pos[0]) == nil {
		return 2
	}
	c := ensureServer(e, cmd, p)
	if c == nil {
		return 2
	}
	if err := c.Do("POST", "/control/sessions/"+f.pos[0]+"/close", map[string]any{}, nil); err != nil {
		return controlErr(e, cmd, err)
	}
	return 0
}

// sbtel serve --status | --stop [--json]; hidden: serve --foreground [--port n] [--idle minutes]
// [--prefer-port n]  (§3.13)
func cmdServe(e env, args []string) int {
	const cmd = "serve"
	f, err := parseArgs(args, []string{"status", "stop", "json", "foreground"}, []string{"port", "idle", "prefer-port"})
	if err != nil {
		return usageErr(e, cmd, err)
	}
	n := 0
	for _, k := range []string{"status", "stop", "foreground"} {
		if f.has(k) {
			n++
		}
	}
	if n != 1 || len(f.pos) != 0 {
		return usageErr(e, cmd, errors.New("give one of --status or --stop"))
	}
	p, ok := paths(e, cmd)
	if !ok {
		return 2
	}
	switch {
	case f.has("status"):
		info, st := server.Running(p)
		if f.has("json") {
			out := map[string]any{"running": info != nil}
			if info != nil {
				out["pid"], out["port"], out["version"], out["started"] = info.PID, info.Port, st.Version, info.Started
			}
			b, _ := json.Marshal(out)
			fmt.Fprintln(e.stdout, string(b))
		} else if info != nil {
			fmt.Fprintf(e.stdout, "running pid %d port %d version %s since %s\n", info.PID, info.Port, st.Version, info.Started)
		} else {
			fmt.Fprintln(e.stdout, "not running")
		}
		if info == nil {
			return 1
		}
		return 0
	case f.has("stop"):
		if _, err := server.StopRunning(p, 5*time.Second); err != nil {
			fmt.Fprintf(e.stderr, "sbtel serve: %v\n", err)
		}
		return 0
	}
	return serveForeground(e, f, p)
}

func serveForeground(e env, f flags, p state.Paths) int {
	o := server.Options{Home: p.Home, Version: sbtel.Version(), ViewerHTML: sbtel.ViewerHTML, Log: e.stderr, DiffText: diffText}
	if v, ok := f.val("port"); ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 || n > 65535 {
			return usageErr(e, "serve", fmt.Errorf("bad --port %q", v))
		}
		o.Port, o.PortSet = n, true
	}
	if v, ok := f.val("prefer-port"); ok {
		o.PreferPort, _ = strconv.Atoi(v)
	}
	idle := os.Getenv("SBTEL_IDLE_MINUTES")
	if v, ok := f.val("idle"); ok {
		idle = v
	}
	if idle != "" {
		m, err := strconv.ParseFloat(idle, 64)
		if err != nil || m <= 0 {
			return usageErr(e, "serve", fmt.Errorf("bad idle minutes %q", idle))
		}
		o.Idle = time.Duration(m * float64(time.Minute))
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	err := server.New(o).Run(ctx)
	if errors.Is(err, server.ErrAnotherServer) {
		fmt.Fprintln(e.stderr, "sbtel serve: another server is already running; exiting")
		return 0
	}
	if err != nil {
		fmt.Fprintf(e.stderr, "sbtel serve: %v\n", err)
		return 2
	}
	return 0
}
