package main

import (
	"os"
	"runtime/debug"
	"strings"
	"testing"
)

// `sbtel licenses` prints sbtel's license and the notice of every third-party module in the binary,
// each with its full license text (THIRD_PARTY_NOTICES, scripts/third-party-notices.sh).
func TestLicenses(t *testing.T) {
	c, out, _ := runT("", "licenses")
	if c != 0 {
		t.Fatalf("licenses: exit %d", c)
	}
	for _, f := range []string{"../../LICENSE", "../../THIRD_PARTY_NOTICES"} {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(out, strings.TrimRight(string(b), "\n")) {
			t.Errorf("licenses does not print all of %s", f)
		}
	}
	if !strings.Contains(out, "is under the MIT license") || !strings.Contains(out, "Copyright (c) 2026 Shashi Gowda") {
		t.Errorf("licenses: no MIT header for sbtel:\n%.300s", out)
	}
	// Every module linked into this (test) binary has a section, with its license file.
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		t.Fatal("no build info")
	}
	if len(bi.Deps) < 2 {
		t.Fatalf("build info lists %d modules", len(bi.Deps))
	}
	for _, d := range bi.Deps {
		head := "\n" + d.Path + " " + d.Version + "\n"
		i := strings.Index(out, head)
		if i < 0 {
			t.Errorf("licenses: no section for %s %s", d.Path, d.Version)
			continue
		}
		if !strings.Contains(out[i:], "\n"+d.Path+"/LICENSE\n") {
			t.Errorf("licenses: no LICENSE text for %s", d.Path)
		}
	}
	for _, want := range []string{
		"github.com/dop251/goja/LICENSE\n", "Copyright (c) 2016 Dmitry Panov", // goja, MIT
		"github.com/dop251/goja/ftoa/LICENSE_LUCENE\n", "github.com/dop251/goja/ftoa/internal/fast/LICENSE_V8\n",
		"golang.org/x/text/LICENSE\n", "golang.org/x/text/PATENTS\n", // BSD-3, from third_party/xtext
		"github.com/google/pprof/LICENSE\n", "Apache License",
		"The Go standard library and runtime", "go/LICENSE\n",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("licenses: missing %q", strings.TrimSpace(want))
		}
	}
	if c, _, _ := runT("", "licenses", "extra"); c != 2 {
		t.Errorf("licenses extra: exit %d, want 2", c)
	}
}
