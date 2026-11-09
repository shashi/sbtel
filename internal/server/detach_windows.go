//go:build windows

// @sbtel file Sbtel.Server.Detach

package server

import "syscall"

const (
	detachedProcess       = 0x00000008 // DETACHED_PROCESS: no console
	createNewProcessGroup = 0x00000200 // CREATE_NEW_PROCESS_GROUP: no Ctrl-C from the parent's console
)

// detachAttr starts the child without a console and in its own process group, so it survives the
// CLI and its console window.
func detachAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: detachedProcess | createNewProcessGroup, HideWindow: true}
}
