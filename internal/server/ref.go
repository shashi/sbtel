// @sbtel file Sbtel.Server.Routes
package server

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/shashi/sbtel/internal/state"
)

// GET /s/<id>/ref?path=…  (DESIGN.md §5.9, v0.4): the text of a file that the session's spec names in a
// (ref …) form, for the viewer's file modal. It is the one route that reads a file the user did not hand
// to sbtel, so it is narrow on purpose:
//
//   - only a path the current spec text names in a (ref …), or that a comment, a reply or a review of the
//     session names as (ref …) or as a Markdown link; never one the page merely asks for;
//   - relative to the spec file's directory, with no "..", no absolute path and no dot-file or dot-directory;
//   - inside that directory after symbolic links are resolved; a regular file of at most refMaxBytes;
//   - answered as JSON text ({path, text, size}), or, with raw=1, as the file itself for the few kinds the
//     page shows as they are (refRaw): a picture, a PDF, a calendar invite. Those are sent with their own
//     type and nosniff. Nothing is ever served as HTML, SVG or script, so a referenced file cannot run in
//     the page's origin: the page draws HTML and SVG itself, from the JSON text, in a frame without script.
const refMaxBytes = 2 << 20

// A picture or a PDF is not read as text, so it may be larger.
const refRawMaxBytes = 32 << 20

var refForm = regexp.MustCompile(`\(ref\s+(?:"((?:[^"\\]|\\.)*)"|([^\s()";]+))`)
var refLines = regexp.MustCompile(`^(.+?):\d+(?:-\d+)?$`)

// In a comment or a reply a file is named as in a spec, (ref path), or as a Markdown link, [label](path).
var refLink = regexp.MustCompile(`\]\(([^()\s]+)\)`)
var refImages = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}
var refRaw = map[string]string{".pdf": "application/pdf", ".ics": "text/calendar; charset=utf-8"}

// refFile is the file part of a ref's path as written: without `#anchor` and without `:line` or `:from-to`.
func refFile(p string) string {
	if i := strings.Index(p, "#"); i > 0 {
		p = p[:i]
	}
	if m := refLines.FindStringSubmatch(p); m != nil {
		p = m[1]
	}
	return p
}

// refsIn lists the files that (ref …) forms name in a spec, or in the text of a comment or a reply.
func refsIn(src []byte) map[string]bool {
	out := map[string]bool{}
	refsInto(out, src)
	return out
}

