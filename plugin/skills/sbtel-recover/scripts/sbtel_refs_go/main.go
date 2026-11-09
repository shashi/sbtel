// sbtel_refs_go: optional helper for the sbtel-recover skill. It prints the symbol references in a Go
// module, resolved by go/types, in the format of sbtel_refs.mjs. It needs only the Go toolchain: no
// gopls and no golang.org/x/tools. A Go package is a namespace without imports between its files, so
// an import graph says nothing inside it; this resolves every identifier instead.
//
//	go -C <this directory> run . [options] [PACKAGES]      (PACKAGES default: ./...)
//
// Prints one line per reference that crosses a unit:  from_file:line to_file:line<TAB>name
// which is the input sbtel_owners.py --edges reads. Paths are relative to --dir.
//
// A unit is one top-level declaration: a function or method, or one spec of a const, var or type
// declaration (each spec of a parenthesised group is a unit of its own). A reference counts when the
// object it names is declared in the module's own non-test files, in another unit: calls, but also
// types (a struct field of type *T, a conversion, a composite literal), struct fields and methods
// (x.f, T{f: 1}), constants and variables. A call through an interface names the interface's method,
// not its implementations: add those edges by hand where they matter.
//
// Options:
//
//	--dir DIR      the module to analyse (default: the current directory; with go -C, pass "$PWD")
//	--goos LIST    the GOOS values to load, comma-separated (default linux,darwin,windows). Each one
//	               sees its own files (foo_windows.go, //go:build lines); the results are merged
//	--tags LIST    a build tag set, comma-separated; repeat the flag for several sets (each is loaded
//	               with every GOOS). Default: one empty set
//	--units        print unit-to-unit pairs instead (from_file:line to_file:line, the first line of each
//	               unit, once per pair): the declaration graph, for sbtel_sccs.py
//
// It runs `go list -e -deps -export -json` (CGO_ENABLED=0) once per GOOS and tag set; dependencies
// are read from their export data, the module's packages are type-checked from source. Test files
// and cgo files are not loaded.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type listed struct {
	ImportPath string
	Dir        string
	GoFiles    []string
	Export     string
	ImportMap  map[string]string
	Module     *struct{ Main bool }
	Error      *struct{ Err string }
}

type unit struct {
	file       string // relative to --dir
	start, end token.Pos
	line       int
}

type options struct {
	dir   string
	goos  []string
	tags  []string
	units bool
	pats  []string
}

type tagSets []string

func (t *tagSets) String() string     { return strings.Join(*t, " ") }
func (t *tagSets) Set(v string) error { *t = append(*t, v); return nil }

func main() {
	var o options
	var goos string
	var tags tagSets
	fs := flag.NewFlagSet("sbtel_refs_go", flag.ContinueOnError)
	fs.StringVar(&o.dir, "dir", ".", "the module to analyse")
	fs.StringVar(&goos, "goos", "linux,darwin,windows", "GOOS values, comma-separated")
	fs.Var(&tags, "tags", "a build tag set, comma-separated (repeatable)")
	fs.BoolVar(&o.units, "units", false, "print unit-to-unit pairs")
	if err := fs.Parse(os.Args[1:]); err != nil {
		os.Exit(2)
	}
	o.goos = strings.Split(goos, ",")
	o.tags = tags
	if len(o.tags) == 0 {
		o.tags = []string{""}
	}
	o.pats = fs.Args()
	if len(o.pats) == 0 {
		o.pats = []string{"./..."}
	}
	lines, err := run(o)
	if err != nil {
		fmt.Fprintln(os.Stderr, "sbtel_refs_go:", err)
		os.Exit(2)
	}
	for _, l := range lines {
		fmt.Println(l)
	}
}

// run loads every GOOS and tag set and returns the merged, sorted output lines.
func run(o options) ([]string, error) {
	dir, err := filepath.Abs(o.dir)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, g := range o.goos {
		for _, t := range o.tags {
			ls, err := load(dir, strings.TrimSpace(g), t, o.pats, o.units)
			if err != nil {
				return nil, fmt.Errorf("GOOS=%s tags=%q: %v", g, t, err)
			}
			for _, l := range ls {
				seen[l] = true
			}
		}
	}
	out := make([]string, 0, len(seen))
	for l := range seen {
		out = append(out, l)
	}
	sort.Strings(out)
	return out, nil
}

