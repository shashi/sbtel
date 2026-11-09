//go:build !windows

// @sbtel file Sbtel.Server.Detach

package server

import "syscall"

// detachAttr puts the child in a new session (setsid), so it survives the CLI, its terminal and
// the terminal's process group.
func detachAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setsid: true} }
