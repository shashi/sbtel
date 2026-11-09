package main

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// A module with two packages: types, struct fields, methods, a composite literal key, a constant
// group, a windows-only file, a file behind a build tag, and a test file that must not be loaded.
var module = map[string]string{
	"go.mod": "module example.com/m\n\ngo 1.22\n",
	"store/store.go": `package store

// Store keeps items.
type Store struct {
	Items []Item
	n     int
}

func (s *Store) Add(it Item) { s.Items = append(s.Items, it); s.n++ }
`,
	"store/item.go": `package store

type Item struct{ Name string }

const (
	Small = iota
	Big
)
`,
	"store/os_windows.go": `package store

func path() string { return Item{Name: "C:"}.Name }
`,
	"store/extra.go": `//go:build extra

package store

func Extra() int { return Big }
`,
	"store/store_test.go": `package store

func helper() Store { return Store{} }
`,
	"app/app.go": `package app

import "example.com/m/store"

type App struct {
	db *store.Store
}

func (a *App) Run() int {
	a.db.Add(store.Item{Name: "x"})
	return len(a.db.Items) + store.Small
}
`,
}

func write(t *testing.T) string {
	dir := t.TempDir()
	for name, text := range module {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestReferences(t *testing.T) {
	dir := write(t)
	got, err := run(options{dir: dir, goos: []string{"linux"}, tags: []string{""}, pats: []string{"./..."}})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"app/app.go:10 app/app.go:6\tdb",        // a struct field, through a method's receiver
		"app/app.go:10 store/item.go:3\tItem",   // a type, in a composite literal
		"app/app.go:10 store/item.go:3\tName",   // a struct field, as a literal key
		"app/app.go:10 store/store.go:9\tAdd",   // a method
		"app/app.go:11 app/app.go:6\tdb",        //
		"app/app.go:11 store/item.go:6\tSmall",  // a constant, one spec of a group
		"app/app.go:11 store/store.go:5\tItems", // a struct field, through a selector
		"app/app.go:6 store/store.go:4\tStore",  // a type, in a struct field's type
		"app/app.go:9 app/app.go:5\tApp",        // the receiver's type
		"store/store.go:5 store/item.go:3\tItem",
		"store/store.go:9 store/item.go:3\tItem",
		"store/store.go:9 store/store.go:4\tStore",
		"store/store.go:9 store/store.go:5\tItems",
		"store/store.go:9 store/store.go:6\tn",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("linux:\n got %s\nwant %s", strings.Join(got, "\n     "), strings.Join(want, "\n     "))
	}
	if strings.Contains(strings.Join(got, "\n"), "store_test.go") {
		t.Error("a test file was loaded")
	}

	// Every GOOS and tag set: the windows-only file and the tagged file add their references.
	got, err = run(options{dir: dir, goos: []string{"linux", "windows"}, tags: []string{"", "extra"}, pats: []string{"./..."}})
	if err != nil {
		t.Fatal(err)
	}
	all := strings.Join(got, "\n")
	for _, w := range []string{"store/os_windows.go:3 store/item.go:3\tItem", "store/os_windows.go:3 store/item.go:3\tName", "store/extra.go:5 store/item.go:7\tBig"} {
		if !strings.Contains(all, w) {
			t.Errorf("missing %q in\n%s", w, all)
		}
	}
	if len(got) != len(want)+3 {
		t.Errorf("merged: %d lines, want %d:\n%s", len(got), len(want)+3, all)
	}

	// --units: the declaration graph, one line per pair of units.
	got, err = run(options{dir: dir, goos: []string{"linux"}, tags: []string{""}, pats: []string{"./..."}, units: true})
	if err != nil {
		t.Fatal(err)
	}
	wantUnits := []string{
		"app/app.go:9 app/app.go:5", "app/app.go:9 store/item.go:3", "app/app.go:9 store/item.go:6",
		"app/app.go:9 store/store.go:4", "app/app.go:9 store/store.go:9", "app/app.go:5 store/store.go:4",
		"store/store.go:4 store/item.go:3", "store/store.go:9 store/item.go:3", "store/store.go:9 store/store.go:4",
	}
	sort.Strings(wantUnits)
	if !reflect.DeepEqual(got, wantUnits) {
		t.Errorf("--units:\n got %s\nwant %s", strings.Join(got, "\n     "), strings.Join(wantUnits, "\n     "))
	}
}

// Dependency inversion: an interface (owned by a behavior in the spec), an interface that embeds it, an
// implementer with a blank assertion, a caller that calls only through the interface, and a composition
// root that builds the implementer and hands it to the caller. The blank assertion's type and the
// embedded interface are tagged `implements`; the caller's references to Durable and Save are plain uses.
var inversion = map[string]string{
	"go.mod": "module example.com/inv\n\ngo 1.22\n",
	"store/durable.go": `package store

// @sbtel Durable
type Durable interface {
	Save(s string) error
}

// @sbtel Journaled
type Journaled interface {
	Durable
	Replay() []string
}
`,
	"store/disk.go": `// @sbtel file Disk

package store

type Disk struct{ lines []string }

var _ Journaled = (*Disk)(nil)

func (d *Disk) Save(s string) error { d.lines = append(d.lines, s); return nil }
func (d *Disk) Replay() []string    { return d.lines }
`,
	"editor/editor.go": `// @sbtel file Editor

package editor

import "example.com/inv/store"

type Editor struct{ out store.Durable }

func New(out store.Durable) *Editor { return &Editor{out} }

func (e *Editor) Type(s string) error { return e.out.Save(s) }
`,
	"main.go": `// @sbtel file Root

package main

import (
	"example.com/inv/editor"
	"example.com/inv/store"
)

func main() { editor.New(&store.Disk{}).Type("hi") }
`,
}

func TestImplementsTags(t *testing.T) {
	dir := t.TempDir()
	for name, text := range inversion {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := run(options{dir: dir, goos: []string{"linux"}, tags: []string{""}, pats: []string{"./..."}})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"editor/editor.go:11 editor/editor.go:7\tEditor",
		"editor/editor.go:11 editor/editor.go:7\tout",
		"editor/editor.go:11 store/durable.go:5\tSave",   // a call through the interface: a use
		"editor/editor.go:7 store/durable.go:4\tDurable", // a field of the interface type: a use
		"editor/editor.go:9 editor/editor.go:7\tEditor",
		"editor/editor.go:9 store/durable.go:4\tDurable", // a parameter of the interface type: a use
		"main.go:10 editor/editor.go:11\tType",
		"main.go:10 editor/editor.go:9\tNew", // the composition root names the caller...
		"main.go:10 store/disk.go:5\tDisk",   // ...and the implementer
		"store/disk.go:10 store/disk.go:5\tDisk",
		"store/disk.go:10 store/disk.go:5\tlines",
		"store/disk.go:7 store/disk.go:5\tDisk",
		"store/disk.go:7 store/durable.go:9\tJournaled\timplements", // the blank assertion
		"store/disk.go:9 store/disk.go:5\tDisk",
		"store/disk.go:9 store/disk.go:5\tlines",
		"store/durable.go:10 store/durable.go:4\tDurable\timplements", // an embedded interface
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %s\nwant %s", strings.Join(got, "\n     "), strings.Join(want, "\n     "))
	}
}

// A module reached through a symbolic link (macOS's temp dirs live under /var, a link to /private/var):
// the paths stay relative to the module, as the go tool reports real paths.
func TestSymlinkedDir(t *testing.T) {
	dir := write(t)
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(dir, link); err != nil {
		t.Skip("no symbolic links here:", err)
	}
	want, err := run(options{dir: dir, goos: []string{"linux"}, tags: []string{""}, pats: []string{"./..."}})
	if err != nil {
		t.Fatal(err)
	}
	got, err := run(options{dir: link, goos: []string{"linux"}, tags: []string{""}, pats: []string{"./..."}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("through a link:\n got %s\nwant %s", strings.Join(got, "\n     "), strings.Join(want, "\n     "))
	}
}
