# accept6 (v0.2): sketch callouts and inline editors, level labels, (~ ~) kept through edits, carried types.
# Desktop parts use the real mouse (Playwright), so hover is the browser's own; the touch part uses real
# touch input (CDP Input.dispatchTouchEvent) under iPhone 13 emulation, as accept5 does.
# usage: python3 accept6.py page.html
import sys, json
from playwright.sync_api import sync_playwright
PAGE = 'file://' + sys.argv[1]
r = {}
HELPERS = """
window.__t = {
  el: id => document.querySelector(`.blk[data-id="${CSS.escape(id)}"]`),
  mid: e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; },
  row: (id, side, kind) => [...__t.el(id).querySelectorAll(`:scope > .tab.${side} .drow`)].find(x => x.dataset.kind === kind),
  co: () => co.el && !co.el.hidden ? { mode: co.mode, text: co.el.textContent, form: !!co.el.querySelector('form'), html: co.el.innerHTML } : null,
  talk: () => [...document.querySelectorAll('.blk.talk')].map(e => e.dataset.id).sort().join(','),
  src: () => document.getElementById('src').value,
  // A connector's midpoint on screen, for the line between blocks a and b.
  line: (a, b) => { const c = state.lay.connectors.find(x => x.a === a && x.b === b); const [x, y] = midOf(c.pts); return [x * state.cam.k + state.cam.x, y * state.cam.k + state.cam.y]; },
  center: (id, k) => { const B = state.lay.blocks.find(b => b.id === id); state.cam = { k, x: innerWidth / 2 - (B.x + B.w / 2) * k, y: innerHeight / 2 - (B.y + B.h / 2) * k }; applyCam(); },
};
"""
CARRY = """(message Selection (sketch "Selected ids."))
(message Camera (sketch "Pan and zoom."))
(message Snapshot (carries Selection Camera)
  (~ What undo restores. ~))
(message Named (refines Snapshot))
(block App
  (level :name "Edits" (block Undo (port :in Named :as keep)))
  (level (block Cam (port :out Camera :as cam)) (block Other)))
"""

