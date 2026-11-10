// Local preview with live reload: `node dev.mjs [path-to-sbtel-repo] [port]`.
// Serves this directory, reloads open tabs when a file changes, and reruns build.mjs when src/ changes.
import { createServer } from 'node:http';
import { watch, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.argv[2] || join(root, '..', 'sbtel'));
const port = +(process.argv[3] || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.sbtel': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const RELOAD = '<script>new EventSource("/__reload").onmessage = () => location.reload()</script>';
const clients = new Set();

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/__reload') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  let file = resolve(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith('/')) { res.writeHead(302, { location: path + '/' }).end(); return; }
    file = join(file, 'index.html');
  }
  if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/html' }).end(readFileSync(join(root, '404.html'))); return; }
  const type = TYPES[extname(file)] || 'application/octet-stream';
  let body = readFileSync(file);
  if (type.startsWith('text/html')) body = body.toString().replace('</body>', RELOAD + '</body>');
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
}).listen(port, '127.0.0.1', () => console.log(`sbtel site: http://127.0.0.1:${port}/  (repo: ${repo})`));

let timer = null, building = false, ownWrites = 0;
const reload = () => clients.forEach(c => c.write('data: reload\n\n'));
function build() {
  if (building) return; building = true;
  const t = Date.now();
  spawn(process.execPath, [join(root, 'build.mjs'), repo], { stdio: 'inherit' }).on('exit', code => {
    building = false; ownWrites = Date.now() + 300;
    console.log(code ? `build failed (${code})` : `built in ${Date.now() - t} ms`); reload();
  });
}
watch(root, { recursive: true }, (_, name) => {
  if (!name || name.startsWith('.git') || building || Date.now() < ownWrites) return;
  clearTimeout(timer);
  timer = setTimeout(() => (name.startsWith('src' + sep) || name === 'build.mjs' ? build() : reload()), 80);
});
