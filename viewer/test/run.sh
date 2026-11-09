#!/bin/bash
# Viewer acceptance suites (standalone mode), run against a built page in headless Chrome.
#   viewer/test/run.sh [page.html]        default: viewer/dist/index.html
#   SUITES="accept accept4" viewer/test/run.sh   run a subset
# Needs google-chrome at /usr/bin/google-chrome, python3 and the playwright python package; accept12
# also needs bin/sbtel built from this page (make accept builds it), or SBTEL_BIN.
# Each suite's RESULT line must equal its line in expected.txt (results recorded on the frozen
# Marquee playground, md5 a94bbc1d4b8752b16ac116a54581b118, and on viewer/dist). Exit 1 on any mismatch.
set -u
T=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$T/../.." && pwd)
PAGE=$(realpath "${1:-$ROOT/viewer/dist/index.html}")
OUT=$(mktemp -d "${TMPDIR:-/tmp}/sbtel-accept.XXXXXX")
SUITES=${SUITES:-"accept accept2 accept3 accept3b accept3c redo accept4 accept5 accept6 accept7 accept8 accept9 accept10 accept11 accept12"}

# Chrome --dump-dom suites: the test is appended to a copy of the page and reports through console.log.
virtual() { # name test.js WxH budget timeout
  python3 - "$PAGE" "$OUT/$1.html" "$T/suites/$2" <<'PY'
import sys
h = open(sys.argv[1]).read(); a = open(sys.argv[3]).read()
h += "\n<script>\n" + a + "\nsetTimeout(async()=>{let r;try{r=await __accept();}catch(e){r={fatal:e.message}}console.log('RESULT '+JSON.stringify(r));},2000);\n</script>\n"
open(sys.argv[2], 'w').write(h)
PY
  timeout "$5" google-chrome --headless=new --no-sandbox --disable-gpu --user-data-dir="$OUT/profile-$1" --window-size="$3" \
    --virtual-time-budget="$4" --enable-logging=stderr --v=0 --dump-dom "file://$OUT/$1.html" 2>&1 >/dev/null | grep -o 'RESULT {.*}\|Uncaught[^"]*' | head -5
}
run_suite() {
  case "$1" in
    accept)   virtual accept accept.js 1500,1000 15000 90 ;;
    accept2)  virtual accept2 accept2.js 1600,1100 90000 180 ;;
    accept3)  virtual accept3 accept3.js 1600,1100 90000 180 ;;
    accept3b) virtual accept3b accept3b.js 1600,1100 90000 180 ;;
    accept3c) virtual accept3c accept3c.js 1600,1100 90000 180 ;;
    redo)     virtual redo accept2_redo.js 1600,1100 90000 180 ;;
    # Real time (Playwright): accept4 checks CSS transitions, which --virtual-time-budget freezes.
    accept4)  cp "$PAGE" "$OUT/accept4.html"; timeout 180 python3 "$T/suites/pw.py" "$OUT/accept4.html" "$T/suites/accept4.js" 2>&1 | grep -o 'RESULT {.*}\|PAGEERRORS.*' | head -5 ;;
    # Real touch input via CDP under iPhone 13 emulation; the page carries its own device-width viewport.
    accept5)  cp "$PAGE" "$OUT/accept5.html"
              timeout 240 python3 "$T/suites/accept5.py" "$OUT/accept5.html" 2>&1 | grep -o 'RESULT {.*}\|Error.*' | head -5 ;;
    # v0.2 callouts, editors, level labels and carried types: real mouse, then real touch (iPhone 13).
    accept6)  cp "$PAGE" "$OUT/accept6.html"
              timeout 300 python3 "$T/suites/accept6.py" "$OUT/accept6.html" 2>&1 | grep -o 'RESULT {.*}\|Error.*' | head -5 ;;
    # v0.2.1 persistent undo: a browser profile on disk, closed and started again (Playwright).
    accept7)  cp "$PAGE" "$OUT/accept7.html"; timeout 200 python3 "$T/suites/accept7.py" "$OUT/accept7.html" 2>&1 | grep -o 'RESULT {.*}\|Error.*' | head -5 ;;
    # v0.2.2 behaviors with a block's grammar: pills on behavior and message cards, the implementers outline.
    accept8)  cp "$PAGE" "$OUT/accept8.html"; timeout 200 python3 "$T/suites/accept8.py" "$OUT/accept8.html" 2>&1 | grep -o 'RESULT {.*}\|Error.*' | head -5 ;;
    # v0.2.3 a spec from the URL (#src, #example), embed mode and the home link, served over HTTP.
    accept9)  cp "$PAGE" "$OUT/accept9.html"; timeout 200 python3 "$T/suites/accept9.py" "$OUT/accept9.html" 2>&1 | grep -o 'RESULT {.*}\|Error.*' | head -5 ;;
    # v0.2.3 a docs page with three embedded viewers: separate histories, no scroll trapping, no errors.
    accept10) cp "$PAGE" "$OUT/accept10.html"; timeout 200 python3 "$T/suites/accept10.py" "$OUT/accept10.html" 2>&1 | grep -o 'RESULT {.*}\|Error.*' | head -5 ;;
    # v0.2.4 embed mode fits what is drawn and posts sbtel:size to a same-origin parent; &focus=<Block>.
    accept11) cp "$PAGE" "$OUT/accept11.html"; timeout 200 python3 "$T/suites/accept11.py" "$OUT/accept11.html" 2>&1 | grep -o 'RESULT {.*}\|Error.*' | head -5 ;;
    # v0.2.5 files made by `sbtel export`, opened from disk: rendering, no network, read-only, bindings, undo.
    # They come from the binary ($SBTEL_BIN, default bin/sbtel), which must embed this page.
    accept12) cp "$PAGE" "$OUT/accept12.html"; timeout 240 python3 "$T/suites/accept12.py" "$OUT/accept12.html" "${SBTEL_BIN:-$ROOT/bin/sbtel}" 2>&1 | grep -o 'RESULT {.*}\|Error.*' | head -5 ;;
    *) echo "unknown suite $1"; return 1 ;;
  esac
}
for s in $SUITES; do (run_suite "$s" > "$OUT/$s.txt") & done; wait
fail=0
for s in $SUITES; do
  want=$(grep -P "^$s\t" "$T/expected.txt" | cut -f2-); got=$(head -1 "$OUT/$s.txt")
  if [ "$got" = "$want" ]; then echo "PASS $s"; else echo "FAIL $s"; echo "  want: $want"; echo "  got:  $(cat "$OUT/$s.txt")"; fail=1; fi
done
echo "page: $PAGE ($(md5sum < "$PAGE" | cut -c1-32))"
if [ $fail = 0 ]; then rm -rf "$OUT"; else echo "work dir kept: $OUT"; fi
exit $fail
