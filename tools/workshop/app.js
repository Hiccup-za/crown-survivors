'use strict';
// Crown Survivors Workshop, Assets tab (Playground, Balance and Reports live in workshop.js).
// Every sprite here is drawn by the live game code in public/index.html, never a copy:
// the game script runs in a hidden iframe (storage, network and the main loop stubbed out, so no save is read or written
// and no telemetry is sent), and a small bridge is injected just before the game's IIFE closes so we can call its drawers.
const $ = id => document.getElementById(id);

// ---------- runtime ----------
const PRELUDE = `(()=>{
 const mk=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{m.set(k,String(v))},removeItem:k=>{m.delete(k)},clear:()=>m.clear(),key:i=>[...m.keys()][i]??null,get length(){return m.size}}};
 Object.defineProperty(window,'localStorage',{value:mk(),configurable:true});
 Object.defineProperty(window,'sessionStorage',{value:mk(),configurable:true});
 window.fetch=()=>Promise.reject(new Error('network is off in the Workshop runtime'));
 window.XMLHttpRequest=function(){throw new Error('network is off in the Workshop runtime')};
 try{Object.defineProperty(navigator,'sendBeacon',{value:()=>true,configurable:true})}catch(e){}
 window.requestAnimationFrame=()=>0;
 window.__errs=[];addEventListener('error',e=>__errs.push(e.message));addEventListener('unhandledrejection',e=>e.preventDefault());
})();`;
// direct eval inside the game's IIFE sees its whole scope: get/set any top-level name, and draw onto a canvas we own
const BRIDGE = `
;window.__CS={get:n=>{try{return eval(n)}catch(e){return undefined}},set:(n,v)=>{window.__v=v;eval(n+'=window.__v')},
 draw(c,fn){const o=x,ou=U;x=c;U=1;try{fn()}finally{x=o;U=ou;FL=0}}};
// combat sandbox: a real run (startRun / update / drawWorld) with spawning off, the hero pinned and invulnerable, pinned target
// dummies that never die, and a boss whose attack choice (e.seq) and phase (HP fraction) are held so one attack repeats
;(()=>{let on=0,cfg=null,boss=null,pon=0,pc=null,slots=[],pb=null,pq=0;const _hs=hwSpawn,_hr=hwRitual;hwSpawn=dt=>{if(!on&&!pq)_hs(dt)};hwRitual=dt=>{if(!on&&!pq)_hr(dt)};
 const hpf=p=>p===3?.2:p===2?.5:.95;
 window.__CS.sim={
  start(c){cfg=c;on=1;pon=pq=0;S.char=c.hero|0;S.tut=true;S.muted=true;startRun(c.hw?1:0);const g=G;
   g.tut=null;g.god=true;g.won=!c.hw;g.banner=null;g.w={};g.evo={};g.phase=c.phase|0;g.en=[];g.eliteT=1e9;
   if(c.weapon){g.w[c.weapon]=c.lvl||1;if(c.evo)g.evo[c.weapon]=1}
   SC=st();
   for(const d of c.dummies||[]){const e=spawnEnemy(d.type);e.x=d.x;e.y=d.y;if(d.shootT!=null)e.shootT=d.shootT;if(d.pin){e.home=[d.x,d.y];e.spd=0;e.hp=e.mhp=1e9}}
   boss=null;
   if(c.bi!=null){spawnBoss(c.bi);boss=G.boss;g.banner=null}
   if(c.hb){const B=HB[c.hb];boss={type:'boss',hb:c.hb,boss:1,x:0,y:0,hp:B.hp,mhp:B.hp,r:B.r,spd:B.spd,dmg:B.dmg,xp:60,flash:0,kx:0,ky:0,ph:0,atk:1,seq:0,hitT:{}};g.en.push(boss);g.hw.live.push(boss)}
   if(boss){boss.x=c.bx;boss.y=c.by;boss.atk=c.atk!=null?c.atk:.5;boss.hp=boss.mhp*hpf(c.ph);boss.bph=c.ph||1;if(c.seq!=null)boss.seq=c.seq}
   scene='play';trans=null;shake=0},
  step(dt){if(!on||!G)return;const g=G;g.paused=false;g.choice=null;g.queue=0;if(boss&&cfg.seq!=null)boss.seq=cfg.seq;
   update(dt);
   g.choice=null;g.queue=0;g.xp=0;g.p.hp=g.p.mhp;g.p.x=g.p.y=0;g.banner=null;g.flash=0;shake=0;
   if(boss){boss.hp=boss.mhp*hpf(cfg.ph);boss.dead=0;if(!g.en.includes(boss))g.en.push(boss)}
   const k=Math.min(1,dt*4);for(const e of g.en)if(e.home){e.hp=e.mhp;e.x+=(e.home[0]-e.x)*k;e.y+=(e.home[1]-e.y)*k}},
  draw(c,w,h,z){const o=x,ow=W,oh=H,oz=Z,ou=U;x=c;W=w;H=h;Z=z;U=1;try{SC=SC||st();drawWorld()}finally{x=o;W=ow;H=oh;Z=oz;U=ou}},
  stop(){on=0;G=null;scene='title'}};
// playground: a configurable real run (workshop.js). Hero pinned at 0,0 unless free move; target slots respawn their kills so time to kill can be
// measured; immortal targets and a held boss have their HP pinned. The world steps at phone size (390x844) so edge spawns and on-screen checks match a phone
 const lay=(n,k)=>Array.from({length:n},(_,i)=>{const a=i*2.39996,r=9*Math.sqrt(i),R=Math.max(70,n*7);return k==='line'?[50+i*22,0]:k==='pack'?[110+r*Math.cos(a),r*Math.sin(a)]:[Math.cos(i*6.2832/n)*R,Math.sin(i*6.2832/n)*R]});
 const put=s=>{const g=G,T=pc.target,e=spawnEnemy(T.type,!!T.elite);e.x=s.x+(T.pin?0:g.p.x);e.y=s.y+(T.pin?0:g.p.y);if(T.pin){e.home=[s.x,s.y];e.spd=0}if(T.hp!=='real')e.hp=e.mhp=1e9;s.e=e;s.t0=g.t;s.wait=0};
 window.__CS.pg={
  start(c){on=0;pc=c;pon=1;pq=!c.spawn;const hw=c.mode==='halloween';S.char=c.hero|0;S.curse=hw?0:c.curse|0;S.tut=true;S.muted=true;startRun(hw?1:0);const g=G;
   g.tut=null;g.banner=null;g.god=!!c.god;g.t=+c.t||0;g.phase=c.phase|0;g.w={};g.evo={};g.ps={};
   for(const k in c.w||{}){const v=c.w[k];if(v==='evo'){g.w[k]=5;g.evo[k]=1}else if(v>0)g.w[k]=v}
   for(const k in c.ps||{})if(c.ps[k]>0)g.ps[k]=c.ps[k];if(g.ps.heart){g.p.mhp+=20*g.ps.heart;g.p.hp=g.p.mhp}
   const nb=BOSS.findIndex(b=>b.t>g.t);g.bossI=!c.spawn||nb<0?BOSS.length:nb;g.eliteT=c.spawn?45:1e9;SC=st();
   const T=c.target;slots=T&&T.n>0?lay(T.n,T.layout).map(([x,y])=>({x,y,e:null,t0:0,wait:0,kills:0,ttk:[]})):[];slots.forEach(put);
   pb=null;const B=c.boss;
   if(B&&B.kind==='classic'){spawnBoss(+B.id);pb=G.boss}
   if(B&&B.kind==='ritual'&&hw&&HB[B.id]){const H=HB[B.id];pb={type:'boss',hb:B.id,boss:1,x:0,y:0,hp:H.hp,mhp:H.hp,r:H.r,spd:H.spd,dmg:H.dmg,xp:60,flash:0,kx:0,ky:0,ph:0,atk:2,seq:0,hitT:{}};g.en.push(pb);g.hw.live.push(pb)}
   if(pb){pb.x=g.p.x+130;pb.y=g.p.y-70;pb.hp=pb.mhp*hpf(B.ph);pb.bph=B.ph||1;g.banner=null}
   scene='play';trans=null;shake=0},
  step(dt){if(!pon||!G||G.over)return;const g=G,p=g.p,T=pc.target||{},o=[W,H,Z];if(pq){g.spawnAcc=-1e9;g.eliteT=1e9}
   W=390;H=844;Z=Math.min(390/300,844/540);try{update(dt)}finally{W=o[0];H=o[1];Z=o[2]}
   g.choice=null;g.queue=0;g.xp=0;if(!pc.move)p.x=p.y=0;
   for(const s of slots){if(s.e&&s.e.dead){s.kills++;s.ttk.push(g.t-s.t0);if(s.ttk.length>50)s.ttk.shift();s.e=null;s.wait=.25}
    if(!s.e){s.wait-=dt;if(s.wait<=0)put(s);continue}
    if(T.hp!=='real')s.e.hp=s.e.mhp;
    if(s.e.home){const k=Math.min(1,dt*4);s.e.x+=(s.e.home[0]-s.e.x)*k;s.e.y+=(s.e.home[1]-s.e.y)*k}}
   if(pb&&T.hp!=='real'&&!pb.dead)pb.hp=pb.mhp*hpf(pc.boss.ph)},
  stats(){const g=G;if(!pon||!g)return null;const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
   return JSON.stringify({t:g.t,dmg:g.dmgDealt,kills:g.kills,hp:g.p.hp,mhp:g.p.mhp,lvl:g.lvl,over:g.over?g.over.win?'won':'dead':null,SC,
    n:{enemies:g.en.length,shots:g.pr.length,bullets:g.eb.length,fx:g.fx.length,pools:g.pools.length,hazards:(g.tele||[]).length,gems:g.gems.length},
    slots:slots.map(s=>({kills:s.kills,last:s.ttk.length?s.ttk[s.ttk.length-1]:null,avg:avg(s.ttk),hp:s.e?s.e.hp:0,mhp:s.e?s.e.mhp:0})),
    boss:pb?{n:(pb.hb?HB[pb.hb]:BOSS[pb.bi]).n,hp:pb.hp,mhp:pb.mhp,ph:pb.bph||1,dead:!!pb.dead}:null,hw:g.hw?{embers:g.hw.embers,rank:g.hw.rank,tier:hwTier()}:null})},
  key(k,d){keys[k]=d?1:0},
  draw(c,w,h,z){window.__CS.sim.draw(c,w,h,z)},
  stop(){pon=pq=0;G=null;scene='title';for(const k in keys)keys[k]=0}}})();
`;
const NAMES = ['heroS', 'enemyS', 'bossS', 'hwBossS', 'sprite', 'gemS', 'icon', 'soulEmber', 'pcrown', 'jack', 'crownG', 'hwProps',
  'CH', 'ETYPE', 'ENAME', 'BOSS', 'HB', 'WP', 'PS', 'MIC', 'META', 'SPRK', 'SPRF', 'SPRR', 'RAMP', 'PHASE', 'HPH', 'GMAT', 'pal'];
