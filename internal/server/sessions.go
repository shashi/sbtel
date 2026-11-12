// @sbtel file Sbtel.Server.Sessions

package server

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/shashi/sbtel/internal/state"
)

// session is one loaded session. Every field is guarded by Server.mu.
type session struct {
	meta     state.Meta
	seq      int    // last event seq
	src      []byte // spec sessions: the current version's bytes
	a, b     []byte // diff sessions
	bindings []byte // nil when there are none
	subs     map[*sub]struct{}

	statKey string // file-backed: "<size>/<mtime>" when we last hashed the file
}

// errNotFound is a missing session or comment (404).
var errNotFound = errors.New("not found")

// errBadRequest wraps a client mistake (400).
type errBadRequest struct{ msg string }

func (e errBadRequest) Error() string { return e.msg }

// get returns a loaded session, loading it from disk on first use. Caller holds s.mu.
func (s *Server) get(id string) (*session, error) {
	if ss, ok := s.sessions[id]; ok {
		return ss, nil
	}
	if !state.ValidID(id) {
		return nil, fmt.Errorf("%w: no session %s", errNotFound, id)
	}
	m, err := state.ReadMeta(s.paths, id)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: no session %s", errNotFound, id)
		}
		return nil, err
	}
	evs, err := state.ReadEvents(s.paths, id)
	if err != nil {
		return nil, err
	}
	ss := &session{meta: *m, subs: map[*sub]struct{}{}}
	if n := len(evs); n > 0 {
		ss.seq = evs[n-1].Seq
	}
	switch m.Kind {
	case "spec":
		if ss.src, err = os.ReadFile(s.paths.Version(id, m.Version)); err != nil {
			return nil, err
		}
	case "diff":
		if ss.a, err = os.ReadFile(s.paths.Side(id, "a")); err != nil {
			return nil, err
		}
		if ss.b, err = os.ReadFile(s.paths.Side(id, "b")); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("session %s: unknown kind %q", id, m.Kind)
	}
	if m.Bindings {
		ss.bindings, _ = os.ReadFile(s.paths.Bindings(id))
	}
	s.sessions[id] = ss
	return ss, nil
}

func (s *Server) url(id, kind string) string {
	u := "http://127.0.0.1:" + strconv.Itoa(s.port) + "/s/" + id + "/"
	if kind == "diff" {
		u += "diff"
	}
	return u
}

func (s *Server) append(ss *session, e state.Event) (state.Event, error) {
	if e.From != "" { // only another live spec session counts as a sender
		if o, err := s.get(e.From); err != nil || e.From == ss.meta.ID || o.meta.Kind != "spec" {
			e.From = ""
		}
	}
	e.Seq = ss.seq + 1
	e.At = state.Now()
	if err := state.AppendEvent(s.paths, ss.meta.ID, e); err != nil {
		return e, err
	}
	ss.seq = e.Seq
	ss.meta.Updated = e.At
	// What was said also goes to the project's own log, beside the spec (state.AppendProjectComment).
	if (e.Kind == "comment" || e.Kind == "reply" || e.Kind == "review" || e.Kind == "note" || e.Kind == "ack") && ss.meta.Spec != nil && ss.meta.Spec.Path != nil {
		le, sid := e, ss.meta.ID
		if e.Kind == "reply" || e.Kind == "ack" { // an answer to something restored is logged against its first session and id
			evs, _ := state.ReadEvents(s.paths, ss.meta.ID)
			for _, o := range evs {
				if at := strings.SplitN(o.Origins[e.To], "/", 2); len(at) == 2 {
					sid, le.To = at[0], at[1]
				}
			}
		}
		if err := state.AppendProjectComment(*ss.meta.Spec.Path, sid, le); err != nil {
			s.logf("session %s: project comment log: %v", ss.meta.ID, err)
		}
	}
	s.mirror(ss, e)
	return e, nil
}

