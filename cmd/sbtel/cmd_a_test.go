package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/shashi/sbtel"
	"github.com/shashi/sbtel/internal/engine"
)

const (
	shellSpec  = "../../examples/shell.sbtel"
	sampleBind = "../../conformance/specs/sample.bindings.txt"
	sampleSpec = "../../conformance/specs/sample.sbtel"
)

func mustRead(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// Every A command through run(...), with exit codes 0, 1 and 2 each exercised (DESIGN.md §10.A).
func TestExitCodes(t *testing.T) {
	okBind := "Shell.Composer -> Shell.Router  # a.ts:1\nShell.Router -> Shell.Keymap\n"
	badBind := "Shell.Router -> Shell.Composer\n"
	for _, tc := range []struct {
		name  string
		stdin string
		args  []string
		exit  int
	}{
		{"check ok", okBind, []string{"check", shellSpec, "--bindings", "-"}, 0},
		{"check violation", badBind, []string{"check", shellSpec, "--bindings=-"}, 1},
		{"check invalid line wins", "", []string{"check", shellSpec, "--bindings", sampleBind}, 2},
		{"check parse error", okBind, []string{"check", "../../conformance/specs/bad-extra-paren.sbtel", "--bindings", "-"}, 1},
		{"check spec on stdin", mustRead(t, shellSpec), []string{"check", "-", "--bindings", "../../conformance/specs/a-rules.bindings.txt"}, 2},
		{"check no bindings", "", []string{"check", shellSpec}, 2},
		{"check two stdin", "", []string{"check", "-", "--bindings", "-"}, 2},
		{"check two specs", "", []string{"check", shellSpec, shellSpec, "--bindings", sampleBind}, 2},
		{"check missing file", "", []string{"check", "nope.sbtel", "--bindings", sampleBind}, 2},
		{"check missing bindings", "", []string{"check", shellSpec, "--bindings", "nope.txt"}, 2},
		{"check bad flag", "", []string{"check", shellSpec, "--bindings", sampleBind, "--with-deps"}, 2},
		{"query ok", "", []string{"query", shellSpec, "Shell.Turn"}, 0},
		{"query deps json", "", []string{"query", "--with-deps", shellSpec, "Shell.Turn", "--json"}, 0},
		{"query stdin", mustRead(t, shellSpec), []string{"query", "-", "beh:Durable", "msg:Intent"}, 0},
		{"query missing id", "", []string{"query", shellSpec, "Shell.Trn"}, 2},
		{"query parse error", "", []string{"query", "../../conformance/specs/bad-missing-paren.sbtel", "Shell"}, 1},
		{"query no ids", "", []string{"query", shellSpec}, 2},
		{"query no spec", "", []string{"query"}, 2},
		{"diff same", "", []string{"diff", shellSpec, shellSpec}, 0},
		{"diff differ", "", []string{"diff", sampleSpec, "../../conformance/specs/bad-scope.sbtel"}, 1},
		{"diff stdin b", mustRead(t, shellSpec), []string{"diff", shellSpec, "-"}, 0},
		{"diff stdin a", "(block X)", []string{"diff", "-", shellSpec, "--json"}, 1},
		{"diff parse error", "", []string{"diff", sampleSpec, "../../conformance/specs/bad-extra-paren.sbtel"}, 2},
		{"diff one arg", "", []string{"diff", shellSpec}, 2},
		{"diff two stdin", "", []string{"diff", "-", "-"}, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, out, errs := runT(tc.stdin, tc.args...)
			if c != tc.exit {
				t.Errorf("exit %d, want %d\nstdout: %s\nstderr: %s", c, tc.exit, out, errs)
			}
			if c == 2 && !strings.HasPrefix(errs, "sbtel "+tc.args[0]+": ") && !strings.Contains(out, "error: not an edge") {
				t.Errorf("stderr should start %q: %q", "sbtel "+tc.args[0]+": ", errs)
			}
		})
	}
}