let CS = null, R = {}, frameEl = null, mtime = null, TAB = 'assets'; // TAB: the Workshop tab on show (workshop.js switches it)

async function loadRuntime() {
  const res = await fetch('/game/index.html', { cache: 'no-store' });
  if (!res.ok) throw new Error('GET /game/index.html → ' + res.status);
  const src = await res.text(), m = res.headers.get('x-mtime');
  const doc = new DOMParser().parseFromString(src, 'text/html');
  const scripts = [...doc.querySelectorAll('script')];
  const main = scripts.find(s => !s.src && s.textContent.includes('function heroS('));
  if (!main) throw new Error('Could not find the game script in public/index.html (looked for "function heroS(").');
  const code = main.textContent, end = code.lastIndexOf('})();');
  if (end < 0) throw new Error('The game script no longer ends with "})();", so the viewer bridge has nowhere to go.');
  scripts.forEach(s => s.src && s.remove());
  main.textContent = code.slice(0, end) + BRIDGE + code.slice(end);
  const pre = doc.createElement('script');
  pre.textContent = PRELUDE;
  doc.head.prepend(pre);
  const fr = document.createElement('iframe');
  fr.className = 'rt';
  fr.setAttribute('aria-hidden', 'true');
  document.body.append(fr);
  await new Promise(r => { fr.onload = r; fr.srcdoc = '<!DOCTYPE html>' + doc.documentElement.outerHTML; });
  const w = fr.contentWindow;
  if (!w.__CS) { fr.remove(); throw new Error('The game script failed to start:\n' + (w.__errs || []).join('\n')); }
  const r = {};
  for (const n of NAMES) r[n] = w.__CS.get(n);
  if (frameEl) frameEl.remove();
  frameEl = fr; CS = w.__CS; R = r; mtime = m;
  return (w.__errs || []).length;
}

// ---------- catalog ----------
const TAU = Math.PI * 2;
const DESC = {
  pip: 'Mean little rolling pumpkin. Ribs scroll to fake the roll, hollow carved eyes, fanged scowl.',
  shade: 'Purple-black bat with pumpkin-orange wing membranes and a stem curl. Up / mid / down / mid flap.',
  cskel: 'Bone skeleton with a carved pumpkin head, candy-corn scarf and a rusty sickle. 2-step walk.',
  jwisp: 'Jack-o\'-lantern with its lid knocked open; a flame climbs out and trails behind. Flickers to half alpha.',
  sknight: 'Too-tall skeleton knight with a plumed helm, dragging a rusted sword. Tell: Grave Pin, sword raised.',
  patch: 'Fat pumpkin tyrant with a crown of curled stems and a sewn-on patch. Tell: rears up, then slams.',
  twin: 'One pumpkin split down a jagged crack. Fan tell: halves part. Dash tell: halves clamp and lean in.',
  wheel: 'Angry pumpkin hub inside a spiked wooden cartwheel. Rev-up: spoke blur, eyes narrow to white-hot slits.',
  gourd: 'Massive dark pumpkin with a fused gold crown and a glowing fanged maw. Three phases, four attack poses.',
};
const HW_CYCLE = { pip: 'Roll', shade: 'Flap', cskel: 'Walk', jwisp: 'Float', sknight: 'Walk' };
const loopFlash = (t, c) => (t % c.dur) < 0.1; // the Hit clip: a 0.1s flash at the start of each loop, like a damage tick
const countdown = (T0, dur) => t => T0 * (1 - (t % dur) / dur) + 0.001; // tells count down to the attack