// restore brings what was said about a spec file in earlier sessions into a new session on it, from the
// project's comment log (DESIGN.md §4.4). Each comment and review gets an id of this session, and the
// replies follow their comments; all are marked old, so no inbox delivers them again. A review's
// proposed spec is not kept. The events are written directly: they are in the project log already.
func (s *Server) restore(ss *session) {
	if ss.meta.Kind != "spec" || ss.meta.Spec == nil || ss.meta.Spec.Path == nil {
		return
	}
	ids := map[string]string{}
	for _, o := range state.ReadProjectComments(*ss.meta.Spec.Path) {
		n := strconv.Itoa(ss.seq + 1)
		e := state.Event{Seq: ss.seq + 1, Kind: o.Kind, By: o.By, At: o.At, Old: true}
		switch o.Kind {
		case "comment":
			e.ID = "c" + n
			e.Target, e.TargetLabel, e.Text, e.Source, e.Version, e.Hash = o.Target, o.TargetLabel, o.Text, o.Source, 1, ss.meta.Base
			ids[o.Session+"/"+o.ID] = e.ID
			e.Origins = map[string]string{e.ID: o.Session + "/" + o.ID}
		case "review":
			e.ID = "r" + n
			e.Message, e.Version, e.Hash = o.Message, 1, ss.meta.Base
			ids[o.Session+"/"+o.ID] = e.ID
			e.Origins = map[string]string{e.ID: o.Session + "/" + o.ID}
			for k, c := range o.Comments {
				old := c.ID
				c.ID = "c" + n + "." + strconv.Itoa(k+1)
				ids[o.Session+"/"+old] = c.ID
				e.Origins[c.ID] = o.Session + "/" + old
				e.Comments = append(e.Comments, c)
			}
		case "note":
			e.ID = "n" + n
			e.Target, e.TargetLabel, e.Text = o.Target, o.TargetLabel, o.Text
			ids[o.Session+"/"+o.ID] = e.ID
			e.Origins = map[string]string{e.ID: o.Session + "/" + o.ID}
		case "reply", "ack":
			if e.To = ids[o.Session+"/"+o.To]; e.To == "" {
				continue
			}
			e.Text = o.Text
		default:
			continue
		}
		if e.At == "" {
			e.At = state.Now()
		}
		if err := state.AppendEvent(s.paths, ss.meta.ID, e); err != nil {
			s.logf("session %s: restoring comments: %v", ss.meta.ID, err)
			return
		}
		ss.seq = e.Seq
	}
}

// mirror copies an event to the session whose page sent it (DESIGN.md §4.3, ref): a comment, review or
// save made in a spec shown inside another spec's page, and the agent's reply to one. That session's
// inbox and page then have it, tagged with the file it is about. Caller holds s.mu.
func (s *Server) mirror(ss *session, e state.Event) {
	from := e.From
	if e.Kind == "reply" {
		evs, _ := state.ReadEvents(s.paths, ss.meta.ID)
		from = senderOf(evs, e.To)
	}
	if from == "" || e.Kind == "ref" {
		return
	}
	parent, err := s.get(from)
	if err != nil {
		return
	}
	file := ss.meta.Label
	if ss.meta.Spec != nil && ss.meta.Spec.Path != nil {
		file = filepath.Base(*ss.meta.Spec.Path)
		if parent.meta.Spec != nil && parent.meta.Spec.Path != nil {
			if rel, err := filepath.Rel(filepath.Dir(*parent.meta.Spec.Path), *ss.meta.Spec.Path); err == nil && !strings.HasPrefix(rel, "..") {
				file = filepath.ToSlash(rel)
			}
		}
	}
	pe, err := s.append(parent, state.Event{Kind: "ref", By: e.By, Session: ss.meta.ID, File: file, Ref: &e})
	if err != nil {
		s.logf("session %s: copy to %s: %v", ss.meta.ID, from, err)
		return
	}
	_ = s.writeMeta(parent)
	s.broadcast(parent, sseMsg{id: pe.Seq, event: "ref", data: mustJSON(pe)}, nil)
}

// senderOf is the session a comment or review was sent from: its own, "" (see Event.From).
func senderOf(evs []state.Event, id string) string {
	for _, e := range evs {
		if (e.Kind == "comment" || e.Kind == "review") && e.ID == id {
			return e.From
		}
		if e.Kind == "review" {
			for _, c := range e.Comments {
				if c.ID == id {
					return e.From
				}
			}
		}
	}
	return ""
}

func (s *Server) writeMeta(ss *session) error {
	return state.WriteJSONAtomic(s.paths.Meta(ss.meta.ID), ss.meta)
}

func diffHash(a, b []byte) string { return state.Hash([]byte(state.Hash(a) + state.Hash(b))) }

// ---------- control: create and new versions ----------

type specIn struct {
	Path *string `json:"path"`
	Name string  `json:"name"`
	Src  string  `json:"src"`
}