func refsInto(out map[string]bool, src []byte) {
	for _, m := range refForm.FindAllSubmatch(src, -1) {
		p := string(m[2])
		if len(m[1]) > 0 {
			p = strings.NewReplacer(`\"`, `"`, `\\`, `\`).Replace(string(m[1]))
		}
		out[refFile(p)] = true
	}
}

// refsSaid lists the files named in what was said in a session: comments, replies and reviews.
func (s *Server) refsSaid(id string) map[string]bool {
	out := map[string]bool{}
	evs, err := state.ReadEvents(s.paths, id)
	if err != nil {
		return out
	}
	add := func(text string) {
		refsInto(out, []byte(text))
		for _, m := range refLink.FindAllStringSubmatch(text, -1) {
			out[refFile(m[1])] = true
		}
	}
	for _, e := range evs {
		add(e.Text)
		add(e.Message)
		for _, c := range e.Comments {
			add(c.Text)
		}
	}
	return out
}

// resolveRef returns the real path of a referenced file under root, or "" when it may not be served.
func resolveRef(root, rel string) string {
	if rel == "" || filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, `\`) || strings.ContainsRune(rel, 0) {
		return ""
	}
	parts := strings.FieldsFunc(rel, func(r rune) bool { return r == '/' || r == '\\' })
	dropped := isDropped(rel) // .sbtel/files/<name>: the one dot-directory a ref may name
	for i, part := range parts {
		if part == ".." || strings.HasPrefix(part, ".") && part != "." && !(dropped && i == 0) {
			return ""
		}
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return ""
	}
	full, err := filepath.EvalSymlinks(filepath.Join(realRoot, filepath.FromSlash(rel)))
	if err != nil {
		return ""
	}
	if r, err := filepath.Rel(realRoot, full); err != nil || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) || filepath.IsAbs(r) {
		return ""
	}
	for i, part := range strings.Split(strings.TrimPrefix(filepath.ToSlash(strings.TrimPrefix(full, realRoot)), "/"), "/") {
		if strings.HasPrefix(part, ".") && part != "." && !(dropped && i == 0 && part == state.ProjectDirName) { // a link into a dot-directory
			return ""
		}
	}
	return full
}

func (s *Server) serveRef(w http.ResponseWriter, r *http.Request, ss *session) {
	m := &ss.meta
	rel := r.URL.Query().Get("path")
	// A dropped file is served without being named: the page shows it before the comment that names it is sent.
	if m.Spec == nil || m.Spec.Path == nil || !(isDropped(rel) || refsIn(ss.src)[rel] || s.refsSaid(m.ID)[rel]) {
		notFound(w)
		return
	}
	full := resolveRef(filepath.Dir(*m.Spec.Path), rel)
	if full == "" {
		notFound(w)
		return
	}
	info, err := os.Stat(full)
	if err != nil || !info.Mode().IsRegular() {
		notFound(w)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	ext := strings.ToLower(filepath.Ext(full))
	ct, image := refImages[ext]
	pdf := ext == ".pdf"
	if !image {
		ct = refRaw[ext]
	}
	limit := int64(refMaxBytes)
	if image || pdf {
		limit = refRawMaxBytes
	}
	if info.Size() > limit {
		writeJSON(w, 200, map[string]any{"path": rel, "size": info.Size(), "tooLarge": true, "image": image})
		return
	}
	if ct != "" && r.URL.Query().Get("raw") == "1" {
		f, err := os.Open(full)
		if err != nil {
			notFound(w)
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", ct)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Disposition", "inline")
		http.ServeContent(w, r, "", info.ModTime(), f)
		return
	}
	if image || pdf {
		writeJSON(w, 200, map[string]any{"path": rel, "size": info.Size(), "image": image, "pdf": pdf, "raw": true})
		return
	}
	b, err := os.ReadFile(full)
	if err != nil {
		notFound(w)
		return
	}
	if !utf8.Valid(b) || strings.ContainsRune(string(b), 0) {
		writeJSON(w, 200, map[string]any{"path": rel, "size": len(b), "binary": true})
		return
	}
	writeJSON(w, 200, map[string]any{"path": rel, "size": len(b), "text": string(b), "raw": ct != ""})
}

// isDropped says whether rel is a file in the project's own files folder: .sbtel/files/<name>, one level deep.
func isDropped(rel string) bool {
	name := strings.TrimPrefix(filepath.ToSlash(rel), state.ProjectFilesRel+"/")
	return name != filepath.ToSlash(rel) && name != "" && !strings.ContainsAny(name, `/\`) && !strings.HasPrefix(name, ".")
}

// POST /s/<id>/file {name, data}  (DESIGN.md §5.2, v0.4): a file dropped onto the diagram or pasted into a
// comment. data is the file's bytes in base64. It is written to `.sbtel/files/` beside the spec and
// nowhere else, under a cleaned name, never over a file with other contents; the answer is the path a
// (ref …) names. A spec from stdin has no directory, so it takes no files.
const (
	fileMaxBytes  = 16 << 20
	fileBodyLimit = fileMaxBytes*4/3 + 4096
)

type fileIn struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

var fileNameBad = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// cleanFileName keeps a dropped file's base name to letters, digits, dot, dash and underscore, without a
// leading dot, at most 80 characters: a name that needs no quoting in a ref and cannot leave its folder.
func cleanFileName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, `\`, "/"))
	name = strings.Trim(fileNameBad.ReplaceAllString(name, "-"), "-.")
	if len(name) > 80 {
		ext := filepath.Ext(name)
		if len(ext) > 12 {
			ext = ""
		}
		name = strings.TrimRight(name[:80-len(ext)], "-.") + ext
	}
	if name == "" {
		name = "file"
	}
	return name
}

func (s *Server) saveFile(ss *session, in fileIn) (map[string]any, error) {
	m := &ss.meta
	if m.Spec == nil || m.Spec.Path == nil {
		return nil, &httpError{http.StatusConflict, "this spec was read from stdin, so it has no folder to keep files in"}
	}
	b, err := base64.StdEncoding.DecodeString(in.Data)
	if err != nil {
		return nil, &httpError{http.StatusBadRequest, "data is not base64"}
	}
	if len(b) > fileMaxBytes {
		return nil, &httpError{http.StatusRequestEntityTooLarge, "the file is larger than 16 MB"}
	}
	dir := state.ProjectFiles(*m.Spec.Path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	state.EnsureIgnored(*m.Spec.Path) // best effort: open already did it
	name := cleanFileName(in.Name)
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; i < 1000; i++ {
		if i > 1 {
			name = stem + "-" + strconv.Itoa(i) + ext
		}
		full := filepath.Join(dir, name)
		old, err := os.ReadFile(full)
		if err == nil && string(old) == string(b) { // the same file, dropped again
			return map[string]any{"path": state.ProjectFilesRel + "/" + name, "size": len(b), "existed": true}, nil
		}
		if err == nil {
			continue
		}
		f, err := os.OpenFile(full, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			if os.IsExist(err) {
				continue
			}
			return nil, err
		}
		_, werr := f.Write(b)
		if cerr := f.Close(); werr == nil {
			werr = cerr
		}
		if werr != nil {
			return nil, werr
		}
		return map[string]any{"path": state.ProjectFilesRel + "/" + name, "size": len(b)}, nil
	}
	return nil, &httpError{http.StatusConflict, "too many files with that name"}
}

// GET /s/<id>/open?path=…  (DESIGN.md §5.2, v0.4): a ref to another spec opens as a diagram. The path
// passes the same tests as a file to read (named in this session, inside the spec's directory) and must
// end in .sbtel. The answer is a redirect to a session on that file: the one that already shows it, else
// a new one. The page opens it in a new tab.
func (s *Server) openRef(id, rel string) (string, error) {
	s.mu.Lock()
	ss, err := s.get(id)
	if err != nil {
		s.mu.Unlock()
		return "", err
	}
	m := &ss.meta
	full := ""
	if m.Kind == "spec" && m.Spec != nil && m.Spec.Path != nil && strings.EqualFold(filepath.Ext(rel), ".sbtel") {
		s.pollDisk(ss)
		if refsIn(ss.src)[rel] || s.refsSaid(m.ID)[rel] {
			full = resolveRef(filepath.Dir(*m.Spec.Path), rel)
		}
	}
	if info, err := os.Stat(full); full == "" || err != nil || !info.Mode().IsRegular() || info.Size() > refMaxBytes {
		s.mu.Unlock()
		return "", errNotFound
	}
	// A session that already shows this file: the most recently used one.
	found, when := "", ""
	ids, _ := state.ListIDs(s.paths)
	for _, oid := range ids {
		o, err := s.get(oid)
		if err != nil || o.meta.Kind != "spec" || o.meta.Spec == nil || o.meta.Spec.Path == nil {
			continue
		}
		p := *o.meta.Spec.Path
		if real, err := filepath.EvalSymlinks(p); err == nil {
			p = real
		}
		if p == full && o.meta.Updated >= when {
			found, when = oid, o.meta.Updated
		}
	}
	s.mu.Unlock()
	if found != "" {
		return s.url(found, "spec"), nil
	}
	b, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	name := filepath.Base(full)
	out, err := s.create(SessionIn{Kind: "spec", Label: name, Spec: &specIn{Path: &full, Name: name, Src: string(b)}})
	if err != nil {
		return "", err
	}
	return out["url"].(string), nil
}