function buildCatalog() {
  const A = [], ET = R.ETYPE || {}, EN = R.ENAME || {}, SPRK = R.SPRK || {};
  const mmss = s => (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0');

  // heroes
  (R.CH || []).forEach((c, i) => A.push({
    id: 'hero-' + i, group: 'Heroes', name: c.n, sub: c.ev ? 'event hero' : c.p ? c.p + ' gold' : 'starter', desc: c.d,
    src: `heroS(x, y, ${i}, scale, walk, face, blink)`, box: () => 20, flip: 1,
    stats: [['HP', c.hp], ['Speed', c.spd + '×'], ['Perk', c.perk], ['Weapon', (R.WP[c.w] || {}).n || c.w], ['Price', c.night ? 'Night ' + c.night + ' unlock' : c.p ? c.p + ' gold' : 'free']],
    colors: [c.c, c.k],
    clips: [{ id: 'idle', name: 'Idle', dur: 3.2 }, { id: 'walk', name: 'Walk', dur: TAU / 12 * 4 }, { id: 'blink', name: 'Blink', dur: 1 }],
    draw: (X, t, o, c2) => R.heroS(0, 0, i, 1, c2.id === 'walk' ? t * 12 : 0, o.face, c2.id === 'blink' || (t % 3.2) < .1),
  }));

  // classic enemies (vector, continuous)
  Object.keys(ET).filter(k => !ET[k].ev && !SPRK[k]).forEach(k => {
    const E = ET[k];
    A.push({
      id: 'en-' + k, group: 'Classic enemies', name: EN[k] || k, sub: k, src: `enemyS({ type: '${k}', r, ph, flash, elite })`,
      hit: o => E.r * (o.elite ? 1.8 : 1), box: o => E.r * (o.elite ? 1.8 : 1) * 2.1, elite: 1, flash: 1,
      stats: enemyStats(E, k), colors: [E.c],
      clips: [{ id: 'move', name: 'Move', dur: k === 'frog' ? 3.2 : TAU }, { id: 'hit', name: 'Hit', dur: .5 }],
      draw: (X, t, o, c) => R.enemyS({ type: k, x: 0, y: 0, r: E.r * (o.elite ? 1.8 : 1), ph: t, flash: o.flash || c.id === 'hit' && loopFlash(t, c) ? 1 : 0, elite: o.elite ? 1 : 0 }),
    });
  });

  // classic bosses
  (R.BOSS || []).forEach((B, bi) => {
    const clips = [{ id: 'move', name: 'Move', dur: TAU }];
    if (bi === 3) clips.push({ id: 'p2', name: 'Phase 2 · roots', dur: TAU, p: { bph: 2 } }, { id: 'p3', name: 'Phase 3 · enraged', dur: TAU, p: { bph: 3 } }, { id: 'burrow', name: 'Burrowed', dur: 1, p: { burrow: 1 } });
    if (bi === 4) clips.push({ id: 'p3', name: 'Phase 3 · enraged', dur: TAU, p: { bph: 3 } }, { id: 'hide', name: 'Hidden', dur: 1, p: { hide: 1 } });
    clips.push({ id: 'hit', name: 'Hit', dur: .5 });
    A.push({
      id: 'boss-' + bi, group: 'Classic bosses', name: B.n.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), sub: 'boss ' + (bi + 1) + ' · ' + mmss(B.t),
      src: bi === 3 ? 'bossS(e) → thornS(e, r, flash, bob)' : bi === 4 ? 'bossS(e) → stormS(e, r, flash, bob)' : `bossS({ bi: ${bi}, r, ph, flash })`,
      hit: () => B.r, box: () => B.r * 2.15, flash: 1,
      stats: [['HP', B.hp], ['Radius', B.r], ['Speed', B.spd], ['Arrives', mmss(B.t)]], colors: [B.c], clips,
      draw: (X, t, o, c) => R.enemyS(Object.assign({ type: 'boss', bi, x: 0, y: 0, r: B.r, ph: t, flash: o.flash || c.id === 'hit' && loopFlash(t, c) ? 1 : 0 }, c.p)),
    });
  });

  // Halloween trash + elites (Sprite Kit v2: discrete 4-frame cycles through the sprite cache)
  Object.keys(SPRK).forEach(k => {
    const E = ET[k] || { r: 8 }, fps = (R.SPRF || {})[k] || 8, rr = o => E.r * (o.elite ? 1.8 : 1);
    const clips = [{ id: 'cycle', name: HW_CYCLE[k] || 'Cycle', frames: 4, fps, dur: 4 / fps }];
    if (k === 'sknight') clips.push({ id: 'tell', name: 'Grave Pin tell', frames: 4, fps, dur: 4 / fps });
    clips.push({ id: 'hit', name: 'Hit', frames: 4, fps, dur: 4 / fps });
    A.push({
      id: 'hw-' + k, group: 'Halloween enemies', name: EN[k] || k, sub: (E.el ? 'elite' : 'trash') + ' · kit v2', desc: DESC[k],
      src: `SPRK.${k}(r, frame, state)  via sprite() cache`, hit: rr, box: o => rr(o) * ((R.SPRR || {})[k] || 2), flip: 1, flash: 1, elite: 1, sil: 1, kit: 1,
      stats: enemyStats(E, k).concat([['Frame rate', fps + ' fps'], ['Cache box', ((R.SPRR || {})[k] || '?') + ' × r']]),
      clips,
      draw: (X, t, o, c) => {
        const r = rr(o), st = c.id === 'tell' ? 't' : 'n';
        X.imageSmoothingEnabled = false;
        if (o.sil) { if (o.face < 0) X.scale(-1, 1); CS.set('FL', 2); R.sprite(k, r, ((t * fps) | 0) & 3, st); return; }
        R.enemyS({ type: k, x: 0, y: 0, r, ph: t, fc: o.face, elite: o.elite ? 1 : 0, shootT: st === 't' ? 0 : 9, flash: o.flash || c.id === 'hit' && (t % c.dur) < 1 / fps ? 1 : 0 });
      },
    });
  });

  // Halloween ritual bosses (drawn live, poses from AI state)
  const HBC = {
    patch: [{ id: 'idle', name: 'Idle', dur: TAU / 2 }, { id: 'slam', name: 'Slam tell', dur: .7, pose: countdown(.7, .7), next: 'slam' }],
    twin: [{ id: 'idle', name: 'Idle', dur: TAU / 2 }, { id: 'fan', name: 'Fan tell', dur: .5, pose: countdown(.5, .5), next: 'fan' }, { id: 'dash', name: 'Dash tell', dur: .5, pose: countdown(.5, .5), next: 'dash' }],
    wheel: [{ id: 'idle', name: 'Idle', dur: TAU / 3, spin: 3 }, { id: 'chase', name: 'Chase', dur: TAU / 2, spin: 14 }, { id: 'rev', name: 'Rev-up tell', dur: .8, spin: 10, pose: () => .4, next: 'roll' }, { id: 'roll', name: 'Roll attack', dur: TAU / 2, spin: 14, p: { dash: 1 } }],
    gourd: [{ id: 'idle', name: 'Idle', dur: TAU / 2 }, { id: 'volley', name: 'Volley', dur: TAU / 2, p: { vol: 1 } }, { id: 'spiral', name: 'Spiral', dur: TAU / 2, p: { pose: 'spiral', poseT: .5 } },
      { id: 'rain', name: 'Rain', dur: TAU / 2, p: { pose: 'rain', poseT: .5 } }, { id: 'vines', name: 'Vines', dur: TAU / 2, p: { pose: 'vines', poseT: .5 } }, { id: 'charge', name: 'Charge tell', dur: .8, pose: countdown(.8, .8), next: 'charge' }],
  };
  const HBF = { patch: 'patchS', twin: 'twinS', wheel: 'wheelS', gourd: 'gourdS' };
  Object.keys(R.HB || {}).forEach((k, i) => {
    const H = R.HB[k], clips = (HBC[k] || [{ id: 'idle', name: 'Idle', dur: TAU }]).concat([{ id: 'hit', name: 'Hit', dur: .5 }]);
    A.push({
      id: 'hb-' + k, group: 'Halloween bosses', name: H.n.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), sub: k === 'gourd' ? 'final' : 'mini-boss · M' + (i + 1), desc: DESC[k],
      src: `hwBossS(e) → ${HBF[k] || '?'}(e, r)`, hit: () => H.r, box: () => H.r * 1.6, flip: 1, flash: 1, sil: 1, kit: 1,
      vars: k === 'gourd' ? [{ key: 'bph', label: 'Phase', opts: [[1, 'P1'], [2, 'P2'], [3, 'P3']] }] : [],
      stats: [['HP', H.hp], ['Radius', H.r], ['Speed', H.spd], ['Damage', H.dmg]], colors: [H.c], clips,
      draw: (X, t, o, c) => {
        const e = Object.assign({ type: 'boss', hb: k, x: 0, y: 0, r: H.r, ph: t, fc: o.face, bph: o.bph || 1, spin: t * (c.spin || 1.5),
          flash: o.flash || c.id === 'hit' && loopFlash(t, c) ? 1 : 0 }, c.p);
        if (c.pose) { e.tell = c.pose(t); e.next = c.next; }
        if (o.sil) { CS.set('FL', 2); R.hwBossS(e); } else R.enemyS(e);
      },
    });
  });

  // pickups
  [['xp', 'XP gem', {}], ['mid', 'XP gem · mid', {}], ['big', 'XP gem · big', {}], ['gold', 'Gold coin', {}], ['heart', 'Heart', {}], ['magnet', 'Magnet', {}], ['chest', 'Chest', {}],
    ['ember', 'Soul Ember', { v: 1 }], ['ember2', 'Soul Ember · big', { v: 2, k: 'ember' }]].forEach(([k, n, q]) => A.push({
    id: 'gem-' + k, group: 'Pickups', name: n, sub: 'gemS', src: `gemS({ k: '${q.k || k}'${q.v ? ', v: ' + q.v : ''} })`, box: () => 22,
    clips: [{ id: 'idle', name: 'Idle', dur: TAU / 1 }], draw: (X, t) => R.gemS(Object.assign({ k, x: 0, y: 0 }, q)),
  }));

  // icons
  const WP = R.WP || {}, PS = R.PS || {}, MIC = R.MIC || {}, META = R.META || [];
  const ico = (group, kind, k, n, d, extra = []) => A.push({
    id: 'ic-' + kind + '-' + k, group, name: n, sub: k, desc: d, src: `icon('${kind}', '${k}', x, y, r)`, box: () => 13,
    stats: extra, clips: [{ id: 'static', name: 'Static', dur: 1 }], draw: () => R.icon(kind, k, 0, 0, 10),
  });
  Object.keys(WP).forEach(k => ico('Weapon icons', 'w', k, WP[k].n, WP[k].d, [['Evolves with', (PS[WP[k].ev] || {}).n || WP[k].ev], ['Colour', WP[k].c]]));
  Object.keys(WP).forEach(k => ico('Evolution icons', 'e', k, WP[k].e, 'Evolved ' + WP[k].n));
  Object.keys(PS).forEach(k => ico('Passive icons', 'p', k, PS[k].n, PS[k].d, [['Colour', PS[k].c]]));
  Object.keys(MIC).forEach(k => { const m = META.find(r => r[0] === k) || []; ico('Shop icons', 'm', k, m[1] || k, m[2], m[3] ? [['Base cost', m[3]], ['Max rank', m[4]]] : []); });

  // emblems
  const em = (id, n, d, src, box, clips, draw) => A.push({ id: 'em-' + id, group: 'Emblems', name: n, desc: d, sub: src.split('(')[0], src, box: () => box, clips, draw });
  em('ember', 'Soul Ember flame', 'The living flame inside Soul Ember pickups and the Halloween HUD.', 'soulEmber(ph)', 20, [{ id: 'flicker', name: 'Flicker', dur: TAU / 3 }], () => R.soulEmber(0));
  em('pcrown', 'Pumpkin Crown', 'Event currency icon: a little pumpkin wearing the gold crown.', 'pcrown(x, y, s)', 15, [{ id: 'static', name: 'Static', dur: 1 }], () => R.pcrown(0, 0, 1));
  em('crown', 'Gold crown', 'Kit v2 crown: the boss motif.', 'crownG(x, y, w)', 12, [{ id: 'static', name: 'Static', dur: 1 }], () => R.crownG(0, 0, 16));
  em('jack', 'Magic Pumpkin shot', 'Jack-o\'-lantern glyph, layered and swayed the way the Magic Pumpkin projectile draws it.', 'jack(u, ox, oy, k, body, face, stem, side)', 12,
    [{ id: 'sway', name: 'Sway', dur: TAU / 18 * 2 }], (X, t) => { X.rotate(Math.sin(t * 18) * .3); R.jack(1.25, 0, 0, 1, R.pal.ink, R.pal.ink); R.jack(1, 0, 0, 1, '#e87820', '#ffd23f', '#2f6b44', '#c95f12'); });

  // attacks: live combat sandbox (the game's own update() + drawWorld()), see BRIDGE
  const SIM = 'update() + drawWorld() in a sandboxed run';
  const sim = (group, id, name, sub, desc, span, clips, thumb, stats = []) => A.push({ id: 'atk-' + id, group, name, sub, desc, src: SIM, sim: 1, span, clips, stats, box: () => 13, draw: thumb });
  const ring = [[45, 4, Math.PI / 4], [85, 4, 0], [125, 2, .4]].flatMap(([r, n, a0]) => Array.from({ length: n }, (_, i) => { const a = a0 + i * TAU / n; return { type: 'blob', x: Math.cos(a) * r, y: Math.sin(a) * r, pin: 1 }; }));
  Object.keys(WP).forEach(k => {
    const hero = Math.max(0, (R.CH || []).findIndex(c => c.w === k)), w = WP[k];
    sim('Weapon attacks', 'w-' + k, w.n, 'Lv 1–5 · ' + w.e, w.d + '. Fired by ' + R.CH[hero].n + ' at pinned target dummies that never die.', 320,
      [1, 2, 3, 4, 5].map(l => ({ id: 'l' + l, name: 'Lv ' + l, cfg: { hero, weapon: k, lvl: l, dummies: ring } })).concat([{ id: 'evo', name: 'Evolved · ' + w.e, cfg: { hero, weapon: k, lvl: 5, evo: 1, dummies: ring } }]),
      () => R.icon('w', k, 0, 0, 10), [['Hero', R.CH[hero].n], ['Evolution', w.e], ['Evolves with', (PS[w.ev] || {}).n || w.ev]]);
  });
  const foe = (type, r) => X => R.enemyS({ type, x: 0, y: 0, r, ph: .3, flash: 0 });
  sim('Enemy attacks', 'imp', (EN.imp || 'imp') + ' fireball', 'imp · ranged', 'Backs off inside 150u and lobs a fireball every 2.5–4s.', 360,
    [{ id: 'shot', name: 'Fireball', loop: 6, cfg: { phase: 2, dummies: [{ type: 'imp', x: 120, y: -30, shootT: .4 }] } }], foe('imp', 9));
  sim('Enemy attacks', 'harpy', (EN.harpy || 'harpy') + ' feathers', 'harpy · ranged', 'Hangs back inside 190u and throws a 3-feather fan.', 380,
    [{ id: 'fan', name: 'Feather fan', loop: 6, cfg: { phase: 4, dummies: [{ type: 'harpy', x: 150, y: -40, shootT: .4 }] } }], foe('harpy', 11));
  sim('Enemy attacks', 'sknight', (EN.sknight || 'sknight') + ' Grave Pin', 'sknight · hazard', 'Raises its sword, then bone spikes erupt under the player after a 1s telegraph.', 360,
    [{ id: 'pin', name: 'Grave Pin', loop: 5, cfg: { hw: 1, dummies: [{ type: 'sknight', x: 130, y: -20, shootT: .4 }] } }], X => { X.imageSmoothingEnabled = false; R.sprite('sknight', 11, 1, 't'); });
  const B = R.BOSS || [], bossT = bi => X => R.enemyS({ type: 'boss', bi, x: 0, y: 0, r: 6.5, ph: .3, flash: 0 }), at = (bi, o) => Object.assign({ bi, phase: bi, bx: 120, by: -60 }, o);
  const BA = [
    [['summon', 'Summon blobs', 6, {}]],
    [['dash', 'Dash + bats', 5, {}]],
    [['ring', 'Fire ring', 5, {}]],
    [['spiral', 'Seed spiral', 4, { ph: 1, seq: 0 }], ['snare', 'Root snare', 4, { ph: 1, seq: 1 }], ['lash', 'Vine lash · P2', 4, { ph: 2, seq: 0 }], ['pods', 'Bursting pods · P2', 4, { ph: 2, seq: 1 }], ['burrow', 'Burrow', 3.5, { ph: 1, bx: 300, by: 0, atk: 1 }]],
    [['grid', 'Thunder grid', 4, { ph: 1, seq: 0 }], ['gale', 'Gale feathers', 4, { ph: 1, seq: 1 }], ['blink', 'Blink strike · P2', 3.5, { ph: 2, seq: 0 }], ['eye', 'Eye of the Storm · P3', 6, { ph: 3, seq: 0 }]],
  ];
  B.forEach((b, bi) => sim('Boss attacks', 'b' + bi, b.n.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), (BA[bi] || []).length + ' attack' + ((BA[bi] || []).length > 1 ? 's' : ''),
    'Each clip forces one attack and repeats it; the phase is held by pinning HP.', 440, (BA[bi] || []).map(([id, name, loop, o]) => ({ id, name, loop, cfg: at(bi, o) })), bossT(bi), [['HP', b.hp], ['Arrives', (b.t / 60 | 0) + ':' + String(b.t % 60).padStart(2, '0')]]));
  const HA = {
    patch: [['slam', 'Slam', 4.5, {}]],
    twin: [['dash', 'Dash', 3.5, { seq: 0 }], ['fan', 'Seed fan', 3.5, { seq: 1 }]],
    wheel: [['roll', 'Roll', 5, {}]],
    gourd: [['volley', 'Volley', 4, { ph: 1, seq: 0 }], ['vines', 'Vines', 4, { ph: 1, seq: 1 }], ['rain', 'Ember rain · P2', 4, { ph: 2, seq: 0 }], ['summon', 'Summon · P2', 4, { ph: 2, seq: 2 }], ['spiral', 'Spiral · P3', 4, { ph: 3, seq: 0 }], ['charge', 'Charge · P3', 4, { ph: 3, seq: 1 }]],
  };
  Object.keys(R.HB || {}).forEach(k => sim('Ritual boss attacks', 'hb-' + k, R.HB[k].n.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), (HA[k] || []).length + ' attack' + ((HA[k] || []).length > 1 ? 's' : ''),
    'Tell first, then the attack: each clip forces one and repeats it.', 440, (HA[k] || []).map(([id, name, loop, o]) => ({ id, name, loop, cfg: Object.assign({ hw: 1, hb: k, bx: 130, by: -60 }, o) })),
    () => R.hwBossS({ hb: k, r: 8, ph: .3, flash: 0, fc: 1 }), [['HP', R.HB[k].hp], ['Damage', R.HB[k].dmg]]));

  return A.filter(a => a.draw);
}
function enemyStats(E, k) {
  return [['HP', E.hp], ['Speed', E.spd], ['Radius', E.r], ['Damage', E.dmg], ['XP', E.xp], ['Gore', (R.GMAT || {})[k] || 'red'], ['Elite', '×8 HP · ×1.8 size']];
}

