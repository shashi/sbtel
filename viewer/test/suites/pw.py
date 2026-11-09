# usage: python3 pw.py page.html test.js [w h] [scheme]  -> runs window.__accept in real time
import sys, json
from playwright.sync_api import sync_playwright
page_path, test = sys.argv[1], sys.argv[2]
w, h = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (1500, 1000)
scheme = sys.argv[5] if len(sys.argv) > 5 else 'light'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1, color_scheme=scheme)
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file://' + page_path); pg.wait_for_timeout(1500)
    pg.add_script_tag(content=open(test).read())
    r = pg.evaluate('async () => { try { return await __accept(); } catch (e) { return { fatal: e.message + e.stack }; } }')
    print('RESULT ' + json.dumps(r)); 
    if errs: print('PAGEERRORS', errs)
    b.close()