// DESIGN.md §10.A done-when: check on examples/shell.sbtel with the sample bindings prints §3.4.
func TestCheckText(t *testing.T) {
	c, out, _ := runT("", "check", sampleSpec, "--bindings", sampleBind)
	b := sampleBind
	want := b + ":6: Shell.Turn -> Shell: ancestor: Shell.Turn is inside Shell: a part may not bind to the block that encloses it  (ancestor: not allowed (a part binding its whole))\n" +
		b + ":8: Shell.Router -> Shell.Composer: upward: Shell.Router (level 2 of Shell) binds upward to Shell.SessionView (level 3)  (src/router.ts:40  upward)\n" +
		b + ":9: Shell.Theme -> Shell.Router: same-level: Shell.Theme and Shell.Router share level 2 of Shell but are not adjacent  (same level, not adjacent)\n" +
		b + ":12: Shell.Turn -> Shell.TurnList: upward: Shell.Turn (level 1 of Shell.Transcript) binds upward to Shell.TurnList (level 2)  (upward inside Transcript)\n" +
		b + ":13: Shell.Toast -> Nope: unknown: Nope is not a block or a behavior in the spec  (unknown callee)\n" +
		b + ":15: error: not an edge: this line is not an edge\n" +
		b + ":16: error: not an edge: A -> B -> C\n" +
		sampleSpec + ": 11 bindings, 5 not allowed, 0 explained\n"
	if c != 2 || out != want {
		t.Errorf("exit %d\n got:\n%s\nwant:\n%s", c, out, want)
	}
	// The §10.A done-when command, on the example (which workstream D may edit): the §3.4 line shapes.
	c, out, _ = runT("", "check", shellSpec, "--bindings", sampleBind)
	lines := strings.Split(strings.TrimSuffix(out, "\n"), "\n")
	shape := regexp.MustCompile(`^` + regexp.QuoteMeta(sampleBind) + `:\d+: (\S+ -> \S+: (same-level|upward|ancestor|unknown): .+|error: not an edge: .+)$`)
	for _, l := range lines[:len(lines)-1] {
		if !shape.MatchString(l) {
			t.Errorf("not a §3.4 line: %q", l)
		}
	}
	if c != 2 || !regexp.MustCompile(`^`+regexp.QuoteMeta(shellSpec)+`: 11 bindings, \d+ not allowed, 0 explained$`).MatchString(lines[len(lines)-1]) {
		t.Errorf("exit %d, summary %q", c, lines[len(lines)-1])
	}
	// # VIOLATION: notes (§2.5): the reason under its violation, the count, warnings for stale notes.
	c, out, _ = runT("# VIOLATION: the router redraws the session view\nShell.Router -> Shell.SessionView  # r.ts:1\n"+
		"# VIOLATION: stale\nShell.Router -> Shell.Keymap\n# VIOLATION: dangling\n", "check", shellSpec, "--bindings", "-")
	wantNotes := "<stdin>:2: Shell.Router -> Shell.SessionView: upward: Shell.Router (level 2 \"Services\" of Shell) binds upward to Shell.SessionView (level 3 \"Surfaces\")  (r.ts:1)\n" +
		"  VIOLATION: the router redraws the session view\n" +
		"<stdin>:4: warning: VIOLATION note on an allowed edge: Shell.Router -> Shell.Keymap (adjacent)\n" +
		"<stdin>:5: warning: VIOLATION note explains no edge: the file ends after it\n" +
		shellSpec + ": 2 bindings, 1 not allowed, 1 explained\n"
	if c != 1 || out != wantNotes {
		t.Errorf("notes: exit %d\n got:\n%s\nwant:\n%s", c, out, wantNotes)
	}
	c, out, _ = runT("Shell.Toast -> Shell.Tost\n", "check", shellSpec, "--bindings", "-", "--json")
	var r map[string]any
	if err := json.Unmarshal([]byte(out), &r); err != nil || c != 1 || r["file"] != shellSpec || r["bindingsFile"] != "<stdin>" ||
		!strings.Contains(out, `(did you mean Shell.Toast?)`) || strings.Count(out, "\n") != 1 {
		t.Errorf("json: exit %d %v %s", c, err, out)
	}
	c, out, _ = runT("", "check", "../../conformance/specs/bad-extra-paren.sbtel", "--bindings", sampleBind)
	if c != 2 || !strings.HasPrefix(out, "../../conformance/specs/bad-extra-paren.sbtel:95:1: error: Unexpected \")\"\n") {
		t.Errorf("parse error: exit %d %q", c, out)
	}
}