// ---------- state ----------
const PHONE = Math.min(390 / 300, 844 / 540); // css px per world unit on a 390×844 phone (the game's Z)
const st = { assets: [], a: null, clip: 0, t: 0, playing: true, speed: 1, zoom: 4, panX: 0, panY: 0,
  o: { face: 1, flash: 0, elite: 0, sil: 0 }, ov: { hitbox: 0, grid: 0, origin: 1, onion: 0 }, bg: 'checker', lineup: 0, q: '', mouse: null };
const clip = () => st.a ? st.a.clips[Math.min(st.clip, st.a.clips.length - 1)] : null;
const opts = () => Object.assign({}, st.o, ...(st.a && st.a.vars || []).map(v => ({ [v.key]: st.o[v.key] ?? v.opts[0][0] })));

// draw one asset at the current context origin (world units)
function paint(X, a, t, c, o) {
  if (!CS) return;
  CS.set('clock', t);
  X.save();
  try { CS.draw(X, () => a.draw(X, t, o, c)); } finally { X.restore(); }
}

// ---------- backdrops ----------
const BGS = [['checker', 'Checkerboard'], ['dark', 'Dark'], ['paper', 'Paper'], ['ink', 'Ink']];
function bgOptions() {
  const sel = $('bg'), cur = st.bg;
  const list = BGS.concat((R.PHASE || []).map((p, i) => ['phase' + i, 'Arena · phase ' + (i + 1)]), R.HPH ? [['hw', 'Arena · Halloween dusk']] : []);
  sel.innerHTML = list.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  sel.value = list.some(l => l[0] === cur) ? cur : 'checker';
  st.bg = sel.value;
}
function drawBg(X, w, h, toScreen) {
  const b = st.bg;
  if (b === 'checker') {
    X.fillStyle = '#2a2433'; X.fillRect(0, 0, w, h); X.fillStyle = '#332c3e';
    const s = 12 * devicePixelRatio;
    for (let y = 0; y < h; y += s) for (let x = ((y / s) & 1) * s; x < w; x += s * 2) X.fillRect(x, y, s, s);
    return;
  }
  if (b === 'dark' || b === 'paper' || b === 'ink') { X.fillStyle = { dark: '#0d0a12', paper: '#fff3c4', ink: '#3b2a1a' }[b]; X.fillRect(0, 0, w, h); return; }
  const ph = b === 'hw' ? R.HPH : R.PHASE[+b.slice(5)];
  X.fillStyle = ph.g; X.fillRect(0, 0, w, h);
  // world-space arena tiles (48u), the same checker and hash the game uses; graves and gourds come from hwProps itself
  const [x0, y0] = toScreen.inv(0, 0), [x1, y1] = toScreen.inv(w, h), T = 48;
  X.save(); X.setTransform(...toScreen.m);
  for (let tx = Math.floor(x0 / T) - 1; tx <= x1 / T; tx++) for (let ty = Math.floor(y0 / T) - 1; ty <= y1 / T; ty++) {
    const hh = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    if ((tx + ty) & 1) { X.fillStyle = ph.g2; X.fillRect(tx * T, ty * T, T, T); }
    if (ph.tuft && hh % 5 === 0) { X.fillStyle = ph.tuft; X.fillRect(tx * T + hh % 30, ty * T + (hh >> 5) % 30, 2, 6); X.fillRect(tx * T + hh % 30 + 3, ty * T + (hh >> 5) % 30 + 2, 2, 4); }
    if (b === 'hw' && R.hwProps) CS.draw(X, () => R.hwProps(tx, ty, T, hh));
  }
  X.restore();
}

