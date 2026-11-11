// @sbtel file Sbtel.State

// Package state is the on-disk layout of $SBTEL_HOME (docs/DESIGN.md §4): paths, atomic writes,
// server.json, session meta, the events log and the inbox cursor.
//
// Single-writer rule (§4): only the server process writes session files, except cursor.json, which
// only `sbtel inbox` writes. Readers tolerate a half-written last line in events.jsonl.
package state

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"time"
)

// Home is $SBTEL_HOME, else ~/.sbtel (%USERPROFILE%\.sbtel on Windows).
func Home() (string, error) {
	if h := os.Getenv("SBTEL_HOME"); h != "" {
		return filepath.Abs(h)
	}
	var d string
	if runtime.GOOS == "windows" {
		d = os.Getenv("USERPROFILE")
	}
	if d == "" {
		var err error
		if d, err = os.UserHomeDir(); err != nil {
			return "", fmt.Errorf("no home directory (set SBTEL_HOME): %v", err)
		}
	}
	return filepath.Join(d, ".sbtel"), nil
}

var idRe = regexp.MustCompile(`^[0-9a-f]{32}$`)

// ValidID reports whether s is a well-formed session id (32 lowercase hex). It guards every path
// built from an id, so no id can escape sessions/.
func ValidID(s string) bool { return idRe.MatchString(s) }

// NewID returns 128 random bits from crypto/rand as 32 lowercase hex characters.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("crypto/rand: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}

// Hash is the sha256 hex of b (meta.base, event hashes, save bases).
func Hash(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// Now is an RFC3339 UTC time with milliseconds.
func Now() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00") }

// Paths under one home.
type Paths struct{ Home string }

func (p Paths) ServerJSON() string        { return filepath.Join(p.Home, "server.json") }
func (p Paths) ServerLog() string         { return filepath.Join(p.Home, "server.log") }
func (p Paths) Sessions() string          { return filepath.Join(p.Home, "sessions") }
func (p Paths) Session(id string) string  { return filepath.Join(p.Home, "sessions", id) }
func (p Paths) Meta(id string) string     { return filepath.Join(p.Session(id), "meta.json") }
func (p Paths) Events(id string) string   { return filepath.Join(p.Session(id), "events.jsonl") }
func (p Paths) Cursor(id string) string   { return filepath.Join(p.Session(id), "cursor.json") }
func (p Paths) Spec(id string) string     { return filepath.Join(p.Session(id), "spec.sbtel") }
func (p Paths) Bindings(id string) string { return filepath.Join(p.Session(id), "bindings.txt") }
func (p Paths) Side(id, side string) string {
	return filepath.Join(p.Session(id), side+".sbtel")
}
func (p Paths) Version(id string, n int) string {
	return filepath.Join(p.Session(id), "versions", fmt.Sprintf("%d.sbtel", n))
}

// Proposal is the proposed spec of the review event with sequence number seq (§4.3).
func (p Paths) Proposal(id string, seq int) string {
	return filepath.Join(p.Session(id), "proposals", fmt.Sprintf("%d.sbtel", seq))
}

// MkdirAll creates dir (and parents) with mode 0700.
func MkdirAll(dir string) error { return os.MkdirAll(dir, 0o700) }

// WriteAtomic writes <path>.tmp in the same directory, then renames it over path.
func WriteAtomic(path string, data []byte, mode os.FileMode) error {
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		_ = os.Chmod(tmp, mode) // the umask may have narrowed it; keep the caller's mode
		err = os.Rename(tmp, path)
	}
	if err != nil {
		os.Remove(tmp)
	}
	return err
}

// WriteJSONAtomic marshals v (indented) and writes it atomically with mode 0600.
func WriteJSONAtomic(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return WriteAtomic(path, append(b, '\n'), 0o600)
}

// ---------- server.json ----------

// ServerInfo is server.json (§4.2).
type ServerInfo struct {
	PID     int    `json:"pid"`
	Port    int    `json:"port"`
	Version string `json:"version"`
	Started string `json:"started"`
	Token   string `json:"token"`
}

// ReadServer reads server.json. A missing file is (nil, nil).
func ReadServer(p Paths) (*ServerInfo, error) {
	b, err := os.ReadFile(p.ServerJSON())
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var s ServerInfo
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, fmt.Errorf("%s: %v", p.ServerJSON(), err)
	}
	return &s, nil
}

