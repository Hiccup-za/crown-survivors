'use strict';
// Crown Survivors Workshop: tab switching, Playground, Balance and Reports. Shares the game runtime (CS, R, reload) with the Assets tab in app.js;
// only one run lives in that runtime, so the Assets sandbox and the Playground stop each other when you switch tabs.
const TABS = ['assets', 'playground', 'balance', 'reports'];
const copy = (text, msg) => { navigator.clipboard?.writeText(text); toast(msg || 'Copied'); };
const download = (name, text, type = 'application/json') => {
  const u = URL.createObjectURL(new Blob([text], { type })), l = document.createElement('a');
  l.href = u; l.download = name; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
};
const plain = v => JSON.parse(JSON.stringify(v ?? null)); // copy out of the runtime iframe, dropping functions
const fmt = (v, d = 1) => v == null || Number.isNaN(v) ? '–' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : (+v).toFixed(d);

// ---------- tabs ----------
function setTab(t) {
  if (!TABS.includes(t) || t === TAB) return;
  const prev = TAB;
  TAB = t;
  document.body.className = 't-' + t;
  TABS.forEach(k => { $('tab-' + k).hidden = k !== t; });
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (prev === 'assets' && CS) { CS.sim.stop(); simKey = null; }
  if (prev === 'playground' && CS) { CS.pg.stop(); pg.live = false; pgKeysOff(); }
  if (t === 'playground') pgEnter();
  if (t === 'balance') balRender();
  if (t === 'reports') repLoad();
  history.replaceState(null, '', t === 'assets' ? location.pathname : '#' + t);
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
addEventListener('keydown', e => {
  if (e.altKey && /^Digit[1-4]$/.test(e.code)) { setTab(TABS[+e.code.slice(5) - 1]); e.preventDefault(); return; }
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range';
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (TAB === 'playground' && !(pg.cfg.move && document.activeElement === $('pgvp') && MOVE_KEYS.has(e.key.toLowerCase()))) {
    if (e.key === ' ') { pg.playing = !pg.playing; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { pgStepOnce(); e.preventDefault(); }
  }
  if ((TAB === 'balance' || TAB === 'reports') && e.key === '/') { $(TAB === 'balance' ? 'balq' : 'repq').focus(); e.preventDefault(); }
});
// the runtime is rebuilt whenever public/index.html changes: re-read tables, restart the playground run
const _reload = reload;
reload = async manual => {
  await _reload(manual);
  if (!CS) return;
  balSrc = null;
  if (TAB === 'balance') balRender();
  if (TAB === 'playground') pgRestart();
  else if (TAB !== 'assets') CS.sim.stop();
};

// ---------- playground ----------
const PG_KEY = 'crownsurv_workshop_presets', MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const pgDefault = () => ({ mode: 'classic', hero: 0, curse: 0, t: 0, phase: 0, w: { bolt: 1 }, ps: {},
  target: { type: 'blob', n: 12, layout: 'ring', elite: false, pin: true, hp: 'immortal' }, spawn: false, god: true, move: false, boss: null });
const pg = { cfg: pgDefault(), live: false, playing: true, speed: 1, zoom: 1.6, acc: 0, samples: [], updMs: 0, drawMs: 0, s: null, err: null, uiT: 0 };
const pgView = $('pgview'), pgX = pgView.getContext('2d'), pgVp = $('pgvp');
const okFor = (o, hero) => o.only == null || o.only === hero;

function pgEnter() {
  if (!CS) return;
  pgConfigUI();
  pgRestart();
}
function pgRestart() {
  if (!CS) return;
  const c = pg.cfg;
  // hero-exclusive kit only for its hero
  for (const k in c.w) if (!R.WP[k] || !okFor(R.WP[k], c.hero)) delete c.w[k];
  for (const k in c.ps) if (!R.PS[k] || !okFor(R.PS[k], c.hero)) delete c.ps[k];
  pgKeysOff();
  try {
    CS.pg.start(plain(c));
    pg.live = true; pg.acc = 0; pg.samples = []; pg.s = null; pg.err = null; $('pgerr').style.display = 'none';
  } catch (e) { pgFail(e); }
  pgStats(true);
}
function pgFail(e) {
  pg.live = false; pg.err = String(e.stack || e);
  const el = $('pgerr'); el.textContent = 'Playground error:\n' + pg.err; el.style.display = 'block';
}
function pgStepOnce() { if (!pg.live) return; pg.playing = false; pgTick(); }
function pgTick() {
  const t0 = performance.now();
  CS.pg.step(SIM_DT);
  pg.updMs = pg.updMs * .9 + (performance.now() - t0) * .1;
}
function pgFrame(now) {
  const dt = Math.min(.1, (now - pgFrame.last) / 1000); pgFrame.last = now;
  if (TAB === 'playground' && CS && pg.live) {
    try {
      if (pg.playing) {
        pg.acc += dt * pg.speed;
        let n = 0;
        while (pg.acc >= SIM_DT && n++ < 40) { pgTick(); pg.acc -= SIM_DT; }
        if (n >= 40) pg.acc = 0;
      }
      const d = devicePixelRatio, w = Math.round(pgVp.clientWidth * d), h = Math.round(pgVp.clientHeight * d);
      if (pgView.width !== w || pgView.height !== h) { pgView.width = w; pgView.height = h; }
      const t0 = performance.now();
      pgX.setTransform(d, 0, 0, d, 0, 0);
      CS.pg.draw(pgX, w / d, h / d, pg.zoom);
      pg.drawMs = pg.drawMs * .9 + (performance.now() - t0) * .1;
      const s = JSON.parse(CS.pg.stats() || 'null');
      if (s) {
        // DPS over a rolling 5s window of game time, from G.dmgDealt
        const S5 = pg.samples, last = S5[S5.length - 1];
        if (!last || s.t > last[0]) S5.push([s.t, s.dmg]);
        while (S5.length > 2 && S5[1][0] <= s.t - 5) S5.shift();
        pg.s = s;
      }
      if (now - pg.uiT > 200) { pg.uiT = now; pgStats(); }
    } catch (e) { pgFail(e); pgStats(true); }
  }
  $('pgPlay').textContent = pg.playing ? '❚❚' : '▶';
  requestAnimationFrame(pgFrame);
}
pgFrame.last = performance.now();
const pgDps = () => { const S5 = pg.samples; if (S5.length < 2) return 0; const a = S5[0], b = S5[S5.length - 1]; return b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0; };

function pgConfigUI() {
  const c = pg.cfg, hw = c.mode === 'halloween', el = $('pgcfg'), T = c.target;
  const seg = (key, opts, cur) => `<span class="seg" data-k="${key}">${opts.map(([v, n]) => `<button data-v="${esc(JSON.stringify(v))}" class="${JSON.stringify(cur) === JSON.stringify(v) ? 'on' : ''}">${n}</button>`).join('')}</span>`;
  const sel = (key, opts, cur) => `<select data-k="${key}">${opts.map(([v, n]) => `<option value="${esc(JSON.stringify(v))}"${JSON.stringify(cur) === JSON.stringify(v) ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  const row = (label, html, title = '') => `<div class="ctl" title="${esc(title)}"><label>${label}</label>${html}</div>`;
  const chk = (key, label, on, title = '') => `<label class="chk" title="${esc(title)}"><input type="checkbox" data-k="${key}"${on ? ' checked' : ''}> ${label}</label>`;
  const lv = (key, T0, cur, evo) => Object.keys(T0).filter(k => okFor(T0[k], c.hero)).map(k => `<div class="lv"><span>${esc(T0[k].n)}${T0[k].only != null ? ' <small>hero only</small>' : ''}</span>${seg(key + '.' + k, [0, 1, 2, 3, 4, 5].map(l => [l, l]).concat(evo ? [['evo', 'E']] : []), cur[k] || 0)}</div>`).join('');
  const B = c.boss || { kind: '', id: 0, ph: 1 };
  const bossIds = B.kind === 'ritual' ? Object.keys(R.HB).map(k => [k, R.HB[k].n]) : R.BOSS.map((b, i) => [i, (i + 1) + '. ' + b.n]);
  el.innerHTML = `
  <div class="sec"><h3>Run</h3>
    ${row('Mode', seg('mode', [['classic', 'Classic'], ['halloween', 'Halloween']], c.mode))}
    ${row('Hero', sel('hero', R.CH.map((h, i) => [i, h.n]), c.hero))}
    ${hw ? '' : row('Curse', sel('curse', [0, 1, 2, 3, 4, 5].map(v => [v, v ? 'Curse ' + v : 'None']), c.curse), 'Curse raises enemy HP, speed and spawn rate')}
    ${row('Start time', `<span><input type="number" data-k="t" min="0" max="1200" step="10" value="${c.t}"> s</span>`, hw ? 'Halloween scales by ritual tier, not time' : 'G.t: scales enemy HP, speed, damage and spawn rate')}
    ${hw ? '' : row('Arena phase', sel('phase', R.PHASE.map((_, i) => [i, 'Phase ' + (i + 1)]), c.phase))}
  </div>
  <div class="sec"><h3>Weapons</h3>${lv('w', R.WP, c.w, 1)}</div>
  <div class="sec"><h3>Passives</h3>${lv('ps', R.PS, c.ps, 0)}</div>
  <div class="sec"><h3>Targets</h3>
    ${row('Enemy', sel('target.type', Object.keys(R.ETYPE).map(k => [k, (R.ENAME[k] || k) + (R.ETYPE[k].ev ? ' (event)' : '')]), T.type))}
    ${row('Count', `<input type="number" data-k="target.n" min="0" max="200" value="${T.n}">`)}
    ${row('Layout', seg('target.layout', [['ring', 'Ring'], ['pack', 'Pack'], ['line', 'Line']], T.layout))}
    ${row('Movement', seg('target.pin', [[true, 'Pinned'], [false, 'Moving']], T.pin))}
    ${row('HP', seg('target.hp', [['immortal', 'Immortal'], ['real', 'Real']], T.hp), 'Real HP: kills respawn after 0.25s, so time to kill is measured')}
    ${chk('target.elite', 'Elite (×8 HP, ×1.8 size)', T.elite)}
  </div>
  <div class="sec"><h3>Boss</h3>
    ${row('Boss', sel('boss.kind', [['', 'None'], ['classic', 'Classic boss']].concat(hw ? [['ritual', 'Ritual boss']] : []), B.kind))}
    ${B.kind ? row('Which', sel('boss.id', bossIds, B.id)) + row('Phase', seg('boss.ph', [[1, 'P1'], [2, 'P2'], [3, 'P3']], B.ph), 'Held by pinning HP while targets are immortal') : ''}
  </div>
  <div class="sec"><h3>Toggles</h3>
    ${chk('spawn', 'Natural spawning', c.spawn, hw ? 'hwSpawn + rituals' : 'Spawn waves, elites and timed bosses')}
    ${chk('god', 'God mode', c.god)}
    ${chk('move', 'Free move (click the view, then WASD)', c.move)}
  </div>`;
  const set = (path, v) => {
    const ks = path.split('.'), last = ks.pop();
    let o = c;
    for (const k of ks) { if (o[k] == null) o[k] = {}; o = o[k]; }
    if (ks[0] === 'w' || ks[0] === 'ps') { if (v) o[last] = v; else delete o[last]; }
    else o[last] = v;
    if (path === 'boss.kind') c.boss = v ? { kind: v, id: v === 'ritual' ? Object.keys(R.HB)[0] : 0, ph: 1 } : null;
    if (path === 'mode' && v === 'classic' && c.boss && c.boss.kind === 'ritual') c.boss = null;
    pgConfigUI(); pgRestart();
  };
  el.querySelectorAll('.seg[data-k] button').forEach(b => b.onclick = () => set(b.parentElement.dataset.k, JSON.parse(b.dataset.v)));
  el.querySelectorAll('select[data-k]').forEach(s => s.onchange = () => set(s.dataset.k, JSON.parse(s.value)));
  el.querySelectorAll('input[type=checkbox][data-k]').forEach(i => i.onchange = () => set(i.dataset.k, i.checked));
  el.querySelectorAll('input[type=number][data-k]').forEach(i => i.onchange = () => set(i.dataset.k, Math.max(+i.min, Math.min(+i.max, +i.value || 0))));
  $('pgMove').textContent = c.move ? 'free move: click the view, WASD / arrows' : '';
}

function pgStats(force) {
  const el = $('pgstats'), s = pg.s, c = pg.cfg;
  if (!el.querySelector('#pgS') || force) {
    el.innerHTML = `<div class="sec" id="pgS"></div>
    <div class="sec"><h3>Presets</h3>
      <div class="preset"><input id="pgName" placeholder="Preset name"><button class="btn" id="pgSave">Save</button></div>
      <div class="exp" style="margin-top:6px"><button class="btn" id="pgCopy" title="This setup as JSON, for a report or an agent prompt">Copy as JSON</button><button class="btn" id="pgPaste" title="Load a setup from JSON on the clipboard">Paste JSON</button><button class="btn" id="pgReset">Defaults</button></div>
      <div class="plist" id="pgList"></div></div>
    <div class="sec"><h3>Shortcuts</h3><div class="keys"><kbd>Space</kbd><span>Play / pause</span><kbd>→</kbd><span>Step one tick</span><kbd>Alt 1–4</kbd><span>Switch tab</span></div></div>`;
    $('pgSave').onclick = () => {
      const n = $('pgName').value.trim();
      if (!n) return toast('Name the preset first');
      const P = presets(); P[n] = plain(c); setPresets(P); toast('Saved preset ' + n); pgPresetList();
    };
    $('pgCopy').onclick = () => copy(JSON.stringify(c, null, 1), 'Copied the setup as JSON');
    $('pgPaste').onclick = async () => {
      try { pg.cfg = Object.assign(pgDefault(), JSON.parse(await navigator.clipboard.readText())); pgConfigUI(); pgRestart(); toast('Loaded setup from clipboard'); }
      catch (e) { toast('Clipboard has no setup JSON'); }
    };
    $('pgReset').onclick = () => { pg.cfg = pgDefault(); pgConfigUI(); pgRestart(); };
    pgPresetList();
  }
  const box = $('pgS');
  if (!s) { box.innerHTML = `<h3>Live stats</h3><p class="desc">${pg.err ? 'The run failed: see the error on the view.' : 'Starting…'}</p>`; return; }
  const SC = s.SC || {}, tg = s.slots, kills = tg.reduce((a, q) => a + q.kills, 0), ttk = tg.filter(q => q.avg != null);
  const ttkAvg = ttk.length ? ttk.reduce((a, q) => a + q.avg * q.kills, 0) / Math.max(1, ttk.reduce((a, q) => a + q.kills, 0)) : null;
  const tr = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  box.innerHTML = `<h3>Live stats ${s.over ? `<span class="pill open">run over: ${s.over}</span>` : ''}</h3>
    <div class="big">${fmt(pgDps(), 0)} <small style="font-size:12px;color:var(--dim)">DPS · 5s window</small></div>
    <table>
      ${tr('Total damage', fmt(s.dmg, 0))}${tr('Kills (all)', s.kills)}${tr('Run time G.t', s.t.toFixed(1) + 's')}${tr('Level', s.lvl)}${tr('HP', `${Math.round(s.hp)} / ${Math.round(s.mhp)}`)}
      ${s.hw ? tr('Embers · rank · tier', `${s.hw.embers} · ${s.hw.rank} · ${s.hw.tier}`) : ''}
    </table>
    <h3 style="margin-top:12px">Targets${c.target.hp === 'real' ? '' : ' (immortal)'}</h3>
    <table>${c.target.hp === 'real'
      ? tr('Target kills', kills) + tr('Time to kill (avg)', ttkAvg == null ? '–' : ttkAvg.toFixed(2) + 's') + tr('Fastest / slowest', ttk.length ? Math.min(...ttk.map(q => q.avg)).toFixed(2) + ' / ' + Math.max(...ttk.map(q => q.avg)).toFixed(2) + 's' : '–')
        + tr('Target HP', tg[0] && tg[0].mhp ? fmt(tg[0].mhp, 0) : '–')
      : tr('Targets', tg.length) + tr('Note', 'switch HP to Real for time to kill')}
      ${s.boss ? tr('Boss', `${esc(s.boss.n)} P${s.boss.ph}`) + tr('Boss HP', s.boss.dead ? 'dead' : `${fmt(s.boss.hp, 0)} / ${fmt(s.boss.mhp, 0)}`) : ''}
    </table>
    ${c.target.hp === 'real' && tg.length ? `<table style="margin-top:6px">${tg.slice(0, 10).map((q, i) => tr('#' + (i + 1), `${q.kills} kills · ${q.avg == null ? '–' : q.avg.toFixed(2) + 's'}`)).join('')}${tg.length > 10 ? tr('…', (tg.length - 10) + ' more') : ''}</table>` : ''}
    <h3 style="margin-top:12px">Computed stats (SC)</h3>
    <table>${tr('Damage ×', fmt(SC.dmg, 3))}${tr('Cooldown ×', fmt(SC.cd, 3))}${tr('Area ×', fmt(SC.area, 3))}${tr('Crit', fmt(SC.crit * 100, 1) + '%')}${tr('Armor', SC.armor)}${tr('Speed', fmt(SC.spd, 1))}${tr('Magnet', fmt(SC.mag, 1))}</table>
    <h3 style="margin-top:12px">Entities · perf</h3>
    <table>${Object.entries(s.n).map(([k, v]) => tr(k, v)).join('')}${tr('update', pg.updMs.toFixed(2) + ' ms / tick')}${tr('draw', pg.drawMs.toFixed(2) + ' ms')}</table>`;
  $('pghud').textContent = `${c.mode === 'halloween' ? 'Halloween' : 'Classic'} · ${R.CH[c.hero].n} · G.t ${s.t.toFixed(1)}s · ${pg.speed}×${pg.playing ? '' : ' · paused'}`;
}
const presets = () => { try { return JSON.parse(localStorage.getItem(PG_KEY) || '{}'); } catch (e) { return {}; } };
const setPresets = P => localStorage.setItem(PG_KEY, JSON.stringify(P));
function pgPresetList() {
  const P = presets(), el = $('pgList');
  el.innerHTML = Object.keys(P).length ? Object.keys(P).sort().map(n => `<div><button class="btn" data-load="${esc(n)}">${esc(n)}</button><button class="btn" data-del="${esc(n)}" title="Delete preset">✕</button></div>`).join('') : '<p class="desc">No presets yet.</p>';
  el.querySelectorAll('[data-load]').forEach(b => b.onclick = () => { pg.cfg = Object.assign(pgDefault(), plain(presets()[b.dataset.load])); $('pgName').value = b.dataset.load; pgConfigUI(); pgRestart(); toast('Loaded ' + b.dataset.load); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const Q = presets(); delete Q[b.dataset.del]; setPresets(Q); pgPresetList(); });
}
function pgKeysOff() { if (CS && CS.pg) for (const k of MOVE_KEYS) CS.pg.key(k, 0); }
$('pgApply').onclick = () => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); pgConfigUI(); pgRestart(); };
$('pgRestart').onclick = () => pgRestart();
$('pgPlay').onclick = () => { pg.playing = !pg.playing; };
$('pgStep').onclick = () => pgStepOnce();
$('pgSpeed').onchange = e => { pg.speed = +e.target.value; };
$('pgZoom').oninput = e => { pg.zoom = +e.target.value; };
pgVp.addEventListener('pointerdown', () => pgVp.focus());
pgVp.addEventListener('wheel', e => { e.preventDefault(); pg.zoom = Math.min(4, Math.max(.6, pg.zoom * Math.exp(-e.deltaY * .0015))); $('pgZoom').value = pg.zoom; }, { passive: false });
pgVp.addEventListener('keydown', e => { const k = e.key.toLowerCase(); if (pg.cfg.move && MOVE_KEYS.has(k) && CS) { CS.pg.key(k, 1); e.preventDefault(); } });
pgVp.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (MOVE_KEYS.has(k) && CS) CS.pg.key(k, 0); });
pgVp.addEventListener('blur', pgKeysOff);
requestAnimationFrame(pgFrame);