// ---------- viewport ----------
const view = $('view'), vx = view.getContext('2d'), vp = $('vp');
let onionC = null, last = performance.now(), renderErr = null;

function transform(w, h) {
  const d = devicePixelRatio, s = st.zoom * d, ox = w / 2 + st.panX * d, oy = h / 2 + st.panY * d;
  return { m: [s, 0, 0, s, ox, oy], s, inv: (px, py) => [(px - ox) / s, (py - oy) / s] };
}
function lineupItems() {
  const items = st.assets.filter(a => a.group === st.a.group && visible(a)), o = opts();
  let x = 0;
  return items.map(a => { const b = a.box(o), it = { a, x: x + b, b }; x += b * 2 + 10; return it; }).map(it => (it.x -= (x - 10) / 2, it));
}
function render(now) {
  const dt = Math.min(.1, (now - last) / 1000); last = now;
  if (TAB !== 'assets') { requestAnimationFrame(render); return; }
  const c = clip();
  if (st.playing && c) st.t += dt * st.speed;
  const d = devicePixelRatio, w = Math.round(vp.clientWidth * d), h = Math.round(vp.clientHeight * d);
  if (view.width !== w || view.height !== h) { view.width = w; view.height = h; }
  vx.setTransform(1, 0, 0, 1, 0, 0);
  vx.imageSmoothingEnabled = true;
  const T = transform(w, h);
  try {
    if (CS && st.a && c && st.a.sim) simRender(dt, c, w, h, d);
    else {
    if (CS) drawBg(vx, w, h, T);
    if (st.ov.grid) drawGrid(vx, w, h, T);
    if (CS && st.a && c) {
      const o = opts();
      vx.setTransform(...T.m);
      if (st.lineup && !st.a.sim) {
        for (const it of lineupItems()) {
          const cc = it.a.clips.find(k => k.id === c.id) || it.a.clips[0];
          vx.save(); vx.translate(it.x, 0); paint(vx, it.a, st.t, cc, o);
          if (st.ov.hitbox && it.a.hit) drawHit(vx, it.a.hit(o), T.s);
          vx.restore();
        }
        vx.setTransform(1, 0, 0, 1, 0, 0);
        vx.font = `${11 * d}px ui-monospace,Menlo,monospace`; vx.textAlign = 'center'; vx.fillStyle = '#ece4d4';
        for (const it of lineupItems()) {
          const sx = T.m[4] + it.x * T.s, sy = T.m[5] + it.b * T.s + 14 * d;
          vx.fillStyle = it.a === st.a ? '#ffd23f' : '#ece4d4'; vx.fillText(it.a.name, sx, sy);
        }
      } else {
        if (st.ov.onion && c.frames) drawOnion(w, h, T, o, c);
        paint(vx, st.a, st.t, c, o);
        if (st.ov.hitbox && st.a.hit) drawHit(vx, st.a.hit(o), T.s);
      }
      if (st.ov.origin) drawOrigin(vx, T);
    }
    }
    renderErr = null; $('err').style.display = 'none';
  } catch (e) {
    if (String(e) !== renderErr) { renderErr = String(e); showErr('Draw error in ' + (st.a ? st.a.name : '?') + ':\n' + (e.stack || e)); }
  }
  hud(c);
  syncTransport(c);
  requestAnimationFrame(render);
}
// ---------- combat sandbox ----------
// attack clips run the real game loop at a fixed 60 Hz; a clip restarts its run when selected and again every c.loop seconds
const SIM_DT = 1 / 60;
let simKey = null, simAcc = 0, simT = 0;
function simStart(c) { CS.sim.start(c.cfg); simAcc = 0; simT = 0; }
function simAdvance(t) {
  simAcc += t;
  let n = 0;
  while (simAcc >= SIM_DT && n++ < 12) { CS.sim.step(SIM_DT); simAcc -= SIM_DT; simT += SIM_DT; }
  if (n >= 12) simAcc = 0;
}
function simRender(dt, c, w, h, d, X = vx, zoom = st.zoom, pan = [st.panX, st.panY]) {
  const key = st.a.id + '|' + c.id;
  if (key !== simKey) { simStart(c); simKey = key; }
  if (X === vx && st.playing) simAdvance(dt * st.speed);
  if (c.loop && simT >= c.loop) simStart(c);
  X.setTransform(d, 0, 0, d, pan[0] * d, pan[1] * d);
  CS.sim.draw(X, w / d, h / d, zoom);
}
function drawGrid(X, w, h, T) {
  const [x0, y0] = T.inv(0, 0), [x1, y1] = T.inv(w, h);
  const line = (step, col) => {
    if (step * T.s < 5) return;
    X.beginPath();
    for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) { const p = T.m[4] + gx * T.s; X.moveTo(Math.round(p) + .5, 0); X.lineTo(Math.round(p) + .5, h); }
    for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) { const p = T.m[5] + gy * T.s; X.moveTo(0, Math.round(p) + .5); X.lineTo(w, Math.round(p) + .5); }
    X.strokeStyle = col; X.lineWidth = 1; X.stroke();
  };
  X.setTransform(1, 0, 0, 1, 0, 0);
  line(1, 'rgba(255,255,255,.04)'); line(8, 'rgba(255,255,255,.09)'); line(48, 'rgba(255,210,63,.22)');
}
function drawOrigin(X, T) {
  const d = devicePixelRatio, ox = T.m[4], oy = T.m[5];
  X.setTransform(1, 0, 0, 1, 0, 0); X.strokeStyle = 'rgba(124,194,90,.8)'; X.lineWidth = d;
  X.beginPath(); X.moveTo(ox - 8 * d, oy); X.lineTo(ox + 8 * d, oy); X.moveTo(ox, oy - 8 * d); X.lineTo(ox, oy + 8 * d); X.stroke();
}
function drawHit(X, r, s) {
  X.save(); X.lineWidth = 1.5 / s * devicePixelRatio; X.setLineDash([4 / s * devicePixelRatio, 3 / s * devicePixelRatio]);
  X.strokeStyle = '#ff8a3d'; X.fillStyle = 'rgba(255,138,61,.08)'; X.beginPath(); X.arc(0, 0, r, 0, TAU); X.fill(); X.stroke(); X.restore();
}
function drawOnion(w, h, T, o, c) {
  if (!onionC) onionC = document.createElement('canvas');
  if (onionC.width !== w || onionC.height !== h) { onionC.width = w; onionC.height = h; }
  const f = frameOf(c), O = onionC.getContext('2d');
  for (const [df, col] of [[-1, '#ff4a4a'], [1, '#5adf6a']]) {
    O.setTransform(1, 0, 0, 1, 0, 0); O.globalCompositeOperation = 'source-over'; O.clearRect(0, 0, w, h);
    O.setTransform(...T.m); paint(O, st.a, ((f + df + c.frames) % c.frames + .5) / c.fps, c, o);
    O.setTransform(1, 0, 0, 1, 0, 0); O.globalCompositeOperation = 'source-atop'; O.fillStyle = col; O.fillRect(0, 0, w, h);
    vx.save(); vx.setTransform(1, 0, 0, 1, 0, 0); vx.globalAlpha = .38; vx.drawImage(onionC, 0, 0); vx.restore();
  }
}
const frameOf = c => c.frames ? Math.floor(st.t * c.fps + 1e-6) % c.frames : 0;
function hud(c) {
  if (!st.a || !c) return;
  if (st.a.sim) { $('hud').textContent = `${st.a.name} · ${c.name} · live game loop\n${st.zoom.toFixed(2)} css px / world unit`; return; }
  const m = st.mouse ? `   cursor ${st.mouse[0].toFixed(1)}, ${st.mouse[1].toFixed(1)} u` : '';
  $('hud').textContent = `${st.lineup ? st.a.group + ' lineup' : st.a.name} · ${c.name}${c.frames ? ` · frame ${frameOf(c) + 1}/${c.frames}` : ''}\n` +
    `${st.zoom.toFixed(2)} css px / world unit${Math.abs(st.zoom - PHONE) < .01 ? ' (phone 1:1)' : ''}${m}`;
}