// ---------- meta.json ----------

// FileRef names a spec input: Path is absolute, or nil for stdin.
type FileRef struct {
	Name string  `json:"name"`
	Path *string `json:"path"`
}

// DiffRef holds the two sides of a diff session.
type DiffRef struct {
	A FileRef `json:"a"`
	B FileRef `json:"b"`
}

// Meta is meta.json (§4.1).
type Meta struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind"` // "spec" | "diff"
	Label    string   `json:"label"`
	Created  string   `json:"created"`
	Updated  string   `json:"updated"`
	Spec     *FileRef `json:"spec,omitempty"`
	Diff     *DiffRef `json:"diff,omitempty"`
	Version  int      `json:"version"`
	Base     string   `json:"base"`
	Bindings bool     `json:"bindings"`
}

// ReadMeta reads sessions/<id>/meta.json. An invalid id or a missing session is os.ErrNotExist.
func ReadMeta(p Paths, id string) (*Meta, error) {
	if !ValidID(id) {
		return nil, os.ErrNotExist
	}
	b, err := os.ReadFile(p.Meta(id))
	if err != nil {
		return nil, err
	}
	var m Meta
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("%s: %v", p.Meta(id), err)
	}
	return &m, nil
}

// ListIDs returns the ids of every session directory with a meta.json.
func ListIDs(p Paths) ([]string, error) {
	ents, err := os.ReadDir(p.Sessions())
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, e := range ents {
		if e.IsDir() && ValidID(e.Name()) {
			if _, err := os.Stat(p.Meta(e.Name())); err == nil {
				ids = append(ids, e.Name())
			}
		}
	}
	return ids, nil
}

// ---------- events.jsonl ----------

// Event is one line of events.jsonl (§4.3). Which fields are present depends on Kind; see
// MarshalJSON. Path is a pointer so that `path: null` round-trips.
type Event struct {
	Seq  int    `json:"seq"`
	Kind string `json:"kind"` // version | comment | reply | save | review
	By   string `json:"by"`   // agent | user | disk
	At   string `json:"at"`

	Version int     `json:"version,omitempty"`
	Hash    string  `json:"hash,omitempty"`
	Path    *string `json:"path"`
	Label   string  `json:"label,omitempty"`

	ID          string `json:"id,omitempty"`
	Target      string `json:"target,omitempty"`
	TargetLabel string `json:"targetLabel,omitempty"`
	Text        string `json:"text,omitempty"`
	Source      string `json:"source,omitempty"`

	To    string `json:"to,omitempty"`
	Prev  string `json:"prev,omitempty"`
	Force bool   `json:"force,omitempty"` // save: written over a newer version than the tab's base

	// review: an overall message, its comments and, with edits, the proposed spec.
	Message    string          `json:"message,omitempty"`
	Comments   []ReviewComment `json:"comments,omitempty"`
	Proposal   *Proposal       `json:"proposal,omitempty"`
	Supersedes string          `json:"supersedes,omitempty"` // the review whose proposal this one replaces

	// From is the session whose page sent a comment, review or save, when that is not this session: a
	// spec shown inside another spec's page (a ref to an .sbtel file). That session's inbox gets it.
	From string `json:"from,omitempty"`
	// ref: an event of another session, copied here because it was sent from this session's page (or
	// answers something that was). Session and File say where it happened; Ref is the event there.
	Session string `json:"session,omitempty"`
	File    string `json:"file,omitempty"`
	Ref     *Event `json:"ref,omitempty"`

	// Old marks a comment, review or reply brought into a new session from the project's comment log
	// (ReadProjectComments): it was said, and heard, in an earlier session.
	Old bool `json:"old,omitempty"`
	// Origins, on an old comment or review: for its id and its comments' ids here, the "session/id" they
	// have in the project log, so a reply made here is logged against what it answers.
	Origins map[string]string `json:"origins,omitempty"`
}

// ReviewComment is one comment of a review: the fields of a comment event, with the id c<seq>.<k>.
type ReviewComment struct {
	ID          string `json:"id"`
	Target      string `json:"target"`
	TargetLabel string `json:"targetLabel"`
	Text        string `json:"text"`
	Source      string `json:"source"`
}

// Proposal is a review's proposed spec: the file the server stored it in, its hash, the version it was
// made against, and `sbtel diff` of that version and the proposal.
type Proposal struct {
	Path        string `json:"path"`
	Hash        string `json:"hash"`
	Base        string `json:"base"`
	BaseVersion int    `json:"baseVersion"`
	DiffText    string `json:"diffText"`
}

