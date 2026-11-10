// @sbtel file Sbtel.Server.Routes
package server

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

// GET /s/<id>/ref?path=…  (DESIGN.md §5.9, v0.4): the text of a file that the session's spec names in a
// (ref …) form, for the viewer's file modal. It is the one route that reads a file the user did not hand
// to sbtel, so it is narrow on purpose:
//
//   - only a path the current spec text names in a (ref …), never one the page merely asks for;
//   - relative to the spec file's directory, with no "..", no absolute path and no dot-file or dot-directory;
//   - inside that directory after symbolic links are resolved; a regular file of at most refMaxBytes;
//   - answered as JSON text ({path, text, size}), or, with raw=1 and an image extension, as that image.
//     Nothing is ever served as HTML or script, so a referenced file cannot run in the page's origin.
const refMaxBytes = 2 << 20

var refForm = regexp.MustCompile(`\(ref\s+(?:"((?:[^"\\]|\\.)*)"|([^\s()";]+))`)
var refLines = regexp.MustCompile(`^(.+?):\d+(?:-\d+)?$`)
var refImages = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}

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

// refsIn lists the files a spec's (ref …) forms name.
func refsIn(src []byte) map[string]bool {
	out := map[string]bool{}
	for _, m := range refForm.FindAllSubmatch(src, -1) {
		p := string(m[2])
		if len(m[1]) > 0 {
			p = strings.NewReplacer(`\"`, `"`, `\\`, `\`).Replace(string(m[1]))
		}
		out[refFile(p)] = true
	}
	return out
}

// resolveRef returns the real path of a referenced file under root, or "" when it may not be served.
func resolveRef(root, rel string) string {
	if rel == "" || filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, `\`) || strings.ContainsRune(rel, 0) {
		return ""
	}
	for _, part := range strings.FieldsFunc(rel, func(r rune) bool { return r == '/' || r == '\\' }) {
		if part == ".." || strings.HasPrefix(part, ".") && part != "." {
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
	for _, part := range strings.Split(filepath.ToSlash(strings.TrimPrefix(full, realRoot)), "/") {
		if strings.HasPrefix(part, ".") && part != "." { // a link into a dot-directory
			return ""
		}
	}
	return full
}

func (s *Server) serveRef(w http.ResponseWriter, r *http.Request, ss *session) {
	m := &ss.meta
	rel := r.URL.Query().Get("path")
	if m.Spec == nil || m.Spec.Path == nil || !refsIn(ss.src)[rel] {
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
	ct, image := refImages[strings.ToLower(filepath.Ext(full))]
	if info.Size() > refMaxBytes {
		writeJSON(w, 200, map[string]any{"path": rel, "size": info.Size(), "tooLarge": true, "image": image})
		return
	}
	b, err := os.ReadFile(full)
	if err != nil {
		notFound(w)
		return
	}
	if image && r.URL.Query().Get("raw") == "1" {
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Content-Disposition", "inline")
		w.Write(b)
		return
	}
	if image {
		writeJSON(w, 200, map[string]any{"path": rel, "size": len(b), "image": true})
		return
	}
	if !utf8.Valid(b) || strings.ContainsRune(string(b), 0) {
		writeJSON(w, 200, map[string]any{"path": rel, "size": len(b), "binary": true})
		return
	}
	writeJSON(w, 200, map[string]any{"path": rel, "size": len(b), "text": string(b)})
}