// ---------- balance ----------
// every table read live from the runtime; derived tables come from the game's own need() and hwK()
const keyed = o => Object.entries(o || {}).map(([key, v]) => Object.assign({ key }, v));
const BAL = [
  ['CH', 'Heroes', D => D.CH.map((c, i) => Object.assign({ i }, c))],
  ['WP', 'Weapons', D => keyed(D.WP)],
  ['PS', 'Passives', D => keyed(D.PS)],
  ['INF', 'Endless upgrades', D => keyed(D.INF)],
  ['META', 'Shop', D => D.META.map(([key, name, desc, cost, max]) => ({ key, name, desc, cost, max }))],
  ['ETYPE', 'Enemies', D => keyed(D.ETYPE).map(e => Object.assign({ key: e.key, name: D.ENAME[e.key] || '' }, e)), ['ENAME']],
  ['BOSS', 'Classic bosses', D => D.BOSS.map((b, i) => Object.assign({ i }, b))],
  ['HB', 'Ritual bosses', D => keyed(D.HB)],
  ['HW', 'Halloween economy', D => Object.entries(D.HW).map(([key, value]) => ({ key, value }))],
  ['EVENTS', 'Events', D => keyed(D.EVENTS)],
  ['PHASE', 'Arena phases', D => D.PHASE.map((p, i) => Object.assign({ phase: i + 1 }, p))],
];
const DERIVED = [
  ['need', 'XP to level', 'need(l) for levels 1 to 40, with the running total', D => { let tot = 0; return Array.from({ length: 40 }, (_, i) => { const l = i + 1, xp = D.need(l); tot += xp; return { level: l, xp, total: tot }; }); }],
  ['hwK', 'Halloween tier scaling', 'hwK(t) for tiers 0 to 12; tier = 4 × (rank − 1) + rituals cleared this rank', D => Array.from({ length: 13 }, (_, t) => Object.assign({ tier: t }, D.hwK(t)))],
  ['hwCost', 'Ritual costs by Night Rank', 'cost × (1 + rankCost × (rank − 1)), embers', D => [1, 2, 3, 4, 5].map(rank => Object.assign({ rank }, ...D.HW.cost.map((c, i) => ({ ['ritual ' + (i + 1)]: Math.round(c * (1 + D.HW.rankCost * (rank - 1))) }))))],
];
let balSrc = null, balData = null;
async function balLoad() {
  if (balSrc && balData) return;
  balSrc = await (await fetch('/game/index.html', { cache: 'no-store' })).text();
  const D = {};
  for (const n of ['CH', 'WP', 'PS', 'INF', 'META', 'ETYPE', 'ENAME', 'BOSS', 'HB', 'HW', 'EVENTS', 'PHASE']) D[n] = plain(CS.get(n));
  D.need = CS.get('need'); D.hwK = CS.get('hwK');
  balData = D;
}
// where a name is defined in public/index.html, as file:line (plus any Object.assign(NAME, …) extensions)
function balLines(name) {
  const at = i => balSrc.slice(0, i).split('\n').length, out = [];
  const m = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`).exec(balSrc) || new RegExp(`[,;\\s]${name}\\s*=(?![=>])`).exec(balSrc) || new RegExp(`function\\s+${name}\\s*\\(`).exec(balSrc);
  if (m) out.push(at(m.index + m[0].indexOf(name)));
  for (const a of balSrc.matchAll(new RegExp(`Object\\.assign\\(${name}\\s*,`, 'g'))) out.push(at(a.index));
  return out;
}
function balTables() {
  const D = balData;
  return BAL.map(([name, title, rows, also = []]) => ({ name, title, rows: rows(D), raw: D[name], lines: balLines(name), also: also.map(a => [a, balLines(a)]) }))
    .concat(DERIVED.map(([name, title, desc, rows]) => ({ name, title, desc, rows: rows(D), lines: balLines(name), derived: 1 })));
}
async function balRender() {
  const el = $('balbody');
  if (!CS) { el.innerHTML = '<p class="empty">Waiting for the game runtime…</p>'; return; }
  try { await balLoad(); } catch (e) { el.innerHTML = `<p class="empty">Could not read the tables: ${esc(e.message)}</p>`; return; }
  const q = $('balq').value.trim().toLowerCase(), tables = balTables();
  const cell = v => {
    if (v == null) return '<td></td>';
    if (typeof v === 'number') return `<td class="num">${+v.toFixed(4)}</td>`;
    if (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) return `<td><i class="c" style="background:${v}"></i>${v}</td>`;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `<td title="${esc(s)}">${esc(s)}</td>`;
  };
  let shown = 0, rowsShown = 0;
  el.innerHTML = tables.map((t, ti) => {
    const rows = q ? t.rows.filter(r => (t.name + ' ' + t.title + ' ' + JSON.stringify(r)).toLowerCase().includes(q)) : t.rows;
    if (!rows.length) return '';
    shown++; rowsShown += rows.length;
    const cols = [...new Set(t.rows.flatMap(r => Object.keys(r)))];
    const loc = t.lines.length ? `<span class="loc" data-loc="public/index.html:${t.lines[0]}" title="Copy">public/index.html:${t.lines.join(', ')}</span>` : '';
    const also = (t.also || []).filter(a => a[1].length).map(([n, l]) => `<span class="loc" data-loc="public/index.html:${l[0]}" title="Copy">${n} :${l[0]}</span>`).join(' ');
    return `<div class="tbl"><header><h2>${esc(t.title)}<code>${t.derived ? t.name + '()' : t.name}</code></h2>${loc} ${also}<span class="n">${rows.length}${rows.length !== t.rows.length ? ' of ' + t.rows.length : ''} rows${t.desc ? ' · ' + esc(t.desc) : ''}</span>
      <button class="btn" data-copy="${ti}">Copy JSON</button></header>
      <div class="wrap"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => cell(r[c])).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  }).join('') || '<p class="empty">No rows match.</p>';
  $('balinfo').textContent = `${shown} tables · ${rowsShown} rows · PHASE count ${balData.PHASE.length}`;
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { const t = tables[+b.dataset.copy]; copy(JSON.stringify(t.derived ? t.rows : t.raw, null, 1), 'Copied ' + t.name + ' as JSON'); });
  el.querySelectorAll('[data-loc]').forEach(s => s.onclick = () => copy(s.dataset.loc, 'Copied ' + s.dataset.loc));
}
function balConfig() {
  const tables = balTables(), out = { source: 'public/index.html', generatedAt: new Date().toISOString(), tables: {}, derived: {} };
  for (const t of tables) (t.derived ? out.derived : out.tables)[t.name] = Object.assign({ title: t.title, defined: t.lines.map(l => 'public/index.html:' + l) }, t.desc ? { desc: t.desc } : {}, t.derived ? { rows: t.rows } : { data: t.raw });
  out.tables.ENAME = { title: 'Enemy names', defined: balLines('ENAME').map(l => 'public/index.html:' + l), data: balData.ENAME };
  out.tables.PHASE.count = balData.PHASE.length;
  return out;
}
$('balq').oninput = () => balRender();
$('balDl').onclick = async () => { await balLoad(); download('config.json', JSON.stringify(balConfig(), null, 1)); toast('Saved config.json'); };

