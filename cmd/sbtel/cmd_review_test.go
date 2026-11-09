package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/shashi/sbtel/internal/state"
)

// A review through the real server (its diff text comes from the engine, as in `sbtel serve`): one
// event in the inbox with the message, the diff, the proposed spec's path and the comments; the spec
// file is untouched; replies go to the review's comments and to the review; a forced save says so.
func TestReviewInboxAndForceSave(t *testing.T) {
	home, _ := foreground(t)
	p := state.Paths{Home: home}
	dir := t.TempDir()
	spec := filepath.Join(dir, "a.sbtel")
	v1 := "(block A\n  (level (block A.Ui (sketch \"The screen.\")))\n  (level (block A.Store)))\n"
	os.WriteFile(spec, []byte(v1), 0o644)
	_, out, _ := runT("", "open", spec)
	id := strings.TrimSpace(out)
	info, _ := state.ReadServer(p)
	base := "http://127.0.0.1:" + itoa(info.Port)
	post := func(route string, body any) (string, error) {
		b, _ := json.Marshal(body)
		return httpPost(base+"/s/"+id+"/"+route, base, string(b))
	}

	proposed := strings.Replace(v1, "The screen.", "The screen, with a toolbar.", 1)
	resp, err := post("review", map[string]any{
		"message":  "Two things.\nSee the comments.",
		"comments": []map[string]any{{"target": "block:A.Ui", "targetLabel": "block A.Ui", "text": "Split this.", "source": "(block A.Ui)"}, {"target": "block:A.Store", "targetLabel": "block A.Store", "text": "Keep a backup.", "source": "(block A.Store)"}},
		"proposal": map[string]any{"src": proposed, "base": state.Hash([]byte(v1)), "baseVersion": 1},
	})
	var r struct {
		ID       string
		Seq      int
		Comments []string
		Proposal string
	}
	if err != nil || json.Unmarshal([]byte(resp), &r) != nil || r.ID != "r2" || len(r.Comments) != 2 || r.Comments[0] != "c2.1" {
		t.Fatalf("review: %v %s", err, resp)
	}
	if b, _ := os.ReadFile(spec); string(b) != v1 {
		t.Errorf("a review wrote the spec file: %q", b)
	}
	if b, _ := os.ReadFile(p.Proposal(id, 2)); string(b) != proposed || r.Proposal != p.Proposal(id, 2) {
		t.Errorf("proposal file %s: %q", r.Proposal, b)
	}

	c, js, _ := runT("", "inbox", id, "--json", "--peek")
	var ev map[string]any
	if c != 0 || json.Unmarshal([]byte(strings.TrimSpace(js)), &ev) != nil || ev["kind"] != "review" || ev["id"] != "r2" || ev["message"] != "Two things.\nSee the comments." {
		t.Fatalf("inbox --json: %d %s", c, js)
	}
	pr := ev["proposal"].(map[string]any)
	if pr["path"] != p.Proposal(id, 2) || pr["baseVersion"].(float64) != 1 || pr["base"] != state.Hash([]byte(v1)) || pr["hash"] != state.Hash([]byte(proposed)) ||
		!strings.Contains(pr["diffText"].(string), "~ block A.Ui: sketch") {
		t.Errorf("inbox --json proposal: %v", pr)
	}
	if cs := ev["comments"].([]any); len(cs) != 2 || cs[1].(map[string]any)["id"] != "c2.2" || cs[1].(map[string]any)["text"] != "Keep a backup." {
		t.Errorf("inbox --json comments: %v", cs)
	}

	c, txt, _ := runT("", "inbox", id)
	want := regexp.MustCompile(`^r2 review of version 1 by user, \S+: a message, 2 comments, proposed edits
  > Two things\.
  > See the comments\.
  edits against version 1 \(sbtel diff\):
    ~ block A\.Ui: sketch \[-screen\.-\] \{\+screen, with a toolbar\.\+\}
    1 change \(.*\), 0 affected ports
  proposed spec: ` + regexp.QuoteMeta(p.Proposal(id, 2)) + `
  c2\.1 comment on block A\.Ui
    > Split this\.
    source:
      \(block A\.Ui\)
  c2\.2 comment on block A\.Store
    > Keep a backup\.
    source:
      \(block A\.Store\)
$`)
	if c != 0 || !want.MatchString(txt) {
		t.Errorf("inbox text:\n%s", txt)
	}
	if c, out, _ := runT("", "inbox", id, "--wait", "--timeout", "0.2"); c != 0 || out != "" {
		t.Errorf("inbox --wait after reading the review: %d %q", c, out)
	}

	// Replies: to one comment of the review, and to the review as a whole; not to an unknown id.
	for _, to := range []string{"c2.1", "r2"} {
		if c, _, errs := runT("", "reply", id, to, "Done."); c != 0 {
			t.Errorf("reply to %s: %d %s", to, c, errs)
		}
	}
	if c, _, _ := runT("", "reply", id, "c2.9", "x"); c != 2 {
		t.Errorf("reply to an unknown review comment: %d", c)
	}

	// A comment-only review: no proposal, no file. An empty review is refused.
	resp, _ = post("review", map[string]any{"comments": []map[string]any{{"target": "block:A", "text": "Only this."}}})
	if !strings.Contains(resp, `"proposal":null`) {
		t.Errorf("comment-only review: %s", resp)
	}
	if resp, _ = post("review", map[string]any{"message": "  "}); !strings.Contains(resp, "empty review") {
		t.Errorf("empty review: %s", resp)
	}
	_, txt, _ = runT("", "inbox", id)
	if !strings.HasPrefix(txt, "r5 review of version 1 by user, ") || !strings.Contains(txt, ": 1 comment\n  c5.1 comment on block:A\n    > Only this.\n") {
		t.Errorf("comment-only review text:\n%s", txt)
	}

	// The agent pushes v2; a save on base v1 is refused (409, by agent), then forced.
	os.WriteFile(spec, []byte(proposed), 0o644)
	runT("", "open", spec, "--session", id)
	resp, _ = post("save", map[string]any{"base": state.Hash([]byte(v1)), "src": "(block Mine)\n"})
	if !strings.Contains(resp, `"by":"agent"`) || !strings.Contains(resp, `"version":2`) {
		t.Errorf("stale save: %s", resp)
	}
	if b, _ := os.ReadFile(spec); string(b) != proposed {
		t.Errorf("a refused save wrote the file")
	}
	resp, _ = post("save", map[string]any{"base": state.Hash([]byte(v1)), "src": "(block Mine)\n", "force": true})
	if !strings.Contains(resp, `"version":3`) {
		t.Errorf("forced save: %s", resp)
	}
	if b, _ := os.ReadFile(spec); string(b) != "(block Mine)\n" {
		t.Errorf("forced save did not write: %q", b)
	}
	_, txt, _ = runT("", "inbox", id)
	if !strings.HasPrefix(txt, "save version 3 by user (was 2, which the user overwrote without merging), ") {
		t.Errorf("forced save text: %q", txt)
	}
	_, js, _ = runT("", "inbox", id, "--json") // already read: empty
	if js != "" {
		t.Errorf("inbox after reading: %q", js)
	}
	evs, _ := state.ReadEvents(p, id)
	if last := evs[len(evs)-1]; last.Kind != "save" || !last.Force {
		t.Errorf("forced save event: %+v", last)
	}
}
