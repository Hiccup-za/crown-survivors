// Crown Survivors Workshop dev server: the Workshop UI, the live game source, the game itself at /play (Databuddy stripped)
// and the F8 bug report store in dev/reports/. Local only (bound to 127.0.0.1), never deployed.
// Usage: npm run workshop  (PORT=8790 by default)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '../..');
const GAME = join(root, 'public/index.html'), REPORTS = join(root, 'dev/reports');
const PORT = Number(process.env.PORT) || 8790;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ID = /^[\w-]{1,120}$/;
const STATIC = {
  '/': [join(here, 'index.html'), 'text/html; charset=utf-8'],
  '/app.js': [join(here, 'app.js'), 'text/javascript; charset=utf-8'],
  '/workshop.js': [join(here, 'workshop.js'), 'text/javascript; charset=utf-8'],
  '/game/index.html': [GAME, 'text/html; charset=utf-8'],
};
const REPORT_FILES = { 'report.json': 'application/json; charset=utf-8', 'screenshot.png': 'image/png', 'README.md': 'text/markdown; charset=utf-8' };

const version = async () => JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const send = (res, code, body, type = 'text/plain; charset=utf-8') => res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
const json = (res, code, v) => send(res, code, JSON.stringify(v), 'application/json; charset=utf-8');
async function body(req, max = 40 << 20) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('body too large'), { code: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

// /play: the game exactly as deployed, minus the Databuddy tag, plus the package version for bug reports
async function play() {
  const src = await readFile(GAME, 'utf8');
  const out = src.replace(/<script[^>]*databuddy[^>]*><\/script>\s*/i, '').replace(/<html\b/, `<html data-version="${await version()}"`);
  if (/databuddy\.js/i.test(out)) throw new Error('could not strip the Databuddy script tag from public/index.html');
  return out;
}

// ---------- bug reports ----------
const summaries = new Map(); // id -> { m: mtimeMs, s: summary }, so the list doesn't re-parse big reports every poll
async function listReports() {
  let ids = [];
  try { ids = (await readdir(REPORTS, { withFileTypes: true })).filter(d => d.isDirectory() && ID.test(d.name)).map(d => d.name); } catch (e) { return []; }
  const out = [];
  for (const id of ids) {
    try {
      const f = join(REPORTS, id, 'report.json'), m = (await stat(f)).mtimeMs, c = summaries.get(id);
      if (c && c.m === m) { out.push(c.s); continue; }
      const r = JSON.parse(await readFile(f, 'utf8'));
      const s = { id, at: r.at, note: r.note, status: r.status || 'open', summary: r.summary, errors: (r.errors || []).length, scene: r.scene, runMode: r.runMode, version: r.version, replayOf: r.replayOf || null };
      summaries.set(id, { m, s }); out.push(s);
    } catch (e) { /* half-written or foreign folder: skip */ }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
function readme(r) {
  const s = r.summary || {}, line = (k, v) => v == null || v === '' ? '' : `| ${k} | ${String(v).replace(/\|/g, '\\|')} |\n`;
  const errs = (r.errors || []).map(e => `- \`${e.kind}\` at ${e.t}s: ${e.msg}${e.stack ? '\n\n  ```\n' + String(e.stack).split('\n').map(l => '  ' + l).join('\n') + '\n  ```' : ''}`).join('\n');
  return `# Bug report ${r.id}

> ${(r.note || '(no note)').split('\n').join('\n> ')}

Status: **${r.status || 'open'}** · ${r.at} · game ${r.version || '?'} · ${r.scene} / ${r.runMode}${r.replayOf ? ` · follow-up of \`${r.replayOf}\`` : ''}

![screenshot](screenshot.png)

## Summary

| Field | Value |
| --- | --- |
${line('Hero', s.hero)}${line('Weapons', s.weapons)}${line('Passives', s.passives)}${line('Run time (G.t)', s.t)}${line('Level', s.level)}${line('HP', s.hp)}${line('Enemies', s.enemies)}${line('Boss', s.boss)}${line('Phase', s.phase)}${line('Night Rank', s.rank)}${line('Debug run', s.dbg ? 'yes' : '')}${line('Viewport', r.viewport ? `${r.viewport.W}×${r.viewport.H} @${r.viewport.DPR}x` : '')}${line('URL', r.url)}${line('User agent', r.ua)}
## Errors (${(r.errors || []).length})

${errs || 'None captured.'}

## Replay

With \`npm run workshop\` running, open http://localhost:${PORT}/play?report=${r.id}

The run loads frozen at the moment of the report: \`S\`, \`G\`, \`runMode\` and \`clock\` are restored, saves, cloud sync and telemetry are off.
Press backtick for the debug menu (resume, step one frame, time scale), and F8 to file a follow-up report.

## Files

- \`screenshot.png\`: the canvas when F8 was pressed
- \`report.json\`: everything else. \`state.S\` is the save, \`state.G\` the serialized run. Shared objects are written once with \`$id\`
  and referenced as \`{"$r": n}\`; \`{"$set": []}\` is a Set, \`{"$map": [[k, v]]}\` a Map, \`{"$n": "Infinity"}\` a non-finite number.
  Functions, canvases and the floor blood cache (\`G.blood\`) are left out.
`;
}
async function saveReport(raw) {
  const r = JSON.parse(raw);
  let id = String(r.id || '');
  if (!ID.test(id)) throw Object.assign(new Error('bad report id'), { code: 400 });
  for (let n = 2; await stat(join(REPORTS, id)).then(() => true, () => false); n++) id = String(r.id).slice(0, 110) + '-' + n;
  r.id = id; r.status = r.status || 'open';
  const shot = typeof r.screenshot === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(r.screenshot) : null;
  delete r.screenshot;
  if (shot) r.screenshot = 'screenshot.png';
  const dir = join(REPORTS, id);
  await mkdir(dir, { recursive: true });
  if (shot) await writeFile(join(dir, 'screenshot.png'), Buffer.from(shot[1], 'base64'));
  await writeFile(join(dir, 'report.json'), JSON.stringify(r, null, 1));
  await writeFile(join(dir, 'README.md'), readme(r));
  return { id, path: `dev/reports/${id}/` };
}
async function setStatus(id, raw) {
  const { status } = JSON.parse(raw);
  if (status !== 'open' && status !== 'resolved') throw Object.assign(new Error('status must be open or resolved'), { code: 400 });
  const f = join(REPORTS, id, 'report.json'), r = JSON.parse(await readFile(f, 'utf8'));
  r.status = status; r.statusAt = new Date().toISOString();
  await writeFile(f, JSON.stringify(r, null, 1));
  await writeFile(join(REPORTS, id, 'README.md'), readme(r));
  return { id, status };
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), path = url.pathname, m = req.method;
  // only our own pages may talk to us: blocks DNS rebinding (Host) and cross-site form posts (Origin)
  if (!HOSTS.has(req.headers.host || '')) return send(res, 403, 'forbidden host');
  if (m === 'POST' && req.headers.origin && !HOSTS.has(req.headers.origin.replace(/^http:\/\//, ''))) return send(res, 403, 'forbidden origin');
  try {
    const st = STATIC[path];
    if (st && (m === 'GET' || m === 'HEAD')) {
      const [file, type] = st, s = await stat(file);
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'last-modified': s.mtime.toUTCString(), 'x-mtime': String(s.mtimeMs) });
      return res.end(m === 'HEAD' ? undefined : await readFile(file));
    }
    if (path === '/play' && m === 'GET') return send(res, 200, await play(), 'text/html; charset=utf-8');
    if (path === '/__dev/reports') {
      if (m === 'GET') return json(res, 200, await listReports());
      if (m === 'POST') return json(res, 201, await saveReport(await body(req)));
    }
    const rm = /^\/__dev\/reports\/([^/]+)\/([^/]+)$/.exec(path);
    if (rm && ID.test(rm[1])) {
      const [, id, f] = rm;
      if (f === 'status' && m === 'POST') return json(res, 200, await setStatus(id, await body(req, 1 << 16)));
      if (REPORT_FILES[f] && m === 'GET') return send(res, 200, await readFile(join(REPORTS, id, f)), REPORT_FILES[f]);
    }
    send(res, 404, 'not found');
  } catch (e) {
    send(res, e.code === 'ENOENT' ? 404 : typeof e.code === 'number' ? e.code : e instanceof SyntaxError ? 400 : 500, String(e.message || e));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Crown Survivors Workshop: http://localhost:${PORT}  (game: http://localhost:${PORT}/play)`));
