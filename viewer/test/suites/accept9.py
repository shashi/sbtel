# accept9 (v0.2.3): a spec from the URL (#src=, #example=), embed mode (?embed, ?embed=readonly, &theme=)
# and the home link. Playwright, real mouse, over HTTP: the page is served from a temp dir with an
# examples/ folder beside it, as the website serves /sbtel/play/.
# usage: python3 accept9.py page.html
import sys, json, base64, os, shutil, tempfile, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

NOTES = '''(block Notes
  (sketch "Write notes, see them rendered, keep them on disk.")
  (message Edit (sketch "A change to one note's text."))
  (level :name "Editing"
    (adjacent (~ The preview follows the editor. ~)
      (block Notes.Editor (port edit out Edit) (sketch "The text area."))
      (block Notes.Preview (sketch "Renders the note beside the editor — ünïcode."))))
  (level :name "Storage"
    (block Notes.Store (port edit in Edit) (sketch "Writes notes to disk."))))
'''
DEMO = '(block Demo (sketch "From examples/demo.sbtel.")\n  (level (block Demo.A (sketch "a")) (block Demo.B (sketch "b"))))\n'
b64 = lambda s: base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')

root = tempfile.mkdtemp(prefix='sbtel-accept9-')
os.makedirs(root + '/play/examples')
shutil.copy(sys.argv[1], root + '/play/index.html')
open(root + '/play/examples/demo.sbtel', 'w').write(DEMO)
page = open(sys.argv[1]).read()
open(root + '/play/home.html', 'w').write(page.replace('<title>', '<meta name="sbtel-home" content="../">\n<title>', 1))
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d/play/' % srv.server_address[1]

