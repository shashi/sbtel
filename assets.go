// @sbtel file Sbtel.Assets

// Package sbtel holds the files every part of the binary shares, embedded at build time:
// the JS core (core/core.js, core/api.js), the built viewer page, the version string, and the
// license texts that `sbtel licenses` prints.
// It sits at the module root because go:embed cannot reach outside a package's directory.
package sbtel

import (
	_ "embed"
	"strings"
)

//go:generate node viewer/build.mjs

//go:embed core/core.js
var CoreJS string

//go:embed core/api.js
var APIJS string

// ViewerHTML is viewer/dist/index.html. It is committed; rebuild it with `make viewer` (or
// `go generate .`) after changing viewer/src or core, and `make check-viewer` catches a stale copy.
//
//go:embed viewer/dist/index.html
var ViewerHTML string

//go:embed VERSION
var version string

// Version is the release version, from the VERSION file (one line).
func Version() string { return strings.TrimSpace(version) }

// License is sbtel's own license (LICENSE, MIT).
//
//go:embed LICENSE
var License string

// ThirdPartyNotices is THIRD_PARTY_NOTICES: the full license text of every third-party module linked
// into the binary (goja and its dependencies, golang.org/x/text) and of the Go standard library.
// Regenerate it with scripts/third-party-notices.sh; `make check-notices` catches a stale copy.
//
//go:embed THIRD_PARTY_NOTICES
var ThirdPartyNotices string