func TestQueryText(t *testing.T) {
	c, out, errs := runT("", "query", sampleSpec, "Shell.Keymap", "Shell.Kemap", "Clipbord")
	want := "; sbtel query " + sampleSpec + " Shell.Keymap Shell.Kemap Clipbord\n" +
		"; Shell.Keymap: block in Shell, lines 80-82\n" +
		"(block Shell :type \"Module\"\n" +
		"  (sketch \"The UI shell user interacts via.\")\n" +
		"  (message KeyChord (sketch \"A normalized key combination.\"))\n" +
		"  (block Shell.Keymap\n" +
		"    (port :out KeyChord :as chord)\n" +
		"    (sketch \"Turns raw key events into chords.\")))\n"
	wantErr := "sbtel query: no element Shell.Kemap (did you mean Shell.Keymap?)\nsbtel query: no element Clipbord (did you mean Shell.Clipboard?)\n"
	if c != 2 || out != want || errs != wantErr {
		t.Errorf("exit %d\n got:\n%s%s\nwant:\n%s%s", c, out, errs, want, wantErr)
	}
	c, out, _ = runT("", "query", sampleSpec, "Shell.Keymap", "--with-deps")
	if c != 0 || !strings.Contains(out, "; may bind to (collapsed): Shell.Router, Shell.Clipboard, Shell.LowLevelThing, Shell.SurfaceKit, Shell.SessionStore\n") {
		t.Errorf("with-deps: exit %d\n%s", c, out)
	}
}

// Every query of every element of the examples (alone and with --with-deps) is a fragment that lints
// clean, and the stubs bind the same way in the fragment as in the spec.
func TestQueryFragmentsLint(t *testing.T) {
	en, err := engine.New()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{sampleSpec, "../../examples/viewer.sbtel", "../../conformance/specs/playground.sbtel", "../../conformance/specs/v22-behaviors.sbtel"} {
		src := mustRead(t, p)
		var model struct {
			Model struct {
				Blocks struct {
					Map [][]json.RawMessage `json:"$map"`
				} `json:"blocks"`
				Behaviors struct {
					Map [][]json.RawMessage `json:"$map"`
				} `json:"behaviors"`
				Messages struct {
					Map [][]json.RawMessage `json:"$map"`
				} `json:"messages"`
			} `json:"model"`
		}
		s, _ := en.Call("parseSpec", src)
		if err := json.Unmarshal([]byte(s), &model); err != nil {
			t.Fatal(err)
		}
		var ids []string
		add := func(m [][]json.RawMessage, prefix string) {
			for _, kv := range m {
				var k string
				json.Unmarshal(kv[0], &k)
				ids = append(ids, prefix+k)
			}
		}
		add(model.Model.Blocks.Map, "")
		add(model.Model.Behaviors.Map, "beh:")
		add(model.Model.Messages.Map, "msg:")
		if len(ids) < 12 {
			t.Fatalf("%s: only %d ids", p, len(ids))
		}
		for i, id := range ids {
			if strings.Contains(p, "playground") && i%4 != 0 {
				continue // goja is slow; the node property run covers every id (see the report)
			}
			for _, deps := range []bool{false, true} {
				ij, _ := json.Marshal([]string{id})
				q, err := en.Call("query", src, string(ij), deps)
				if err != nil {
					t.Fatal(err)
				}
				var r struct {
					Fragment string   `json:"fragment"`
					Stubs    []string `json:"stubs"`
				}
				json.Unmarshal([]byte(q), &r)
				l, _ := en.Call("lint", r.Fragment)
				if !strings.Contains(l, `"ok":true`) {
					txt, _ := en.Call("lintText", "fragment", r.Fragment)
					t.Errorf("%s %s deps=%v: fragment does not lint clean:\n%s\n%s", p, id, deps, txt, r.Fragment)
				}
				if deps && !strings.Contains(id, ":") {
					bind := ""
					for _, st := range r.Stubs {
						bind += id + " -> " + st + "\n"
					}
					for _, s := range []string{src, r.Fragment} {
						c, _ := en.Call("check", s, bind)
						if !strings.Contains(c, `"ok":true`) {
							t.Errorf("%s %s: a stub is not bindable: %s", p, id, c)
						}
					}
				}
			}
		}
	}
}

