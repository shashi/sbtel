# accept12 (v0.2.5): files made by `sbtel export`, opened from disk (file://) as a reader would open an
# emailed or downloaded file. The spec renders and round-trips exactly (text that would end an inline
# <script> included), nothing is requested from anywhere, --readonly blocks every edit, --bindings shows
# its violations and the "uses" outline, an edit survives a reload in that spec's own undo history, and
# --embed links to the same file in full view.
# usage: python3 accept12.py page.html path/to/sbtel   (the binary must embed this page: builtFromThisPage)
import sys, json, os, re, shutil, subprocess, tempfile
from playwright.sync_api import sync_playwright

PAGE, SBTEL = sys.argv[1], sys.argv[2]
# A tilde sketch holds anything: a closing script tag in two cases, a comment opener, entities that must
# stay literal; and one line ends in CR LF, which an HTML parser would turn into LF if it were not escaped.
NOTES = ('(block Notes\n'
         '  (~ Ends </script><script>window.pwned = 1</script> and </SCRIPT > <!-- <script> &lt; &amp; & a < b ~)\r\n'
         '  (message Edit (sketch "A change to one note\'s text."))\n'
         '  (behavior Durable (sketch "Keeps what it is given."))\n'
         '  (level :name "Editing"\n'
         '    (adjacent (~ The preview follows the editor. ~)\n'
         '      (block Notes.Editor (port edit out Edit) (sketch "The text area."))\n'
         '      (block Notes.Preview (sketch "Renders the note beside the editor — ünïcode."))))\n'
         '  (level :name "Storage"\n'
         '    (block Notes.Store (implements Durable) (port edit in Edit) (sketch "Writes notes to disk."))))\n')
OTHER = '(block Other (sketch "Another spec.")\n  (level (block Other.A (sketch "a")) (block Other.B (sketch "b"))))\n'
EDGES = ('# VIOLATION: the store tells the editor that a write finished.\n'
         'Notes.Store -> Notes.Editor  # store.ts:40\n'
         'Notes.Store -> Notes.Preview  # store.ts:41\n'
         'Notes.Preview -> Notes.Store  # preview.ts:3\n'
         'Notes.Editor -> Durable  # editor.ts:9\n')

d = tempfile.mkdtemp(prefix='sbtel-accept12-')
def w(name, text):
    p = os.path.join(d, name)
    with open(p, 'w', newline='') as f: f.write(text)
    return p
notes, other, edges = w('notes.sbtel', NOTES), w('other.sbtel', OTHER), w('edges.txt', EDGES)
def export(out, *args):
    p = subprocess.run([SBTEL, 'export', notes if not args or args[0] != 'other' else other, '-o', os.path.join(d, out)] + [a for a in args if a != 'other'], capture_output=True, text=True)
    if p.returncode != 0: raise SystemExit('Error: sbtel export %s: %s' % (out, p.stderr))
    return 'file://' + os.path.join(d, out)
FULL, RO, BIND, EMB = export('notes.html'), export('ro.html', '--readonly'), export('bind.html', '--bindings', edges), export('emb.html', '--embed')
OTH = export('other.html', 'other')

r, errs, net = {}, [], []
def check(name, ok): r[name] = 'pass' if ok else 'FAIL'

# The binary embeds this page: the export is the page with the baked blocks in place of its <title>.
exported = open(os.path.join(d, 'notes.html'), encoding='utf-8').read()
unbaked = re.sub(r'<title>[^<]*</title>\n<meta name="generator"[^\n]*\n(?:<script type="[^"]+" id="sbtel-[a-z]+">[^<]*</script>\n)+', '<title>sbtel Playground</title>\n', exported, count=1)
check('builtFromThisPage', unbaked == open(PAGE, encoding='utf-8').read())

