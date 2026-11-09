# accept7 (v0.2.1): the standalone playground's undo history persists. A real browser profile on disk
# (a persistent context): edit, close the browser, start it again on the same profile, and Ctrl-Z
# continues back through the earlier edits. The page always opens with the sample, so after the restart
# the sample is the newest step and the first Ctrl-Z brings back the last edit. Also the page's title.
# usage: python3 accept7.py page.html
import sys, json, tempfile, shutil
from playwright.sync_api import sync_playwright
PAGE = 'file://' + sys.argv[1]
r = {}
EXE = dict(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
# Delete a leaf block through the app (one undo step), as a drag or the Delete dialog would.
DEL = """name => { const id = name; edit({ t: 'delete', node: state.model.node(id), loc: state.lay.loc.get(id) }); return state.src; }"""

def run():
    prof = tempfile.mkdtemp(prefix='sbtel-accept7-')
    errs = []
    try:
        with sync_playwright() as p:
            c = p.chromium.launch_persistent_context(prof, viewport={'width': 1500, 'height': 1000}, **EXE)
            pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(PAGE); pg.wait_for_timeout(1500)
            r['title'] = pg.title()
            s0 = pg.evaluate("() => state.src")
            s1 = pg.evaluate(DEL, 'Shell.Clipboard')
            s2 = pg.evaluate(DEL, 'Shell.Theme')
            pg.wait_for_timeout(600)  # the history is written 300 ms after a change, and on pagehide
            c.close()
            c = p.chromium.launch_persistent_context(prof, viewport={'width': 1500, 'height': 1000}, **EXE)
            pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(PAGE); pg.wait_for_timeout(1500)
            seen = [pg.evaluate("() => state.src")]
            for _ in range(3):
                pg.mouse.click(1400, 120)  # the canvas has the focus, not a text field
                pg.keyboard.press('Control+z'); pg.wait_for_timeout(150)
                seen.append(pg.evaluate("() => state.src"))
            want = [s0, s2, s1, s0]
            r['undoAfterRestart'] = 'pass' if seen == want else 'fail ' + json.dumps([want.index(x) if x in want else -1 for x in seen])
            pg.keyboard.press('Control+Shift+z'); pg.wait_for_timeout(150)
            r['redoAfterRestart'] = 'pass' if pg.evaluate("() => state.src") == s1 else 'fail'
            rec = pg.evaluate("() => JSON.parse(localStorage.getItem('sbtel-hist'))")
            r['storedAsPatches'] = 'pass' if rec and rec['v'] == 1 and all(len(x) == 3 for x in rec['undo'] + rec['redo']) else 'fail'
            c.close()
    finally:
        shutil.rmtree(prof, ignore_errors=True)
    r['pageErrors'] = 'none' if not errs else errs[:3]

run()
print('RESULT ' + json.dumps(r))