// ---------- browser ----------
const visible = a => !st.q || (a.name + ' ' + a.id + ' ' + a.group + ' ' + (a.sub || '')).toLowerCase().includes(st.q);
function thumb(cv, a, t = .35, px = 80, c = a.clips[0], o = { face: 1, flash: 0, elite: 0, sil: 0 }) {
  cv.width = cv.height = px;
  const X = cv.getContext('2d'), s = px / 2 / a.box(o) * .92;
  X.setTransform(s, 0, 0, s, px / 2, px / 2);
  try { paint(X, a, t, c, o); } catch (e) { /* missing drawer: leave the slot empty */ }
}
function buildTree() {
  const tree = $('tree'), open = new Set([...tree.querySelectorAll('details[open]')].map(d => d.dataset.g));
  const first = !tree.children.length;
  tree.innerHTML = '';
  const ORDER = ['Heroes', 'Weapon attacks', 'Classic enemies', 'Enemy attacks', 'Classic bosses', 'Boss attacks', 'Halloween enemies', 'Halloween bosses', 'Ritual boss attacks'];
  const rank = g => { const i = ORDER.indexOf(g); return i < 0 ? ORDER.length : i; };
  const groups = [...new Set(st.assets.map(a => a.group))].sort((a, b) => rank(a) - rank(b));
  for (const g of groups) {
    const items = st.assets.filter(a => a.group === g && visible(a));
    if (!items.length) continue;
    const det = document.createElement('details');
    det.className = 'group'; det.dataset.g = g; det.open = first ? !/icons/i.test(g) : open.has(g) || !!st.q;
    det.innerHTML = `<summary>${g}<span class="n">${items.length}</span></summary>`;
    for (const a of items) {
      const b = document.createElement('button');
      b.className = 'item' + (a === st.a ? ' sel' : ''); b.dataset.id = a.id;
      const cv = document.createElement('canvas'); thumb(cv, a);
      b.append(cv); b.insertAdjacentHTML('beforeend', `<div><b>${esc(a.name)}</b><span>${esc(a.sub || '')}</span></div>`);
      b.onclick = () => select(a.id);
      det.append(b);
    }
    tree.append(det);
  }
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function select(id, keepView) {
  const a = st.assets.find(k => k.id === id) || st.assets[0];
  if (!a) return;
  const changed = a !== st.a;
  st.a = a;
  if (changed) {
    if (CS && CS.sim) CS.sim.stop();
    simKey = null;
    st.clip = 0; st.t = 0;
    for (const v of a.vars || []) st.o[v.key] = v.opts[0][0];
    if (!keepView) fit();
  }
  document.querySelectorAll('.item').forEach(b => b.classList.toggle('sel', b.dataset.id === a.id));
  const sel = document.querySelector('.item.sel');
  if (sel) { sel.closest('details').open = true; sel.scrollIntoView({ block: 'nearest' }); }
  buildClips(); buildInspector(); buildStrip();
}
function fit() {
  if (!st.a) return;
  const w = vp.clientWidth, h = vp.clientHeight, o = opts();
  if (st.a.sim) st.zoom = Math.min(w, h) / st.a.span;
  else if (st.lineup) {
    const it = lineupItems(), span = it.length ? it[it.length - 1].x + it[it.length - 1].b - (it[0].x - it[0].b) : 40, tall = Math.max(...it.map(i => i.b), 10);
    st.zoom = Math.min(w / (span * 1.1), h / (tall * 2 * 1.5), 12);
  } else st.zoom = Math.min(w, h) / (st.a.box(o) * 2 * 1.3);
  st.panX = st.panY = 0;
}

// ---------- timeline ----------
// sprite <-> attack sandbox links: bosses and shooters link to their attacks, heroes to their starting weapon
function attackOf(a) {
  const m = /^(boss-(\d+)|hb-(\w+)|en-(imp|harpy)|hw-(sknight)|hero-(\d+))$/.exec(a.id);
  if (!m) return null;
  const id = m[2] != null ? 'atk-b' + m[2] : m[3] ? 'atk-hb-' + m[3] : m[4] || m[5] ? 'atk-' + (m[4] || m[5]) : 'atk-w-' + ((R.CH || [])[+m[6]] || {}).w;
  return st.assets.find(k => k.id === id) || null;
}
const spriteOf = a => a.sim ? st.assets.find(k => !k.sim && attackOf(k) === a && !/^hero-/.test(k.id)) || st.assets.find(k => !k.sim && attackOf(k) === a) : null;
function goAttack(atk, i) { select(atk.id); setClip(i); st.playing = true; }
function buildClips() {
  const el = $('clips');
  el.innerHTML = '';
  st.a.clips.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'clip' + (i === st.clip ? ' on' : '');
    b.innerHTML = `<i>${i + 1}</i>${esc(c.name)}${c.frames ? ` <i>· ${c.frames}f @ ${c.fps}fps</i>` : ''}`;
    b.onclick = () => setClip(i);
    el.append(b);
  });
  const atk = attackOf(st.a), back = spriteOf(st.a);
  if (atk) {
    el.insertAdjacentHTML('beforeend', '<span class="clipsep">Attacks</span>');
    atk.clips.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'clip atk';
      b.title = 'Play this attack live in the combat sandbox';
      b.textContent = '⚡ ' + c.name;
      b.onclick = () => goAttack(atk, i);
      el.append(b);
    });
  }
  if (back) {
    const b = document.createElement('button');
    b.className = 'clip back';
    b.textContent = '◀ ' + back.name + ' sprite';
    b.onclick = () => select(back.id);
    el.append(b);
  }
}
function setClip(i) {
  if (!st.a || i >= st.a.clips.length) return;
  st.clip = i; st.t = 0;
  buildClips(); buildStrip();
}
function buildStrip() {
  const el = $('strip'), c = clip(), o = opts();
  el.innerHTML = '';
  if (!c || !CS) return;
  if (st.a.sim) {
    el.innerHTML = `<p class="simnote">Live: the game's own <code>update()</code> and <code>drawWorld()</code> run at 60 Hz with spawning off and the hero invulnerable.${c.loop ? ` The run restarts every ${c.loop}s so the attack repeats.` : ''} ▶ steps one tick; ⏮ restarts.</p>`;
    return;
  }
  const n = c.frames || 8;
  for (let k = 0; k < n; k++) {
    const t = c.frames ? (k + .5) / c.fps : k * c.dur / n;
    const f = document.createElement('div'), cv = document.createElement('canvas');
    f.className = 'frame'; f.dataset.k = k;
    thumb(cv, st.a, t, 128, c, o);
    f.append(cv); f.insertAdjacentHTML('beforeend', `<span>${c.frames ? 'F' + (k + 1) : t.toFixed(2) + 's'}</span>`);
    f.onclick = () => { st.playing = false; st.t = t; };
    el.append(f);
  }
}
function step(dir) {
  const c = clip();
  if (!c) return;
  st.playing = false;
  if (st.a.sim) { if (dir > 0) simAdvance(SIM_DT); else toast('A live run can\'t rewind: ⏮ restarts it'); return; }
  if (c.frames) { const f = (frameOf(c) + dir + c.frames) % c.frames; st.t = (f + .5) / c.fps; } else st.t = Math.max(0, st.t + dir / 30);
}
function syncTransport(c) {
  $('play').textContent = st.playing ? '❚❚' : '▶';
  if (!c) return;
  $('scrub').disabled = !!st.a.sim;
  if (st.a.sim) {
    $('scrub').value = c.loop ? Math.round(simT / c.loop * 1000) : 0;
    $('tc').textContent = `live · ${simT.toFixed(2)}s${c.loop ? ` / ${c.loop.toFixed(1)}s` : ''}`;
    return;
  }
  const lt = st.t % c.dur;
  if (document.activeElement !== $('scrub')) $('scrub').value = Math.round(lt / c.dur * 1000);
  $('tc').textContent = c.frames ? `F${frameOf(c) + 1}/${c.frames} · ${lt.toFixed(2)}s / ${c.dur.toFixed(2)}s` : `${lt.toFixed(2)}s / ${c.dur.toFixed(2)}s`;
  const on = c.frames ? frameOf(c) : Math.floor(lt / c.dur * 8);
  document.querySelectorAll('.frame').forEach(f => f.classList.toggle('on', +f.dataset.k === on));
}

