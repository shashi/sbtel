// @sbtel file Sbtel.State
package state

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// The project folder (DESIGN.md §4.4, v0.4): `.sbtel/` beside a spec file. It holds what belongs with the
// project rather than with one machine: files dropped onto the diagram (`files/`) and a log of what was
// said about each spec (`comments/<spec file>.jsonl`). Session ids, cursors and versions stay in the
// state directory in the user's home.
const ProjectDirName = ".sbtel"

// ProjectDir is the `.sbtel` directory beside the spec at specPath.
func ProjectDir(specPath string) string { return filepath.Join(filepath.Dir(specPath), ProjectDirName) }

// ProjectFiles is where dropped files go, and ProjectFilesRel that directory as a ref writes it.
func ProjectFiles(specPath string) string { return filepath.Join(ProjectDir(specPath), "files") }

const ProjectFilesRel = ProjectDirName + "/files"

// GitRoot is the nearest directory at or above dir that holds a `.git` (a directory, or the file a
// worktree or submodule has), or "" when there is none.
func GitRoot(dir string) string {
	dir, err := filepath.Abs(dir)
	if err != nil {
		return ""
	}
	for {
		if _, err := os.Lstat(filepath.Join(dir, ".git")); err == nil {
			return dir
		}
		up := filepath.Dir(dir)
		if up == dir {
			return ""
		}
		dir = up
	}
}

// EnsureIgnored makes git ignore `.sbtel/` when the spec lives in a git repository: it appends the line
// `.sbtel/` to the repository's top .gitignore unless a line there already ignores it. It returns the
// .gitignore it changed, or "" when there was nothing to do (no repository, or already ignored).
func EnsureIgnored(specPath string) (string, error) {
	root := GitRoot(filepath.Dir(specPath))
	if root == "" {
		return "", nil
	}
	file := filepath.Join(root, ".gitignore")
	b, err := os.ReadFile(file)
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	sc := bufio.NewScanner(strings.NewReader(string(b)))
	for sc.Scan() {
		switch strings.TrimSpace(sc.Text()) {
		case ".sbtel", ".sbtel/", "/.sbtel", "/.sbtel/", "**/.sbtel", "**/.sbtel/", ".sbtel/*", ".sbtel/**":
			return "", nil
		}
	}
	add := ".sbtel/\n"
	if len(b) > 0 && b[len(b)-1] != '\n' {
		add = "\n" + add
	}
	f, err := os.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := f.WriteString(add); err != nil {
		return "", err
	}
	return file, nil
}

// AppendProjectComment appends one comment, reply or review to `.sbtel/comments/<spec file>.jsonl` beside
// the spec, as one JSON line. The line is the session's event without what is private to the session.
func AppendProjectComment(specPath string, e Event) error {
	dir := filepath.Join(ProjectDir(specPath), "comments")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if e.Proposal != nil { // the proposed spec lives in the session; its path is of no use elsewhere
		p := *e.Proposal
		p.Path = ""
		e.Proposal = &p
	}
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dir, filepath.Base(specPath)+".jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(b, '\n'))
	return err
}
