#!/bin/sh
# Tests install.sh (DESIGN.md §9.2, §9.4) against the release files in dist/, under sh, dash and bash
# (each when installed). Run scripts/release.sh first.
#   scripts/test-install.sh [dist-dir]          (make test-install)
# It serves dist/ over http on a free port for the wget case (python3), and uses file:// otherwise.
# Linux-only for now: the happy paths run the linux binary for the machine's arch.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
INST=$ROOT/install.sh
DIST=$(cd "${1:-$ROOT/dist}" && pwd) || { echo "no dist directory; run scripts/release.sh"; exit 2; }
[ -f "$DIST/checksums.txt" ] || { echo "$DIST has no checksums.txt; run scripts/release.sh"; exit 2; }
W=$(mktemp -d "${TMPDIR:-/tmp}/sbtel-install-test.XXXXXX")
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
(cd "$DIST" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$W"' EXIT INT TERM
i=0; until curl -fsS "http://127.0.0.1:$PORT/checksums.txt" >/dev/null 2>&1; do
	i=$((i+1)); [ $i -gt 100 ] && { echo "http server did not start"; exit 2; }; sleep 0.1
done
pass=0; fail=0
ok() { pass=$((pass+1)); echo "PASS $*"; }
ko() { fail=$((fail+1)); echo "FAIL $*"; }

# A PATH of symlinks with chosen tools only.
mkbin() { # mkbin <dir> <tool>...
	bd=$1; shift; mkdir -p "$bd"
	for t in "$@"; do p=$(command -v "$t") && ln -sf "$p" "$bd/$t"; done
}
BASE_TOOLS="sh dash bash uname mktemp rm mkdir cp chmod mv awk cat printf sha256sum shasum"

SHELLS=; for c in sh dash bash; do command -v $c >/dev/null 2>&1 && SHELLS="$SHELLS $c"; done
for SH in $SHELLS; do
	# 1. happy path with curl, file:// base, custom dir not on PATH -> PATH hint (on stderr, with the other messages)
	d=$W/$SH/ok; mkdir -p "$d"
	out=$(SBTEL_BASE_URL="file://$DIST" SBTEL_INSTALL_DIR="$d/bin" $SH "$INST" 2>"$d/err"); rc=$?
	if [ $rc -eq 0 ] && [ -x "$d/bin/sbtel" ] && "$d/bin/sbtel" version | grep -q '^sbtel ' \
		&& grep -q "export PATH=\"$d/bin:\$PATH\"" "$d/err" && ! printf '%s' "$out" | grep -q 'export PATH' \
		&& [ "$(stat -c %a "$d/bin/sbtel")" = 755 ]; then ok "$SH: installs from file:// with PATH hint"
	else ko "$SH: happy path rc=$rc out=$out err=$(cat "$d/err")"; fi
	ls -a "$d/bin" | grep -q part && ko "$SH: leftover .part file"

	# 2. dir already on PATH -> no hint; piped through stdin like curl | sh
	d=$W/$SH/onpath; mkdir -p "$d/bin"
	out=$(PATH="$d/bin:$PATH" SBTEL_BASE_URL="file://$DIST/" SBTEL_INSTALL_DIR="$d/bin" $SH < "$INST" 2>&1); rc=$?
	if [ $rc -eq 0 ] && ! printf '%s' "$out" | grep -q 'export PATH'; then ok "$SH: piped stdin, no hint when on PATH"; else ko "$SH: onpath rc=$rc out=$out"; fi

	# 3. default dir is $HOME/.local/bin
	d=$W/$SH/home; mkdir -p "$d"
	HOME=$d SBTEL_BASE_URL="file://$DIST" $SH "$INST" >/dev/null 2>&1; rc=$?
	if [ $rc -eq 0 ] && [ -x "$d/.local/bin/sbtel" ]; then ok "$SH: default ~/.local/bin"; else ko "$SH: default dir rc=$rc"; fi

	# 4. checksum mismatch -> fatal, nothing installed
	d=$W/$SH/bad; mkdir -p "$d/dist"; cp "$DIST"/* "$d/dist/"
	printf 'x' >> "$d/dist/sbtel_linux_amd64"
	err=$(SBTEL_BASE_URL="file://$d/dist" SBTEL_INSTALL_DIR="$d/bin" $SH "$INST" 2>&1 >/dev/null); rc=$?
	if [ $rc -ne 0 ] && [ ! -e "$d/bin/sbtel" ] && printf '%s' "$err" | grep -q '^sbtel install: checksum mismatch'; then ok "$SH: checksum mismatch refused"; else ko "$SH: mismatch rc=$rc err=$err"; fi

	# 5. missing checksum line -> fatal
	d=$W/$SH/noline; mkdir -p "$d/dist"; cp "$DIST"/* "$d/dist/"; grep -v linux_amd64 "$DIST/checksums.txt" > "$d/dist/checksums.txt"
	err=$(SBTEL_BASE_URL="file://$d/dist" SBTEL_INSTALL_DIR="$d/bin" $SH "$INST" 2>&1 >/dev/null); rc=$?
	if [ $rc -ne 0 ] && [ ! -e "$d/bin/sbtel" ] && printf '%s' "$err" | grep -q '^sbtel install: checksums.txt has no line'; then ok "$SH: missing checksum line refused"; else ko "$SH: noline rc=$rc err=$err"; fi

	# 6. missing asset (404 / no file) -> download failed
	d=$W/$SH/missing; mkdir -p "$d/dist"
	err=$(SBTEL_BASE_URL="file://$d/dist" SBTEL_INSTALL_DIR="$d/bin" $SH "$INST" 2>&1 >/dev/null); rc=$?
	if [ $rc -ne 0 ] && printf '%s' "$err" | grep -q '^sbtel install: download failed'; then ok "$SH: missing asset"; else ko "$SH: missing rc=$rc err=$err"; fi

	# 7. unsupported arch / os via a fake uname
	for case in "Linux riscv64 architecture" "Linux armv7l architecture" "SunOS x86_64 operating"; do
		set -- $case
		d=$W/$SH/uname-$2; mkdir -p "$d/fake"
		printf '#!/bin/sh\ncase $1 in -s) echo %s;; -m) echo %s;; esac\n' "$1" "$2" > "$d/fake/uname"; chmod +x "$d/fake/uname"
		err=$(PATH="$d/fake:$PATH" SBTEL_BASE_URL="file://$DIST" SBTEL_INSTALL_DIR="$d/bin" $SH "$INST" 2>&1 >/dev/null); rc=$?
		if [ $rc -ne 0 ] && [ ! -e "$d/bin" ] && printf '%s' "$err" | grep -q "^sbtel install: unsupported $3"; then ok "$SH: $1 $2 refused"; else ko "$SH: uname $1 $2 rc=$rc err=$err"; fi
	done

	# 8. Darwin arm64 / MINGW pick the right asset name (served dir with only checksums -> mismatch path not needed; check URL)
	for case in "Darwin arm64 sbtel_darwin_arm64" "MINGW64_NT-10.0 x86_64 sbtel_windows_amd64.exe" "Linux aarch64 sbtel_linux_arm64"; do
		set -- $case
		d=$W/$SH/asset-$3; mkdir -p "$d/fake"
		printf '#!/bin/sh\ncase $1 in -s) echo %s;; -m) echo %s;; esac\n' "$1" "$2" > "$d/fake/uname"; chmod +x "$d/fake/uname"
		err=$(PATH="$d/fake:$PATH" SBTEL_BASE_URL="file://$d/none" SBTEL_INSTALL_DIR="$d/bin" $SH "$INST" 2>&1 >/dev/null)
		if printf '%s' "$err" | grep -q "downloading file://$d/none/$3\$"; then ok "$SH: $1 $2 -> $3"; else ko "$SH: asset $1 $2 err=$err"; fi
	done

	# 9. no curl, no wget -> fatal
	d=$W/$SH/nodl; mkbin "$d/path" $BASE_TOOLS
	err=$(PATH="$d/path" SBTEL_BASE_URL="file://$DIST" SBTEL_INSTALL_DIR="$d/bin" "$d/path/$SH" "$INST" 2>&1 >/dev/null); rc=$?
	if [ $rc -ne 0 ] && printf '%s' "$err" | grep -q '^sbtel install: need curl or wget'; then ok "$SH: no curl/wget refused"; else ko "$SH: nodl rc=$rc err=$err"; fi

	# 10. no curl but wget, over http (wget has no file://)
	d=$W/$SH/wget; mkbin "$d/path" $BASE_TOOLS wget
	out=$(PATH="$d/path" SBTEL_BASE_URL="http://127.0.0.1:$PORT" SBTEL_INSTALL_DIR="$d/bin" "$d/path/$SH" "$INST" 2>"$d/err"); rc=$?
	if [ $rc -eq 0 ] && [ -x "$d/bin/sbtel" ]; then ok "$SH: wget fallback over http"; else ko "$SH: wget rc=$rc err=$(cat "$d/err")"; fi

	# 11. no sha256sum, shasum fallback
	d=$W/$SH/shasum; mkbin "$d/path" sh dash bash uname mktemp rm mkdir cp chmod mv awk cat printf curl shasum perl
	PATH="$d/path" SBTEL_BASE_URL="file://$DIST" SBTEL_INSTALL_DIR="$d/bin" "$d/path/$SH" "$INST" >/dev/null 2>"$d/err"; rc=$?
	if [ $rc -eq 0 ] && [ -x "$d/bin/sbtel" ]; then ok "$SH: shasum fallback"; else ko "$SH: shasum rc=$rc err=$(cat "$d/err")"; fi

	# 12. no hashing tool -> fatal, nothing installed
	d=$W/$SH/nohash; mkbin "$d/path" sh dash bash uname mktemp rm mkdir cp chmod mv awk cat printf curl
	err=$(PATH="$d/path" SBTEL_BASE_URL="file://$DIST" SBTEL_INSTALL_DIR="$d/bin" "$d/path/$SH" "$INST" 2>&1 >/dev/null); rc=$?
	if [ $rc -ne 0 ] && [ ! -e "$d/bin/sbtel" ] && printf '%s' "$err" | grep -q '^sbtel install: need sha256sum or shasum'; then ok "$SH: no hash tool refused"; else ko "$SH: nohash rc=$rc err=$err"; fi

	# 13. SBTEL_VERSION picks the tagged URL (fails to download offline-ish; check the URL it tried)
	d=$W/$SH/ver; mkbin "$d/path" $BASE_TOOLS; printf '#!/bin/sh\nexit 22\n' > "$d/path/curl"; chmod +x "$d/path/curl"
	err=$(PATH="$d/path" SBTEL_VERSION=v0.2.0 SBTEL_INSTALL_DIR="$d/bin" "$d/path/$SH" "$INST" 2>&1 >/dev/null)
	if printf '%s' "$err" | grep -q 'downloading https://github.com/shashi/sbtel/releases/download/v0.2.0/sbtel_linux_amd64$'; then ok "$SH: SBTEL_VERSION url"; else ko "$SH: version err=$err"; fi
	err=$(PATH="$d/path" SBTEL_VERSION=v0.2.0 SBTEL_BASE_URL=file:///x SBTEL_INSTALL_DIR="$d/bin" "$d/path/$SH" "$INST" 2>&1 >/dev/null)
	if printf '%s' "$err" | grep -q 'downloading file:///x/sbtel_linux_amd64$'; then ok "$SH: SBTEL_BASE_URL beats SBTEL_VERSION"; else ko "$SH: precedence err=$err"; fi
	err=$(PATH="$d/path" SBTEL_INSTALL_DIR="$d/bin" "$d/path/$SH" "$INST" 2>&1 >/dev/null)
	if printf '%s' "$err" | grep -q 'downloading https://github.com/shashi/sbtel/releases/latest/download/sbtel_linux_amd64$'; then ok "$SH: latest url"; else ko "$SH: latest err=$err"; fi

	# 14. temp dir cleaned up (TMPDIR scoped)
	d=$W/$SH/tmp; mkdir -p "$d/t"
	TMPDIR="$d/t" SBTEL_BASE_URL="file://$DIST" SBTEL_INSTALL_DIR="$d/bin" $SH "$INST" >/dev/null 2>&1
	TMPDIR="$d/t" SBTEL_BASE_URL="file://$DIST/nope" SBTEL_INSTALL_DIR="$d/bin2" $SH "$INST" >/dev/null 2>&1
	if [ -z "$(ls -A "$d/t")" ]; then ok "$SH: temp dir removed on success and failure"; else ko "$SH: temp left: $(ls -A "$d/t")"; fi

	# 15. reinstall over an existing (running-style) binary
	d=$W/$SH/ok
	SBTEL_BASE_URL="file://$DIST" SBTEL_INSTALL_DIR="$d/bin" $SH "$INST" >/dev/null 2>&1 && ok "$SH: reinstall over existing" || ko "$SH: reinstall"
done
echo "$pass passed, $fail failed"
[ $fail -eq 0 ]
