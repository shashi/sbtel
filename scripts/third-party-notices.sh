#!/bin/sh
# Writes THIRD_PARTY_NOTICES: the full license text of every third-party module linked into the sbtel
# binary, copied from the module sources themselves (the Go module cache, or third_party/ for a
# replaced module), plus the Go standard library and runtime, which every Go binary contains.
#   scripts/third-party-notices.sh            write THIRD_PARTY_NOTICES
#   scripts/third-party-notices.sh --check    exit 1 if THIRD_PARTY_NOTICES is stale
# The modules are what `go list -deps ./cmd/sbtel` links. For each one it takes the license files at
# the module root (LICENSE*, LICENCE*, COPYING*, NOTICE*, PATENTS*) and any LICENSE* file in the
# directory of a package that is linked (goja's ftoa code carries two of its own). The binary embeds
# the file (assets.go) and `sbtel licenses` prints it; the release ships it beside the binaries.
# The fonts that the viewer page embeds (viewer/fonts/*.woff2, inlined by viewer/build.mjs, so they are
# in the binary too) get a section each, from their license file viewer/fonts/<font>-OFL.txt, and the
# icons it draws (viewer/icons/*.svg, Lucide) get one from viewer/icons/LICENSE.
set -eu
cd "$(dirname "$0")/.."
: "${GOPROXY:=direct}" "${GOSUMDB:=off}"; export GOPROXY GOSUMDB
out=$(mktemp); trap 'rm -f "$out" "$out.pk"' EXIT
self=$(go list -m)
go list -deps -f '{{if .Module}}{{.Module.Path}}	{{.Dir}}{{end}}' ./cmd/sbtel > "$out.pk"
rule='================================================================================'
sub='--------------------------------------------------------------------------------'
{
  printf 'Third-party notices for sbtel\n\n'
  printf 'The sbtel binary includes the third-party software below. Each section names a module and its\n'
  printf 'version, or a font that the viewer page embeds, and the license file it comes from, followed by\n'
  printf 'that file'"'"'s full text. sbtel itself is under the MIT license (LICENSE). Regenerate this file\n'
  printf 'with scripts/third-party-notices.sh.\n'
  go list -deps -f '{{with .Module}}{{.Path}}	{{.Version}}	{{.Dir}}{{with .Replace}}	{{.Path}}{{end}}{{end}}' ./cmd/sbtel |
    sort -u | while IFS='	' read -r path ver dir repl; do
      [ "$path" = "$self" ] && continue
      printf '\n%s\n%s %s\n' "$rule" "$path" "$ver"
      [ -n "${repl:-}" ] && printf '(built from the copy in %s)\n' "$repl"
      files=$(cd "$dir" && { ls -1 | grep -E '^(LICEN[CS]E|COPYING|NOTICE|PATENTS)' || true
        grep "^$path	" "$out.pk" | cut -f2 | while read -r pd; do
          [ "$pd" = "$dir" ] && continue
          for f in "$pd"/LICENSE*; do [ -f "$f" ] && printf '%s\n' "${f#"$dir"/}"; done
        done; } | sort -u)
      [ -n "$files" ] || { echo "third-party-notices: no license file found for $path in $dir" >&2; exit 1; }
      for f in $files; do
        printf '%s\n%s/%s\n%s\n\n' "$sub" "$path" "$f" "$sub"
        sed -e 's/[[:space:]]*$//' "$dir/$f"
      done
    done
  for lic in viewer/fonts/*-OFL.txt; do
    font=$(basename "$lic" -OFL.txt)
    ls viewer/fonts/"$font"-*.woff2 >/dev/null 2>&1 || { echo "third-party-notices: $lic has no viewer/fonts/$font-*.woff2" >&2; exit 1; }
    printf '\n%s\nfont %s (embedded in the viewer page: %s)\n' "$rule" "$font" "$(cd viewer/fonts && ls "$font"-*.woff2 | tr '\n' ' ' | sed 's/ $//')"
    printf '%s\n%s\n%s\n\n' "$sub" "$lic" "$sub"
    sed -e 's/[[:space:]]*$//' "$lic"
  done
  for f in viewer/fonts/*.woff2; do
    font=$(basename "$f" | sed -E 's/-(latin-ext|latin|greek|cyrillic-ext|cyrillic|vietnamese)-wght-normal\.woff2$//')
    [ -f "viewer/fonts/$font-OFL.txt" ] || { echo "third-party-notices: no license file viewer/fonts/$font-OFL.txt for $f" >&2; exit 1; }
  done
  ls viewer/icons/*.svg >/dev/null 2>&1 && {
    printf '\n%s\nicons Lucide (drawn into the viewer page: %s)\n' "$rule" "$(cd viewer/icons && ls *.svg | sed 's/\.svg$//' | tr '\n' ' ' | sed 's/ $//')"
    printf '%s\n%s\n%s\n\n' "$sub" viewer/icons/LICENSE "$sub"
    sed -e 's/[[:space:]]*$//' viewer/icons/LICENSE
  }
  printf '\n%s\nThe Go standard library and runtime (Go %s)\n' "$rule" "$(sed -n 's/^go \([0-9.]*\).*/\1/p' go.mod)"
  for f in LICENSE PATENTS; do
    printf '%s\ngo/%s\n%s\n\n' "$sub" "$f" "$sub"
    sed -e 's/[[:space:]]*$//' "$(go env GOROOT)/$f"
  done
} > "$out"
if [ "${1:-}" = --check ]; then
  # Compared with \r\n read as \n, so a CRLF checkout of THIRD_PARTY_NOTICES is not "stale".
  if tr -d '\r' < THIRD_PARTY_NOTICES | cmp -s "$out" -; then echo "THIRD_PARTY_NOTICES is up to date"; exit 0; fi
  echo "THIRD_PARTY_NOTICES is stale: run scripts/third-party-notices.sh" >&2; exit 1
fi
cp "$out" THIRD_PARTY_NOTICES
echo "wrote THIRD_PARTY_NOTICES ($(grep -c "^$rule" THIRD_PARTY_NOTICES) sections)"
