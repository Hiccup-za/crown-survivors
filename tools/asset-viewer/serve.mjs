// Asset viewer dev server: serves the viewer and the live game source (public/index.html). Local only, never deployed.
// Usage: npm run assets  (PORT=8790 by default)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROUTES = {
  '/': [join(here, 'index.html'), 'text/html; charset=utf-8'],
  '/app.js': [join(here, 'app.js'), 'text/javascript; charset=utf-8'],
  '/game/index.html': [join(here, '../../public/index.html'), 'text/html; charset=utf-8'],
};
const PORT = Number(process.env.PORT) || 8790;

createServer(async (req, res) => {
  const route = ROUTES[new URL(req.url, 'http://x').pathname];
  if (!route || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const [file, type] = route;
    const s = await stat(file);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'last-modified': s.mtime.toUTCString(), 'x-mtime': String(s.mtimeMs) });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Crown Survivors asset viewer: http://localhost:${PORT}`));
