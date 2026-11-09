// @sbtel file Sbtel.Server.Fanout

package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/shashi/sbtel/internal/state"
)

type sseMsg struct {
	id    int // 0: no id line
	event string
	data  string
}

// sub is one SSE connection (one tab).
type sub struct {
	ch   chan sseMsg
	tab  string
	done chan struct{}
	once sync.Once
}

func (c *sub) end() { c.once.Do(func() { close(c.done) }) }

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func versionMsg(e state.Event) sseMsg {
	d := map[string]any{"version": e.Version, "hash": e.Hash, "by": e.By}
	if e.Label != "" {
		d["label"] = e.Label
	}
	return sseMsg{id: e.Seq, event: "version", data: mustJSON(d)}
}

func replyMsg(e state.Event) sseMsg {
	return sseMsg{id: e.Seq, event: "reply", data: mustJSON(map[string]any{"to": e.To, "text": e.Text, "seq": e.Seq, "at": e.At})}
}

// broadcast sends m to every tab of ss except `except`. A tab that cannot keep up is dropped (it
// reconnects with Last-Event-ID and gets the replay). Caller holds s.mu.
func (s *Server) broadcast(ss *session, m sseMsg, except *sub) {
	for c := range ss.subs {
		if c == except {
			continue
		}
		select {
		case c.ch <- m:
		default:
			c.end()
		}
	}
}

func (s *Server) closeAllSubs() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, ss := range s.sessions {
		for c := range ss.subs {
			c.end()
		}
	}
}

// findSub returns the open connection of tab `tab` in ss, if any. Caller holds s.mu.
func findSub(ss *session, tab string) *sub {
	if tab == "" {
		return nil
	}
	for c := range ss.subs {
		if c.tab == tab {
			return c
		}
	}
	return nil
}

func writeSSE(w http.ResponseWriter, m sseMsg) error {
	var err error
	if m.id > 0 {
		_, err = fmt.Fprintf(w, "id: %d\n", m.id)
	}
	if err == nil {
		_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", m.event, m.data)
	}
	return err
}

// events serves GET /s/<id>/events. The replay point is Last-Event-ID, or the `after` query
// parameter for a client that opens a fresh EventSource; `tab` names the tab so that its own saves
// are not echoed back to it.
func (s *Server) events(w http.ResponseWriter, r *http.Request, id string) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "", http.StatusInternalServerError)
		return
	}
	after := -1
	if v := r.Header.Get("Last-Event-ID"); v != "" {
		after, _ = strconv.Atoi(v)
	} else if v := r.URL.Query().Get("after"); v != "" {
		after, _ = strconv.Atoi(v)
	}
	s.mu.Lock()
	ss, err := s.get(id)
	if err != nil {
		s.mu.Unlock()
		notFound(w)
		return
	}
	s.pollDisk(ss)
	c := &sub{ch: make(chan sseMsg, 256), tab: r.URL.Query().Get("tab"), done: make(chan struct{})}
	hello := sseMsg{event: "hello", data: mustJSON(map[string]any{"version": ss.meta.Version, "hash": ss.meta.Base, "seq": ss.seq})}
	var replay []sseMsg
	if after >= 0 && after < ss.seq {
		evs, _ := state.ReadEvents(s.paths, id)
		for _, e := range evs {
			if e.Seq <= after {
				continue
			}
			switch e.Kind {
			case "reply":
				replay = append(replay, replyMsg(e))
			case "version", "save":
				replay = append(replay, versionMsg(e))
			}
		}
	}
	ss.subs[c] = struct{}{}
	s.clients.Add(1)
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(ss.subs, c)
		s.mu.Unlock()
		s.clients.Add(-1)
		s.touch()
	}()

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "retry: 3000\n\n")
	if writeSSE(w, hello) != nil {
		return
	}
	for _, m := range replay {
		if writeSSE(w, m) != nil {
			return
		}
	}
	fl.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case m := <-c.ch:
			if writeSSE(w, m) != nil {
				return
			}
			fl.Flush()
			if m.event == "closed" {
				return
			}
		case <-ping.C:
			if _, err := fmt.Fprint(w, ":ping\n\n"); err != nil {
				return
			}
			fl.Flush()
		case <-c.done:
			// drain what was queued before the end (a `closed` message, typically)
			for {
				select {
				case m := <-c.ch:
					if writeSSE(w, m) != nil {
						return
					}
				default:
					fl.Flush()
					return
				}
			}
		case <-r.Context().Done():
			return
		}
	}
}
