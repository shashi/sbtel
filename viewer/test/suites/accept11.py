# accept11 (v0.2.4): embed mode fits what is drawn and reports its natural size to the page. A docs page
# frames three viewers; each posts { type:'sbtel:size', width, height } to its parent: the fitted box
# (contentBox, Core.Layout) at zoom 1 with 12 px around it and 52 px for the dock, in sane numbers, again
# when an edit changes it, never during a drag preview. &focus=<Block> fits and reports that block alone, at
# most at zoom 1, centred. A page on another origin hears nothing (the target origin is '/'), and a viewer
# that is not framed posts nothing. A click on a card focuses the frame, so a click on the page releases
# the wheel again (accept10 clicks empty canvas). Playwright, real mouse, over HTTP.
# usage: python3 accept11.py page.html
import sys, json, base64, os, shutil, tempfile, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

A = '(block Alpha (sketch "First demo.")\n  (level (block Alpha.One (sketch "one")) (block Alpha.Two (sketch "two"))))\n'
D = '(block Delta (sketch "Focused on one block.")\n  (level (block Delta.One (sketch "one")) (block Delta.Two (sketch "two"))))\n'
C = '(block Gamma (sketch "From examples/gamma.sbtel.")\n  (level (block Gamma.One (sketch "one"))))\n'
b64 = lambda s: base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')
root = tempfile.mkdtemp(prefix='sbtel-accept11-')
os.makedirs(root + '/play/examples'); os.makedirs(root + '/docs')
shutil.copy(sys.argv[1], root + '/play/index.html')
open(root + '/play/examples/gamma.sbtel', 'w').write(C)
frame = lambda id, src: f'<iframe id="{id}" src="{src}" style="display:block;width:640px;height:360px;border:0;margin:30px auto"></iframe>'
page = lambda frames: '<!doctype html><html lang="en"><meta charset="utf-8"><title>Docs</title><body style="margin:0">' + frames + '</body></html>'
open(root + '/docs/index.html', 'w').write(page(frame('fa', '../play/?embed#src=' + b64(A)) + frame('fc', '../play/?embed=readonly#example=gamma') +
    frame('fd', '../play/?embed=readonly&focus=Delta.Two#src=' + b64(D))))
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
HOST = 'http://127.0.0.1:%d' % PORT
# The same frame, served from another origin (localhost against 127.0.0.1).
open(root + '/docs/cross.html', 'w').write(page(frame('fx', 'http://localhost:%d/play/?embed#src=%s' % (PORT, b64(A)))))