// diffText against a hand-written DiffResult (DESIGN.md §7.1) that uses every tag and Fields key.
func TestDiffTextFixture(t *testing.T) {
	fixture := `{
	 "changes": [
	  {"element":"block","tags":["added"],"a":null,"b":{"id":"Shell.Banner2","name":"Shell.Banner2","in":"Shell.Notification","lines":{"start":3,"end":3}},"moved":null,"renamed":null,"fields":null},
	  {"element":"block","tags":["moved","renamed","changed"],"a":{"id":"Shell.Item","name":"Shell.Item","in":"Shell.Transcript","lines":{"start":1,"end":2}},
	   "b":{"id":"Shell.Turn","name":"Shell.Turn","in":"Shell.SessionView","lines":{"start":1,"end":2}},
	   "moved":{"from":{"in":"Shell.Transcript","level":2},"to":{"in":"Shell.SessionView","level":1}},
	   "renamed":{"from":"Shell.Item","to":"Shell.Turn","similarity":0.83},
	   "fields":{"type":{"from":"A","to":"B"},
	     "sketch":{"from":"keep old words","to":"keep new words","words":[{"op":"=","text":"keep"},{"op":"-","text":"old words"},{"op":"+","text":"new words"}]},
	     "implements":{"added":["Durable"],"removed":[]},
	     "ports":{"added":[{"name":"x","dir":"in","kind":"Foo","via":null}],"removed":[{"name":"y","dir":"out","kind":"Bar","via":null}],
	              "changed":[{"name":"z","from":{"name":"z","dir":"in","kind":"Z"},"to":{"name":"z","dir":"out","kind":"Z"}},
	                         {"name":"w","from":{"name":"w","dir":"in","kind":"W"},"to":{"name":"w","dir":"in","kind":"W"},"sketch":{"from":"","to":"Once","words":[{"op":"+","text":"Once"}]}}]},
	     "drawer":{"in":{"added":["x: Foo"],"removed":[]},"out":{"added":[],"removed":["y: Bar"]}},
	     "adjacency":{"added":["Shell.TurnActions"],"removed":["Shell.Old"]},
	     "levels":[{"level":1,"name":{"from":null,"to":"Core"},"sketch":{"from":"a","to":"b","words":[{"op":"-","text":"a"},{"op":"+","text":"b\n\nc"}]},"groups":[{"blocks":["X","Y"],"sketch":{"from":"","to":"why","words":[{"op":"+","text":"why"}]}}]}]}},
	  {"element":"behavior","tags":["changed"],"a":{"id":"β:Box","name":"Box","in":null,"lines":{"start":1,"end":1}},"b":{"id":"β:Box","name":"Box","in":null,"lines":{"start":1,"end":1}},
	   "moved":null,"renamed":null,"fields":{"params":{"from":["T"],"to":["T","K"]}}},
	  {"element":"message","tags":["moved","changed"],"a":{"id":"μ:Ack","name":"Ack","in":"A","lines":{"start":1,"end":1}},"b":{"id":"μ:Ack","name":"Ack","in":null,"lines":{"start":1,"end":1}},
	   "moved":{"from":{"in":"A","level":null},"to":{"in":null,"level":null}},"renamed":null,"fields":{"refines":{"from":"Msg","to":null}}},
	  {"element":"message","tags":["removed"],"a":{"id":"μ:Notice","name":"Notice","in":"Shell","lines":{"start":5,"end":5}},"b":null,"moved":null,"renamed":null,"fields":null}
	 ],
	 "affected":[{"owner":"Shell.Router","port":"intent","dir":"in","kind":"Intent","lost":[{"owner":"Shell.Composer","port":"submit"}],"gained":[{"owner":"Shell.X","port":"y"}]}],
	 "summary":{"added":1,"removed":1,"moved":2,"renamed":1,"changed":3,"affected":1}
	}`
	en, err := engine.New()
	if err != nil {
		t.Fatal(err)
	}
	got, err := en.Call("diffText", fixture)
	if err != nil {
		t.Fatal(err)
	}
	want := `+ block Shell.Banner2 (in Shell.Notification)
~ block Shell.Turn: renamed from Shell.Item (0.83); moved from Shell.Transcript level 2 to Shell.SessionView level 1; type "A" -> "B"; sketch [-old words-] {+new words+}; implements +Durable; ports +in x: Foo -out y: Bar ~in z: Z -> out z: Z ~in w: W sketch {+Once+}; drawer in +x: Foo out -y: Bar; adjacency +Shell.TurnActions -Shell.Old; level 1 name none -> "Core"; level 1 sketch [-a-] {+b¶c+}; level 1 adjacent (X Y) sketch {+why+}
~ behavior Box: params (T) -> (T K)
~ message Ack: moved from A to the file; refines Msg -> none
- message Notice (was in Shell)
! port Shell.Router.intent (in Intent): lost Shell.Composer.submit; gained Shell.X.y
5 changes (1 added, 1 removed, 2 moved, 1 renamed, 3 changed), 1 affected port
`
	if got != want {
		t.Errorf("got:\n%s\nwant:\n%s", got, want)
	}
	if s, _ := en.Call("diffText", `{"changes":[],"affected":[],"summary":{}}`); s != "no changes\n" {
		t.Errorf("empty diff: %q", s)
	}
}

