// @sbtel file Sbtel.Server.Routes

package server

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/shashi/sbtel/internal/state"
)

const (
	// One limit for browser writes and control bodies (§5.2), so a tab can save any spec an agent can
	// push. viewer/src/server.js checks the same number (SAVE_LIMIT) before it posts a save.
	browserBodyLimit = 64 << 20
	controlBodyLimit = 64 << 20 // agents may push big specs
)

func notFound(w http.ResponseWriter) { w.WriteHeader(http.StatusNotFound) }

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) hostOK(host string) bool {
	p := strconv.Itoa(s.port)
	return host == "127.0.0.1:"+p || host == "localhost:"+p
}

func (s *Server) originOK(o string) bool {
	p := strconv.Itoa(s.port)
	return o == "http://127.0.0.1:"+p || o == "http://localhost:"+p
}

// ServeHTTP applies the §5.2 rules to every request, then routes it.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	if !s.hostOK(r.Host) {
		w.WriteHeader(http.StatusMisdirectedRequest) // 421: DNS rebinding or a stray client
		return
	}
	s.touch()
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusMethodNotAllowed) // no CORS, ever
		return
	}
	path := r.URL.Path
	if strings.HasPrefix(path, "/control/") {
		s.control(w, r, strings.TrimPrefix(path, "/control/"))
		return
	}
	if strings.HasPrefix(path, "/s/") {
		rest := path[len("/s/"):]
		id, sub, ok := strings.Cut(rest, "/")
		if !ok || !state.ValidID(id) {
			notFound(w)
			return
		}
		s.browser(w, r, id, sub)
		return
	}
	notFound(w)
}

// decode reads a JSON body under a size limit. It writes the error response itself.
func decode(w http.ResponseWriter, r *http.Request, limit int64, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	b, err := io.ReadAll(r.Body)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request body is larger than " + strconv.FormatInt(limit>>20, 10) + " MiB"})
		} else {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		return false
	}
	if err := json.Unmarshal(b, v); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad JSON: " + err.Error()})
		return false
	}
	return true
}

