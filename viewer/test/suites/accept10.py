# accept10 (v0.2.3): a docs page that embeds three viewers in iframes, as the website does. Checks that
# their histories stay apart (from each other and from the playground), that the outer page scrolls
# over a frame until it is clicked, that a click makes wheel zoom and pan work in that frame only, that
# nothing takes focus on load, and that no frame logs an error. Playwright, real mouse, over HTTP.
# usage: python3 accept10.py page.html
import sys, json, base64, os, shutil, tempfile, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

A = '(block Alpha (sketch "First demo.")\n  (level (block Alpha.One (sketch "one")) (block Alpha.Two (sketch "two"))))\n'
B = '(block Beta (sketch "Second demo.")\n  (level (block Beta.One (sketch "one")) (block Beta.Two (sketch "two"))))\n'
C = '(block Gamma (sketch "Third demo, from examples/gamma.sbtel.")\n  (level (block Gamma.One (sketch "one"))))\n'
b64 = lambda s: base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')
root = tempfile.mkdtemp(prefix='sbtel-accept10-')
os.makedirs(root + '/play/examples'); os.makedirs(root + '/docs')
shutil.copy(sys.argv[1], root + '/play/index.html')
open(root + '/play/examples/gamma.sbtel', 'w').write(C)
frame = lambda id, q: f'<iframe id="{id}" src="../play/?{q}" style="display:block;width:560px;height:320px;border:1px solid #ccc;border-radius:12px;margin:40px auto"></iframe>'
filler = '<p style="max-width:560px;margin:0 auto">' + 'Some prose between the demos. ' * 40 + '</p>'
open(root + '/docs/index.html', 'w').write('<!doctype html><html lang="en"><meta charset="utf-8"><title>Docs</title><body style="margin:0;font:16px sans-serif">' +
    filler + frame('fa', 'embed#src=' + b64(A)) + filler + frame('fb', 'embed#src=' + b64(B)) + filler +
    frame('fc', 'embed=readonly#example=gamma') + filler * 4 + '</body></html>')
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
HOST = 'http://127.0.0.1:%d/' % srv.server_address[1]

r, errs = {}, []
def check(name, ok): r[name] = 'pass' if ok else 'FAIL'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1000, 'height': 760}, device_scale_factor=1)
    def load():
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type in ('error', 'warning') and not (m.location or {}).get('url', '').endswith('favicon.ico') and errs.append(m.text))
        pg.goto(HOST + 'docs/'); pg.wait_for_timeout(1800)
        return pg
    frames = lambda pg: {k: pg.locator('#' + k).element_handle().content_frame() for k in ('fa', 'fb', 'fc')}
    pg = load()
    F = frames(pg)
    check('framesLoad', [F[k].evaluate("topBlocks(state.model)[0].name") for k in ('fa', 'fb', 'fc')] == ['Alpha', 'Beta', 'Gamma'])
    check('noFocusOnLoad', pg.evaluate("document.activeElement === document.body && document.hasFocus() !== false") and pg.evaluate("window.scrollY") == 0)
    check('framesFitted', all(F[k].evaluate("(() => { const r = document.querySelector('.blk').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight - 40; })()") for k in F))

    # The outer page scrolls over a frame that has not been clicked; the frame's camera stays.
    pg.locator('#fa').scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    box = pg.locator('#fa').bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    pg.mouse.move(cx, cy); pg.wait_for_timeout(300)
    check('hintOnHover', F['fa'].evaluate("!document.querySelector('.pl-hint').hidden"))
    cam0, y0 = F['fa'].evaluate("JSON.stringify(state.cam)"), pg.evaluate("scrollY")
    pg.mouse.wheel(0, 240); pg.wait_for_timeout(600)
    check('pageScrollsOverIdleFrame', pg.evaluate("scrollY") > y0 + 100 and F['fa'].evaluate("JSON.stringify(state.cam)") == cam0)
    pg.mouse.wheel(0, -240); pg.wait_for_timeout(600)
    pg.locator('#fa').scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    box = pg.locator('#fa').bounding_box(); cx, cy = box['x'] + 30, box['y'] + 30
    # A click (on empty canvas) makes the frame live: the wheel pans it, and the page stays put.
    pg.mouse.click(cx, cy); pg.wait_for_timeout(300)
    y1, cam1 = pg.evaluate("scrollY"), F['fa'].evaluate("JSON.stringify(state.cam)")
    pg.mouse.move(cx, cy); pg.mouse.wheel(0, 120); pg.wait_for_timeout(500)
    check('liveFrameTakesWheel', pg.evaluate("scrollY") == y1 and F['fa'].evaluate("JSON.stringify(state.cam)") != cam1)
    # Clicking the outer page ends it.
    pg.mouse.click(10, 10); pg.wait_for_timeout(300)
    pg.mouse.move(cx, cy); y2 = pg.evaluate("scrollY"); pg.mouse.wheel(0, 200); pg.wait_for_timeout(600)
    check('blurReleasesWheel', pg.evaluate("scrollY") > y2 + 50)

    # An edit in frame A (a real delete through the dialog) stays in A's history.
    pg.locator('#fa').scroll_into_view_if_needed(); pg.wait_for_timeout(300)
    fa = pg.frame_locator('#fa')
    fa.locator('#fit').click(); pg.wait_for_timeout(500)
    fa.locator('.blk[data-id="Alpha.Two"] .ttl').click(); pg.wait_for_timeout(200)
    pg.keyboard.press('Delete'); pg.wait_for_timeout(300); fa.locator('[data-m="yes"]').click(); pg.wait_for_timeout(800)
    check('editInFrame', F['fa'].evaluate("!state.model.node('Alpha.Two')"))
    keys = pg.evaluate("Object.keys(localStorage).filter(k => k.startsWith('sbtel-hist')).sort()")
    pg.close()
    pg = load()
    F = frames(pg)
    undoable = [F[k].evaluate("!document.getElementById('undo').disabled") for k in ('fa', 'fb')]
    check('noHistoryCrossTalk', undoable == [True, False] and F['fb'].evaluate("!!state.model.node('Beta.Two')") and F['fa'].evaluate("!!state.model.node('Alpha.Two')"))
    check('keysPerSpec', len(keys) == 2 and all(k.startswith('sbtel-hist:embed-') for k in keys) and 'sbtel-hist' not in keys)
    check('readonlyFrameStoresNothing', F['fc'].evaluate("Object.keys(localStorage).filter(k => k.includes(SBTEL.modes.standalone.digest(state.src))).length") == 0)
    # The playground itself sees none of it.
    pp = ctx.new_page(); pp.on('pageerror', lambda e: errs.append(str(e))); pp.goto(HOST + 'play/'); pp.wait_for_timeout(1200)
    check('playgroundUntouched', pp.evaluate("state.src === SAMPLE && document.getElementById('undo').disabled"))
    pp.close(); pg.close(); b.close()
srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
r['consoleErrors'] = 'none' if not errs else errs[:3]
print('RESULT ' + json.dumps(r))