// ---------- inspector ----------
function buildInspector() {
  const a = st.a, o = opts(), el = $('insp');
  if (a.sim) return buildSimInspector(a, el);
  const seg = (key, choices, enabled = true) => `<span class="seg" data-key="${key}">${choices.map(([v, n]) => `<button data-v="${v}" class="${o[key] == v ? 'on' : ''}" ${enabled ? '' : 'disabled'}>${n}</button>`).join('')}</span>`;
  const ctl = (label, html, enabled = true, why = '') => `<div class="ctl${enabled ? '' : ' off'}" title="${esc(why)}"><label>${label}</label>${html}</div>`;
  const ramps = a.kit && R.RAMP ? `<div class="sec"><h3>Kit v2 ramps</h3>${Object.entries(R.RAMP).map(([n, cs]) => `<div class="ramp"><b>${n}</b><div class="sw">${cs.map(swatch).join('')}</div></div>`).join('')}</div>` : '';
  el.innerHTML = `
  <div class="sec"><p class="title">${esc(a.name)}</p><span class="tag">${esc(a.group)}</span>${a.desc ? `<p class="desc">${esc(a.desc)}</p>` : ''}<div class="src">${esc(a.src)}</div></div>
  ${attackOf(a) ? `<div class="sec"><h3>Attacks</h3><div class="exp">${attackOf(a).clips.map((c, i) => `<button class="btn atkbtn" data-i="${i}">⚡ ${esc(c.name)}</button>`).join('')}</div></div>` : ''}
  <div class="sec"><h3>Display</h3>
    ${ctl('Facing', seg('face', [[-1, '◀ Left'], [1, 'Right ▶']], !!a.flip), !!a.flip, a.flip ? '' : 'The game never flips this asset')}
    ${ctl('Hit flash', seg('flash', [[0, 'Off'], [1, 'On']], !!a.flash), !!a.flash)}
    ${ctl('Elite variant', seg('elite', [[0, 'Off'], [1, '×1.8']], !!a.elite), !!a.elite, a.elite ? 'Elites spawn at 1.8× size with 8× HP and a gold ring' : 'Not an enemy')}
    ${ctl('Silhouette', seg('sil', [[0, 'Off'], [1, 'Ink']], !!a.sil), !!a.sil, a.sil ? 'Solid ink read test from the sprite kit' : 'Only Sprite Kit v2 drawers support silhouette')}
    ${(a.vars || []).map(v => ctl(v.label, seg(v.key, v.opts))).join('')}
  </div>
  ${a.stats && a.stats.length ? `<div class="sec"><h3>Game data</h3><table>${a.stats.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}${a.hit ? `<tr><td>Hitbox</td><td>r = ${+a.hit(o).toFixed(1)}</td></tr>` : ''}</table></div>` : ''}
  ${a.colors ? `<div class="sec"><h3>Colours</h3><div class="sw">${a.colors.map(swatch).join('')}</div></div>` : ''}
  ${ramps}
  <div class="sec"><h3>Export PNG</h3>
    <div class="ctl"><label>Scale</label>${`<span class="seg" id="xs">${[2, 4, 8].map(s => `<button data-s="${s}" class="${s === exportScale ? 'on' : ''}">${s}×</button>`).join('')}</span>`}</div>
    <div class="exp"><button class="btn" id="xFrame">Current frame</button><button class="btn" id="xSheet">Sprite sheet</button></div>
  </div>
  <div class="sec"><h3>Shortcuts</h3><div class="keys">
    <kbd>Space</kbd><span>Play / pause</span><kbd>← →</kbd><span>Step frame</span><kbd>↑ ↓</kbd><span>Previous / next asset</span>
    <kbd>1–9</kbd><span>Pick a clip</span><kbd>F</kbd><span>Flip facing</span><kbd>H G O</kbd><span>Hitbox, grid, onion</span>
    <kbd>L</kbd><span>Lineup</span><kbd>0</kbd><span>Fit view</span><kbd>/</kbd><span>Search</span><kbd>R</kbd><span>Reload source</span></div></div>`;
  el.querySelectorAll('.seg[data-key] button').forEach(b => b.onclick = () => {
    const k = b.parentElement.dataset.key, v = Number(b.dataset.v);
    st.o[k] = v;
    if (k === 'elite') fit();
    buildInspector(); buildStrip();
  });
  el.querySelectorAll('.sw button').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.c); toast('Copied ' + b.dataset.c); });
  el.querySelectorAll('#xs button').forEach(b => b.onclick = () => { exportScale = +b.dataset.s; buildInspector(); });
  el.querySelectorAll('.atkbtn').forEach(b => b.onclick = () => goAttack(attackOf(a), +b.dataset.i));
  $('xFrame').onclick = () => exportPng(false);
  $('xSheet').onclick = () => exportPng(true);
}
function buildSimInspector(a, el) {
  el.innerHTML = `
  <div class="sec"><p class="title">${esc(a.name)}</p><span class="tag">${esc(a.group)}</span>${a.desc ? `<p class="desc">${esc(a.desc)}</p>` : ''}<div class="src">${esc(a.src)}</div></div>
  ${a.stats.length ? `<div class="sec"><h3>Game data</h3><table>${a.stats.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>` : ''}
  <div class="sec"><h3>Attacks</h3><table>${a.clips.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.name)}</td></tr>`).join('')}</table></div>
  <div class="sec"><h3>Export PNG</h3>
    <div class="ctl"><label>Scale</label><span class="seg" id="xs">${[1, 2, 3].map(s => `<button data-s="${s}" class="${s === simScale ? 'on' : ''}">${s}×</button>`).join('')}</span></div>
    <div class="exp"><button class="btn" id="xFrame">Current frame</button></div>
  </div>
  <div class="sec"><h3>Shortcuts</h3><div class="keys"><kbd>Space</kbd><span>Play / pause</span><kbd>→</kbd><span>Step one tick</span><kbd>1–9</kbd><span>Pick an attack</span><kbd>↑ ↓</kbd><span>Previous / next asset</span><kbd>0</kbd><span>Fit view</span></div></div>`;
  el.querySelectorAll('#xs button').forEach(b => b.onclick = () => { simScale = +b.dataset.s; buildSimInspector(a, el); });
  $('xFrame').onclick = () => {
    const c = clip(), s = simScale, size = Math.round(a.span * s), cv = document.createElement('canvas');
    cv.width = cv.height = size;
    simRender(0, c, size, size, 1, cv.getContext('2d'), s, [0, 0]);
    const name = `${a.id}-${c.id}-t${simT.toFixed(2)}@${s}x.png`;
    cv.toBlob(b => { const u = URL.createObjectURL(b), l = document.createElement('a'); l.href = u; l.download = name; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); toast('Saved ' + name); });
  };
}
let simScale = 2;
const swatch = c => `<button data-c="${c}" title="Copy ${c}"><i style="background:${c}"></i><span>${c}</span></button>`;

// ---------- export ----------
let exportScale = 4;
function exportPng(sheet) {
  const a = st.a, c = clip(), o = opts(), s = exportScale, cell = Math.ceil(a.box(o) * 2 * s);
  const ts = sheet ? Array.from({ length: c.frames || 8 }, (_, k) => c.frames ? (k + .5) / c.fps : k * c.dur / 8) : [c.frames ? (frameOf(c) + .5) / c.fps : st.t % c.dur];
  const cv = document.createElement('canvas');
  cv.width = cell * ts.length; cv.height = cell;
  const X = cv.getContext('2d');
  ts.forEach((t, k) => { X.setTransform(s, 0, 0, s, cell * k + cell / 2, cell / 2); paint(X, a, t, c, o); });
  const name = `${a.id}-${c.id}${sheet ? `-sheet${ts.length}` : c.frames ? '-f' + (frameOf(c) + 1) : ''}${o.face < 0 ? '-left' : ''}${o.sil ? '-sil' : ''}@${s}x.png`;
  cv.toBlob(b => { const u = URL.createObjectURL(b), l = document.createElement('a'); l.href = u; l.download = name; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); toast('Saved ' + name); });
}

// ---------- ui wiring ----------
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 1600); }
function showErr(m) { const e = $('err'); e.textContent = m; e.style.display = 'block'; }
function setStatus(kind, msg) { $('dot').className = 'dot ' + kind; $('status').textContent = msg; }

$('q').oninput = e => { st.q = e.target.value.trim().toLowerCase(); buildTree(); };
$('bg').onchange = e => { st.bg = e.target.value; };
$('play').onclick = () => { st.playing = !st.playing; };
$('first').onclick = () => { st.t = 0; simKey = null; };
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('speed').onchange = e => { st.speed = +e.target.value; };
$('scrub').oninput = e => { const c = clip(); if (!c) return; st.playing = false; st.t = e.target.value / 1000 * c.dur * .9999; };
$('reload').onclick = () => reload(true);
$('lineup').onclick = () => toggleLineup();
document.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => {
  const z = b.dataset.zoom;
  if (z === 'fit') fit(); else { st.zoom = z === 'phone' ? PHONE : +z; st.panX = st.panY = 0; }
});
document.querySelectorAll('[data-ov]').forEach(b => b.onclick = () => { st.ov[b.dataset.ov] ^= 1; syncToggles(); });
function syncToggles() {
  document.querySelectorAll('[data-ov]').forEach(b => b.classList.toggle('on', !!st.ov[b.dataset.ov]));
  $('lineup').classList.toggle('on', !!st.lineup);
}
function toggleLineup() { st.lineup ^= 1; syncToggles(); fit(); }
setInterval(() => { $('zoomv').textContent = st.zoom.toFixed(2) + '×'; }, 100);

// pan + zoom
let drag = null;
vp.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, px: st.panX, py: st.panY }; vp.setPointerCapture(e.pointerId); vp.classList.add('drag'); });
vp.addEventListener('pointermove', e => {
  const r = vp.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2 - st.panX, my = e.clientY - r.top - r.height / 2 - st.panY;
  st.mouse = [mx / st.zoom, my / st.zoom];
  if (drag) { st.panX = drag.px + e.clientX - drag.x; st.panY = drag.py + e.clientY - drag.y; }
});
vp.addEventListener('pointerleave', () => { st.mouse = null; });
const endDrag = () => { drag = null; vp.classList.remove('drag'); };
vp.addEventListener('pointerup', endDrag); vp.addEventListener('pointercancel', endDrag);
vp.addEventListener('dblclick', () => fit());
vp.addEventListener('wheel', e => {
  e.preventDefault();
  const r = vp.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
  const nz = Math.min(64, Math.max(.25, st.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015))));
  st.panX = mx - (mx - st.panX) * nz / st.zoom; st.panY = my - (my - st.panY) * nz / st.zoom; st.zoom = nz;
}, { passive: false });

addEventListener('keydown', e => {
  if (TAB !== 'assets') return;
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase(), list = st.assets.filter(visible), i = list.indexOf(st.a);
  if (k === ' ') { st.playing = !st.playing; e.preventDefault(); }
  else if (k === 'arrowleft') { step(-1); e.preventDefault(); }
  else if (k === 'arrowright') { step(1); e.preventDefault(); }
  else if (k === 'arrowdown' || k === 'arrowup') { const n = list[(i + (k === 'arrowdown' ? 1 : -1) + list.length) % list.length]; if (n) select(n.id); e.preventDefault(); }
  else if (/^[1-9]$/.test(k)) setClip(+k - 1);
  else if (k === 'f' && st.a && st.a.flip) { st.o.face *= -1; buildInspector(); buildStrip(); }
  else if (k === 'h' || k === 'g' || k === 'o') { st.ov[{ h: 'hitbox', g: 'grid', o: 'onion' }[k]] ^= 1; syncToggles(); }
  else if (k === 'l') toggleLineup();
  else if (k === '0') fit();
  else if (k === 'r') reload(true);
  else if (k === '/') { $('q').focus(); e.preventDefault(); }
});

// ---------- load + live reload ----------
let loading = false;
async function reload(manual) {
  if (loading) return;
  loading = true;
  setStatus('busy', 'Loading game source…');
  try {
    const errs = await loadRuntime();
    const keep = st.a && st.a.id;
    st.assets = buildCatalog();
    st.a = null;
    bgOptions(); buildTree(); select(keep || st.assets[0].id, !!keep);
    drawLogo();
    const when = new Date().toLocaleTimeString();
    setStatus(errs ? 'err' : 'ok', `public/index.html · ${st.assets.length} assets · ${when}${errs ? ` · ${errs} startup error(s)` : ''}`);
    if (manual || keep) toast('Game source reloaded');
  } catch (e) {
    setStatus('err', 'Load failed: ' + e.message.split('\n')[0]);
    showErr(String(e.message || e));
  } finally { loading = false; }
}
function drawLogo() { const cv = $('logo'), X = cv.getContext('2d'); X.setTransform(1.6, 0, 0, 1.6, 24, 28); try { paint(X, st.assets[0], .3, st.assets[0].clips[0], { face: 1 }); } catch (e) { } }
setInterval(async () => {
  if (loading || document.hidden) return;
  try { const r = await fetch('/game/index.html', { method: 'HEAD', cache: 'no-store' }); const m = r.headers.get('x-mtime'); if (m && mtime && m !== mtime) reload(false); } catch (e) { setStatus('err', 'Workshop server is not reachable'); }
}, 1200);

syncToggles();
reload(false).then(() => requestAnimationFrame(render));
