# Telemetry

First-party gameplay stats stored in our own Neon database, next to the leaderboards. They exist so we can
report on progression (gold, Pumpkin Crowns, codex, upgrades), runs and sessions across **all** players,
not just the ones who sign in with X. They never feed a leaderboard.

This is separate from the Databuddy events in `public/index.html` (`dbTrack`),
which are unchanged.

## What the game sends

`POST /api/t`, fire-and-forget (`fetch` with `keepalive`), errors ignored. Sent:

- **on boot**: session ping + save snapshot (captures players' existing totals the first time they load this build)
- **at every run end**: session ping + save snapshot + the run (`tRun` in `endRun`; Halloween Endless runs also call it from `hwEnd` once that mode ships)
- **when the tab is hidden**: session ping + snapshot, only if the save changed since the last send

```jsonc
{
  "v": 1,
  "install_id": "uuid",   // random, kept in localStorage `crownsurv_tid`
  "session_id": "uuid",   // new on every page load
  "touch": false,         // (pointer: coarse)
  "snap": { "gold", "pumpkin_crowns", "runs", "wins", "kills", "best_s", "max_curse",
            "meta", "chars", "wins_by", "pumpkin_by", "codex" },
  "run":  { "mode": "classic|halloween", "event_id", "hero", "result": "win|death|quit",
            "time_s", "kills", "level", "gold_earned",
            "curse", "bosses",                                  // classic
            "crowns", "rituals", "night_rank", "embers", "death_cause", // halloween
            "build": { "w", "ps", "evo", "inf" } }
}
```

No PII: no IP, user agent or email is stored. When the player is signed in, the Bearer token links rows to
their `user.id`. Nested maps from old saves are cleaned (bad entries dropped) rather than rejecting the ping.
A second run from the same install inside 5 s is dropped.

## Rate limits (`api/migrations/004_telemetry_limits.sql`)

Keyed by `sha256(BETTER_AUTH_SECRET | UTC day | IP)`, so no IP is stored and the hash changes at midnight UTC.
The IP comes from `x-forwarded-for`, which Vercel sets itself. Over a limit the API answers `429` and writes
nothing; the game ignores it.

- **120 requests per IP per 10-minute window** (generous for schools and carrier NAT).
- **20 never-seen installs per IP per UTC day.** Installs already in `telemetry_sessions` always pass, so
  this only caps invented install ids, the main way to flood the stats.

Limit rows prune themselves (1% of requests delete rows older than 1 h / 2 days). Requests with no IP
(local dev) are not limited. Tune with `IP_HITS_PER_WINDOW` / `IP_NEW_INSTALLS_PER_DAY` in `api/src/telemetry.ts`.

## Tables (`api/migrations/003_telemetry.sql`)

| Table | Grain | Use for |
| --- | --- | --- |
| `telemetry_sessions` | one row per page load | DAU, sessions, session length (`last_seen - started_at`), runs per session, touch vs desktop |
| `telemetry_runs` | one row per finished run | runs per day/mode, gold earned, crowns, death causes, hero and build picks |
| `player_snapshots` | latest save per install | gold balances, total Pumpkin Crowns, upgrade levels, codex completion, hero unlocks |

## Dashboard

`/admin` (`public/admin.html`) charts everything above from `GET /api/admin/stats?from=YYYY-MM-DD&to=YYYY-MM-DD`
(`api/src/admin.ts`; `to` exclusive, days in SAST, at most 120). Only emails listed in `ADMIN_EMAILS` can read it:
enter one on the page and Better Auth emails a single-use magic link (10 minutes, sent through Resend). Other
addresses get the same "sent" reply but no email, so no account is created for them. Signing in with X no longer
grants admin access. A badge in the header shows which deployment the page reads
from (`env` from `GET /api/health`): Production, Preview or Local.

The **Mock data** toggle (or `?mock=1`) renders generated data in
the same shape without calling the API, for layout checks and before real data exists.

### Preview data

Previews use a separate database so testing never touches production stats. With the Neon Vercel integration
installed, each preview gets its own Neon branch (a copy of production at the time it was created) as its
`DATABASE_URL`. If `MIGRATE_ON_PREVIEW_BUILD=1` is set for Preview, the build applies pending migrations to that
branch (`vercel.json` `buildCommand`). Only set it once previews have their own database: otherwise the build would
migrate production.

## Starter queries

```sql
-- Daily active players and sessions
SELECT date_trunc('day', started_at) AS day, count(DISTINCT install_id) AS players, count(*) AS sessions,
       round(avg(extract(epoch FROM last_seen - started_at)) / 60, 1) AS avg_session_min
FROM telemetry_sessions GROUP BY 1 ORDER BY 1;

-- Harvest Moon runs per day, crowns and gold
SELECT date_trunc('day', created_at) AS day, count(*) AS runs, count(DISTINCT install_id) AS players,
       sum(crowns) AS crowns, round(avg(time_s)) AS avg_time_s, sum(gold_earned) AS gold
FROM telemetry_runs WHERE event_id = 'harvest-2026' GROUP BY 1 ORDER BY 1;

-- What kills players in Halloween Endless
SELECT death_cause, count(*) FROM telemetry_runs
WHERE mode = 'halloween' AND result = 'death' GROUP BY 1 ORDER BY 2 DESC;

-- Gold balance distribution
SELECT width_bucket(gold, 0, 20000, 10) AS bucket, min(gold), max(gold), count(*)
FROM player_snapshots GROUP BY 1 ORDER BY 1;

-- Total Pumpkin Crowns held, and players with at least one
SELECT sum(pumpkin_crowns) AS crowns, count(*) FILTER (WHERE pumpkin_crowns > 0) AS crowned_players
FROM player_snapshots;

-- Shop upgrade adoption: players at each level of each upgrade
SELECT m.key AS upgrade, m.value::int AS level, count(*)
FROM player_snapshots, jsonb_each_text(meta) m GROUP BY 1, 2 ORDER BY 1, 2;

-- Codex completion
SELECT round(avg(codex_items)) AS avg_items_seen, round(avg(codex_enemies)) AS avg_enemies_seen
FROM player_snapshots;
```
