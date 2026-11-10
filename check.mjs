// Quick look at the home page: `node check.mjs [outdir]`. Prints where each section starts on a laptop and a
// phone, checks that the hero plays from the tangle to the design, and saves first-screen screenshots.
// Needs playwright for node (a preinstalled tool, not a dependency of this site).
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = dirname(fileURLToPath(import.meta.url)), out = resolve(process.argv[2] || join(root, '.check'));
mkdirSync(out, { recursive: true });
const url = pathToFileURL(join(root, 'index.html')).href;
const b = await chromium.launch(); let bad = 0;
for (const [name, opts] of [['laptop', { viewport: { width: 1280, height: 720 } }], ['phone', devices['iPhone 13']]]) {
  const p = await b.newPage(opts); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url); await p.waitForTimeout(600);
  await p.screenshot({ path: join(out, name + '.png') });
  const m = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight,
    overflow: document.documentElement.scrollWidth > innerWidth,
    hero: Math.round(document.querySelector('#hero').getBoundingClientRect().top + scrollY),
    secs: [...document.querySelectorAll('section[id]')].map(s => s.id + '@' + Math.round(s.getBoundingClientRect().top + scrollY)) }));
  await p.evaluate(() => document.querySelector('#hero').scrollIntoView({ block: 'center' }));
  await p.waitForFunction(() => document.getElementById('demo').dataset.state === 'design', null, { timeout: 9000 }).catch(() => {});
  const beat = await p.evaluate(() => document.getElementById('demo').dataset.state);
  await p.waitForTimeout(5600); // the design, settled
  await p.screenshot({ path: join(out, name + '-design.png') });
  const ok = beat === 'design' && !m.overflow && !errs.length; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: page ${m.h}px, screen ${m.vh}px, hero diagram at ${m.hero}px, autoplay reached "${beat}"` +
    (m.overflow ? ', horizontal overflow' : '') + (errs.length ? ', errors: ' + errs.join('; ') : '') + `\n     ${m.secs.join('  ')}`);
  await p.close();
}
await b.close(); console.log('screenshots in ' + out); process.exit(bad ? 1 : 0);