MARKS = "() => Object.fromEntries([...document.querySelectorAll('.blk[data-bh]')].map(e => [e.dataset.id, (e.classList.contains('bh-impl') ? 'impl:' : e.classList.contains('bh-uses') ? 'uses:' : '') + e.dataset.bh]))"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1200, 'height': 800}, device_scale_factor=1)
    ctx.add_init_script("try { localStorage.setItem('sbtel-help-seen', 'true'); } catch (e) {}")
    # Anything but the exported files themselves and inline data: is a network request.
    ctx.on('request', lambda q: q.url.startswith('data:') or q.url.split('?')[0].split('#')[0].startswith('file://' + d + '/') or net.append(q.url))
    def go(url, w=1200, h=800):
        pg = ctx.new_page(); pg.set_viewport_size({'width': w, 'height': h})
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        pg.goto(url); booted(pg)
        return pg
    # Boot has run: the diagram is drawn (and, where the page keeps one, the history is in use).
    def booted(pg):
        pg.wait_for_function("() => typeof state !== 'undefined' && !!state.model && !!document.querySelector('.blk') && (readOnly() || !!hist.key || document.body.classList.contains('embed'))", timeout=20000)
        pg.wait_for_timeout(500)
    E = lambda pg, js, *a: pg.evaluate(js, *a)
    def hover(pg, id):
        c = E(pg, "id => { const r = state.elems.get(id).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height - 12]; }", id)
        pg.mouse.move(c[0], c[1]); pg.wait_for_timeout(300)

    # Renders the spec, exactly as written, under its title; no script in the spec ran.
    pg = go(FULL)
    check('rendersSpec', E(pg, "topBlocks(state.model)[0].name === 'Notes' && document.querySelectorAll('.blk').length >= 4 && !!state.elems.get('Notes.Store')"))
    check('specRoundTrips', E(pg, "state.src") == NOTES and E(pg, "window.pwned === undefined"))
    check('titleAndChip', E(pg, "document.title") == 'Notes' and E(pg, "document.getElementById('specName').textContent") == 'Notes · 4 blocks')
    check('exportedStandalone', E(pg, "SBTEL.mode === 'standalone' && !!SBTEL.modes.standalone.exported && !document.body.classList.contains('embed') && !readOnly()"))
    check('homeLinkNewTab', E(pg, "(a => !!a && a.href === 'https://shashi.biz/sbtel/' && a.target === '_blank' && /noreferrer/.test(a.rel))(document.querySelector('#brand a.home'))"))
    pg.click('#srcBtn'); pg.wait_for_timeout(400)
    check('noSampleButtons', E(pg, "getComputedStyle(document.querySelector('#srcSheet .row2')).display === 'none' && document.getElementById('src').value === state.src.replace(/\\r\\n/g, '\\n')"))  # a textarea's value has no CR
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)

    # An edit, then a reload: the baked spec loads again and undo brings the edit back; another spec's
    # file has its own history.
    key = E(pg, "'sbtel-hist:spec-' + SBTEL.modes.standalone.digest(state.src)")
    pg.click('.blk[data-id="Notes.Preview"] .ttl'); pg.keyboard.press('Delete'); pg.wait_for_timeout(200)
    pg.click('[data-m="yes"]'); pg.wait_for_timeout(700)
    pg.wait_for_function("k => (JSON.parse(localStorage.getItem(k) || 'null') || {}).head === state.src", arg=key, timeout=5000)
    check('editKeyedPerSpec', E(pg, "k => !state.model.node('Notes.Preview') && !!localStorage.getItem(k) && !localStorage.getItem('sbtel-hist')", key))
    pg.reload(); booted(pg)
    check('reloadKeepsUndo', E(pg, "!!state.model.node('Notes.Preview') && !document.getElementById('undo').disabled"))
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(400)
    check('undoRestoresEdit', E(pg, "!state.model.node('Notes.Preview')"))
    pg.close()
    pg = go(OTH)
    check('otherSpecApart', E(pg, "topBlocks(state.model)[0].name === 'Other' && document.getElementById('undo').disabled"))
    pg.close()

    # --readonly: the full viewer, nothing edits.
    pg = go(RO)
    src0, kept = E(pg, "state.src"), E(pg, "k => localStorage.getItem(k)", key)
    check('readonlyFlag', E(pg, "readOnly() && getComputedStyle(document.getElementById('undo')).display === 'none' && document.getElementById('src').readOnly && !document.body.classList.contains('embed')"))
    check('readonlyChip', E(pg, "document.getElementById('specName').textContent") == 'Notes · 4 blocks · read-only')
    pg.click('.blk[data-id="Notes.Store"] .ttl'); pg.wait_for_timeout(300)
    check('readonlyStrip', E(pg, "[...document.querySelectorAll('.strip [data-a]')].map(b => b.dataset.a).join()") == 'code,comment')
    pg.keyboard.press('Delete'); pg.wait_for_timeout(300)
    pg.keyboard.press('Control+x'); pg.wait_for_timeout(200)
    check('readonlyNoDelete', E(pg, "!document.querySelector('[data-m=\"yes\"]') && !!state.model.node('Notes.Store')"))
    box = pg.locator('.blk[data-id="Notes.Store"] .ttl').bounding_box()
    pg.mouse.click(box['x'] + 20, box['y'] + 8, button='right'); pg.wait_for_timeout(300)
    labels = E(pg, "[...document.querySelectorAll('.pop .mi')].map(b => b.textContent)")
    check('readonlyMenu', 'Code' in labels and not any(x in labels for x in ['Edit', 'Delete', 'Add a behavior', 'Insert a level above']))
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    box = pg.locator('.blk[data-id="Notes.Editor"] .ttl').bounding_box()
    pg.mouse.move(box['x'] + 20, box['y'] + 8); pg.mouse.down(); pg.mouse.move(box['x'] + 20, box['y'] + 160, steps=12); pg.mouse.up(); pg.wait_for_timeout(500)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(200)
    pg.click('.blk[data-id="Notes.Store"] > .tab.top'); pg.wait_for_timeout(300)
    pg.click('.blk[data-id="Notes.Store"] .drow[data-pi]'); pg.wait_for_timeout(400)
    check('readonlyNoEditor', E(pg, "!document.querySelector('.callout.edit')"))
    pg.keyboard.press('Escape')
    pg.click('#srcBtn'); pg.wait_for_timeout(300)
    pg.locator('#src').press('End'); pg.keyboard.type('(block X)'); pg.wait_for_timeout(500)
    # The same spec's history (notes.html wrote it above) is left as it was: a read-only page keeps none.
    check('readonlyUnchanged', E(pg, "state.src") == src0 and E(pg, "k => localStorage.getItem(k)", key) == kept)
    pg.close()

    # --bindings: the pill fails on the unexplained violation, the popover lists both with their notes,
    # and hovering a behavior outlines the block whose code uses it.
    pg = go(BIND)
    check('bindingsPillFails', E(pg, "document.getElementById('chkBtn').classList.contains('bad')"))
    pg.click('#chkBtn'); pg.wait_for_timeout(400)
    pop = E(pg, "pops.checks ? pops.checks.textContent : ''")
    check('bindingsListed', 'Code bindings respect the levels (4 edges, 1 of 2 violations explained)' in pop
          and 'Explained: the store tells the editor that a write finished.' in pop and 'Not explained in the bindings file.' in pop
          and 'store.ts:41' in pop and 'preview.ts:3' not in pop)
    pg.keyboard.press('Escape'); pg.mouse.move(5, 400); pg.wait_for_timeout(300)
    hover(pg, 'β:Durable')
    m = E(pg, MARKS)
    check('bindingsUses', m.get('Notes.Editor', '').startswith('uses:') and m.get('Notes.Store', '').startswith('impl:'))
    pg.close()
    pg = go(FULL)
    hover(pg, 'β:Durable')
    check('noUsesWithoutBindings', not any(v.startswith('uses:') for v in E(pg, MARKS).values()) and 'Bindings' not in E(pg, "(showChecks(), pops.checks.textContent)"))
    pg.close()

    # --embed: the chromeless layout; its link opens the same file in full view, not a playground.
    pg = go(EMB, 640, 400)
    check('embedLayout', E(pg, "document.body.classList.contains('embed') && getComputedStyle(document.getElementById('brand')).display === 'none' && !readOnly()"))
    href = E(pg, "document.querySelector('.pl-open').getAttribute('href')")
    check('embedOpensFullView', E(pg, "document.querySelector('.pl-open .lbl').textContent") == 'Open full view' and href == E(pg, "location.pathname") + '?embed=off')
    pg.close()
    pg = go('file://' + href)
    check('fullViewLoads', E(pg, "!document.body.classList.contains('embed') && document.getElementById('specName').textContent") == 'Notes · 4 blocks' and E(pg, "state.src") == NOTES)
    pg.close()
    b.close()
shutil.rmtree(d, ignore_errors=True)
r['network'] = 'none' if not net else net[:3]
r['pageErrors'] = 'none' if not errs else errs[:3]
print('RESULT ' + json.dumps(r))
