# Halloween Event — build notes and balance table

Companion to the *Halloween Event — Plan of Action* page. The numbers here are the
**playtest defaults** that the code reads (working rule 3: no stats invented in code). To
retune, change this table and the matching constant in `public/index.html`
(`EVENTS`, `HW`, `HB`, the `ETYPE` Halloween rows) or `api/src/events.ts`.

Items marked **Needs Christopher** are placeholders. They are easy to change and nothing
ships until he signs off.

## Event config (Chunk 1a)

| Field | Value | Where |
| --- | --- | --- |
| id | `harvest-2026` | `EVENTS.harvest` in `public/index.html` and `api/src/events.ts` (keep in sync) |
| name | `Harvest Moon` (shared with the Pumpkin Prince event hero) | |
| startAt | `2026-10-28T00:00:00+02:00` (SAST) | |
| endAt | `2026-11-08T00:00:00+02:00` (SAST, exclusive: last day is 7 Nov) | |
| theme | `halloween` (title skin, arena, analytics `score_submit` board tag) | |
| submit grace | 2 h after `endAt` (lets runs that were in progress at close still post) | `api/src/events.ts` |

QA override (ignored on `crown-survivors.vercel.app`): `?event=harvest-2026` forces the
event live and `?event=ended` forces every event over. The API still enforces the real window,
so preview runs cannot post scores early.

## Run loop

1. Kill enemies, collect **Soul Embers** (pickups: magnet range applies).
2. Rituals **summon themselves**. Once your embers cover the next ritual's cost, a 2 s countdown runs
   (the tell, shown on the ember meter at the bottom of the HUD), the cost is spent, and the bosses rise.
   The player never triggers it. Only one ritual can be in progress at a time. Embers collected during a
   ritual carry over to the next one.
3. A ritual is cleared when every boss it summoned is dead. That drops a chest and heals 25% max HP.
4. R1–R3 summon pumpkin mini-bosses. R4 summons **The Night Gourd**. Each Night Gourd kill is a
   **Pumpkin Crown** (saved immediately). Clearing R4 raises **Night Rank** by one and the ladder
   restarts with combo rituals.
5. No timers gate anything. Enemy difficulty follows ritual progress, not elapsed time.
6. The first R3 clear in a run grants +2 weapon/passive slots, the Halloween counterpart of
   Classic's "Crown of the Wilds".

## Soul Embers

| Source | Embers |
| --- | --- |
| Trash kill (Pip, Shade Bat, Candy Skel) | 1 at 30% |
| Elite-type kill (Jack Wisp, Skelly Knight) | 1 |
| Elite spawn (8× HP "ELITE INCOMING") | 6 |
| Mini-boss kill | 15 |
| Night Gourd kill | 30 |

## Ritual ladder: ember costs

Cost = base × (1 + 0.5 × (Night Rank − 1)), rounded.

| Ritual | Base | Rank 1 | Rank 2 | Rank 3 |
| --- | --- | --- | --- | --- |
| R1 | 40 | 40 | 60 | 80 |
| R2 | 70 | 70 | 105 | 140 |
| R3 | 110 | 110 | 165 | 220 |
| R4 | 160 | 160 | 240 | 320 |

## Combo rituals

The first boss listed has full HP. Each escort has 60% HP.

| Night Rank | R1 | R2 | R3 | R4 |
| --- | --- | --- | --- | --- |
| 1 | Patch Lord | Hollow Twin | Harvest Wheel | The Night Gourd |
| 2 | Patch Lord + Patch Lord | Hollow Twin + Patch Lord | Harvest Wheel + Hollow Twin | Night Gourd + Patch Lord |
| 3+ | Patch Lord + Hollow Twin | Hollow Twin + Harvest Wheel | Harvest Wheel + Hollow Twin + Patch Lord | Night Gourd + Harvest Wheel + Hollow Twin |

## Night Rank multipliers