type sideIn struct {
	Name string  `json:"name"`
	Path *string `json:"path"`
	Src  string  `json:"src"`
}

type diffIn struct {
	A sideIn `json:"a"`
	B sideIn `json:"b"`
}

// SessionIn is the body of POST /control/sessions and /control/sessions/<id>/version.
type SessionIn struct {
	Kind     string  `json:"kind,omitempty"`
	Label    string  `json:"label,omitempty"`
	Spec     *specIn `json:"spec,omitempty"`
	Diff     *diffIn `json:"diff,omitempty"`
	Bindings *string `json:"bindings,omitempty"` // nil: unchanged; a string replaces bindings.txt
}

func checkPath(p *string) error {
	if p != nil && !filepath.IsAbs(*p) {
		return errBadRequest{"path must be absolute: " + *p}
	}
	return nil
}

func (s *Server) create(in SessionIn) (map[string]any, error) {
	switch {
	case in.Kind == "spec" && in.Spec != nil:
		if err := checkPath(in.Spec.Path); err != nil {
			return nil, err
		}
	case in.Kind == "diff" && in.Diff != nil:
	default:
		return nil, errBadRequest{"need kind spec with spec, or kind diff with diff"}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := state.NewID()
	dir := s.paths.Session(id)
	if err := state.MkdirAll(filepath.Join(dir, "versions")); err != nil {
		return nil, err
	}
	now := state.Now()
	ss := &session{subs: map[*sub]struct{}{}, meta: state.Meta{ID: id, Kind: in.Kind, Label: in.Label, Created: now, Updated: now, Version: 1}}
	ev := state.Event{Kind: "version", By: "agent", Version: 1}
	fail := func(err error) (map[string]any, error) { os.RemoveAll(dir); return nil, err }
	if in.Kind == "spec" {
		ss.src = []byte(in.Spec.Src)
		ss.meta.Spec = &state.FileRef{Name: in.Spec.Name, Path: in.Spec.Path}
		ss.meta.Base = state.Hash(ss.src)
		if in.Spec.Path == nil {
			if err := state.WriteAtomic(s.paths.Spec(id), ss.src, 0o600); err != nil {
				return fail(err)
			}
		}
		if err := state.WriteAtomic(s.paths.Version(id, 1), ss.src, 0o600); err != nil {
			return fail(err)
		}
		ev.Path = in.Spec.Path
	} else {
		ss.a, ss.b = []byte(in.Diff.A.Src), []byte(in.Diff.B.Src)
		ss.meta.Diff = &state.DiffRef{A: state.FileRef{Name: in.Diff.A.Name, Path: in.Diff.A.Path}, B: state.FileRef{Name: in.Diff.B.Name, Path: in.Diff.B.Path}}
		ss.meta.Base = diffHash(ss.a, ss.b)
		if err := state.WriteAtomic(s.paths.Side(id, "a"), ss.a, 0o600); err != nil {
			return fail(err)
		}
		if err := state.WriteAtomic(s.paths.Side(id, "b"), ss.b, 0o600); err != nil {
			return fail(err)
		}
	}
	ev.Hash = ss.meta.Base
	if in.Bindings != nil {
		ss.bindings = []byte(*in.Bindings)
		ss.meta.Bindings = true
		if err := state.WriteAtomic(s.paths.Bindings(id), ss.bindings, 0o600); err != nil {
			return fail(err)
		}
	}
	ss.meta.ID = id
	if _, err := s.append(ss, ev); err != nil {
		return fail(err)
	}
	s.restore(ss)
	if err := s.writeMeta(ss); err != nil {
		return fail(err)
	}
	s.sessions[id] = ss
	s.logf("session %s created (%s, %q)", id[:8], in.Kind, in.Label)
	return map[string]any{"id": id, "version": 1, "url": s.url(id, in.Kind)}, nil
}

func samePath(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// newVersion handles POST /control/sessions/<id>/version. Pushing exactly what the session already
// holds (same bytes, path, label and bindings) records nothing and notifies no one (§11).
func (s *Server) newVersion(id string, in SessionIn) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ss, err := s.get(id)
	if err != nil {
		return nil, err
	}
	m := &ss.meta
	if (m.Kind == "spec") != (in.Spec != nil) || (m.Kind == "diff") != (in.Diff != nil) {
		return nil, errBadRequest{fmt.Sprintf("session %s is a %s session", id, m.Kind)}
	}
	if in.Spec != nil {
		if err := checkPath(in.Spec.Path); err != nil {
			return nil, err
		}
		if (m.Spec.Path == nil) != (in.Spec.Path == nil) {
			return nil, errBadRequest{"cannot switch a session between a file and stdin"}
		}
	}
	labelChanged := in.Label != "" && in.Label != m.Label
	bindChanged := in.Bindings != nil && (ss.bindings == nil || string(ss.bindings) != *in.Bindings)
	var hash string
	if in.Spec != nil {
		hash = state.Hash([]byte(in.Spec.Src))
	} else {
		hash = diffHash([]byte(in.Diff.A.Src), []byte(in.Diff.B.Src))
	}
	sameContent := hash == m.Base && (in.Spec == nil || samePath(in.Spec.Path, m.Spec.Path))
	if sameContent && !labelChanged && !bindChanged {
		return map[string]any{"version": m.Version, "url": s.url(id, m.Kind), "tabs": len(ss.subs)}, nil
	}
	if bindChanged {
		if err := state.WriteAtomic(s.paths.Bindings(id), []byte(*in.Bindings), 0o600); err != nil {
			return nil, err
		}
		ss.bindings = []byte(*in.Bindings)
		m.Bindings = true
	}
	n := m.Version + 1
	ev := state.Event{Kind: "version", By: "agent", Version: n, Hash: hash}
	if in.Spec != nil {
		src := []byte(in.Spec.Src)
		if err := state.WriteAtomic(s.paths.Version(id, n), src, 0o600); err != nil {
			return nil, err
		}
		if in.Spec.Path == nil {
			if err := state.WriteAtomic(s.paths.Spec(id), src, 0o600); err != nil {
				return nil, err
			}
		}
		ss.src = src
		m.Spec.Path, ev.Path = in.Spec.Path, in.Spec.Path
		if in.Spec.Name != "" {
			m.Spec.Name = in.Spec.Name
		}
		ss.statKey = ""
	} else {
		a, b := []byte(in.Diff.A.Src), []byte(in.Diff.B.Src)
		if err := state.WriteAtomic(s.paths.Side(id, "a"), a, 0o600); err != nil {
			return nil, err
		}
		if err := state.WriteAtomic(s.paths.Side(id, "b"), b, 0o600); err != nil {
			return nil, err
		}
		ss.a, ss.b = a, b
		m.Diff = &state.DiffRef{A: state.FileRef{Name: in.Diff.A.Name, Path: in.Diff.A.Path}, B: state.FileRef{Name: in.Diff.B.Name, Path: in.Diff.B.Path}}
	}
	if labelChanged {
		m.Label, ev.Label = in.Label, in.Label
	}
	m.Version, m.Base = n, hash
	e, err := s.append(ss, ev)
	if err != nil {
		return nil, err
	}
	if err := s.writeMeta(ss); err != nil {
		return nil, err
	}
	s.broadcast(ss, versionMsg(e), nil)
	return map[string]any{"version": n, "url": s.url(id, m.Kind), "tabs": len(ss.subs)}, nil
}

// ---------- disk polling (§5.4) ----------

// pollDisk records a changed file-backed spec as a new version (by "disk"). Caller holds s.mu.
func (s *Server) pollDisk(ss *session) {
	m := &ss.meta
	if m.Kind != "spec" || m.Spec == nil || m.Spec.Path == nil {
		return
	}
	path := *m.Spec.Path
	fi, err := os.Stat(path)
	if err != nil {
		return // a vanished file is not an error: the session keeps its last version
	}
	key := fmt.Sprintf("%d/%d", fi.Size(), fi.ModTime().UnixNano())
	if key == ss.statKey && fi.Size() > 1<<20 {
		return // large and unchanged since we last hashed it
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	ss.statKey = key
	h := state.Hash(b)
	if h == m.Base {
		return
	}
	n := m.Version + 1
	if err := state.WriteAtomic(s.paths.Version(m.ID, n), b, 0o600); err != nil {
		s.logf("session %s: %v", m.ID[:8], err)
		return
	}
	e, err := s.append(ss, state.Event{Kind: "version", By: "disk", Version: n, Hash: h, Path: m.Spec.Path})
	if err != nil {
		s.logf("session %s: %v", m.ID[:8], err)
		return
	}
	ss.src, m.Version, m.Base = b, n, h
	_ = s.writeMeta(ss)
	s.logf("session %s: %s changed on disk, version %d", m.ID[:8], path, n)
	s.broadcast(ss, versionMsg(e), nil)
}

func (s *Server) pollConnected() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, ss := range s.sessions {
		if len(ss.subs) > 0 {
			s.pollDisk(ss)
		}
	}
}

// ---------- browser writes ----------

type saveIn struct {
	Base  string  `json:"base"`
	Src   *string `json:"src"`
	Tab   string  `json:"tab,omitempty"`
	Force bool    `json:"force,omitempty"` // write even when base is not the current version (the tab asked)
	From  string  `json:"from,omitempty"`  // the session whose page sent it, when not this one
}

// conflict is a 409 on save: the current version, and who made it (agent, user or disk).
type conflict struct {
	Version int    `json:"version"`
	Hash    string `json:"hash"`
	By      string `json:"by"`
}

// lastBy is who made the session's current version: the `by` of its last version or save event.
func (s *Server) lastBy(id string) string {
	evs, _ := state.ReadEvents(s.paths, id)
	for i := len(evs) - 1; i >= 0; i-- {
		if evs[i].Kind == "version" || evs[i].Kind == "save" {
			return evs[i].By
		}
	}
	return "agent"
}

func (conflict) Error() string { return "conflict" }

// writeUserFile writes a file-backed spec atomically, through symlinks, keeping its mode.
func writeUserFile(path string, b []byte) error {
	target := path
	if t, err := filepath.EvalSymlinks(path); err == nil {
		target = t
	}
	mode := os.FileMode(0o644)
	if fi, err := os.Stat(target); err == nil {
		mode = fi.Mode().Perm()
	}
	return state.WriteAtomic(target, b, mode)
}

func (s *Server) save(ss *session, in saveIn, from *sub) (map[string]any, error) {
	m := &ss.meta
	if in.Src == nil || in.Base == "" {
		return nil, errBadRequest{"need base and src"}
	}
	s.pollDisk(ss)
	forced := false
	if in.Base != m.Base {
		if !in.Force {
			return nil, conflict{m.Version, m.Base, s.lastBy(m.ID)}
		}
		forced = true // the user chose to overwrite the newer version; the event says so
	}
	src := []byte(*in.Src)
	if m.Spec.Path != nil {
		if err := writeUserFile(*m.Spec.Path, src); err != nil {
			return nil, err
		}
	} else if err := state.WriteAtomic(s.paths.Spec(m.ID), src, 0o600); err != nil {
		return nil, err
	}
	n, h, prev := m.Version+1, state.Hash(src), m.Base
	if err := state.WriteAtomic(s.paths.Version(m.ID, n), src, 0o600); err != nil {
		return nil, err
	}
	e, err := s.append(ss, state.Event{Kind: "save", By: "user", Version: n, Hash: h, Prev: prev, Path: m.Spec.Path, Force: forced, From: in.From})
	if err != nil {
		return nil, err
	}
	ss.src, m.Version, m.Base, ss.statKey = src, n, h, ""
	_ = s.writeMeta(ss)
	s.broadcast(ss, versionMsg(e), from)
	return map[string]any{"version": n, "hash": h}, nil
}

type commentIn struct {
	Target      string `json:"target"`
	TargetLabel string `json:"targetLabel"`
	Text        string `json:"text"`
	Version     int    `json:"version"`
	Source      string `json:"source"`
	From        string `json:"from"` // the session whose page sent it, when not this one (Event.From)
}

func (s *Server) comment(ss *session, in commentIn) (map[string]any, error) {
	if strings.TrimSpace(in.Text) == "" || in.Target == "" {
		return nil, errBadRequest{"need target and text"}
	}
	m := &ss.meta
	v, h := in.Version, m.Base
	if v <= 0 || v > m.Version {
		v = m.Version
	}
	if v != m.Version && m.Kind == "spec" {
		if b, err := os.ReadFile(s.paths.Version(m.ID, v)); err == nil {
			h = state.Hash(b)
		}
	}
	e := state.Event{Kind: "comment", By: "user", Target: in.Target, TargetLabel: in.TargetLabel, Text: in.Text, Version: v, Hash: h, Source: in.Source, From: in.From}
	e.ID = "c" + strconv.Itoa(ss.seq+1)
	e, err := s.append(ss, e)
	if err != nil {
		return nil, err
	}
	_ = s.writeMeta(ss)
	return map[string]any{"id": e.ID, "seq": e.Seq}, nil
}

func (s *Server) reply(id, to, text string) (map[string]any, error) {
	if strings.TrimSpace(text) == "" {
		return nil, errBadRequest{"empty reply"}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ss, err := s.get(id)
	if err != nil {
		return nil, err
	}
	evs, err := state.ReadEvents(s.paths, id)
	if err != nil {
		return nil, err
	}
	if !hasComment(evs, to) {
		return nil, fmt.Errorf("%w: no comment or review %s in session %s", errNotFound, to, id)
	}
	e, err := s.append(ss, state.Event{Kind: "reply", By: "agent", To: to, Text: text})
	if err != nil {
		return nil, err
	}
	_ = s.writeMeta(ss)
	s.broadcast(ss, replyMsg(e), nil)
	return map[string]any{"seq": e.Seq}, nil
}

// ack marks a comment as taken in, with nothing more to say (DESIGN.md §5.2, ack): the page shows the emoji
// as a reaction on the comment and nothing becomes unread. It is for "got it"; anything the human should
// read is a reply.
func (s *Server) ack(id, to, emoji string) (map[string]any, error) {
	emoji = strings.TrimSpace(emoji)
	if emoji == "" {
		emoji = "👍"
	}
	if utf8.RuneCountInString(emoji) > 8 || strings.ContainsAny(emoji, "<>&\"'\\") || strings.IndexFunc(emoji, func(r rune) bool { return r < 0x20 || r == ' ' }) >= 0 {
		return nil, errBadRequest{"an ack takes one emoji"}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ss, err := s.get(id)
	if err != nil {
		return nil, err
	}
	evs, err := state.ReadEvents(s.paths, id)
	if err != nil {
		return nil, err
	}
	if !hasComment(evs, to) || strings.HasPrefix(to, "n") || strings.HasPrefix(to, "r") {
		return nil, fmt.Errorf("%w: no comment %s in session %s", errNotFound, to, id)
	}
	e, err := s.append(ss, state.Event{Kind: "ack", By: "agent", To: to, Text: emoji})
	if err != nil {
		return nil, err
	}
	_ = s.writeMeta(ss)
	s.broadcast(ss, ackMsg(e), nil)
	return map[string]any{"seq": e.Seq}, nil
}

// note starts a thread on something in the spec, with the agent's words first (DESIGN.md §5.2, note): the
// one thing an agent can say without a comment to answer. The human's answer is a comment on the same
// target, and the agent may add to its own thread with reply (the note's id, n<seq>).
func (s *Server) note(id, target, text string) (map[string]any, error) {
	if strings.TrimSpace(text) == "" {
		return nil, errBadRequest{"empty note"}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ss, err := s.get(id)
	if err != nil {
		return nil, err
	}
	key, label, ok := noteTarget(target, ss.src)
	if !ok {
		return nil, errBadRequest{"no such thing in the spec: " + target + " (a block's name, shape:Name, behavior:Name, or . for the whole file)"}
	}
	e := state.Event{Kind: "note", By: "agent", Target: key, TargetLabel: label, Text: text, Version: ss.meta.Version}
	e.ID = "n" + strconv.Itoa(ss.seq+1)
	if e, err = s.append(ss, e); err != nil {
		return nil, err
	}
	_ = s.writeMeta(ss)
	s.broadcast(ss, noteMsg(e), nil)
	return map[string]any{"id": e.ID, "seq": e.Seq}, nil
}

// noteTarget turns what the agent names into a comment target (the page's keys: block:<id>, msg:<name>,
// beh:<name>, block: for the file) and checks that the spec declares it.
func noteTarget(t string, src []byte) (key, label string, ok bool) {
	t = strings.TrimSpace(t)
	form, name := "block", t
	switch {
	case t == "." || t == "file" || t == "block:":
		return "block:", "the file", true
	case strings.HasPrefix(t, "shape:"), strings.HasPrefix(t, "msg:"):
		form, name = "shape", t[strings.Index(t, ":")+1:]
	case strings.HasPrefix(t, "behavior:"), strings.HasPrefix(t, "beh:"):
		form, name = "behavior", t[strings.Index(t, ":")+1:]
	case strings.HasPrefix(t, "block:"):
		name = t[len("block:"):]
	}
	// A block's name may be a phrase, written in the spec as a string: (block "Test that times out" …).
	if form == "block" && strings.Contains(name, " ") && !strings.ContainsAny(name, "\t\n()\";") {
		name = strings.Join(strings.Fields(name), " ")
		words := strings.Fields(name)
		for i := range words {
			words[i] = regexp.QuoteMeta(words[i])
		}
		if src != nil && !regexp.MustCompile(`\(block\s+"\s*`+strings.Join(words, `\s+`)+`\s*"`).Match(src) {
			return "", "", false
		}
		return "block:" + name, "block " + name, true
	}
	if name == "" || strings.ContainsAny(name, " \t\n()\";") {
		return "", "", false
	}
	last := name[strings.LastIndex(name, ".")+1:]
	if src != nil && !regexp.MustCompile(`\(`+form+`\s+`+regexp.QuoteMeta(last)+`[\s)]`).Match(src) {
		return "", "", false
	}
	return map[string]string{"block": "block:", "shape": "msg:", "behavior": "beh:"}[form] + name, form + " " + name, true
}

func (s *Server) closeSession(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	ss, err := s.get(id)
	if err != nil {
		return err
	}
	s.broadcast(ss, sseMsg{event: "closed", data: "{}"}, nil)
	for c := range ss.subs {
		c.end()
	}
	delete(s.sessions, id)
	s.logf("session %s closed", id[:8])
	// Windows cannot remove files another process holds open; retry briefly.
	for i := 0; ; i++ {
		if err = os.RemoveAll(s.paths.Session(id)); err == nil || i == 20 {
			return err
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// hasComment reports whether to names something a reply may answer: a comment sent on its own (c<seq>),
// a review (r<seq>) or one comment of a review (c<seq>.<k>).
func hasComment(evs []state.Event, to string) bool {
	for _, e := range evs {
		if (e.Kind == "comment" || e.Kind == "review" || e.Kind == "note") && e.ID == to {
			return true
		}
		if e.Kind == "review" {
			for _, c := range e.Comments {
				if c.ID == to {
					return true
				}
			}
		}
	}
	return false
}

// ---------- reviews (§5.2) ----------

type reviewProposalIn struct {
	Src         *string `json:"src"`
	Base        string  `json:"base"`
	BaseVersion int     `json:"baseVersion"`
}

type reviewIn struct {
	Message    string            `json:"message"`
	Comments   []commentIn       `json:"comments"`
	Proposal   *reviewProposalIn `json:"proposal"`
	Supersedes string            `json:"supersedes"`
	Version    int               `json:"version"` // diff sessions: the diff.json version the review is on
	From       string            `json:"from"`    // the session whose page sent it, when not this one
}

// review handles POST /s/<id>/review: one event with the message, the comments and, for a spec
// session, the proposed spec, stored in full in proposals/<seq>.sbtel. A review never writes the spec.
// The diff text is computed outside s.mu (goja takes about a second for a big spec), so the session is
// looked up again afterwards; a session closed meanwhile is a 404.
func (s *Server) review(id string, in reviewIn) (map[string]any, error) {
	in.Message = strings.TrimRight(in.Message, " \t\r\n")
	if strings.TrimSpace(in.Message) == "" {
		in.Message = ""
	}
	for _, c := range in.Comments {
		if strings.TrimSpace(c.Text) == "" || c.Target == "" {
			return nil, errBadRequest{"every comment needs a target and text"}
		}
	}
	s.mu.Lock()
	ss, err := s.get(id)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	var baseSrc []byte
	if in.Proposal != nil {
		p := in.Proposal
		if ss.meta.Kind != "spec" {
			s.mu.Unlock()
			return nil, errBadRequest{"a review of a diff proposes no edits"}
		}
		if p.Src == nil || p.Base == "" || p.BaseVersion < 1 || p.BaseVersion > ss.meta.Version {
			s.mu.Unlock()
			return nil, errBadRequest{"a proposal needs src, base and baseVersion"}
		}
		b, err := os.ReadFile(s.paths.Version(id, p.BaseVersion))
		if err != nil || state.Hash(b) != p.Base {
			s.mu.Unlock()
			return nil, errBadRequest{fmt.Sprintf("the proposal's base is not version %d of this session", p.BaseVersion)}
		}
		baseSrc = b
		if string(b) == *p.Src {
			in.Proposal = nil // no edits after all
		}
	}
	s.mu.Unlock()
	if in.Message == "" && len(in.Comments) == 0 && in.Proposal == nil {
		return nil, errBadRequest{"an empty review: no message, comments or edits"}
	}
	diffText := ""
	if in.Proposal != nil && s.opts.DiffText != nil {
		diffText = s.opts.DiffText(string(baseSrc), *in.Proposal.Src)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if ss, err = s.get(id); err != nil {
		return nil, err
	}
	m := &ss.meta
	seq := ss.seq + 1
	e := state.Event{Kind: "review", By: "user", ID: "r" + strconv.Itoa(seq), Message: in.Message, Version: m.Version, Hash: m.Base, Supersedes: in.Supersedes, From: in.From}
	ids := []string{}
	for k, c := range in.Comments {
		rc := state.ReviewComment{ID: "c" + strconv.Itoa(seq) + "." + strconv.Itoa(k+1), Target: c.Target, TargetLabel: c.TargetLabel, Text: c.Text, Source: c.Source}
		e.Comments = append(e.Comments, rc)
		ids = append(ids, rc.ID)
	}
	var proposal any
	if p := in.Proposal; p != nil {
		path := s.paths.Proposal(id, seq)
		if err := state.MkdirAll(filepath.Dir(path)); err != nil {
			return nil, err
		}
		src := []byte(*p.Src)
		if err := state.WriteAtomic(path, src, 0o600); err != nil {
			return nil, err
		}
		e.Version, e.Hash = p.BaseVersion, p.Base
		e.Proposal = &state.Proposal{Path: path, Hash: state.Hash(src), Base: p.Base, BaseVersion: p.BaseVersion, DiffText: diffText}
		proposal = path
	} else if m.Kind == "diff" && in.Version > 0 && in.Version <= m.Version {
		e.Version = in.Version
	}
	e, err = s.append(ss, e)
	if err != nil {
		if e.Proposal != nil {
			os.Remove(e.Proposal.Path)
		}
		return nil, err
	}
	_ = s.writeMeta(ss)
	return map[string]any{"id": e.ID, "seq": e.Seq, "comments": ids, "proposal": proposal}, nil
}

// seenIDs is the comments and reviews of a session that `sbtel inbox` has handed to an agent (DESIGN.md
// §5.2, seen): those of this session's own inbox up to its cursor; those sent from another session's page
// (Event.From) once that session's cursor has passed its copy; and everything brought from the project
// log (it was heard in an earlier session). A review's comments are seen with it. Caller holds s.mu.
func (s *Server) seenIDs(ss *session) []string {
	id := ss.meta.ID
	evs, _ := state.ReadEvents(s.paths, id)
	cur := state.ReadCursor(s.paths, id)
	out := []string{}
	add := func(e state.Event) {
		out = append(out, e.ID)
		for _, c := range e.Comments {
			out = append(out, c.ID)
		}
	}
	senders := map[string]bool{}
	for _, e := range evs {
		if e.Kind != "comment" && e.Kind != "review" {
			continue
		}
		switch {
		case e.From != "":
			senders[e.From] = true
		case e.Old || e.Seq <= cur:
			add(e)
		}
	}
	for from := range senders {
		pc := state.ReadCursor(s.paths, from)
		pevs, _ := state.ReadEvents(s.paths, from)
		for _, e := range pevs {
			if e.Kind == "ref" && e.Session == id && e.Ref != nil && e.Ref.By == "user" && e.Seq <= pc {
				add(*e.Ref)
			}
		}
	}
	return out
}

// seen tells the tabs of a session, and of every session whose comments reached the agent through this
// one's inbox, what has now been seen. `sbtel inbox` calls it after it moves the cursor.
func (s *Server) seen(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	ss, err := s.get(id)
	if err != nil {
		return err
	}
	tell := map[string]*session{id: ss}
	evs, _ := state.ReadEvents(s.paths, id)
	for _, e := range evs {
		if e.Kind == "ref" && e.Session != "" {
			if o, err := s.get(e.Session); err == nil {
				tell[e.Session] = o
			}
		}
	}
	for _, o := range tell {
		if len(o.subs) > 0 {
			s.broadcast(o, sseMsg{event: "seen", data: mustJSON(map[string]any{"ids": s.seenIDs(o)})}, nil)
		}
	}
	return nil
}