// ---------- reports ----------
const rep = { list: [], key: '', sel: null, f: 'open', q: '', cache: {} };
async function repLoad() {
  try {
    const r = await fetch('/__dev/reports', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    rep.list = await r.json();
  } catch (e) { rep.list = null; }
  const open = (rep.list || []).filter(r => r.status !== 'resolved').length, bd = $('rbadge');
  bd.hidden = !open; bd.textContent = open;
  const key = JSON.stringify(rep.list);
  if (TAB === 'reports' && key !== rep.key) { rep.key = key; repCards(); if (rep.sel) repDetail(rep.sel); }
}
const repSum = s => !s ? '' : s.hero ? `${s.mode === 'halloween' ? 'Halloween' : 'Classic'} · ${s.hero} · ${(+s.t || 0).toFixed(0)}s · Lv ${s.level} · ${s.enemies} enemies${s.boss ? ' · ' + s.boss : ''}` : 'scene: ' + (s.scene || '?');
function repCards() {
  const el = $('repcards');
  if (rep.list == null) { el.innerHTML = '<p class="empty">The report store is not reachable.</p>'; return; }
  const q = rep.q.toLowerCase(), L = rep.list.filter(r => (rep.f === 'all' || (r.status || 'open') === rep.f) && (!q || (r.note + ' ' + r.id).toLowerCase().includes(q)));
  if (!L.length) {
    el.innerHTML = rep.list.length ? '<p class="empty">No reports match.</p>' : '<p class="empty">No reports yet. Open <a href="/play" target="_blank">Play (debug)</a> and press <code>F8</code>.</p>';
    return;
  }
  el.innerHTML = L.map(r => `<button class="card${r.id === rep.sel ? ' sel' : ''}${r.status === 'resolved' ? ' resolved' : ''}" data-id="${esc(r.id)}">
    <img loading="lazy" src="/__dev/reports/${encodeURIComponent(r.id)}/screenshot.png" alt="">
    <div><b>${esc(r.note || '(no note)')}</b><span>${new Date(r.at).toLocaleString()}</span><span>${esc(repSum(r.summary))}</span>
    <span>${r.errors ? `<span class="er">${r.errors} error${r.errors > 1 ? 's' : ''}</span> · ` : ''}<span class="pill ${r.status}">${r.status}</span></span></div></button>`).join('');
  el.querySelectorAll('.card').forEach(c => c.onclick = () => { rep.sel = c.dataset.id; repCards(); repDetail(rep.sel); });
}
async function repDetail(id) {
  const el = $('repdetail'), meta = (rep.list || []).find(r => r.id === id);
  if (!meta) { el.innerHTML = ''; return; }
  const ck = id + '|' + meta.status;
  if (!rep.cache[ck]) {
    el.innerHTML = '<p class="empty">Loading…</p>';
    try { rep.cache[ck] = await (await fetch(`/__dev/reports/${encodeURIComponent(id)}/report.json`, { cache: 'no-store' })).json(); }
    catch (e) { el.innerHTML = `<p class="empty">Could not load report.json: ${esc(e.message)}</p>`; return; }
  }
  if (rep.sel !== id) return;
  const r = rep.cache[ck], s = r.summary || {}, path = `dev/reports/${id}/`;
  const tr = (k, v) => v == null || v === '' ? '' : `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;
  el.innerHTML = `<h2>${esc(r.note ? r.note.split('\n')[0] : '(no note)')}</h2>
    <div class="meta">${esc(id)} · ${new Date(r.at).toLocaleString()} · game ${esc(r.version || '?')} · <span class="pill ${r.status}">${r.status}</span>${r.replayOf ? ' · follow-up of ' + esc(r.replayOf) : ''}</div>
    <div class="acts">
      <a class="btn play" href="/play?report=${encodeURIComponent(id)}" target="_blank" rel="noopener">Replay in game ↗</a>
      <button class="btn" id="rpPath">Copy path</button>
      <button class="btn" id="rpStatus">${r.status === 'resolved' ? 'Reopen' : 'Mark resolved'}</button>
      <a class="btn" href="/__dev/reports/${encodeURIComponent(id)}/README.md" target="_blank">README.md</a>
    </div>
    ${r.screenshot ? `<img class="shot" src="/__dev/reports/${encodeURIComponent(id)}/screenshot.png" alt="screenshot">` : ''}
    ${r.note ? `<blockquote>${esc(r.note)}</blockquote>` : ''}
    <h3>Summary</h3><table>${tr('Mode', s.mode)}${tr('Hero', s.hero)}${tr('Weapons', s.weapons)}${tr('Passives', s.passives)}${tr('Run time (G.t)', s.t != null ? s.t + 's' : null)}${tr('Level', s.level)}${tr('HP', s.hp)}${tr('Enemies', s.enemies)}${tr('Boss', s.boss)}${tr('Phase', s.phase)}${tr('Night Rank', s.rank)}${tr('Debug run', s.dbg ? 'yes' : null)}${tr('Scene', r.scene)}${tr('Viewport', r.viewport ? `${r.viewport.W}×${r.viewport.H} @${r.viewport.DPR}x` : null)}${tr('URL', r.url)}</table>
    <h3>Errors (${(r.errors || []).length})</h3>
    <div class="errs">${(r.errors || []).map(e => `<details><summary>[${esc(e.kind)}] ${esc(e.msg)} <span style="color:var(--faint)">· ${e.t}s</span></summary>${e.stack ? `<pre>${esc(e.stack)}</pre>` : ''}</details>`).join('') || '<p class="desc">None captured.</p>'}</div>
    <h3>State</h3>
    <details class="state" id="rpState"><summary>S (save) and G (run), serialized: ${fmt(JSON.stringify(r.state || {}).length / 1024, 0)} KB</summary><pre></pre></details>`;
  $('rpPath').onclick = () => copy(path, 'Copied ' + path);
  $('rpStatus').onclick = async () => {
    const status = r.status === 'resolved' ? 'open' : 'resolved';
    const res = await fetch(`/__dev/reports/${encodeURIComponent(id)}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) });
    if (!res.ok) return toast('Could not update: ' + (await res.text()));
    toast(status === 'resolved' ? 'Marked resolved' : 'Reopened');
    await repLoad();
  };
  $('rpState').ontoggle = e => { const pre = e.target.querySelector('pre'); if (e.target.open && !pre.textContent) pre.textContent = JSON.stringify(r.state, null, 1); };
}
$('repq').oninput = e => { rep.q = e.target.value.trim(); repCards(); };
document.querySelectorAll('#repf button').forEach(b => b.onclick = () => { rep.f = b.dataset.f; document.querySelectorAll('#repf button').forEach(x => x.classList.toggle('on', x === b)); repCards(); });
setInterval(() => { if (!document.hidden) repLoad(); }, 3000);
repLoad();

// open the tab named in the URL hash (#playground, #balance, #reports) once the runtime is up
(function boot() {
  const want = location.hash.slice(1);
  if (!TABS.includes(want) || want === 'assets') return;
  if (!CS) return setTimeout(boot, 100);
  setTab(want);
})();