Bosses: HP × (1 + 1.0 × (N − 1)). Contact and attack damage × (1 + 0.2 × (N − 1)).

Enemies scale by **tier** = 4 × (N − 1) + rituals cleared in the current rank (Chunk 2c2):

| Tier | Example | Enemy HP × (1 + 1.4t + 0.6t²) | Speed × min(1.6, 1 + 0.06t) | Damage × (1 + 0.25t) | Spawns / s min(12, 2 + 1.2t) |
| --- | --- | --- | --- | --- | --- |
| 0 | Rank 1, before R1 | 1.0 | 1.00 | 1.00 | 2.0 |
| 1 | Rank 1, R1 cleared | 3.0 | 1.06 | 1.25 | 3.2 |
| 2 | Rank 1, R2 cleared | 6.2 | 1.12 | 1.50 | 4.4 |
| 3 | Rank 1, R3 cleared | 10.6 | 1.18 | 1.75 | 5.6 |
| 4 | Rank 2 start | 16.2 | 1.24 | 2.00 | 6.8 |
| 6 | Rank 2, R2 cleared | 31.0 | 1.36 | 2.50 | 9.2 |
| 8 | Rank 3 start | 50.6 | 1.48 | 3.00 | 11.6 |

While a ritual is in progress, spawn rate × 0.55 (same as Classic during a boss). Elite spawns
come every 42 s (first at 45 s), drawn from Jack Wisp / Skelly Knight from tier 2 onwards.

For reference, Classic enemy HP at each boss is ×2.6 / 5.5 / 9.4 / 15.5 / 23.5, so Rank 1 tracks
Classic and Rank 2+ is the endless climb.

## Roster: Halloween ETYPE pool (Chunk 3a)

Base stats sit next to the closest Classic type. (The Skelly Knight replaced the Vine Gourd on 25 Oct and kept its slot, numbers and snare role.) The art for every enemy below and every boss further down is **Sprite Kit v2**.
Character briefs, palette ramps and the detail budget live in `docs/sprite-kit.md`; review it live at `?sheet=halloween`.