def desktop(p, b):
    pg = b.new_page(viewport={'width': 1500, 'height': 1000}, device_scale_factor=1); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(PAGE); pg.wait_for_timeout(1500)
    pg.add_script_tag(content=HELPERS)
    E = lambda js, *a: pg.evaluate(js, *a)
    E("() => { document.getElementById('help').hidden = true; state.opts.animate = false; }")
    original = E("() => __t.src()")
    def reset(src=None):
        E("(s) => { hideCallout(); closePop(); closeModal(); if (__t.src() !== s) setSource(s); select(null, null); state.drawers.clear(); state.talk = null; state.carry = null; render(); fit(false); toastEl.hidden = true; }", src or original)
        pg.mouse.move(2, 500); pg.wait_for_timeout(150)
    def step(name, fn, src=None):
        try:
            reset(src); r[name] = fn()
        except Exception as e: r[name] = 'ERROR ' + str(e)[:300]
    def palette(k=1):
        E("(k) => { setDrawer('Shell.CommandPalette', 'top', true); __t.center('Shell.CommandPalette', k); }", k); pg.wait_for_timeout(200)
        return E("() => __t.mid(__t.row('Shell.CommandPalette', 'top', 'KeyChord'))")

    def hover_instant():
        x, y = palette(); pg.mouse.move(x, y); pg.wait_for_timeout(20)
        c = E("() => __t.co()")
        if not c or c['mode'] != 'hover' or 'Opens the palette.' not in c['text']: return 'fail: no callout ' + json.dumps(c)
        # Beside the drawer, never over it, and nothing moved.
        ok = E("() => { const t = __t.el('Shell.CommandPalette').querySelector(':scope > .tab.top').getBoundingClientRect(), c = co.el.getBoundingClientRect(); return c.left >= t.right || c.right <= t.left; }")
        pg.mouse.move(2, 500); pg.wait_for_timeout(20)
        return 'pass' if ok and E("() => __t.co()") is None else 'fail: placement or not hidden'
    step('hoverCalloutInstant', hover_instant)

    def hover_highlight():
        x, y = palette(.6); pg.mouse.move(x, y); pg.wait_for_timeout(20)
        on = E("() => __t.talk()")
        pg.mouse.move(2, 500); pg.wait_for_timeout(20); off = E("() => __t.talk()")
        # A port without a sketch: no callout, but the highlight still happens.
        E("() => { setDrawer('Shell.Router', 'top', true); __t.center('Shell.Router', .6); }"); pg.wait_for_timeout(150)
        x2, y2 = E("() => __t.mid(__t.row('Shell.Router', 'top', 'Intent'))"); pg.mouse.move(x2, y2); pg.wait_for_timeout(20)
        plain = E("() => [__t.talk(), __t.co()]")
        return 'pass' if on == 'Shell.Keymap' and off == '' and plain[0] and plain[1] is None else f'fail: on={on} off={off} plain={plain}'
    step('highlightOnHover', hover_highlight)

    def click_edit():
        x, y = palette(); pg.mouse.move(x, y); pg.mouse.click(x, y); pg.wait_for_timeout(80)
        c = E("() => __t.co()")
        if not c or c['mode'] != 'edit' or not c['form']: return 'fail: no editor ' + json.dumps(c)
        n0 = E("() => hist.undo.length")
        E("() => { const f = co.el.querySelector('form'); f.elements.sketch.value = 'Opens the palette; ~) included.'; f.elements.name.value = 'keys'; }")
        pg.keyboard.press('Control+Enter'); pg.wait_for_timeout(150)
        s = E("() => __t.src()"); n1 = E("() => hist.undo.length")
        if '(port :in KeyChord :as keys (~~ Opens the palette; ~) included. ~~))' not in s or n1 != n0 + 1: return 'fail: ' + s[s.find('(port :in KeyChord'):][:80] + f' undo {n0}->{n1}'
        E("() => undo()"); pg.wait_for_timeout(100)
        return 'pass' if E("() => __t.src()") == original else 'fail: one undo does not restore'
    step('clickEditsOneUndo', click_edit)

    # v0.3: the editor writes :as only for a name that is not the type's default; renaming a port to its
    # default name drops :as, and a name that is the default follows a change of type.
    def editor_default_name():
        x, y = palette(); pg.mouse.click(x, y); pg.wait_for_timeout(80)
        pg.fill('.callout [name=name]', 'keyChord'); pg.keyboard.press('Enter'); pg.wait_for_timeout(150)
        a = E("() => __t.src()")
        if '(port :in KeyChord (~ Opens the palette. ~))' not in a or ':as keyChord' in a: return 'fail: rename to default: ' + a[a.find('(block Shell.CommandPalette'):][:160]
        E("() => undo()"); pg.wait_for_timeout(100)
        E("() => { setDrawer('Shell.Router', 'top', true); __t.center('Shell.Router', 1); }"); pg.wait_for_timeout(150)
        x2, y2 = E("() => __t.mid(__t.row('Shell.Router', 'top', 'Intent'))"); pg.mouse.click(x2, y2); pg.wait_for_timeout(80)
        pg.fill('.callout [name=kind]', 'TurnAdded'); pg.wait_for_timeout(30)
        follows = E("() => co.el.querySelector('[name=name]').value")
        pg.fill('.callout [name=kind]', 'KeyChord'); pg.keyboard.press('Enter'); pg.wait_for_timeout(150)
        b2 = E("() => __t.src()")
        if follows != 'turnAdded' or '(port :in KeyChord)' not in b2 or ':as' in b2[b2.find('(block Shell.Router'):][:120]: return f'fail: follow {follows}: ' + b2[b2.find('(block Shell.Router'):][:160]
        E("() => undo()"); pg.wait_for_timeout(100)
        return 'pass' if E("() => __t.src()") == original else 'fail: undo'
    step('editorDefaultName', editor_default_name)

    # The Edit dialog writes the same form: a new name adds :as, the default name leaves it out.
    def dialog_port_name():
        row = "() => [...document.querySelectorAll('.prow2:not(.inh)')].find(r => r.querySelector('.pkind').value === 'Intent').querySelector('.pname')"
        E("() => openEdit('Shell.Router')"); pg.wait_for_timeout(150)
        E("(f) => { eval(f)().value = 'route'; document.querySelector('[data-m=\"save\"]').click(); }", row); pg.wait_for_timeout(150)
        a = E("() => __t.src()")
        E("() => openEdit('Shell.Router')"); pg.wait_for_timeout(150)
        E("(f) => { eval(f)().value = 'intent'; document.querySelector('[data-m=\"save\"]').click(); }", row); pg.wait_for_timeout(150)
        b2 = E("() => __t.src()")
        return 'pass' if '(port :in Intent :as route)' in a and b2 == original else 'fail: ' + a[a.find('(block Shell.Router'):][:120] + ' | ' + b2[b2.find('(block Shell.Router'):][:120]
    step('dialogPortName', dialog_port_name)

    def esc_cancels():
        x, y = palette(); pg.mouse.click(x, y); pg.wait_for_timeout(80)
        E("() => { co.el.querySelector('form').elements.name.value = 'zzz'; co.el.querySelector('[name=name]').focus(); }")
        pg.keyboard.press('Escape'); pg.wait_for_timeout(80)
        return 'pass' if E("() => __t.src()") == original and E("() => __t.co()") is None else 'fail'
    step('escCancels', esc_cancels)

    def live_validation():
        x, y = palette(); pg.mouse.click(x, y); pg.wait_for_timeout(80)
        pg.fill('.callout [name=name]', 'run'); pg.wait_for_timeout(30)
        a = E("() => co.el.querySelector('.merr').textContent")
        pg.fill('.callout [name=name]', 'chord'); pg.fill('.callout [name=kind]', 'TurnAdded'); pg.wait_for_timeout(30)
        b2 = E("() => co.el.querySelector('.merr').textContent")
        pg.keyboard.press('Enter'); pg.wait_for_timeout(80)
        still = E("() => __t.co() && __t.co().mode")
        return 'pass' if 'named run' in a and 'not in scope' in b2 and still == 'edit' and E("() => __t.src()") == original else f'fail: {a} | {b2} | {still}'
    step('liveValidation', live_validation)

    def inherited():
        E("() => { setDrawer('Shell.Sidebar', 'top', true); __t.center('Shell.Sidebar', 1); }"); pg.wait_for_timeout(150)
        x, y = E("() => __t.mid(__t.row('Shell.Sidebar', 'top', 'Frame'))"); pg.mouse.click(x, y); pg.wait_for_timeout(80)
        c = E("() => __t.co()")
        if not c or c['form'] or 'Edit in behavior Surface' not in c['text']: return 'fail: ' + json.dumps(c)
        pg.click('.callout [data-co=go]'); pg.wait_for_timeout(150)
        return 'pass' if E("() => state.sel") == 'β:Surface' else 'fail: sel ' + str(E("() => state.sel"))
    step('inheritedReadOnly', inherited)

    def label_render():
        E("() => __t.center('Shell.Router', 1)"); pg.wait_for_timeout(100)
        lab = E("() => { const l = document.querySelector('.lsep[data-key=\"Shell|1\"] .llab'); return l && l.textContent; }")
        top = E("() => { const l = document.querySelector('.lsep[data-key=\"Shell|0\"] .llab'); return l && l.textContent; }")
        plain = E("() => !document.querySelector('.lsep[data-key=\"Shell.Notification|1\"] .llab:not(.ph)')")
        worst = {}
        for k in (0.5, 1, 2):
            E("(k) => { __t.center('Shell.Router', k); render(); }", k); pg.wait_for_timeout(60)
            worst[str(k)] = E("""() => { let w = 0; document.querySelectorAll('.lsep').forEach(s => { const c = q => { const e = s.querySelector(q); if (!e || !e.offsetWidth) return null; const b = e.getBoundingClientRect(); return b.top + b.height / 2; };
              const ys = ['.llab', '.lline', '.plus'].map(c).filter(v => v != null); w = Math.max(w, Math.max(...ys) - Math.min(...ys)); }); return Math.round(w * 1000) / 1000; }""")
        ok = lab == 'Services' and top == 'Surfaces' and plain and all(v <= 0.5 for v in worst.values())
        return 'pass' if ok else f'fail: {lab} {top} {plain} {worst}'
    step('levelLabelAligned', label_render)

    def label_edit():
        E("() => __t.center('Shell.Router', 1)"); pg.wait_for_timeout(100)
        pg.click('.lsep[data-key="Shell|1"] .llab'); pg.wait_for_timeout(80)
        pg.fill('.callout [name=name]', 'Routing'); pg.fill('.callout [name=sketch]', 'Surfaces send intents here.')
        pg.focus('.callout [name=name]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(150)
        s = E("() => __t.src()")
        ok = '(level :name "Routing"\n    (~ Surfaces send intents here. ~)' in s and E("() => document.querySelector('.lsep[data-key=\"Shell|1\"] .llab').textContent") == 'Routing'
        # An unnamed level: its placeholder edits it, wrapping the implicit level in (level :name …).
        E("() => { state.open.add('Shell.Notification'); render(); __t.center('Shell.Notification', 1); }"); pg.wait_for_timeout(100)
        pg.hover('.lsep[data-key="Shell.Notification|1"] .lhit'); pg.wait_for_timeout(30)
        ph = E("() => getComputedStyle(document.querySelector('.lsep[data-key=\"Shell.Notification|1\"] .llab.ph')).display")
        return 'pass' if ok and ph != 'none' else f'fail: ok={ok} ph={ph}'
    step('levelLabelEdit', label_edit)

    def group_hover():
        E("() => __t.center('Shell.Keymap', 1)"); pg.wait_for_timeout(100)
        x, y = E("() => __t.line('Shell.Router', 'Shell.Keymap')"); pg.mouse.move(x, y); pg.wait_for_timeout(20)
        c = E("() => __t.co()")
        return 'pass' if c and c['mode'] == 'hover' and 'Clipboard and keymap shortcuts route as intents.' in c['text'] else 'fail ' + json.dumps(c)
    step('adjacencySketchHover', group_hover)

    def tilde_kept():
        # A (~ ~) sketch stays (~ ~), a (sketch "…") stays a string, and a new sketch is written (~ ~).
        E("() => __t.center('Shell.Keymap', 1)"); pg.wait_for_timeout(100)
        x, y = E("() => __t.line('Shell.Router', 'Shell.Keymap')"); pg.mouse.click(x, y); pg.wait_for_timeout(80)
        E("() => { co.el.querySelector('[name=sketch]').value = 'Shortcuts become intents.'; co.commit(false); }"); pg.wait_for_timeout(100)
        E("() => { openEdit('Shell.Theme'); const f = modalEl.querySelector('form'); f.elements.sketch.value = 'Design tokens, light and dark.'; f.requestSubmit(); }"); pg.wait_for_timeout(100)
        E("() => { openEdit('Shell.Router'); const f = modalEl.querySelector('form'); f.querySelector('.psk').value = 'Every intent.'; f.requestSubmit(); }"); pg.wait_for_timeout(100)
        s = E("() => __t.src()")
        want = ['(adjacent (~ Shortcuts become intents. ~)', '(block Shell.Theme (sketch "Design tokens, light and dark."))', '(port :in Intent (~ Every intent. ~))']
        miss = [w for w in want if w not in s]
        return 'pass' if not miss and E("() => parse(__t.src()).warnings.length") == 0 else 'fail: missing ' + json.dumps(miss)
    step('tildePreserved', tilde_kept)

    def carried():
        E("() => fit(false)"); pg.wait_for_timeout(100)
        dots = E("() => [...document.querySelectorAll('.blk[data-id=\"μ:Snapshot\"] > .tab.cry .pdot')].map(d => d.dataset.carry).join(',')")
        x, y = E("() => __t.mid(document.querySelector('.blk[data-id=\"μ:Snapshot\"] [data-carry=Camera]'))"); pg.mouse.move(x, y); pg.wait_for_timeout(20)
        c = E("() => __t.co()")
        pg.mouse.move(2, 500); pg.wait_for_timeout(20)
        x2, y2 = E("() => __t.mid(__t.el('μ:Camera').querySelector('.ttl'))"); pg.mouse.move(x2, y2); pg.wait_for_timeout(20)
        hl = E("() => __t.talk()")
        pg.mouse.move(2, 500); pg.wait_for_timeout(20); off = E("() => __t.talk()")
        pg.mouse.click(x, y); pg.wait_for_timeout(150)
        sel = E("() => state.sel")
        ok = dots == 'Selection,Camera' and c and 'Pan and zoom.' in c['text'] and hl == 'Cam,Undo,μ:Named,μ:Snapshot' and off == '' and sel == 'μ:Camera'
        return 'pass' if ok else f'fail: dots={dots} co={c and c["text"]} hl={hl} off={off} sel={sel}'
    step('carriedTypes', carried, CARRY)
    reset()
    pg.close()
    return errs

def touch(p, b):
    dev = dict(p.devices['iPhone 13']); dev.pop('default_browser_type', None); dev['device_scale_factor'] = 1
    ctx = b.new_context(**dev); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(PAGE); pg.wait_for_timeout(1500)
    pg.add_script_tag(content=HELPERS)
    cdp = ctx.new_cdp_session(pg)
    E = lambda js, *a: pg.evaluate(js, *a)
    E("() => { document.getElementById('help').hidden = true; state.opts.animate = false; }")
    original = E("() => __t.src()")
    def tch(kind, pts): cdp.send('Input.dispatchTouchEvent', { 'type': kind, 'touchPoints': [{ 'x': x, 'y': y, 'id': i } for i, (x, y) in enumerate(pts)] })
    def tap(x, y): tch('touchStart', [(x, y)]); pg.wait_for_timeout(40); tch('touchEnd', []); pg.wait_for_timeout(200)
    def edit_button():
        E("() => { setDrawer('Shell.CommandPalette', 'top', true); __t.center('Shell.CommandPalette', 1); }"); pg.wait_for_timeout(200)
        x, y = E("() => __t.mid(__t.row('Shell.CommandPalette', 'top', 'KeyChord'))"); tap(x, y)
        c = E("() => __t.co()"); hl = E("() => __t.talk()")
        if not c or c['mode'] != 'pin' or 'Opens the palette.' not in c['text'] or 'data-co="edit"' not in c['html'] or hl != 'Shell.Keymap': return 'fail: ' + json.dumps(c) + ' ' + hl
        bx, by = E("() => __t.mid(co.el.querySelector('[data-co=edit]'))"); tap(bx, by)
        c2 = E("() => __t.co()")
        if not c2 or c2['mode'] != 'edit' or not c2['form']: return 'fail: Edit did not open the editor'
        E("() => { co.el.querySelector('[name=sketch]').value = 'Opens it.'; }")
        # A tap elsewhere saves.
        ex, ey = E("() => { for (let y = innerHeight - 160; y > 90; y -= 8) for (let x = 12; x < innerWidth - 12; x += 8) { const t = document.elementFromPoint(x, y); if (t && t.id === 'vp') return [x, y]; } return null; }")
        tap(ex, ey)
        ok = '(port :in KeyChord :as chord (~ Opens it. ~))' in E("() => __t.src()") and E("() => __t.co()") is None
        # An inherited port: no Edit button, a link to the behavior instead.
        E("() => { setDrawer('Shell.Sidebar', 'top', true); __t.center('Shell.Sidebar', 1); }"); pg.wait_for_timeout(200)
        x3, y3 = E("() => __t.mid(__t.row('Shell.Sidebar', 'top', 'Frame'))"); tap(x3, y3)
        c3 = E("() => __t.co()")
        inh = c3 and 'Edit in behavior Surface' in c3['text'] and 'data-co="edit"' not in c3['html']
        return 'pass' if ok and inh else f'fail: saved={ok} inherited={c3 and c3["text"]}'
    try: r['touchEditButton'] = edit_button()
    except Exception as e: r['touchEditButton'] = 'ERROR ' + str(e)[:300]
    ctx.close()
    return errs

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    errs = desktop(p, b) + touch(p, b)
    r['pageErrors'] = 'none' if not errs else '; '.join(errs)[:300]
    b.close()
print('RESULT ' + json.dumps(r))