r, errs = {}, []
def check(name, ok): r[name] = 'pass' if ok else 'FAIL'
NATURAL = "id => { const b = contentBox(state.lay, id, !readOnly()); return [Math.ceil(b.w + 24), Math.ceil(b.h + 64)]; }"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 900, 'height': 900}, device_scale_factor=1)
    # Every page records every sbtel:size it hears: which frame sent it, the numbers, the sender's origin.
    ctx.add_init_script("window.__sizes = []; addEventListener('message', e => { if (e.data && e.data.type === 'sbtel:size') __sizes.push({ f: [...document.querySelectorAll('iframe')].map(f => f.id)[[...document.querySelectorAll('iframe')].findIndex(f => f.contentWindow === e.source)], w: e.data.width, h: e.data.height, o: e.origin }); });")
    def load(path):
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type in ('error', 'warning') and not (m.location or {}).get('url', '').endswith('favicon.ico') and errs.append(m.text))
        pg.goto(HOST + path); pg.wait_for_timeout(1800)
        return pg
    pg = load('/docs/')
    F = {k: pg.locator('#' + k).element_handle().content_frame() for k in ('fa', 'fc', 'fd')}
    sizes = lambda f: [x for x in pg.evaluate('__sizes') if x['f'] == f]
    sane = lambda m: 100 < m['w'] < 3000 and 100 < m['h'] < 3000
    S = {k: sizes(k) for k in F}
    check('sizePosted', all(S[k] and [S[k][-1]['w'], S[k][-1]['h']] == F[k].evaluate(NATURAL, None) and sane(S[k][-1]) and S[k][-1]['o'] == HOST for k in ('fa', 'fc')))
    check('sizeOncePerLayout', len(S['fa']) == 1 and len(S['fc']) == 1)
    # Fitted to the box with 12 px around it (cards with their ears, level lines and names, and the + buttons
    # where it edits): the diagram fills the frame's width or height, at zoom 1 at most.
    tight = """() => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      document.querySelectorAll('#world .blk, #world .blk *, #world .lsep *, #world .aff:not(.gutter) .plus').forEach(e => { const r = e.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(e).display === 'none') return;
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); });
      const k = state.cam.k, full = Math.abs(x0 - 12) < 4 && Math.abs(innerWidth - 12 - x1) < 4 || Math.abs(y0 - 12) < 4 && Math.abs(innerHeight - 52 - y1) < 4;
      return k <= 1 && x0 >= 0 && y0 >= 0 && x1 <= innerWidth && y1 <= innerHeight - 40 && (full || k === 1); }"""
    check('fitsTightly', all(F[k].evaluate(tight) for k in ('fa', 'fc')))
    # The page sets the frame's height from the report (as the website does; the width stays, so the layout
    # does not change): at the natural height a diagram no wider than the frame shows at zoom 1.
    w, h = S['fa'][-1]['w'], S['fa'][-1]['h']
    pg.evaluate("h => { document.getElementById('fa').style.height = h + 'px'; }", h); pg.wait_for_timeout(700)
    check('naturalSizeIsZoomOne', w <= 640 and abs(F['fa'].evaluate('state.cam.k') - 1) < .01 and len(sizes('fa')) == 1)
    fd = S['fd'][-1] if S['fd'] else None
    check('focusBlock', fd is not None and [fd['w'], fd['h']] == F['fd'].evaluate(NATURAL, 'Delta.Two') and fd['w'] < 300
          and F['fd'].evaluate("(() => { const r = document.querySelector('.blk[data-id=\"Delta.Two\"]').getBoundingClientRect(); return state.cam.k === 1 && Math.abs(r.left + r.width / 2 - innerWidth / 2) < 3 && r.top >= 0 && r.bottom <= innerHeight - 40; })()"))
    # A drag preview reports nothing; the edit it makes reports the new size.
    fa = pg.frame_locator('#fa')
    pg.mouse.click(5, 5); pg.wait_for_timeout(200)
    box = pg.locator('#fa').bounding_box(); pg.mouse.click(box['x'] + 5, box['y'] + 5); pg.wait_for_timeout(200)
    t = fa.locator('.blk[data-id="Alpha.Two"] .ttl').bounding_box()
    n0 = len(sizes('fa'))
    pg.mouse.move(t['x'] + 10, t['y'] + 6); pg.mouse.down()
    for i in range(1, 13): pg.mouse.move(t['x'] + 10 + i * 4, t['y'] + 6 + i * 14)
    pg.wait_for_timeout(300)
    check('noReportWhileDragging', len(sizes('fa')) == n0)
    pg.keyboard.press('Escape'); pg.mouse.up(); pg.wait_for_timeout(600)
    fa.locator('.blk[data-id="Alpha.Two"] .ttl').click(); pg.wait_for_timeout(200)
    pg.keyboard.press('Delete'); pg.wait_for_timeout(300); fa.locator('[data-m="yes"]').click(); pg.wait_for_timeout(800)
    after = sizes('fa')
    check('sizeAfterEdit', F['fa'].evaluate("!state.model.node('Alpha.Two')") and len(after) > n0 and [after[-1]['w'], after[-1]['h']] == F['fa'].evaluate(NATURAL, None)
          and [after[-1]['w'], after[-1]['h']] != [w, h])
    # A click on a card makes the frame live and gives it focus (a card's press prevents mousedown's default,
    # which would keep the frame unfocused and live for good); the page does not scroll; a click on the page
    # releases the wheel again.
    pg.mouse.click(5, 5); pg.wait_for_timeout(200)
    t = fa.locator('.blk[data-id="Alpha.One"] .ttl').bounding_box(); y0 = pg.evaluate('scrollY')
    pg.mouse.click(t['x'] + 5, t['y'] + 5); pg.wait_for_timeout(300)
    live = F['fa'].evaluate("document.body.classList.contains('pl-live') && document.hasFocus()") and pg.evaluate('scrollY') == y0
    pg.mouse.click(5, 5); pg.wait_for_timeout(300)
    pg.mouse.move(t['x'] + 5, t['y'] + 5); y1 = pg.evaluate('scrollY'); pg.mouse.wheel(0, 200); pg.wait_for_timeout(500)
    check('cardClickThenPageReleases', live and not F['fa'].evaluate("document.body.classList.contains('pl-live')") and pg.evaluate('scrollY') > y1 + 50)
    pg.close()
    # Another origin hears nothing; a viewer that is not framed posts nothing (and logs nothing).
    pg = load('/docs/cross.html'); pg.wait_for_timeout(600)
    check('crossOriginSilent', pg.evaluate('__sizes.length') == 0 and pg.locator('#fx').element_handle().content_frame().evaluate("document.querySelectorAll('.blk').length") > 0)
    pg.close()
    pg = load('/play/?embed#src=' + b64(A))
    check('notFramedSilent', pg.evaluate('__sizes.length') == 0 and pg.evaluate("document.querySelectorAll('.blk').length") > 0)
    pg.close(); b.close()
srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
r['consoleErrors'] = 'none' if not errs else errs[:3]
print('RESULT ' + json.dumps(r))