// Before workstream C's diffSpecs exists, `diff` is exit 2 with "diff is not implemented yet".
func TestDiffNotImplemented(t *testing.T) {
	en, err := engine.NewFrom(sbtel.CoreJS+"\n;diffSpecs = undefined;\n", sbtel.APIJS)
	if err != nil {
		t.Fatal(err)
	}
	r, err := en.CLI("diff", map[string]any{"files": []engine.File{{Name: "a", Src: "(block A)"}, {Name: "b", Src: "(block B)"}}})
	if err != nil {
		t.Fatal(err)
	}
	if r.Exit != 2 || r.Stdout != "" || r.Stderr != "sbtel diff: diff is not implemented yet\n" {
		t.Errorf("got %+v", r)
	}
}

// A generated spec of about 600 blocks: every command stays fast. Timings go to the test log (-v).
func TestLargeSpec(t *testing.T) {
	var b strings.Builder
	b.WriteString("(message Req)\n(message Evt (refines Req))\n(behavior Durable (port :in Evt :as keep))\n(block Sys\n")
	n, names := 1, []string{"Sys"}
	var block func(depth int, ind string)
	block = func(depth int, ind string) {
		name := fmt.Sprintf("B%d", n)
		n++
		names = append(names, name)
		fmt.Fprintf(&b, "%s(block %s (port :in Req :as in%d) (port :out Evt :as out%d) (implements Durable) (sketch \"block %d\")", ind, name, n, n, n)
		if depth < 3 {
			for l := 0; l < 2; l++ {
				fmt.Fprintf(&b, "\n%s  (level (adjacent\n", ind)
				for i := 0; i < 3; i++ {
					block(depth+1, ind+"    ")
					b.WriteString("\n")
				}
				fmt.Fprintf(&b, "%s    ))", ind)
			}
		}
		b.WriteString(")")
	}
	for l := 0; l < 4; l++ {
		b.WriteString("  (level\n")
		for i := 0; i < 4; i++ {
			block(1, "    ")
			b.WriteString("\n")
		}
		b.WriteString("  )\n")
	}
	b.WriteString(")\n")
	src := b.String()
	if len(names) < 600 {
		t.Fatalf("only %d blocks", len(names))
	}
	dir := t.TempDir()
	spec, spec2, bind := dir+"/big.sbtel", dir+"/big2.sbtel", dir+"/big.txt"
	os.WriteFile(spec, []byte(src), 0o600)
	os.WriteFile(spec2, []byte(strings.Replace(src, "(block B7 ", "(block B7renamed ", 1)), 0o600)
	var edges strings.Builder
	for i := 1; i < len(names); i++ {
		fmt.Fprintf(&edges, "%s -> %s  # f.go:%d\n", names[i], names[(i*7)%len(names)], i)
	}
	os.WriteFile(bind, []byte(edges.String()), 0o600)
	for _, tc := range []struct {
		args []string
		exit int
	}{
		{[]string{"lint", spec}, 0},
		{[]string{"check", spec, "--bindings", bind}, 1},
		{[]string{"query", spec, names[300], "--with-deps"}, 0},
		{[]string{"query", spec, "Sys", "--json"}, 0},
		{[]string{"diff", spec, spec2}, 1},
	} {
		start := time.Now()
		c, out, errs := runT("", tc.args...)
		d := time.Since(start)
		t.Logf("%d blocks: sbtel %s: %v (exit %d, %d bytes)", len(names), tc.args[0], d.Round(time.Millisecond), c, len(out))
		if c != tc.exit {
			t.Errorf("%v: exit %d, want %d: %s", tc.args, c, tc.exit, errs)
		}
		if d > 20*time.Second {
			t.Errorf("%v took %v", tc.args, d)
		}
	}
}
