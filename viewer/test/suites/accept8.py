# accept8 (v0.2.2): behaviors take a block's grammar. A behavior's :type and a message type's :type show
# as pills on their cards; a behavior that implements another shows its badge; hovering a behavior
# outlines its implementers, through behaviors that extend it too, labelled "implements" (standalone
# has no bindings, so nothing is labelled "uses"); the Edit dialog edits a behavior's type and what it
# extends. Real mouse, Playwright.
# usage: python3 accept8.py page.html
import sys, json, re
from playwright.sync_api import sync_playwright
PAGE = 'file://' + sys.argv[1]
SPEC = '''(block Notes
  :type "App"
  (sketch "Write notes, see them rendered, keep them on disk.")
  (message Edit :type "struct" (sketch "A change to one note's text."))
  (behavior Durable :type "trait"
    (port edit in Edit)
    (sketch "Keeps every accepted edit until it is on disk."))
  (behavior Journaled
    (implements Durable)
    (sketch "Durable, and can replay what it kept."))
  (level :name "Editing"
    (block Notes.Editor (port edit out Edit) (sketch "The text area.")))
  (level :name "Storage"
    (block Notes.Store :type "Module" (implements Journaled) (sketch "Writes notes to disk."))
    (block Notes.Memory (implements Durable) (sketch "Keeps notes in memory, for tests."))))
'''
r = {}
MARKS = "() => Object.fromEntries([...document.querySelectorAll('.blk[data-bh]')].map(e => [e.dataset.id, (e.classList.contains('bh-impl') ? 'impl:' : e.classList.contains('bh-uses') ? 'uses:' : '') + e.dataset.bh]))"

def hover(pg, id):
    b = pg.evaluate("id => { const r = state.elems.get(id).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height - 12]; }", id)
    pg.mouse.move(b[0], b[1]); pg.wait_for_timeout(250)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1400, 'height': 1000}, device_scale_factor=1)
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(PAGE); pg.wait_for_timeout(1500)
    pg.evaluate("s => { document.getElementById('help').hidden = true; setSource(s); state.open = new Set(['Notes']); render(); fit(false); }", SPEC)
    pg.wait_for_timeout(700)
    pill = lambda id: pg.evaluate("id => { const p = state.elems.get(id)?.querySelector('.toprow .pill'); return p ? p.textContent : null; }", id)
    r['behaviorPill'] = 'pass' if pill('β:Durable') == 'trait' else 'fail %r' % pill('β:Durable')
    r['messagePill'] = 'pass' if pill('μ:Edit') == 'struct' else 'fail %r' % pill('μ:Edit')
    r['noPillWithoutType'] = 'pass' if pill('β:Journaled') is None else 'fail'
    r['extendsBadge'] = 'pass' if pg.evaluate("() => !!state.elems.get('β:Journaled').querySelector('.toprow [data-beh=\"Durable\"]')") else 'fail'
    r['inheritedPortsOnExtension'] = 'pass' if pg.evaluate("() => portsOf(state.model.behaviors.get('Journaled')).some(p => p.name === 'edit' && p.via === 'Durable')") else 'fail'
    hover(pg, 'β:Durable')
    m = pg.evaluate(MARKS)
    r['hoverOutlinesImplementers'] = 'pass' if m == {'Notes.Store': 'impl:implements', 'Notes.Memory': 'impl:implements', 'β:Journaled': 'impl:implements'} else 'fail ' + json.dumps(m)
    r['sourceDotted'] = 'pass' if pg.evaluate("() => { const e = state.elems.get('β:Durable'); return e.classList.contains('bh-src') && getComputedStyle(e).outlineStyle === 'dotted'; }") else 'fail'
    r['labelShown'] = 'pass' if pg.evaluate("() => getComputedStyle(state.elems.get('Notes.Store'), '::after').content === '\"implements\"'") else 'fail'
    hover(pg, 'β:Journaled')
    m = pg.evaluate(MARKS)
    r['hoverSubBehavior'] = 'pass' if m == {'Notes.Store': 'impl:implements'} else 'fail ' + json.dumps(m)
    pg.mouse.move(700, 990); pg.wait_for_timeout(250)
    r['leaveClears'] = 'pass' if pg.evaluate(MARKS) == {} else 'fail'
    # The badge on an implementer's card outlines the same way.
    b2 = pg.evaluate("() => { const r = state.elems.get('Notes.Memory').querySelector('[data-beh=\"Durable\"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }")
    pg.mouse.move(b2[0], b2[1]); pg.wait_for_timeout(250)
    r['badgeHover'] = 'pass' if 'Notes.Store' in pg.evaluate(MARKS) else 'fail'
    pg.mouse.move(700, 990); pg.wait_for_timeout(200)
    # Edit dialog: a behavior's type and the behaviors it extends.
    pg.evaluate("() => openEdit('β:Journaled')"); pg.wait_for_timeout(300)
    ok = pg.evaluate("() => { const f = document.querySelector('.editf'); return !!f.elements.type && [...f.querySelectorAll('input[name=impl]')].map(x => x.value + ':' + x.checked).join(',') === 'Durable:true'; }")
    pg.fill('.editf input[name=type]', 'interface'); pg.click('.editf [data-m=save]'); pg.wait_for_timeout(300)
    r['editBehaviorType'] = 'pass' if ok and re.search(r'\(behavior Journaled\s+:type "interface"', pg.evaluate("() => state.src")) and pill('β:Journaled') == 'interface' else 'fail'
    pg.evaluate("() => openEdit('β:Durable')"); pg.wait_for_timeout(300)
    pg.check('.editf input[name=impl][value=Journaled]'); pg.click('.editf [data-m=save]'); pg.wait_for_timeout(300)
    r['editRefusesCycle'] = 'pass' if pg.evaluate("() => { const e = document.querySelector('.editf .merr'); return !!e && !e.hidden && e.textContent.includes('already implements Durable'); }") and pg.evaluate("() => !state.model.behaviors.get('Durable').impl.length") else 'fail'
    pg.keyboard.press('Escape')
    b.close()
r['pageErrors'] = 'none' if not errs else errs[:3]
print('RESULT ' + json.dumps(r))
