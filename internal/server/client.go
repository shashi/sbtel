// @sbtel file Sbtel.Server.Client

package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"time"

	"github.com/shashi/sbtel/internal/state"
)

// Status is GET /control/status.
type Status struct {
	PID      int    `json:"pid"`
	Port     int    `json:"port"`
	Version  string `json:"version"`
	Started  string `json:"started"`
	Sessions int    `json:"sessions"`
	Clients  int    `json:"clients"`
}

// Client talks to a running server's control API.
type Client struct {
	Info *state.ServerInfo
	hc   *http.Client
}

func base(info *state.ServerInfo) string { return "http://127.0.0.1:" + strconv.Itoa(info.Port) }

func controlReq(hc *http.Client, info *state.ServerInfo, method, path string, body any) (*http.Response, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, base(info)+path, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+info.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return hc.Do(req)
}

// probe asks the server named by info for its status, within timeout. Any failure is an error.
func probe(info *state.ServerInfo, timeout time.Duration) (*Status, error) {
	hc := &http.Client{Timeout: timeout}
	resp, err := controlReq(hc, info, "GET", "/control/status", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("status: HTTP %d", resp.StatusCode)
	}
	var st Status
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		return nil, err
	}
	return &st, nil
}

// Running returns the server named by server.json if it answers (any version), else nil.
func Running(p state.Paths) (*state.ServerInfo, *Status) {
	info, _ := state.ReadServer(p)
	if info == nil {
		return nil, nil
	}
	st, err := probe(info, time.Second)
	if err != nil {
		return nil, nil
	}
	return info, st
}

// Connect returns a client for a running server of any version, or nil.
func Connect(p state.Paths) *Client {
	info, _ := Running(p)
	if info == nil {
		return nil
	}
	return &Client{Info: info, hc: &http.Client{Timeout: 60 * time.Second}}
}

// HTTPError is a non-2xx control response.
type HTTPError struct {
	Code int
	Msg  string
}

func (e *HTTPError) Error() string { return e.Msg }

// Do sends a control request and decodes a 2xx JSON response into out (if non-nil).
func (c *Client) Do(method, path string, body, out any) error {
	resp, err := controlReq(c.hc, c.Info, method, path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		var e struct{ Error string }
		_ = json.Unmarshal(b, &e)
		if e.Error == "" {
			e.Error = fmt.Sprintf("server answered HTTP %d", resp.StatusCode)
		}
		return &HTTPError{resp.StatusCode, e.Error}
	}
	if out != nil {
		return json.Unmarshal(b, out)
	}
	return nil
}

// waitGone waits until the server named by info stops answering, or timeout.
func waitGone(info *state.ServerInfo, timeout time.Duration) bool {
	end := time.Now().Add(timeout)
	for time.Now().Before(end) {
		if _, err := probe(info, 300*time.Millisecond); err != nil {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false
}

// StopRunning asks the running server to exit and waits up to timeout. It reports whether a
// server was running.
func StopRunning(p state.Paths, timeout time.Duration) (bool, error) {
	info, _ := Running(p)
	if info == nil {
		return false, nil
	}
	c := &Client{Info: info, hc: &http.Client{Timeout: 2 * time.Second}}
	if err := c.Do("POST", "/control/stop", map[string]any{}, nil); err != nil {
		return true, err
	}
	if !waitGone(info, timeout) {
		return true, errors.New("server did not exit within " + timeout.String())
	}
	return true, nil
}

// Ensure returns a client for a healthy server on `version` (§5.1), starting one if needed:
// `exe serve --foreground` detached, stdout and stderr to server.log. A server on another version
// is stopped first; the new one retries the old port so open tabs reconnect.
func Ensure(p state.Paths, version, exe string) (*Client, error) {
	info, _ := state.ReadServer(p)
	prevPort, oldToken := 0, ""
	if info != nil {
		prevPort, oldToken = info.Port, info.Token
		if st, err := probe(info, time.Second); err == nil {
			if st.Version == version {
				return &Client{Info: info, hc: &http.Client{Timeout: 60 * time.Second}}, nil
			}
			c := &Client{Info: info, hc: &http.Client{Timeout: 2 * time.Second}}
			_ = c.Do("POST", "/control/stop", map[string]any{}, nil)
			if !waitGone(info, 5*time.Second) {
				return nil, fmt.Errorf("server version %s (pid %d) did not stop", st.Version, info.PID)
			}
		}
	}
	if err := state.MkdirAll(p.Home); err != nil {
		return nil, err
	}
	args := []string{"serve", "--foreground"}
	if prevPort > 0 {
		args = append(args, "--prefer-port", strconv.Itoa(prevPort))
	}
	if err := Spawn(p, exe, args); err != nil {
		return nil, fmt.Errorf("starting the server: %v", err)
	}
	end := time.Now().Add(5 * time.Second)
	for time.Now().Before(end) {
		time.Sleep(40 * time.Millisecond)
		cur, _ := state.ReadServer(p)
		if cur == nil || cur.Token == oldToken {
			continue
		}
		if st, err := probe(cur, time.Second); err == nil && st.Version == version {
			return &Client{Info: cur, hc: &http.Client{Timeout: 60 * time.Second}}, nil
		}
	}
	return nil, fmt.Errorf("the server did not start within 5s; see %s", p.ServerLog())
}

// Spawn starts exe with args detached from this process (its own session or process group), with
// stdout and stderr appended to a freshly truncated server.log.
func Spawn(p state.Paths, exe string, args []string) error {
	log, err := os.OpenFile(p.ServerLog(), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer log.Close()
	cmd := exec.Command(exe, args...)
	cmd.Stdout, cmd.Stderr, cmd.Stdin = log, log, nil
	cmd.Dir = p.Home
	cmd.Env = append(os.Environ(), "SBTEL_HOME="+p.Home)
	cmd.SysProcAttr = detachAttr()
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait() // reap it if this process outlives it (tests); a CLI exits first
	return nil
}
