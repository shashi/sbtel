# accept5: touch drags need a selection first. Real touch input (CDP Input.dispatchTouchEvent) under
# iPhone 13 emulation, so the browser itself makes the pointer events and the tap clicks.
# usage: python3 accept5.py page.html
import sys, json
from playwright.sync_api import sync_playwright
PAGE = 'file://' + sys.argv[1]
r = {}
JS_HELPERS = """
window.__t = {
  pt: id => { const e = document.querySelector(`.blk[data-id="${CSS.escape(id)}"]`); const r = (e.querySelector('.ttl') || e).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; },
  body: id => { const e = document.querySelector(`.blk[data-id="${CSS.escape(id)}"]`); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.75]; },
  rect: id => { const r = document.querySelector(`.blk[data-id="${CSS.escape(id)}"]`).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; },
  empty: () => { for (let y = innerHeight - 160; y > 90; y -= 8) for (let x = 12; x < innerWidth - 12; x += 8) { const t = document.elementFromPoint(x, y); if (t && t.id === 'vp') return [x, y]; } return null; },
  ear: id => { const r = document.querySelector(`.blk[data-id="${CSS.escape(id)}"] > .tab.top`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; },
  parent: n => { const b = parse(document.getElementById('src').value).blocks.get(n); return b && b.parent ? b.parent.name : null; },
};
"""
def run():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        dev = dict(p.devices['iPhone 13']); dev.pop('default_browser_type', None); dev['device_scale_factor'] = 1
        ctx = b.new_context(**dev); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(PAGE); pg.wait_for_timeout(1500)
        pg.evaluate("() => { document.getElementById('help').hidden = true; state.opts.animate = false; fit(false); }")
        pg.add_script_tag(content=JS_HELPERS)
        cdp = ctx.new_cdp_session(pg)
        E = lambda js: pg.evaluate(js)
        def touch(kind, pts):
            cdp.send('Input.dispatchTouchEvent', { 'type': kind, 'touchPoints': [{ 'x': x, 'y': y, 'id': i } for i, (x, y) in enumerate(pts)] })
        def tap(x, y):
            touch('touchStart', [(x, y)]); pg.wait_for_timeout(40); touch('touchEnd', []); pg.wait_for_timeout(150)
        def swipe(a, c, steps=12, hold=0, before_end=None):
            touch('touchStart', [a]); pg.wait_for_timeout(30 + hold)
            for i in range(1, steps + 1):
                touch('touchMove', [(a[0] + (c[0] - a[0]) * i / steps, a[1] + (c[1] - a[1]) * i / steps)]); pg.wait_for_timeout(16)
            pg.wait_for_timeout(120)
            if before_end: before_end()
            touch('touchEnd', []); pg.wait_for_timeout(250)
        original = E("() => document.getElementById('src').value")
        src = lambda: E("() => document.getElementById('src').value")
        def reset():
            E("() => { closePop(); closeModal(); if (document.getElementById('src').value !== %s) setSource(%s); select(null, null); state.drawers.clear(); render(); fit(false); toastEl.hidden = true; }" % (json.dumps(original), json.dumps(original)))
            pg.wait_for_timeout(300)
        def step(name, fn):
            try: r[name] = fn()
            except Exception as e: r[name] = 'ERROR ' + str(e)[:300]
            reset()

        def pan_unselected():
            a = E("() => __t.pt('Shell.Theme')"); cam = E("() => state.cam.x")
            # End the pan on top of another block: that must not select it.
            swipe(a, (a[0] + 70, a[1] + 4))
            moved = E("() => state.cam.x") - cam
            sel = E("() => state.sel")
            return 'pass' if abs(moved - 70) < 3 and src() == original and sel is None and E("() => !drag") else f'fail: cam {moved} sel {sel}'
        step('panOnUnselectedBlock', pan_unselected)

        def tap_then_drag():
            a = E("() => __t.pt('Shell.Theme')"); tap(*a)
            if E("() => state.sel") != 'Shell.Theme': return 'fail: tap did not select'
            sa = E("() => __t.rect('Shell.ScrollAnchor')"); k = E("() => state.cam.k")
            swipe(a, (sa[2] + 60 * k + 12, (sa[1] + sa[3]) / 2), steps=16)
            if E("() => __t.parent('Shell.Theme')") != 'Shell.SessionView': return 'fail: not moved, parent ' + str(E("() => __t.parent('Shell.Theme')"))
            # trailClick after a touch drag: an immediate tap elsewhere selects.
            b2 = E("() => __t.pt('Shell.Router')"); tap(*b2)
            if E("() => state.sel") != 'Shell.Router': return 'fail: tap after drag swallowed, sel ' + str(E("() => state.sel"))
            E("() => undo()"); pg.wait_for_timeout(200)
            return 'pass' if src() == original else 'fail: undo'
        step('tapThenDragMoves', tap_then_drag)

        def tap_after_pan_same_spot():
            a = E("() => __t.pt('Shell.Theme')"); e0 = E("() => __t.empty()")
            swipe(e0, (a[0], a[1]))          # pan that ends exactly on a block
            sel1 = E("() => state.sel")
            a = E("() => __t.pt('Shell.Theme')"); tap(*a)  # quick tap right there
            sel2 = E("() => state.sel")
            return 'pass' if sel1 is None and sel2 == 'Shell.Theme' and src() == original else f'fail: after pan {sel1}, after tap {sel2}'
        step('panEndsOnBlockThenTap', tap_after_pan_same_spot)

        def long_press():
            a = E("() => __t.pt('Shell.Theme')"); tap(*a)
            touch('touchStart', [a]); pg.wait_for_timeout(800)
            menu = E("() => [...document.querySelectorAll('.pop.menu .mi')].map(b => b.textContent)")
            dragging = E("() => !!drag")
            # wiggle after the menu opened: never becomes a drag
            touch('touchMove', [(a[0] + 30, a[1] + 10)]); pg.wait_for_timeout(60); dragging2 = E("() => !!drag")
            touch('touchEnd', []); pg.wait_for_timeout(200)
            still = E("() => !!document.querySelector('.pop.menu')")
            if not ('Edit' in menu and not dragging and not dragging2 and still and src() == original): return f'fail: block menu {menu} drag {dragging}/{dragging2} open {still}'
            E("() => closePop()")
            e0 = E("() => __t.empty()"); touch('touchStart', [e0]); pg.wait_for_timeout(800); touch('touchEnd', []); pg.wait_for_timeout(200)
            root = E("() => [...document.querySelectorAll('.pop.menu .mi')].map(b => b.textContent)")
            return 'pass' if 'Insert a level above' in root or 'Add a behavior' in root else f'fail: root menu {root}'
        step('longPressOpensMenu', long_press)

        def move_before_long_press():
            a = E("() => __t.pt('Shell.Theme')"); tap(*a)
            touch('touchStart', [a]); pg.wait_for_timeout(100)
            for i in range(1, 6): touch('touchMove', [(a[0] + 6 * i, a[1] + 6 * i)]); pg.wait_for_timeout(16)
            pg.wait_for_timeout(700)
            menu = E("() => !!document.querySelector('.pop.menu')"); dragging = E("() => !!drag")
            touch('touchEnd', []); pg.wait_for_timeout(250)
            # unselected: movement pans, no menu
            b2 = E("() => __t.pt('Shell.Router')"); cam = E("() => state.cam.x")
            E("() => select(null, null)")
            touch('touchStart', [b2]); pg.wait_for_timeout(100)
            for i in range(1, 6): touch('touchMove', [(b2[0] + 8 * i, b2[1])]); pg.wait_for_timeout(16)
            pg.wait_for_timeout(700)
            menu2 = E("() => !!document.querySelector('.pop.menu')"); panned = E("() => state.cam.x") - cam
            touch('touchEnd', []); pg.wait_for_timeout(200)
            return 'pass' if dragging and not menu and not menu2 and abs(panned - 40) < 3 else f'fail: sel drag {dragging} menu {menu}; unsel menu {menu2} pan {panned}'
        step('moveBeforeLongPress', move_before_long_press)

        def pinch():
            a = E("() => __t.pt('Shell.Theme')"); tap(*a)   # one finger on a selected block
            k0 = E("() => state.cam.k"); c = (a[0] + 60, a[1] + 40)
            touch('touchStart', [a]); pg.wait_for_timeout(30); touch('touchStart', [a, c]); pg.wait_for_timeout(30)
            for i in range(1, 11):
                touch('touchMove', [(a[0] - 4 * i, a[1] - 3 * i), (c[0] + 4 * i, c[1] + 3 * i)]); pg.wait_for_timeout(16)
            dragging = E("() => !!drag")
            touch('touchEnd', []); pg.wait_for_timeout(200)
            k1 = E("() => state.cam.k")
            return 'pass' if k1 > k0 * 1.3 and not dragging and src() == original else f'fail: k {k0}->{k1} drag {dragging}'
        step('pinchStillZooms', pinch)

        def ear_tap():
            e = E("() => { const r = document.querySelector('.blk[data-id=\"Shell.Router\"] > .tab.top').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
            tap(*e)
            return 'pass' if E("() => drawersOpen('Shell.Router')") else 'fail'
        step('earTapOpensDrawer', ear_tap)

        def drawer_swipe():
            # Open drawers are not scroll areas (they grow to fit): a swipe on one, selected block or not, pans.
            E("() => { select('Shell.Router', null); setDrawer('Shell.Router', 'top', true); }"); pg.wait_for_timeout(200)
            d = E("() => __t.ear('Shell.Router')"); cam = E("() => state.cam.y")
            swipe(d, (d[0], d[1] + 60))
            moved = E("() => state.cam.y") - cam; still = E("() => drawersOpen('Shell.Router')")
            return 'pass' if abs(moved - 60) < 3 and still and src() == original else f'fail: pan {moved} open {still}'
        step('swipeOnOpenDrawerPans', drawer_swipe)

        def cards():
            a = E("() => __t.pt('β:Durable')"); cam = E("() => state.cam.x")
            swipe(a, (a[0] + 50, a[1]))
            if abs(E("() => state.cam.x") - cam - 50) > 3: return 'fail: unselected card did not pan'
            a = E("() => __t.pt('β:Durable')"); tap(*a)
            if E("() => state.sel") != 'β:Durable': return 'fail: tap did not select card, sel ' + str(E("() => state.sel"))
            # Drag it to the top level: it bounces (its port uses SessionEvent, declared in Shell).
            def to_root():
                z = E("() => { const z = drag && drag.zones.find(z => z.act.dest.block.virtual && z.bad); return z && [(z.x + z.w / 2) * state.cam.k + state.cam.x, (z.y + z.h * 0.85) * state.cam.k + state.cam.y]; }")
                return z
            touch('touchStart', [a]); pg.wait_for_timeout(30)
            for i in range(1, 4): touch('touchMove', [(a[0] + 4 * i, a[1] + 4 * i)]); pg.wait_for_timeout(16)
            z = to_root()
            if not z: touch('touchEnd', []); return 'fail: no drag zones for selected card'
            for i in range(1, 11): touch('touchMove', [(a[0] + (z[0] - a[0]) * i / 10, a[1] + (z[1] - a[1]) * i / 10)]); pg.wait_for_timeout(16)
            pg.wait_for_timeout(100); touch('touchEnd', []); pg.wait_for_timeout(250)
            t = E("() => toastEl.textContent")
            return 'pass' if src() == original and t.startswith('Durable uses message type SessionEvent') else 'fail: toast ' + t
        step('cardsNeedSelectionAndBounce', cards)

        def handle_link():
            a = E("() => __t.pt('Shell.Theme')"); tap(*a)
            h = E("() => { const hs = [...document.querySelectorAll('.blk[data-id=\"Shell.Theme\"] > .hdl')]; const r = hs[1].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
            t = E("() => __t.pt('Shell.Router')")
            swipe(h, t)
            ok = 'Shell.Theme' in E("() => { const m = parse(document.getElementById('src').value); const L = m.blocks.get('Shell.Router'); return state.lay.loc.get('Shell.Router') ? state.lay.loc.get('Shell.Router').L.units[state.lay.loc.get('Shell.Router').ui].blocks.map(b => b.name).join(',') : ''; }")
            return 'pass' if ok else 'fail: not linked'
        step('handleStillLinks', handle_link)
        r['pageErrors'] = errs or 'none'

        # Desktop: a mouse drag on an unselected block still moves it.
        pg2 = b.new_page(viewport={'width': 1500, 'height': 1000}, device_scale_factor=1)
        pg2.goto(PAGE); pg2.wait_for_timeout(1500)
        pg2.evaluate("() => { document.getElementById('help').hidden = true; state.opts.animate = false; fit(false); }")
        pg2.add_script_tag(content=JS_HELPERS)
        a = pg2.evaluate("() => __t.pt('Shell.Theme')"); sa = pg2.evaluate("() => __t.rect('Shell.ScrollAnchor')"); k = pg2.evaluate("() => state.cam.k")
        pg2.mouse.move(*a); pg2.mouse.down(); pg2.mouse.move(sa[2] + 60 * k + 12, (sa[1] + sa[3]) / 2, steps=16); pg2.wait_for_timeout(150); pg2.mouse.up(); pg2.wait_for_timeout(250)
        par = pg2.evaluate("() => __t.parent('Shell.Theme')")
        r['desktopMouseDragUnselected'] = 'pass' if par == 'Shell.SessionView' and pg2.evaluate("() => state.sel") is None else f'fail: parent {par}'
        b.close()
run()
print('RESULT ' + json.dumps(r))
