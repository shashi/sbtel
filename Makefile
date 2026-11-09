# sbtel build. Targets: all (default), viewer, check-viewer, test, conformance, build, release, accept,
# selfcheck and edges (the viewer's own spec against its code), and test-all (everything, including the
# browser tests). Go 1.24+, node 18+.
# docs-check runs the specs and outputs in the docs through the binary (tools/docs/snippets.mjs).
# `accept` also needs google-chrome and python3 with playwright; `test-viewer-diff` and `test-e2e`
# need playwright for node (a preinstalled tool, not a repo dependency); `test-owners` needs python3.
# `selfcheck` and `edges` need python3, and npm once: they install a pinned TypeScript checker into
# tools/selfcheck/node_modules (a dev-only dependency; the binary and the page never use it).
export GOPROXY ?= direct
export GOSUMDB ?= off

.PHONY: all viewer check-viewer notices check-notices test test-race conformance conformance-update build release accept \
	test-owners test-viewer-diff test-e2e test-all test-install selfcheck edges docs-check clean

all: check-viewer check-notices conformance test build

viewer:                         ## rebuild viewer/dist/index.html from viewer/src + core
	node viewer/build.mjs

check-viewer:                   ## fail if viewer/dist/index.html is stale
	node viewer/build.mjs --check

notices:                        ## rewrite THIRD_PARTY_NOTICES from the linked modules' license files
	scripts/third-party-notices.sh

check-notices:                  ## fail if THIRD_PARTY_NOTICES is stale
	scripts/third-party-notices.sh --check

conformance:                    ## node reference run against conformance/expected
	node conformance/run-node.mjs

conformance-update:             ## rewrite conformance/expected from node (review the diff!)
	node conformance/run-node.mjs --update

test:                           ## go vet + go test (goja conformance, CLI glue)
	go vet ./...
	go test ./...

test-race:                      ## go test with the race detector
	go test -race ./...

build:                          ## local binary at bin/sbtel
	go build -o bin/sbtel ./cmd/sbtel

release:                        ## six targets + THIRD_PARTY_NOTICES + checksums into dist/
	scripts/release.sh

accept: check-viewer            ## viewer acceptance suites, standalone mode
	viewer/test/run.sh

test-owners:                    ## the sbtel-recover helpers' tests (python3, and go for sbtel_refs_go)
	python3 -I plugin/skills/sbtel-recover/scripts/test_sbtel_owners.py
	go -C plugin/skills/sbtel-recover/scripts/sbtel_refs_go vet .
	go -C plugin/skills/sbtel-recover/scripts/sbtel_refs_go test .

test-viewer-diff: check-viewer  ## diff view in headless Chrome (fixtures, dev hook, stub server)
	node conformance/diff/viewer.test.mjs

test-e2e: check-viewer          ## the session loop end to end: binary, server, page in headless Chrome
	node internal/server/e2e/e2e.js

# sbtel's own architecture (docs/DESIGN.md §8): examples/viewer.sbtel, the @sbtel annotations in
# VIEWER_SRC and examples/viewer.edges.txt must agree, and so must examples/sbtel.sbtel, the annotations
# in GO_SRC and examples/sbtel.edges.txt; every violation must be explained.
# An edges file is stale only when its edges or comments (VIOLATION notes) change: line numbers that
# drift with an ordinary edit do not fail selfcheck (tools/selfcheck/stale.mjs); `make edges` refreshes them.
VIEWER_SRC = core/core.js viewer/src/index.html viewer/src/session.js viewer/src/review.js viewer/src/server.js viewer/src/diff.js viewer/src/play.js
GO_SRC = $(filter-out %_test.go,$(wildcard assets.go cmd/sbtel/*.go internal/*/*.go))

tools/selfcheck/node_modules/.package-lock.json: tools/selfcheck/package.json tools/selfcheck/package-lock.json
	cd tools/selfcheck && npm ci --no-audit --no-fund --loglevel=error

selfcheck: build tools/selfcheck/node_modules/.package-lock.json   ## specs, annotations and edges of the viewer and the Go code agree
	bin/sbtel lint examples/viewer.sbtel examples/sbtel.sbtel
	python3 -I plugin/skills/sbtel-recover/scripts/sbtel_owners.py examples/viewer.sbtel $(VIEWER_SRC) > /dev/null
	python3 -I plugin/skills/sbtel-recover/scripts/sbtel_owners.py examples/sbtel.sbtel $(GO_SRC) > /dev/null
	node tools/selfcheck/refs.test.mjs
	node tools/selfcheck/stale.test.mjs
	node tools/selfcheck/edges.mjs --check
	node tools/selfcheck/violations.mjs bin/sbtel
	@echo "make selfcheck: ok"

edges: tools/selfcheck/node_modules/.package-lock.json   ## regenerate examples/viewer.edges.txt and sbtel.edges.txt (keeps the VIOLATION notes)
	node tools/selfcheck/edges.mjs

docs-check: build                ## every spec, lint, query and check output in the docs matches the binary
	node tools/docs/snippets.mjs --bin bin/sbtel

test-all: all test-race test-owners selfcheck docs-check test-viewer-diff test-e2e accept   ## everything
	@echo "make test-all: all passed"

test-install:                   ## install.sh against dist/ (run `make release` first; Linux)
	scripts/test-install.sh

clean:
	rm -rf bin dist tools/selfcheck/node_modules
