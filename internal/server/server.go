// @sbtel file Sbtel.Server.Core

// Package server is the shared localhost server (docs/DESIGN.md §5): lifecycle, the browser API
// under /s/<id>/, the token-authenticated control API under /control/, SSE, and disk polling. It is
// the only writer of session files (§4). client.go holds the CLI side: health checks, starting a
// detached server, and control requests.
package server

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/shashi/sbtel/internal/state"
)

// Options configure Run.
type Options struct {
	Home       string        // $SBTEL_HOME (absolute)
	Port       int           // with PortSet: bind exactly this port (0 = random)
	PortSet    bool          // --port was given: it overrides PreferPort and server.json's port
	PreferPort int           // try this port first (the CLI passes the previous server's port)
	Idle       time.Duration // exit after this long with no SSE client and no request; 0: never
	Version    string        // reported in status and meta; tests override it
	ViewerHTML string        // the page served at /s/<id>/
	Log        io.Writer     // diagnostics (server.log for a detached server)
	Tick       time.Duration // disk-poll and watchdog period (default 2s; tests shorten it)
	Health     time.Duration // timeout of the start-race probe of server.json's server (default 1s, §5.1; tests lengthen it)
	// DiffText returns `sbtel diff` of two specs, for a review's proposal (§5.2). The CLI passes the
	// engine's; nil records no diff text. The server never names the engine itself.
	DiffText DiffFunc
}

// @sbtel DiffsSpecs
// DiffFunc is what the server calls to describe a review's proposed edits: `sbtel diff` of the base and
// the proposal, as text. The server knows only this type; the CLI, which builds the server, passes in
// its own (cmd/sbtel diffText, through the engine), so the server never names the engine.
type DiffFunc func(a, b string) string

// Server is one running server.
type Server struct {
	opts  Options
	paths state.Paths
	token string
	port  int
	start string

	mu       sync.Mutex
	sessions map[string]*session

	clients    atomic.Int64
	lastActive atomic.Int64 // unix nanos
	quit       chan struct{}
	quitOnce   sync.Once
	keepJSON   atomic.Bool // set when another server owns server.json: do not delete it on exit
	ready      chan struct{}
}

// New prepares a server; Run binds and serves.
func New(o Options) *Server {
	if o.Tick <= 0 {
		o.Tick = 2 * time.Second
	}
	if o.Log == nil {
		o.Log = io.Discard
	}
	if o.Health <= 0 {
		o.Health = time.Second
	}
	return &Server{opts: o, paths: state.Paths{Home: o.Home}, sessions: map[string]*session{}, quit: make(chan struct{}), ready: make(chan struct{})}
}

func (s *Server) logf(format string, a ...any) {
	fmt.Fprintf(s.opts.Log, "%s "+format+"\n", append([]any{time.Now().UTC().Format(time.RFC3339)}, a...)...)
}

// Port is the bound port (valid after Ready is closed).
func (s *Server) Port() int { return s.port }

// Ready is closed once the server has written server.json and is serving.
func (s *Server) Ready() <-chan struct{} { return s.ready }

// Stop asks the server to shut down.
func (s *Server) Stop() { s.quitOnce.Do(func() { close(s.quit) }) }

func (s *Server) touch() { s.lastActive.Store(time.Now().UnixNano()) }

// @sbtel begin Sbtel.Server.Lifecycle
// ErrAnotherServer is returned by Run when a healthy server already owns server.json (start race,
// §5.1); the caller exits 0.
var ErrAnotherServer = errors.New("another server is already running")

