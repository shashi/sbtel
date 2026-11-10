package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// The goja half of conformance: the same records as conformance/run-node.mjs, compared with the
// same conformance/expected/ files byte for byte. Node writes expected/; goja must agree.
func TestConformance(t *testing.T) {
	dir := filepath.Join("..", "..", "conformance")
	e, err := New()
	if err != nil {
		t.Fatal(err)
	}
	// cases/*.json merged in file-name order, exactly as conformance/run-node.mjs does.
	type checkCase struct {
		Name string `json:"name"`
		Text string `json:"text"`
	}
	type specCases struct {
		Query    []json.RawMessage `json:"query"`
		Check    []checkCase       `json:"check"`
		Edits    []json.RawMessage `json:"edits"`
		Carriers []string          `json:"carriers"`
	}
	type diffCase struct{ Name, A, B string }
	specs, random, diffs := map[string]*specCases{}, []int{}, []diffCase{}
	cfiles, err := filepath.Glob(filepath.Join(dir, "cases", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(cfiles)
	for _, cf := range cfiles {
		raw, err := os.ReadFile(cf)
		if err != nil {
			t.Fatal(err)
		}
		var c struct {
			Specs  map[string]specCases `json:"specs"`
			Random []int                `json:"random"`
			Diff   []diffCase           `json:"diff"`
		}
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatalf("%s: %v", cf, err)
		}
		for name, v := range c.Specs {
			s := specs[name]
			if s == nil {
				s = &specCases{Query: []json.RawMessage{}, Check: []checkCase{}, Edits: []json.RawMessage{}, Carriers: []string{}}
				specs[name] = s
			}
			s.Query = append(s.Query, v.Query...)
			s.Check = append(s.Check, v.Check...)
			s.Edits = append(s.Edits, v.Edits...)
			s.Carriers = append(s.Carriers, v.Carriers...)
		}
		random = append(random, c.Random...)
		diffs = append(diffs, c.Diff...)
	}
	// Specs are read with \r\n as \n, as run-node.mjs does, so a CRLF checkout gives the same records;
	// bindings fixtures are passed as they are (a-rules.bindings.txt tests CRLF on purpose).
	read := func(p string) string {
		b, err := os.ReadFile(filepath.Join(dir, p))
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasSuffix(p, ".sbtel") {
			return strings.ReplaceAll(string(b), "\r\n", "\n")
		}
		return string(b)
	}
	type job struct {
		out  string
		make func() (string, error)
	}
	var jobs []job
	ents, err := os.ReadDir(filepath.Join(dir, "specs"))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, en := range ents {
		if strings.HasSuffix(en.Name(), ".sbtel") {
			names = append(names, en.Name())
		}
	}
	sort.Strings(names)
	for _, n := range names {
		src, c := read("specs/"+n), specs[n]
		if c == nil {
			c = &specCases{Query: []json.RawMessage{}, Check: []checkCase{}, Edits: []json.RawMessage{}, Carriers: []string{}}
		}
		withText := specCases{Query: c.Query, Check: []checkCase{}, Edits: c.Edits, Carriers: c.Carriers}
		for _, k := range c.Check {
			withText.Check = append(withText.Check, checkCase{k.Name, read("specs/" + k.Name)})
		}
		cj, _ := json.Marshal(withText)
		jobs = append(jobs, job{strings.TrimSuffix(n, ".sbtel") + ".json", func() (string, error) { return e.Call("conformance", src, string(cj)) }})
	}
	for _, seed := range random {
		jobs = append(jobs, job{fmt.Sprintf("random-%d.json", seed), func() (string, error) {
			src, err := e.Call("randomSpec", seed)
			if err != nil {
				return "", err
			}
			return e.Call("conformance", src, "{}")
		}})
	}
	for _, d := range diffs {
		a, b := read(d.A), read(d.B)
		jobs = append(jobs, job{"diff-" + d.Name + ".json", func() (string, error) {
			s, err := e.Call("diff", a, b)
			return s + "\n", err
		}})
	}
	if len(jobs) == 0 {
		t.Fatal("no conformance records")
	}
	for _, j := range jobs {
		t.Run(j.out, func(t *testing.T) {
			got, err := j.make()
			if err != nil {
				t.Fatal(err)
			}
			want, err := os.ReadFile(filepath.Join(dir, "expected", j.out))
			if err != nil {
				t.Fatal(err)
			}
			if want := strings.ReplaceAll(string(want), "\r\n", "\n"); got != want {
				i := 0
				for i < len(got) && i < len(want) && got[i] == want[i] {
					i++
				}
				lo := max(0, i-60)
				t.Errorf("goja differs from node at byte %d\n want …%s\n got  …%s", i, clip(string(want), lo, i+60), clip(got, lo, i+60))
			}
		})
	}
}

func clip(s string, lo, hi int) string { return s[min(lo, len(s)):min(hi, len(s))] }

// The CLI glue returns the exit codes and formats DESIGN.md §3 promises.
func TestCLILint(t *testing.T) {
	e, err := New()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		src, want string
		exit      int
	}{
		{"(block A (sketch \"x\"))", "a.sbtel: ok (1 block, 0 behaviors, 0 shapes)\n", 0},
		{"(block A (takes Nope :as p))", "a.sbtel: Every port uses a declared shape: A.p: Nope\na.sbtel: 1 problem (1 block, 0 behaviors, 0 shapes)\n", 1},
		{"(block A\n  (sketch \"x)", "a.sbtel:2:11: error: Unclosed string\n", 1},
	} {
		r, err := e.CLI("lint", map[string]any{"files": []File{{"a.sbtel", tc.src}}})
		if err != nil {
			t.Fatal(err)
		}
		if r.Exit != tc.exit || r.Stdout != tc.want {
			t.Errorf("lint %q: exit %d, stdout %q; want exit %d, %q", tc.src, r.Exit, r.Stdout, tc.exit, tc.want)
		}
	}
	r, _ := e.CLI("lint", map[string]any{"files": []File{}})
	if r.Exit != 2 {
		t.Errorf("lint with no files: exit %d, want 2", r.Exit)
	}
}