| Key | Name | Role | HP | Speed | Radius | Damage | XP | Behaviour | Classic ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pip` | Pip | Trash · fast fodder | 8 | 56 | 8 | 5 | 1 | rolls straight at you | blob 10/34 |
| `shade` | Shade Bat | Trash · flyer | 6 | 64 | 7 | 4 | 1 | bat flutter; 4% of spawns are a flock of 6 | bat 6/62 |
| `cskel` | Candy Skel | Trash · walker | 34 | 30 | 10 | 9 | 3 | steady walker | skel 34/30 |
| `jwisp` | Jack Wisp | Elite · elusive | 30 | 70 | 8 | 9 | 4 | spirals in like a wisp and flickers | wisp 38/70 |
| `sknight` | Skelly Knight | Elite · snare (Grave Pin) | 60 | 26 | 11 | 11 | 5 | inside 170 range, every 4–6 s raises its sword (the tell) and pins the ground under you: bone spikes in a telegraphed circle (r 26 over 1.0 s; hit = its damage + 50% slow for 1.2 s) | vine 40/40 |

Spawn pool by tier:

| Tier | Pool |
| --- | --- |
| 0 | Pip ×3, Shade Bat |
| 1 | Pip ×2, Shade Bat ×2, Candy Skel |
| 2 | + Jack Wisp |
| 3+ | Pip, Shade Bat ×2, Candy Skel ×2, Jack Wisp, Skelly Knight |

## Mini-bosses (Chunk 3b)

Base values are for Rank 1. Every attack is telegraphed (the tell) before it lands.

| Key | Name | HP | Radius | Speed | Contact | Tell → attack |
| --- | --- | --- | --- | --- | --- | --- |
| `patch` | Patch Lord (M1) | 900 | 30 | 36 | 18 | **Squat + glow, 0.7 s** → **Slam**: ring of 12 seeds (speed 95, damage 12) and 4 Pips. Every 3.2 s. |
| `twin` | Hollow Twin (M2) | 2400 | 30 | 58 | 22 | Alternates. **Dash line, 0.75 s** → **Dash** at 300 for 0.55 s. **Halves part, 0.5 s** → **Twin Fan**: two 5-seed fans (speed 120, damage 12) from each face. Every 2.4 s. |
| `wheel` | Harvest Wheel (M3) | 4800 | 34 | 44 | 26 | **Rev-up, 0.9 s** (spins faster, sparks, 480-long lane telegraph) → **Roll** at 330 for 1.2 s → stops with a burst of 10 spikes (speed 110, damage 14). Every 3.0 s; slow chase between rolls. |

## Final boss: The Night Gourd (Chunk 3c)

HP 10000 · radius 46 · speed 30 · contact 30. It has three phases at 66% / 33% HP (shared `bossPhase`
helper, so each phase change bursts and clears its orbiting shots).

| Phase | Movement | Pattern (cycle) | Interval |
| --- | --- | --- | --- |
| P1 "THE NIGHT GOURD RISES" | slow chase | **Volley**: 3 aimed fans of 7 seeds, 0.3 s apart (speed 105, damage 14). **Vines**: 5 thorn snares (r 30, 1.0 s tell, damage 18) on and around you. | 2.8 s |
| P2 "THE NIGHT GOURD CRACKS!" | slow chase | **Ember Rain**: 3×3 grid of strikes (r 32, spacing 80, 1.1 s tell, damage 20) around you. Volley. **Summon**: 6 Pips + 2 Jack Wisps. Vines. | 2.4 s |
| P3 "THE NIGHT GOURD BURNS!" | chase × 1.4 | **Spiral**: 3-arm seed spiral for 2 s (speed 85, damage 14). **Charge**: 0.8 s lane tell → charge at 280 for 0.7 s. Ember Rain. Volley. | 1.9 s |

Reward: Pumpkin Crown, 30 embers, chest, heal 25%.

## Rewards and saves (Chunk 1d)

- `localStorage` `crownsurv_classic_v1` gains `pumpkinCrowns` (total), `pumpkinBy[char]` (per hero, shown as 🎃N
  on the hero row next to ♛N), and `lastEvent` (id of the last event played).
- End-of-run gold = in-run gold + kills / 30 + 100 per crown. Classic `best`, `wins`, `winsBy`, curse unlocks
  and the Classic leaderboard are untouched by Halloween runs (Chunk 2d).

## Event leaderboards (Chunk 4), **boards Need Christopher**

Table `event_scores` (migration `002_event_scores.sql`), scoped by `event_id`. Each user's best row per board,
ranked the same way as Classic.

| Board | Ranks by | Value column |
| --- | --- | --- |
| `crowns` MOST CROWNS | crowns ↓, rituals cleared ↓, kills ↓ | rituals cleared |
| `fastest` FASTEST CROWN | time of first Night Gourd kill ↑ (runs with ≥1 crown) | time |
| `kills` MOST KILLS | kills ↓ | kills |

API: `POST /api/events/:id/scores` (live window + grace only, 30 s rate limit), plus
`GET /api/events/:id/leaderboard?board=` and `GET /api/events/:id/me/rank?board=` (always readable, so they also serve the archive).

## Analytics (locked with Databuddy)

- `run_start` `{mode:"halloween", hero}`
- `run_end` `{mode, hero, result: death|quit, time_s, kills, embers_collected, rituals_cleared, night_rank_max,
  crowns_this_run, minibosses_killed, night_gourd_kills, death_reason?}`.
  `death_reason` is one of `horde` (trash/elite contact, snares), `boss` (mini-boss), `gourd` (Night Gourd) or `other`, and is sent only when `result=death`.
- `score_submit` `{board:"halloween"}` for event-board posts.

Classic events are unchanged. There are no per-kill, per-ritual, per-crown or timed pings.
