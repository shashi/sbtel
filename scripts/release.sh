#!/bin/sh
# Cross-compiles sbtel for the six release targets into dist/, copies THIRD_PARTY_NOTICES beside them,
# and writes dist/checksums.txt (all seven files).
#   scripts/release.sh            (from anywhere; writes <repo>/dist/)
# Output names are the install contract (docs/DESIGN.md §9): sbtel_<os>_<arch>[.exe].
# Static, CGO-free binaries; the version comes from the embedded VERSION file.
set -eu
cd "$(dirname "$0")/.."
: "${GOPROXY:=direct}" "${GOSUMDB:=off}"; export GOPROXY GOSUMDB
node viewer/build.mjs --check
scripts/third-party-notices.sh --check
rm -rf dist; mkdir -p dist
for t in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64; do
  os=${t%/*}; arch=${t#*/}; ext=; [ "$os" = windows ] && ext=.exe
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags='-s -w' -o "dist/sbtel_${os}_${arch}${ext}" ./cmd/sbtel
  echo "built dist/sbtel_${os}_${arch}${ext}"
done
cp THIRD_PARTY_NOTICES dist/
cd dist
if command -v sha256sum >/dev/null 2>&1; then sha256sum sbtel_* THIRD_PARTY_NOTICES > checksums.txt; else shasum -a 256 sbtel_* THIRD_PARTY_NOTICES > checksums.txt; fi
echo "wrote dist/checksums.txt ($(wc -l < checksums.txt | tr -d ' ') entries), version $(cat ../VERSION)"