func (s *Server) fail(w http.ResponseWriter, err error) {
	var br errBadRequest
	var cf conflict
	switch {
	case errors.As(err, &cf):
		writeJSON(w, http.StatusConflict, cf)
	case errors.Is(err, errNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": strings.TrimPrefix(err.Error(), errNotFound.Error()+": ")})
	case errors.As(err, &br):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": br.msg})
	default:
		s.logf("error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}

// ---------- browser API (§5.2) ----------

func (s *Server) browser(w http.ResponseWriter, r *http.Request, id, route string) {
	if r.Method == http.MethodPost {
		if !s.originOK(r.Header.Get("Origin")) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
	} else if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if route == "events" && r.Method == http.MethodGet {
		s.events(w, r, id)
		return
	}
	if route == "review" && r.Method == http.MethodPost {
		var in reviewIn
		if !decode(w, r, browserBodyLimit, &in) {
			return
		}
		out, err := s.review(id, in) // takes s.mu itself: the diff text is computed outside the lock
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, 200, out)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ss, err := s.get(id)
	if err != nil {
		if !errors.Is(err, errNotFound) {
			s.logf("session %s: %v", id, err)
		}
		notFound(w)
		return
	}
	m := &ss.meta
	isGet := r.Method != http.MethodPost
	switch {
	case route == "" && isGet, route == "diff" && isGet:
		if want := map[string]string{"spec": "", "diff": "diff"}[m.Kind]; want != route {
			http.Redirect(w, r, "/s/"+id+"/"+want, http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, s.opts.ViewerHTML)
	case route == "meta" && isGet:
		s.pollDisk(ss)
		out := map[string]any{"id": id, "kind": m.Kind, "label": m.Label, "version": m.Version, "hash": m.Base,
			"bindings": m.Bindings, "serverVersion": s.opts.Version, "name": m.Label, "path": nil}
		if m.Spec != nil {
			out["name"], out["path"] = m.Spec.Name, m.Spec.Path
		}
		writeJSON(w, 200, out)
	case route == "spec" && isGet && m.Kind == "spec":
		s.pollDisk(ss)
		writeJSON(w, 200, map[string]any{"version": m.Version, "hash": m.Base, "name": m.Spec.Name, "src": string(ss.src)})
	case route == "diff.json" && isGet && m.Kind == "diff":
		side := func(f state.FileRef, b []byte) map[string]any {
			return map[string]any{"name": f.Name, "label": f.Name, "path": f.Path, "src": string(b), "hash": state.Hash(b)}
		}
		writeJSON(w, 200, map[string]any{"a": side(m.Diff.A, ss.a), "b": side(m.Diff.B, ss.b), "version": m.Version, "hash": m.Base, "label": m.Label})
	case strings.HasPrefix(route, "versions/") && isGet && m.Kind == "spec":
		n, err := strconv.Atoi(strings.TrimPrefix(route, "versions/"))
		if err != nil || n < 1 || n > m.Version || strconv.Itoa(n) != strings.TrimPrefix(route, "versions/") {
			notFound(w)
			return
		}
		b, err := os.ReadFile(s.paths.Version(id, n))
		if err != nil {
			notFound(w)
			return
		}
		writeJSON(w, 200, map[string]any{"version": n, "hash": state.Hash(b), "src": string(b)})
	case route == "bindings" && isGet:
		if ss.bindings == nil {
			notFound(w)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write(ss.bindings)
	case route == "log" && isGet:
		evs, err := state.ReadEvents(s.paths, id)
		if err != nil {
			s.fail(w, err)
			return
		}
		if evs == nil {
			evs = []state.Event{}
		}
		writeJSON(w, 200, map[string]any{"events": evs})
	case route == "save" && !isGet:
		if m.Kind != "spec" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var in saveIn
		if !decode(w, r, browserBodyLimit, &in) {
			return
		}
		out, err := s.save(ss, in, findSub(ss, in.Tab))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, 200, out)
	case route == "comment" && !isGet:
		var in commentIn
		if !decode(w, r, browserBodyLimit, &in) {
			return
		}
		out, err := s.comment(ss, in)
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, 200, out)
	default:
		notFound(w)
	}
}

// ---------- control API (§5.3) ----------

func (s *Server) control(w http.ResponseWriter, r *http.Request, route string) {
	if r.Header.Get("Origin") != "" || !s.authOK(r) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	get, post := r.Method == http.MethodGet, r.Method == http.MethodPost
	switch {
	case route == "status" && get:
		ids, _ := state.ListIDs(s.paths)
		writeJSON(w, 200, map[string]any{"pid": os.Getpid(), "port": s.port, "version": s.opts.Version, "started": s.start,
			"sessions": len(ids), "clients": s.clients.Load()})
	case route == "stop" && post:
		writeJSON(w, 200, map[string]any{})
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		go s.Stop()
	case route == "sessions" && get:
		s.mu.Lock()
		list := []map[string]any{}
		for id, ss := range s.sessions {
			list = append(list, map[string]any{"id": id, "tabs": len(ss.subs)})
		}
		s.mu.Unlock()
		writeJSON(w, 200, map[string]any{"sessions": list})
	case route == "sessions" && post:
		var in SessionIn
		if !decode(w, r, controlBodyLimit, &in) {
			return
		}
		out, err := s.create(in)
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, 200, out)
	case strings.HasPrefix(route, "sessions/") && post:
		id, action, _ := strings.Cut(strings.TrimPrefix(route, "sessions/"), "/")
		if !state.ValidID(id) {
			writeJSON(w, 404, map[string]string{"error": "no session " + id})
			return
		}
		var out any
		var err error
		switch action {
		case "version":
			var in SessionIn
			if !decode(w, r, controlBodyLimit, &in) {
				return
			}
			out, err = s.newVersion(id, in)
		case "reply":
			var in struct{ To, Text string }
			if !decode(w, r, controlBodyLimit, &in) {
				return
			}
			out, err = s.reply(id, in.To, in.Text)
		case "close":
			err = s.closeSession(id)
			out = map[string]any{}
		default:
			notFound(w)
			return
		}
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, 200, out)
	default:
		notFound(w)
	}
}