func load(dir, goos, tags string, pats []string, units bool) ([]string, error) {
	args := []string{"list", "-e", "-deps", "-export", "-json"}
	if tags != "" {
		args = append(args, "-tags", tags)
	}
	cmd := exec.Command("go", append(args, pats...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GOOS="+goos, "CGO_ENABLED=0")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	raw, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("go list: %v\n%s", err, stderr.String())
	}
	var pkgs []*listed
	for d := json.NewDecoder(bytes.NewReader(raw)); d.More(); {
		p := new(listed)
		if err := d.Decode(p); err != nil {
			return nil, err
		}
		pkgs = append(pkgs, p)
	}
	exports := map[string]string{}
	for _, p := range pkgs {
		if p.Export != "" {
			exports[p.ImportPath] = p.Export
		}
	}
	fset := token.NewFileSet()
	gc := importer.ForCompiler(fset, "gc", func(path string) (io.ReadCloser, error) {
		if f, ok := exports[path]; ok {
			return os.Open(f)
		}
		return nil, fmt.Errorf("no export data for %s", path)
	})
	checked := map[string]*types.Package{}
	var all []unit
	type done struct {
		info  *types.Info
		files []*ast.File
	}
	var mine []done
	for _, p := range pkgs { // go list -deps prints dependencies first
		if p.Module == nil || !p.Module.Main {
			continue
		}
		if p.Error != nil {
			return nil, fmt.Errorf("%s: %s", p.ImportPath, p.Error.Err)
		}
		var files []*ast.File
		for _, name := range p.GoFiles {
			path := filepath.Join(p.Dir, name)
			f, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
			if err != nil {
				return nil, err
			}
			files = append(files, f)
			rel, _ := filepath.Rel(dir, path)
			all = append(all, unitsOf(fset, f, filepath.ToSlash(rel))...)
		}
		info := &types.Info{Uses: map[*ast.Ident]types.Object{}}
		conf := types.Config{GoVersion: "", Importer: importerFunc(func(path string) (*types.Package, error) {
			if m, ok := p.ImportMap[path]; ok {
				path = m
			}
			if c, ok := checked[path]; ok {
				return c, nil
			}
			return gc.Import(path)
		})}
		tp, err := conf.Check(p.ImportPath, fset, files, info)
		if err != nil {
			return nil, fmt.Errorf("type-checking %s: %v", p.ImportPath, err)
		}
		checked[p.ImportPath] = tp
		mine = append(mine, done{info, files})
	}
	byFile := map[*token.File][]*unit{}
	for i := range all {
		u := &all[i]
		f := fset.File(u.start)
		byFile[f] = append(byFile[f], u)
	}
	find := func(pos token.Pos) *unit {
		for _, u := range byFile[fset.File(pos)] {
			if u.start <= pos && pos <= u.end {
				return u
			}
		}
		return nil
	}
	var out []string
	for _, d := range mine {
		for id, obj := range d.info.Uses {
			if obj == nil || !obj.Pos().IsValid() {
				continue
			}
			if _, ok := obj.(*types.PkgName); ok {
				continue
			}
			from, to := find(id.Pos()), find(obj.Pos())
			if from == nil || to == nil || from == to {
				continue
			}
			if units {
				out = append(out, fmt.Sprintf("%s:%d %s:%d", from.file, from.line, to.file, to.line))
				continue
			}
			out = append(out, fmt.Sprintf("%s:%d %s:%d\t%s", from.file, fset.Position(id.Pos()).Line, to.file, fset.Position(obj.Pos()).Line, obj.Name()))
		}
	}
	return out, nil
}

// unitsOf lists a file's top-level declarations: each function or method, and each spec of a const,
// var or type declaration (imports are not units). A unit's line is its first line, without the doc
// comment, which is where sbtel_owners.py starts the declaration an `@sbtel Name` annotates.
func unitsOf(fset *token.FileSet, f *ast.File, rel string) []unit {
	var us []unit
	for _, d := range f.Decls {
		switch d := d.(type) {
		case *ast.FuncDecl:
			us = append(us, unit{rel, d.Pos(), d.End(), fset.Position(d.Pos()).Line})
		case *ast.GenDecl:
			if d.Tok == token.IMPORT {
				continue
			}
			for _, sp := range d.Specs {
				s, e := sp.Pos(), sp.End()
				if !d.Lparen.IsValid() {
					s, e = d.Pos(), d.End()
				}
				us = append(us, unit{rel, s, e, fset.Position(s).Line})
			}
		}
	}
	return us
}

type importerFunc func(path string) (*types.Package, error)

func (f importerFunc) Import(path string) (*types.Package, error) { return f(path) }
