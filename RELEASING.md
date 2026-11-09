# Releasing sbtel

A release is eight files attached to a GitHub release: the six binaries `sbtel_<os>_<arch>[.exe]`
(linux, darwin and windows, each amd64 and arm64), `THIRD_PARTY_NOTICES` (the licenses of the code
the binaries bundle; `sbtel licenses` prints the same text) and `checksums.txt` (`sha256sum`
format, covering the other seven).
`scripts/release.sh` builds them into `dist/` (docs/DESIGN.md §9.1). The installers download from
the release, so the file names are a contract.

## The repository

The repository is `shashi/sbtel` on GitHub. The installers, the plugin manifests and the docs name it
in their URLs (`https://github.com/shashi/sbtel/...` and
`https://raw.githubusercontent.com/shashi/sbtel/main/...`); to find every one, run
`grep -rn 'shashi/sbtel' --exclude-dir=third_party --exclude-dir=dist --exclude-dir=bin .`. The
workflows do not name it: they use `${{ github.repository }}`.

## Where the installers point

- `install.sh` and `install.ps1` themselves are fetched from the default branch:
  `https://raw.githubusercontent.com/shashi/sbtel/main/install.sh` (and `install.ps1`).
- They download the binary and `checksums.txt` from
  `https://github.com/shashi/sbtel/releases/latest/download/`, the newest release that is not a
  prerelease or a draft. `SBTEL_VERSION=v0.2.0` selects `.../releases/download/v0.2.0/` instead, and
  `SBTEL_BASE_URL` overrides both (a local `dist/` with `file://`, or a mirror).
- So a release is live for the installers as soon as its assets are uploaded. A prerelease
  (a tag with a `-`, such as `v0.2.0-rc.1`) is reachable only with `SBTEL_VERSION`.

## Cutting a release

1. **Run everything locally**, including the browser tests that CI does not run (they need Chrome
   and Playwright): `make test-all` (vet, tests, `-race`, node conformance, the helper tests,
   `make selfcheck`, `make docs-check`, the diff viewer test, the e2e test and the 9 acceptance suites). Then
   `make release` and `make test-install` (install.sh against the fresh `dist/`).
2. **Set the version.** Write the version without the `v` into `VERSION` (for example `0.2.0`) and
   into `plugin/.claude-plugin/plugin.json`, add the release's section to `CHANGELOG.md`, run
   `make viewer` (the page shows the version), and commit them.
3. **Tag and push**: `git tag v0.2.0 && git push origin v0.2.0`. The tag must be `v` + VERSION;
   `release.yml` refuses anything else.
4. **The release workflow** (`.github/workflows/release.yml`) runs on the tag. Its `test` job checks
   the tag against VERSION and runs the viewer and notices staleness checks, node conformance, `go vet`,
   `go test -race`, the helper tests, `make selfcheck` and `make docs-check`. Its `release` job runs
   `scripts/release.sh`, checks that `dist/` holds eight files whose checksums verify, creates the
   GitHub release if there is none (`gh release create --verify-tag --generate-notes`, marked
   prerelease for a tag with a `-`), and uploads the eight files with `gh release upload --clobber`. Re-running the workflow replaces the
   assets.
5. **Check the release**: `curl -fsSL https://raw.githubusercontent.com/shashi/sbtel/main/install.sh | sh`
   on a clean machine, then `sbtel version`.
6. Set `VERSION` back to a dev version (`0.2.1-dev`), run `make viewer`, and commit.

To release by hand instead (no workflow): `scripts/release.sh`, then
`gh release create v0.2.0 --verify-tag --generate-notes dist/sbtel_* dist/THIRD_PARTY_NOTICES dist/checksums.txt`.

## The workflows

| File | When | What |
|---|---|---|
| `.github/workflows/ci.yml` | push to `main`, pull requests, manual | on ubuntu, macos and windows: viewer staleness check, node conformance, `go vet`, `go test -race` (plain `go test` on Windows, where `-race` needs cgo), the recover skill's helper tests (Python, and the Go reference helper), a build; on ubuntu also the notices check, `make selfcheck` and `make docs-check` |
| `.github/workflows/release.yml` | push of a `v*` tag | tests on ubuntu, then `scripts/release.sh` and the upload to the release |

The actions are pinned to full commit SHAs, with the tag in a comment. As of 2026-11-08 they are
`actions/checkout` v7.0.1, `actions/setup-go` v7.0.0 and `actions/setup-node` v7.1.0, all on the
node24 runtime (Actions Runner v2.327.1 or later, which GitHub-hosted runners have). The upload uses
the GitHub CLI that GitHub-hosted runners preinstall, authenticated by `GH_TOKEN` from the job's
token, with `contents: write` for that job only. To update an action, look up its new release, and
replace both the SHA and the comment.

`make selfcheck` installs its one dev package (a pinned `typescript`, `tools/selfcheck/package.json`
and `package-lock.json`) with `npm ci` on first use; nothing else in the repo uses npm.

Both workflows set `GOPROXY=direct` and `GOSUMDB=off`, like the Makefile (DESIGN.md §1, Build):
modules come from their origin repositories and `go.sum` is the check. `golang.org/x/text` is vendored
under `third_party/xtext` through a `replace` in go.mod.

## Go and goja versions

CI uses Go **1.24.x**, the `go 1.24` line in go.mod, which is also the toolchain the repo is
developed with. The pinned goja (`github.com/dop251/goja v0.0.0-20260603125802-cfe4039cb6d7`) needs
Go 1.20 or later, so 1.24 is comfortably supported.

CI can move to the latest Go and goja later. To do that:

1. Change `go-version` in both workflows (and the `go` line in go.mod, if a newer language version
   is wanted).
2. Update goja in go.mod and go.sum **by hand** (do not run `go mod tidy`; it tries to fetch goja's
   test-only dependencies), and check whether the new goja needs a newer `golang.org/x/text` than the
   vendored v0.22.0 in `third_party/xtext`.
3. Run `make test-all`. `go test ./internal/engine` is what proves that the core still runs in goja and
   matches node byte for byte; core.js uses ES2020 features, and newer syntax may not work in goja.
4. Run `make notices` (scripts/third-party-notices.sh): any change to the modules or their versions
   changes THIRD_PARTY_NOTICES, which the binary embeds. `make check-notices` and the release fail
   until it is regenerated. Commit it.