func TestExceptionMessage(t *testing.T) {
	e, err := New()
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.Call("lint", 42) // load() throws a TypeError for a non-string
	if err == nil || err.Error() != "lint: spec source must be a string" {
		t.Errorf("got %v", err)
	}
}

// parseBindings keeps a `# VIOLATION:` explanation as the edge's note, and lists a note that explains no
// edge as an orphan (docs/DESIGN.md §2.5), in goja
// exactly as in node (core.js is the same text in both).
func TestParseBindingsNotes(t *testing.T) {
	e, err := New()
	if err != nil {
		t.Fatal(err)
	}
	got, err := e.Call("parseBindings", "\xef\xbb\xbf# header\nA -> B  # x:1\n\n# VIOLATION: why\n#   and more\nC->D  # y:2\nE -> F\n# VIOLATION: dropped by the blank line\n\nG -> H\r\nnot an edge\n")
	if err != nil {
		t.Fatal(err)
	}
	want := `{"edges":[{"callee":"B","caller":"A","line":2,"location":"x:1","note":null},` +
		`{"callee":"D","caller":"C","line":6,"location":"y:2","note":"why and more"},` +
		`{"callee":"F","caller":"E","line":7,"location":null,"note":null},` +
		`{"callee":"H","caller":"G","line":10,"location":null,"note":null}],` +
		`"invalid":[{"line":11,"text":"not an edge"}],` +
		`"orphans":[{"line":8,"note":"dropped by the blank line","why":"blank"}]}` // canonical JSON: sorted keys
	if got != want {
		t.Errorf("parseBindings:\n got %s\nwant %s", got, want)
	}
}