func (s *Server) listen() (net.Listener, error) {
	if s.opts.PortSet {
		return net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(s.opts.Port))
	}
	var tries []int
	if s.opts.PreferPort > 0 {
		tries = append(tries, s.opts.PreferPort)
	}
	if prev, _ := state.ReadServer(s.paths); prev != nil && prev.Port > 0 {
		tries = append(tries, prev.Port)
	}
	// A port the previous server just released can stay unbindable for a moment (its last
	// connections are still closing; on Windows this can last longer). Retry briefly before
	// giving up on it: open tabs reconnect only if the port is the same.
	for attempt := 0; attempt < 15 && len(tries) > 0; attempt++ {
		for _, p := range tries {
			if ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(p)); err == nil {
				return ln, nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return net.Listen("tcp", "127.0.0.1:0")
}

// Run binds, writes server.json and serves until ctx is done, Stop is called, /control/stop
// arrives, the server is idle for Options.Idle, or server.json names another server.
func (s *Server) Run(ctx context.Context) error {
	if err := state.MkdirAll(s.paths.Sessions()); err != nil {
		return err
	}
	ln, err := s.listen()
	if err != nil {
		return fmt.Errorf("listen: %v", err)
	}
	s.port = ln.Addr().(*net.TCPAddr).Port

	// Start race: a healthy server already listed in server.json wins.
	if prev, _ := state.ReadServer(s.paths); prev != nil && prev.Port != s.port {
		if st, err := probe(prev, s.opts.Health); err == nil && st != nil {
			ln.Close()
			return ErrAnotherServer
		}
	}
	s.token = state.NewID()
	s.start = time.Now().UTC().Format(time.RFC3339)
	if err := s.writeServerJSON(); err != nil {
		ln.Close()
		return err
	}
	s.touch()
	hs := &http.Server{Handler: s, ReadHeaderTimeout: 10 * time.Second, ErrorLog: nil}
	errc := make(chan error, 1)
	go func() { errc <- hs.Serve(ln) }()
	idleSays := "never"
	if s.opts.Idle > 0 {
		idleSays = s.opts.Idle.String()
	}
	s.logf("listening on 127.0.0.1:%d (pid %d, version %s, idle exit %s)", s.port, os.Getpid(), s.opts.Version, idleSays)
	close(s.ready)

	tick := time.NewTicker(s.opts.Tick)
	defer tick.Stop()
	// The server stays up until it is stopped; with Options.Idle set it also exits after that long unused.
	var idleC <-chan time.Time
	if s.opts.Idle > 0 {
		idleEvery := s.opts.Idle / 4
		if idleEvery > 5*time.Second {
			idleEvery = 5 * time.Second
		}
		if idleEvery < 20*time.Millisecond {
			idleEvery = 20 * time.Millisecond
		}
		idle := time.NewTicker(idleEvery)
		defer idle.Stop()
		idleC = idle.C
	}

	reason := ""
loop:
	for {
		select {
		case <-ctx.Done():
			reason = "signal"
			break loop
		case <-s.quit:
			reason = "stop"
			break loop
		case err := <-errc:
			reason = "serve error: " + err.Error()
			break loop
		case <-idleC:
			if s.clients.Load() == 0 && time.Since(time.Unix(0, s.lastActive.Load())) > s.opts.Idle {
				reason = "idle"
				break loop
			}
		case <-tick.C:
			if s.watchdog() {
				reason = "server.json names another server"
				s.keepJSON.Store(true)
				break loop
			}
			s.pollConnected()
		}
	}
	s.logf("exiting: %s", reason)
	s.closeAllSubs()
	sctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	_ = hs.Shutdown(sctx)
	cancel()
	if !s.keepJSON.Load() {
		if cur, _ := state.ReadServer(s.paths); cur != nil && cur.Token == s.token {
			os.Remove(s.paths.ServerJSON())
		}
	}
	return nil
}

func (s *Server) writeServerJSON() error {
	return state.WriteJSONAtomic(s.paths.ServerJSON(), state.ServerInfo{
		PID: os.Getpid(), Port: s.port, Version: s.opts.Version, Started: s.start, Token: s.token,
	})
}

// watchdog reports whether server.json now names another server. A missing server.json is
// rewritten (someone deleted it; we are still the server).
func (s *Server) watchdog() bool {
	cur, err := state.ReadServer(s.paths)
	if err != nil {
		return false
	}
	if cur == nil {
		_ = s.writeServerJSON()
		return false
	}
	return cur.Token != s.token
}

func (s *Server) authOK(r *http.Request) bool {
	const p = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) <= len(p) || h[:len(p)] != p {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(h[len(p):]), []byte(s.token)) == 1
}

// @sbtel end Sbtel.Server.Lifecycle
