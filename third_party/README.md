# third_party

`xtext/` is a pruned copy of golang.org/x/text **v0.22.0**, taken from the github.com/golang/text
mirror (commit 3b64043, "go.mod: update golang.org/x dependencies"). go.mod replaces
golang.org/x/text with it because the workspace proxy cannot fetch golang.org/x modules.

Only the packages goja imports, directly or indirectly, are kept, without tests or testdata:
cases, collate, internal, internal/colltab, internal/language, internal/language/compact,
internal/tag, language, transform, unicode/norm, unicode/rangetable (plus go.mod, LICENSE, PATENTS,
which is BSD-3-Clause). Regenerate the list with
`go list -deps ./... | grep golang.org/x/text` if the goja pin changes.

When the repo moves somewhere that can reach golang.org, delete this directory and the `replace`
line in go.mod.