r, errs = {}, []
def check(name, ok): r[name] = 'pass' if ok else 'FAIL'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1200, 'height': 800}, device_scale_factor=1)
    ctx.add_init_script("try { localStorage.setItem('sbtel-help-seen', 'true'); } catch (e) {}")
    def go(url, w=1200, h=800):
        pg = ctx.new_page(); pg.set_viewport_size({'width': w, 'height': h})
        pg.on('pageerror', lambda e: errs.append(str(e)))
        # The one expected failure is the request for examples/missing.sbtel.
        pg.on('console', lambda m: m.type == 'error' and not (m.location or {}).get('url', '').endswith(('favicon.ico', 'missing.sbtel')) and errs.append(m.text))
        pg.goto(url); pg.wait_for_timeout(1200)
        return pg
    E = lambda pg, js, *a: pg.evaluate(js, *a)

    # The playground: unchanged, plus the home link.
    pg = go(BASE)
    check('playgroundSample', E(pg, "topBlocks(state.model)[0].name === 'Shell' && !document.body.classList.contains('embed')"))
    check('homeLinkDefault', E(pg, "(a => !!a && a.href === 'https://shashi.biz/sbtel/' && a.textContent === 'sbtel' && !a.target)(document.querySelector('#brand a.home'))"))
    check('standardsMode', E(pg, "document.compatMode === 'CSS1Compat' && document.documentElement.lang === 'en' && !!document.querySelector('meta[name=viewport]')"))
    pg.close()
    pg = go(BASE + 'home.html')
    check('homeLinkMeta', E(pg, "document.querySelector('#brand a.home').href") == 'http://127.0.0.1:%d/' % srv.server_address[1])
    pg.close()

    # #src: the spec, with its own storage keys.
    pg = go(BASE + '#src=' + b64(NOTES))
    check('srcLoads', E(pg, "state.src") == NOTES and E(pg, "topBlocks(state.model)[0].name") == 'Notes')
    key = E(pg, "'sbtel-hist:spec-' + SBTEL.modes.standalone.digest(state.src)")
    pg.click('.blk[data-id="Notes.Store"] .ttl'); pg.keyboard.press('Delete'); pg.wait_for_timeout(200)
    pg.click('[data-m="yes"]'); pg.wait_for_timeout(700)
    check('srcEditKeyed', E(pg, "!state.model.node('Notes.Store')") and E(pg, "k => !!localStorage.getItem(k) && JSON.parse(localStorage.getItem('sbtel-hist')).head === SAMPLE", key))
    pg.close()
    pg = go(BASE + '#src=' + b64(NOTES))
    check('srcUndoAfterReload', E(pg, "!document.getElementById('undo').disabled && !!state.model.node('Notes.Store')"))
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(400)
    check('srcUndoRestoresEdit', E(pg, "!state.model.node('Notes.Store')"))
    pg.close()
    pg = go(BASE)
    check('playgroundHistoryApart', E(pg, "document.getElementById('undo').disabled && state.src === SAMPLE"))
    pg.close()

    # #example: fetched relative to the page.
    pg = go(BASE + '#example=demo')
    check('exampleLoads', E(pg, "state.src") == DEMO and E(pg, "document.getElementById('specName').textContent").startswith('Demo'))
    pg.close()

    # Errors show the parse-error UI: the source sheet with the message, never a blank page.
    pg = go(BASE + '#example=missing')
    check('exampleMissingShown', E(pg, "!document.getElementById('srcSheet').classList.contains('closed') && /examples\\/missing\\.sbtel/.test(document.getElementById('err').textContent) && !!state.model"))
    pg.close()
    pg = go(BASE + '#src=%%%not-base64')
    check('badBase64Shown', E(pg, "!document.getElementById('srcSheet').classList.contains('closed') && /base64url/.test(document.getElementById('err').textContent)"))
    pg.close()
    pg = go(BASE + '#src=' + b64('(block A (sketch "x")'))
    check('unparsableShown', E(pg, "!document.getElementById('srcSheet').classList.contains('closed') && /Missing/.test(document.getElementById('err').textContent) && document.getElementById('src').value.startsWith('(block A')"))
    pg.fill('#src', '(block A (sketch "x"))'); pg.wait_for_timeout(600)
    check('unparsableFixable', E(pg, "!!state.model.node('A') && document.querySelectorAll('.blk').length > 0"))
    pg.close()
    pg = go(BASE + '?embed#src=' + b64('(block A'), 480, 320)
    check('embedErrorShown', E(pg, "!!document.querySelector('.pl-err') && document.querySelector('.pl-err').getBoundingClientRect().width > 0"))
    pg.close()

    # ?embed: chrome-less, fitted, interactive.
    inside = "() => { const r = document.querySelector('.blk.frame, .blk').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight - 40; }"
    pg = go(BASE + '?embed#src=' + b64(NOTES), 640, 400)
    hidden = "id => getComputedStyle(document.getElementById(id)).display === 'none'"
    check('embedChromeless', all(E(pg, hidden, i) for i in ['brand', 'help', 'msgSheet', 'srcSheet', 'msgBtn', 'srcBtn', 'setBtn', 'chkBtn']) and not E(pg, "!!document.querySelector('#brand a.home')"))
    check('embedToolbar', all(E(pg, "id => getComputedStyle(document.getElementById(id)).display !== 'none'", i) for i in ['undo', 'redo', 'zIn', 'zOut', 'fit']) and E(pg, "!!document.querySelector('.dock .pl-open')"))
    check('embedFits', E(pg, inside))
    pg.set_viewport_size({'width': 360, 'height': 260}); pg.wait_for_timeout(700)
    check('embedRefitsOnResize', E(pg, inside))
    pg.set_viewport_size({'width': 900, 'height': 480}); pg.wait_for_timeout(700)
    check('embedClear', E(pg, "getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)'"))
    check('embedOpenLink', E(pg, "document.querySelector('.pl-open').getAttribute('href')") == '/play/#src=' + b64(NOTES) and E(pg, "document.querySelector('.pl-open').target") == '_blank')
    pg.click('.blk[data-id="Notes.Store"] .ttl'); pg.wait_for_timeout(300)
    check('embedStripNoComment', E(pg, "!!document.querySelector('.strip [data-a=\"edit\"]') && !document.querySelector('.strip [data-a=\"comment\"]')"))
    pg.click('.blk[data-id="Notes.Store"] > .tab.top'); pg.wait_for_timeout(300)
    pg.click('.blk[data-id="Notes.Store"] .drow[data-pi]'); pg.wait_for_timeout(400)
    check('embedPortEditor', E(pg, "!!document.querySelector('.callout.edit')"))
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.click('.blk[data-id="Notes.Store"] .ttl'); pg.keyboard.press('Delete'); pg.wait_for_timeout(200); pg.click('[data-m="yes"]'); pg.wait_for_timeout(600)
    pg.dispatch_event('.pl-open', 'focus')
    href = E(pg, "document.querySelector('.pl-open').getAttribute('href')")
    check('embedOpenCarriesEdit', href.startswith('/play/#src=') and E(pg, "h => SBTEL.modes.standalone.decode(h.split('#src=')[1]) === state.src", href) and E(pg, "!state.model.node('Notes.Store')"))
    keys = E(pg, "Object.keys(localStorage).filter(k => k.startsWith('sbtel-hist'))")
    check('embedOwnKey', any(k.startswith('sbtel-hist:embed-') for k in keys))
    pg.close()

    # ?embed=readonly: no edits, still callouts and code.
    pg = go(BASE + '?embed=readonly#src=' + b64(NOTES), 700, 420)
    check('readonlyFlag', E(pg, "readOnly() && getComputedStyle(document.getElementById('undo')).display === 'none'"))
    pg.click('.blk[data-id="Notes.Store"] .ttl'); pg.wait_for_timeout(300)
    check('readonlyStripCodeOnly', E(pg, "[...document.querySelectorAll('.strip [data-a]')].map(b => b.dataset.a).join()") == 'code')
    pg.keyboard.press('Delete'); pg.wait_for_timeout(300)
    check('readonlyNoDelete', E(pg, "!document.querySelector('[data-m=\"yes\"]') && !!state.model.node('Notes.Store')"))
    pg.click('.blk[data-id="Notes.Store"] > .tab.top'); pg.wait_for_timeout(300)
    pg.click('.blk[data-id="Notes.Store"] .drow[data-pi]'); pg.wait_for_timeout(400)
    check('readonlyPortCallout', E(pg, "!!document.querySelector('.callout') && !document.querySelector('.callout.edit')"))
    pg.keyboard.press('Escape')
    box = pg.locator('.blk[data-id="Notes.Editor"] .ttl').bounding_box()
    src0 = E(pg, "state.src")
    pg.mouse.move(box['x'] + 20, box['y'] + 8); pg.mouse.down(); pg.mouse.move(box['x'] + 20, box['y'] + 160, steps=12); pg.mouse.up(); pg.wait_for_timeout(500)
    check('readonlyNoDrag', E(pg, "state.src") == src0)
    pg.close()

    # &theme
    pg = go(BASE + '?embed&theme=dark#example=demo', 500, 300)
    check('themeParam', E(pg, "document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'"))
    pg.close()
    b.close()
srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
r['pageErrors'] = 'none' if not errs else errs[:3]
print('RESULT ' + json.dumps(r))
