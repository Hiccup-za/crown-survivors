# Architecture proposal: making content easy to add

Status as of 2026-11-06. A review of `public/index.html` (one 224KB IIFE), the API and the Workshop, with a plan for adding events, heroes, enemies and items without the codebase getting harder to manage.

## The short version

Your stats already live in data tables (`CH`, `WP`, `PS`, `ETYPE`, `BOSS`, `HB`, `HW`, `EVENTS`). That's a good base. The problem is that **behavior is keyed by string and index checks spread across the file**, so every new thing has to be wired into many separate places. The most expensive part to change later is the **save and DB model**, which has the Halloween event built into it. Fix that first, then the code layout, then the content registries.

## What adding content costs today

| Adding a... | Places you touch |
|---|---|
| **Enemy** | `ETYPE`, `ENAME`, `ELORE`, `GMAT`, an `if(e.type==='x')` branch in `update()`, a sprite drawer, `SPRF`/`SPRR`, the review sheet, a spawn pool (`EPOOL` or `HW.pool`). That's about 9 places, and `sknight` alone shows up 17 times. |
| **Weapon** | `WP`, a hand-written block in `fireWeapons` with per-level arrays inline (`[1,1,2,2,3][l-1]`), `wDesc` (a separate text table), projectile branches (`b.t==='pumpkin'`) in `update()`, the hit knockback ternary, special-case card text (`c.k==='pumpkin'`) |
| **Passive** | `PS` text (`'+12% damage'`) plus the real number, written separately inside `st()`, so the two can drift apart |
| **Hero** | `CH`, plus perks hardcoded by **array index** in `st()` (`c===2?1.2`, `c===1?1`, `c===3?.15`, `c===0?1.1`) and `pumpSplashRad` (`G.char===4`). Exclusive items use `only:4`. |
| **Boss** | `BOSS`, AI branches, death effects by index (`e.bi===2` gives +2 slots, `e.bi===LASTB`), banner text arrays indexed by `bi` |
| **Event** | `EVENTS` in two files ("keep in sync" comments), a whole mode using `G.hw` checks on about 35 lines, plus `pumpkin_crowns`/`pumpkin_by` columns in the DB, `save.ts`, `telemetry.ts`, `players.ts` and `admin.ts`. **The next event would need a migration and edits in 5 API files.** |

## Risks that grow with every release

1. **Heroes are identified by array index.** `S.chars:[0]`, `winsBy` keyed by index, and `only:4` all break if `CH` is ever reordered. `HERO_ID` is built from the display name, so renaming a hero quietly forks its leaderboard history.
2. **Event currency is part of the schema.** "Pumpkin Crowns" is a column. A second event means either another column or reusing pumpkin data for something else.
3. **No game logic can be tested outside the browser.** The Workshop measures numbers live, which is great for QA, but nothing catches "enemy has no drawer" or "weapon evolves into a passive that doesn't exist" before you play.

## Proposal, in order

### Phase 0: Fix the data model before the next event (highest leverage)

- **Stable string ids everywhere**: `CH[].id = 'pumpkin-prince'`, `only: 'pumpkin-prince'`, `S.chars: ['king-cube', ...]`. Write a one-time, additive loader migration from index to id. Keep reading the old shape and never drop data (no progress reset, ever).
- **Make event progress generic**: `S.eventBy: { 'harvest-2026': { crowns, best, ... } }` in the save, and a `player_event_progress (user_id, event_id, currency, ...)` table on the server. Backfill it from `pumpkin_crowns`/`pumpkin_by` and keep the old columns until nothing reads them. The merge rules in `save.ts` become per-event three-way adds, written once.
- **One event manifest**: `events.json` (id, dates, theme, mode, currency name, heroes, boards), imported by `api/_src/events.ts` and inlined into the client at build time. That removes the "keep in sync" comments.

### Phase 1: Split the file without changing runtime behavior

Keep the single IIFE, the dense style and the Workshop `BRIDGE`, but write the source as files and concatenate them:

```
src/game/00-save.js 10-data/heroes.js 10-data/enemies.js ... 40-update.js 50-draw-world.js ...
tools/build.mjs  -> public/index.html  (concat inside the IIFE, watch mode for the Workshop)
```

The first PR should produce **byte-identical output** to today's `index.html`, so it's provably a no-op. After that, files are small enough to review, and you and the agent can grep `enemies.js` instead of a 224KB file. Avoid ES modules for now: they would break the closure-scope tricks the Workshop and dev tools depend on.

### Phase 2: One entry per thing (registries)

Put each piece of content's data and behavior together, so adding one means editing one file:

```js
ENEMY.sknight={name:'Skelly Knight',lore:'...',hp:60,spd:26,r:11,dmg:11,xp:5,c:'#e8e0cc',elite:1,ev:'harvest',
 gore:'bone',fps:6,ai(e,c,dt){...},draw:(r,f,st)=>{...}}
WEAPON.pumpkin={name:'Magic Pumpkin',evo:'Night Harvest',passive:'bloom',hero:'pumpkin-prince',
 lv:[{n:1,dmg:12,cd:.85,txt:''},{n:1,dmg:15,cd:.8,txt:'Faster'},...],evoLv:{n:5,dmg:24,cd:.48,txt:'5 pumpkins, bigger splash'},
 fire(w,c){...}}
PROJ.pumpkin={kb:20,onHit(b,e,c){...splash}}
```

- **Per-level numbers become data** (the `lv` arrays). The Balance tab can then show them directly instead of measuring them, which `task.md` already calls out as a gap.
- **Hero perks and passives become stat modifiers**: `perk:{area:1.2}`, `PS.might.mod={dmg:.12}`, and `st()` just sums them. Card text is generated from the same number, so it can't drift.
- **Boss rewards become data**: `BOSS[2].onDown={slots:2,banner:'CROWN OF THE WILDS!'}` instead of checking `e.bi===2`.
- Do it **one registry per PR** (enemies, then weapons, then bosses), and use the Workshop Playground as the regression check: DPS, time to kill and spawn counts for every weapon level should match before and after.

### Phase 3: Modes as plug-ins

Most of the `G.hw` branches are really "Classic does X, Halloween does Y". Define a small mode interface and move both modes into it:

```js
MODE.classic={init,spawn(dt),scale(type),onKill(e),onBossDown(e),end(win),hud,over}
MODE.halloween={...}  // hwSpawn, hwRitual, hwDrop, hwEnd, hwOver move here
```

The core loop calls `G.mode.spawn(dt)`. A new event is then a manifest entry, a mode (or Halloween reused with a new `HW`-style config), a skin, and a few new `ENEMY` entries. From a game design view, this is where the payoff is: **"Endless ritual with currency, escalating ranks and boss combos" becomes a reusable event template** you re-theme, not code you rewrite every season.

### Phase 4: Guardrails

- A `validateContent()` that runs in dev mode at boot and from a Node test (cheap once Phase 1 makes data files importable). It checks that every enemy has a drawer, lore and gore material; every pool and combo id exists; every evolution's passive exists; every hero-exclusive item points at a real hero id; and event dates match the manifest.
- A Workshop "Content" panel listing missing fields, and short "Add an enemy / weapon / hero / event" checklists in `docs/`.

## What not to do

- **No ECS or engine rewrite.** The game is small enough that registries plus modes give you about 90% of the extensibility with no change in performance or style.
- **No framework or bundler beyond plain concatenation.** Zero build complexity is a real asset for a static Vercel deploy.

## Phase 0 as built (2026-11-07)

Review notes, where the implementation differs from the plan above, and why:

- **Event progress is a jsonb column, not a `player_event_progress` table.** The save is one row with jsonb maps
  (`wins_by`, `codex`) and a pure three-way merge. `events: {event_id: {currency, by}}` keeps that shape, so the merge
  stays one function and a push stays one row write. A table can still be derived from it for reporting.
- **Expand, don't convert.** Migration 006 only adds `heroes`, `hero`, `hero_wins` and `events` (plus a backfill). The old
  columns keep being written with the same numbers for every existing hero, and reads take the higher of both copies.
  So the API from before, the admin views and `npm run migrate` can land in any order, and a rollback loses nothing.
  Dropping the old columns is a later step, once the admin reads the new ones.
- **Old pages are a live client.** Open tabs keep running the old code and sync on every save. `/api/save` and `/api/t`
  accept both shapes, and `/api/save` answers in v1 unless the page sends `v: 2`, so an old tab never receives ids it
  can't read.
- **No `events.json` yet.** Inlining it into the client needs the Phase 1 build. Until then `api/_test/sync.test.ts`
  checks that the game's `CH`, `EVENTS`, `META` and hero-only items match the API's tables, so they can't drift.
- **Hero perks compare ids now** (`st()`, `pumpSplashRad`), so reordering `CH` is safe today. Moving them to `perk:{...}`
  data is still Phase 2.

## Recommendation

Phase 0 first. It's the only part that gets more expensive with every player save and every event you ship, and it needs to land before the next event. Phase 1 is a safe one-day PR right after it, and everything else can happen gradually while you add content.
