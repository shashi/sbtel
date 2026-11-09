#!/bin/sh
# sbtel installer (POSIX sh). docs/DESIGN.md §9.2 is the contract.
#
#   curl -fsSL https://raw.githubusercontent.com/shashi/sbtel/main/install.sh | sh
#
# Environment:
#   SBTEL_INSTALL_DIR  where to put the binary        (default: $HOME/.local/bin)
#   SBTEL_VERSION      a release tag such as v0.2.0   (default: the latest release)
#   SBTEL_BASE_URL     where the release files live   (overrides SBTEL_VERSION; file:// works with curl)
#
# It downloads sbtel_<os>_<arch>[.exe] and checksums.txt, checks the sha256, and installs only when the
# checksum matches. Everything lives in main(), so a truncated download runs nothing.
set -eu

die() {
	printf 'sbtel install: %s\n' "$*" >&2
	exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }

detect_os() {
	s=$(uname -s 2>/dev/null) || die "cannot run uname -s"
	case $s in
		Linux) echo linux ;;
		Darwin) echo darwin ;;
		MINGW* | MSYS* | CYGWIN*) echo windows ;;
		*) die "unsupported operating system: $s" ;;
	esac
}

detect_arch() {
	m=$(uname -m 2>/dev/null) || die "cannot run uname -m"
	case $m in
		x86_64 | amd64) echo amd64 ;;
		aarch64 | arm64) echo arm64 ;;
		*) die "unsupported architecture: $m (release builds exist for amd64 and arm64)" ;;
	esac
}

# fetch <url> <file>
fetch() {
	if have curl; then
		curl -fsSL "$1" -o "$2" || die "download failed: $1"
	elif have wget; then
		wget -qO "$2" "$1" || die "download failed: $1"
	else
		die "need curl or wget to download $1"
	fi
}

# sha256_of <file>: prints the hex digest
sha256_of() {
	if have sha256sum; then
		sha256sum "$1" | awk '{ print $1 }'
	elif have shasum; then
		shasum -a 256 "$1" | awk '{ print $1 }'
	else
		die "need sha256sum or shasum to verify the download"
	fi
}

main() {
	os=$(detect_os)
	arch=$(detect_arch)
	ext=
	[ "$os" = windows ] && ext=.exe
	asset="sbtel_${os}_${arch}${ext}"

	if [ -n "${SBTEL_BASE_URL:-}" ]; then
		base=${SBTEL_BASE_URL%/}
	elif [ -n "${SBTEL_VERSION:-}" ]; then
		base="https://github.com/shashi/sbtel/releases/download/${SBTEL_VERSION}"
	else
		base="https://github.com/shashi/sbtel/releases/latest/download"
	fi

	if [ -n "${SBTEL_INSTALL_DIR:-}" ]; then
		dir=$SBTEL_INSTALL_DIR
	else
		[ -n "${HOME:-}" ] || die "HOME is not set; set SBTEL_INSTALL_DIR"
		dir="$HOME/.local/bin"
	fi

	tmp=$(mktemp -d 2>/dev/null || mktemp -d -t sbtel) || die "cannot create a temporary directory"
	trap 'rm -rf "$tmp"' EXIT
	trap 'exit 130' INT
	trap 'exit 143' TERM HUP

	printf 'sbtel install: downloading %s\n' "$base/$asset" >&2
	fetch "$base/$asset" "$tmp/$asset"
	fetch "$base/checksums.txt" "$tmp/checksums.txt"

	# sha256sum format: "<64 hex>  <name>" (a "*" before the name marks binary mode).
	want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1; exit }' "$tmp/checksums.txt")
	[ -n "$want" ] || die "checksums.txt has no line for $asset"
	got=$(sha256_of "$tmp/$asset")
	[ "$got" = "$want" ] || die "checksum mismatch for $asset (expected $want, got $got); nothing installed"

	mkdir -p "$dir" || die "cannot create $dir"
	target="$dir/sbtel$ext"
	part="$dir/.sbtel$ext.part.$$"
	cp "$tmp/$asset" "$part" || die "cannot write to $dir"
	chmod 755 "$part" || { rm -f "$part"; die "cannot chmod $part"; }
	mv -f "$part" "$target" || { rm -f "$part"; die "cannot move the binary to $target"; }

	"$target" version || die "installed $target, but it does not run"
	printf 'sbtel install: installed %s\n' "$target" >&2

	case ":${PATH:-}:" in
		*":$dir:"*) ;;
		*)
			printf '\n%s is not on your PATH. Add this line to your shell rc (~/.profile, ~/.bashrc or ~/.zshrc):\n\n' "$dir" >&2
			# shellcheck disable=SC2016 # the hint must print a literal $PATH
			printf '  export PATH="%s:$PATH"\n\n' "$dir" >&2
			;;
	esac
}

main "$@"
