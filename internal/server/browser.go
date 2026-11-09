// @sbtel file Sbtel.Server.Launch

package server

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// BrowserCommand is the command that opens url (§3.7): $SBTEL_BROWSER <url> if set (split on
// spaces), else `open` on macOS, `rundll32 url.dll,FileProtocolHandler` on Windows, `xdg-open`
// elsewhere.
func BrowserCommand(url string) []string {
	if b := strings.Fields(os.Getenv("SBTEL_BROWSER")); len(b) > 0 {
		return append(b, url)
	}
	switch runtime.GOOS {
	case "darwin":
		return []string{"open", url}
	case "windows":
		return []string{"rundll32", "url.dll,FileProtocolHandler", url}
	default:
		return []string{"xdg-open", url}
	}
}

// OpenBrowser runs BrowserCommand detached. It waits up to 3 s: a launcher that exits non-zero in
// that time (xdg-open without a desktop, say) is an error; one still running is taken as success.
func OpenBrowser(url string) error {
	argv := BrowserCommand(url)
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.SysProcAttr = detachAttr()
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return fmt.Errorf("%s exited with status %d", argv[0], ee.ExitCode())
		}
		return err
	case <-time.After(3 * time.Second):
		return nil
	}
}