// MarshalJSON writes exactly the fields §4.3 lists for the event's kind.
func (e Event) MarshalJSON() ([]byte, error) {
	m := map[string]any{"seq": e.Seq, "kind": e.Kind, "by": e.By, "at": e.At}
	switch e.Kind {
	case "version":
		m["version"], m["hash"], m["path"] = e.Version, e.Hash, e.Path
		if e.Label != "" {
			m["label"] = e.Label
		}
	case "comment":
		m["id"], m["target"], m["targetLabel"], m["text"] = e.ID, e.Target, e.TargetLabel, e.Text
		m["version"], m["hash"], m["source"] = e.Version, e.Hash, e.Source
	case "note": // a thread the agent started (sbtel note)
		m["id"], m["target"], m["targetLabel"], m["text"], m["version"] = e.ID, e.Target, e.TargetLabel, e.Text, e.Version
	case "ack": // the agent took a comment in, with nothing more to say (sbtel ack); text is the emoji
		m["to"], m["text"] = e.To, e.Text
	case "reply":
		m["to"], m["text"] = e.To, e.Text
	case "save":
		m["version"], m["hash"], m["prev"], m["path"] = e.Version, e.Hash, e.Prev, e.Path
		if e.Force {
			m["force"] = true
		}
	case "review":
		m["id"], m["message"], m["version"], m["hash"] = e.ID, e.Message, e.Version, e.Hash
		cs := e.Comments
		if cs == nil {
			cs = []ReviewComment{}
		}
		m["comments"], m["proposal"] = cs, e.Proposal
		if e.Supersedes != "" {
			m["supersedes"] = e.Supersedes
		}
	case "ref":
		m["session"], m["file"], m["ref"] = e.Session, e.File, e.Ref
	}
	if e.From != "" {
		m["from"] = e.From
	}
	if e.Old {
		m["old"] = true
		if len(e.Origins) > 0 {
			m["origins"] = e.Origins
		}
	}
	if e.Session != "" && e.Kind != "ref" { // the project log says which session each line is from
		m["session"] = e.Session
	}
	return json.Marshal(m)
}

// IsUser reports whether the event is one `inbox` shows: something the user sent (a comment sent on its
// own, a review or a save). A draft review lives in the tab only, so nothing pending is ever an event.
// What was sent from another session's page is that session's to hear (it has a ref event for it), not this one's.
func (e Event) IsUser() bool {
	if e.Kind == "ref" {
		return e.Ref != nil && e.Ref.By == "user"
	}
	return (e.Kind == "comment" || e.Kind == "save" || e.Kind == "review") && e.From == "" && !e.Old
}

// ReadEvents reads every complete line of events.jsonl. A trailing line without its newline
// (a write in progress) is ignored. A missing file is no events.
func ReadEvents(p Paths, id string) ([]Event, error) {
	b, err := os.ReadFile(p.Events(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if i := bytes.LastIndexByte(b, '\n'); i >= 0 {
		b = b[:i+1]
	} else {
		b = nil
	}
	var out []Event
	sc := bufio.NewScanner(bytes.NewReader(b))
	sc.Buffer(make([]byte, 1<<20), 1<<30)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var e Event
		if err := json.Unmarshal(line, &e); err != nil {
			return out, fmt.Errorf("%s line %d: %v", p.Events(id), len(out)+1, err)
		}
		out = append(out, e)
	}
	return out, sc.Err()
}

// AppendEvent appends one event line (one write call, O_APPEND).
func AppendEvent(p Paths, id string, e Event) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(p.Events(id), os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	_, err = f.Write(append(b, '\n'))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}

// ---------- cursor.json ----------

// ReadCursor returns the read cursor (0 when there is none).
func ReadCursor(p Paths, id string) int {
	b, err := os.ReadFile(p.Cursor(id))
	if err != nil {
		return 0
	}
	var c struct {
		Read int `json:"read"`
	}
	if json.Unmarshal(b, &c) != nil {
		return 0
	}
	return c.Read
}

// WriteCursor writes cursor.json. Only `inbox` calls it.
func WriteCursor(p Paths, id string, seq int) error {
	return WriteJSONAtomic(p.Cursor(id), map[string]int{"read": seq})
}
