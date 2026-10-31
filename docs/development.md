# Crown Survivors: development guide

Everything needed to configure, run, test and deploy Crown Survivors Classic and its leaderboard API. For the overview, see the [README](../README.md).

## Contents

- [Environment variables](#environment-variables-vercel--local)
- [X developer app (OAuth 2.0)](#x-developer-app-oauth-20)
- [Local development](#local-development)
- [Workshop](#workshop)
- [Deploy (Vercel)](#deploy-vercel)
- [API routes](#api-routes-summary)
- [Profiles and guest accounts](#profiles-and-guest-accounts)
- [Seasonal events](#seasonal-events)

## Environment variables (Vercel + local)

Set these in the Vercel project (Production and Preview as needed). Do **not** commit secrets.

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string (`…-pooler…neon.tech/neondb?sslmode=require`) |
| `BETTER_AUTH_SECRET` | 32+ random characters (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | `https://crown-survivors.vercel.app` (no trailing slash). Previews ignore it and use their branch URL, so all variables can be shared between Production and Preview. |
| `X_CLIENT_ID` | X app OAuth 2.0 Client ID |
| `X_CLIENT_SECRET` | X app OAuth 2.0 Client Secret |
| `EXTRA_ORIGINS` | Optional comma-separated extra CORS / trusted origins |
| `ADMIN_EMAILS` | Comma-separated emails that can sign in to the `/admin` stats dashboard by magic link |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key, used to email the `/admin` magic link |
| `EMAIL_FROM` | Optional sender; defaults to `Crown Survivors <onboarding@resend.dev>` |

Default allowed origins: `https://crown-survivors.vercel.app`, `http://localhost:8799`, `http://127.0.0.1:8799`, `http://localhost:3000`.

## X developer app (OAuth 2.0)

1. [developer.x.com](https://developer.x.com) → Projects & Apps → your app → **User authentication settings**.
2. OAuth 2.0 on, type **Web App (confidential client)**, permissions **Read**.
3. **Callback URI / Redirect URL** (paste exactly):

   `https://crown-survivors.vercel.app/api/auth/callback/twitter`

4. **Website URL** (paste exactly):

   `https://crown-survivors.vercel.app`

5. Copy OAuth 2.0 Client ID and Secret into `X_CLIENT_ID` and `X_CLIENT_SECRET`.

Scopes used: `users.read`, `tweet.read` (profile only; no email, no posting).

## Local development

```bash
cd api && npm install && cd ..
cp api/.env.example api/.env   # fill in at least DATABASE_URL
npm run migrate                # idempotent schema
npm run typecheck
cd api && npx vercel dev       # game + API on one origin (usually http://localhost:3000)
```

Tests: `DATABASE_URL=postgresql://localhost:5432/crown_test npm test` runs the unit tests and the integration tests (Hono app + Postgres, Resend stubbed). Point it at a throwaway database with migrations applied: the integration tests truncate tables. Without `DATABASE_URL` the integration suite is skipped. CI (`.github/workflows/test.yml`) runs them on every pull request and on demand.

Ad-hoc SQL: use `npm run db --prefix api -- "<sql>"` instead of raw `psql`. It refuses an empty or host-less URL (`psql ""` silently connects to your local default database), prints the host, database and applied migrations before running, runs read-only unless `--write`, and remote writes also need `--confirm-host <host>`. `--url-env NAME` reads a different variable and `-f file.sql` reads SQL from a file. Vercel will not return sensitive variables with `vercel env pull`, so get production URLs from Neon by branch name (`neonctl connection-string production`).

Serve the game locally (optional): `npx serve public -p 8799`, then add that origin via `EXTRA_ORIGINS` if you point the game at a separate API URL.

## Workshop

`npm run workshop` (or `npm run assets`), then open http://localhost:8790. One local page for QA and review while building the game, with four tabs. It lives in `tools/workshop/`, binds to `127.0.0.1` only and is never deployed. Everything in it runs the live code in `public/index.html` and reloads when that file changes.

- **Assets**: every hero, enemy, boss, pickup, icon and emblem, drawn by the game's own drawers, with their animations (cycles, tells, boss phases, hit flash, silhouette), frame stepping, scrubbing, zoom, hitbox, grid and onion skin overlays, a lineup mode and PNG or sprite sheet export. Attacks (weapons at every level and evolved, enemy ranged attacks, every Classic and ritual boss attack) play in a combat sandbox: a real run through `update()` and `drawWorld()` with spawning off, the hero pinned and invulnerable, target dummies that never die, and the boss's attack choice and phase held so one attack repeats.
- **Playground**: a configurable live run on the same sandbox. Pick the mode, hero, curse, start time (`G.t`) and arena phase; every weapon at level 0 to 5 or Evolved and every passive at 0 to 5 (hero-only items show for their hero); targets by type, count, layout (ring, pack, line), elite, pinned or moving, immortal or real HP (real HP respawns kills, so time to kill is measured); natural spawning, god mode and free move (click the view, then WASD); and a Classic or ritual boss held at P1, P2 or P3. Any change restarts the run. The stats panel shows the computed `SC` stats, DPS over a rolling 5s window of game time, total damage, kills, time to kill, entity counts and update and draw time. The world steps at phone size (390×844), so edge spawns and on-screen checks match a phone. Presets are kept under the Workshop's own `localStorage` key, and **Copy as JSON** puts a setup into a report or an agent prompt.
- **Balance**: every data table read from the running code (`CH`, `WP`, `PS`, `INF`, `META`, `ETYPE` with `ENAME`, `BOSS`, `HB`, `HW`, `EVENTS`, `PHASE`), plus derived tables from the game's own functions: XP to level (`need(l)`, levels 1 to 40, with the running total), Halloween tier scaling (`hwK(t)`, tiers 0 to 12) and ritual costs by Night Rank. Each table shows where it is defined (`public/index.html:<line>`, click to copy) and has **Copy JSON**; **Download config.json** saves everything in one agent-readable file.
- **Reports**: the F8 bug reports in `dev/reports/`, newest first, filtered by open or resolved and searchable by note. A report opens with its screenshot, note, summary, errors with stacks and the full state, plus **Replay in game**, **Copy path** and **Mark resolved / Reopen** (written to `report.json` as `status`). There is no delete button: remove a folder by hand.

**Play (debug)** opens the game at `/play`: `public/index.html` as deployed, minus the Databuddy tag, so `/api` calls simply 404 there.

### Debug menu and F8

Dev mode is on at `localhost` or `127.0.0.1`, or anywhere else with `?debug`, and never on `crown-survivors.vercel.app`, where none of this code runs and no debug DOM exists. In dev mode:

| Key | Action |
| --- | --- |
| `` ` `` (or the **DBG** tab on the left edge) | Debug menu |
| `F8` | Bug report: freezes the run, grabs the canvas, asks for a note. `Cmd/Ctrl+Enter` saves, `Esc` cancels |

The menu covers the run (god mode, time scale 0, 0.25, 0.5, 1, 2 and 4, one-frame step while frozen, +30s or +60s on `G.t`, arena phase), overlays (hitboxes, FPS, frame time and entity counts), the player (heal, +1 level, +XP, +100 gold, revive), weapons and passives (−/+ per item, evolve, max everything), spawning (any enemy ×1, ×10 or ×50, elite, a Classic boss, a ritual boss, kill non-boss, kill everything, clear bullets) and Halloween (+100 embers, next ritual now, Night Rank +1). With no run going it can start a Classic or Halloween run.

The first debug action marks the run (`G.dbg`). A debug run never reaches the leaderboard, banks nothing into the save (the save is snapshotted at that first action, writes pause, and the snapshot comes back when the run ends or the next one starts), and from then on that page sends no telemetry and no Databuddy events.

### Bug reports

F8 posts the report to the Workshop server, which writes:

```
dev/reports/<id>/
  screenshot.png   the canvas when F8 was pressed
  report.json      everything else
  README.md        note, summary, errors and how to replay, for an agent to read in one go
```

`<id>` is the time plus a slug of the note. `report.json` holds `id`, `at`, `note`, `status`, `url`, `ua`, `viewport` (`W`, `H`, `DPR`), `scene`, `runMode`, `clock`, `version` (from `package.json`), `replayOf` (when filed from a replay), a `summary` (mode, hero, weapons and levels, passives, `G.t`, level, HP, enemy count, boss and phase, Night Rank), `errors` (the last 50 errors, unhandled rejections, `console.error` and `console.warn`, with time and stack) and `state` with `S` and the serialized `G`. In the state, an object reachable more than once is written once with `"$id": n` and referenced as `{"$r": n}`; `{"$set": [...]}` is a Set, `{"$map": [[k, v], ...]}` a Map and `{"$n": "Infinity"}` a non-finite number. Functions, canvases, ImageData and the floor blood cache (`G.blood`) are left out.

Without the Workshop server (for example under `vercel dev` with `?debug`) F8 downloads `report-<id>.json` instead, with the screenshot inline.

### Replaying a report

Open `/play?report=<id>` on the Workshop server, or click **Replay in game** in the Reports tab. The game loads `S`, `G`, `runMode` and `clock` from the report and shows the moment frozen, with a **REPLAY** banner and the note. Resume and step from the banner or the debug menu; F8 files a follow-up report that links back with `replayOf`. A replay writes nothing to `localStorage` (the save, leaderboard cache and cloud sync state stay byte-for-byte the same), skips cloud sync and sends no telemetry.

## Deploy (Vercel)

1. Import this repo as a Vercel project (root directory `.`).
2. Add all environment variables above for **Production**.
3. Deploy. Confirm `BETTER_AUTH_URL` matches the live URL and the X callback URI matches.
4. Run migrations against production Neon once: `DATABASE_URL=… npm run migrate`.

Build command (optional): `npm run typecheck`. Output: static files from `public/`.

## API routes (summary)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/auth/x?returnTo=<url>` | Start Sign in with X; returns to game with `#lb_token=…` |
| POST | `/auth/x` `{returnTo}` | The same for a guest (Bearer token): answers `{url}` to open, and the X account absorbs the guest |
| POST | `/api/auth/sign-in/anonymous` | Guest account with a generated name; answers `{token, user}` |
| GET | `/auth/handoff` | Internal OAuth return (token hand-off) |
| * | `/api/auth/*` | Better Auth (session, sign-out, X callback, …) |
| GET | `/api/me` | Current user (`guest`, and `merged`: guest ids this account absorbed) or `{ user: null }` |
| GET | `/api/me/profile` | Your account plus rank and best row on every Classic and event board (authenticated) |
| POST | `/api/scores` | Submit score (authenticated) |
| GET | `/api/leaderboard?board=fastest\|survival\|kills` | Public leaderboard |
| GET | `/api/me/rank?board=…` | Your rank (authenticated) |
| POST | `/api/events/:id/scores` | Submit an event run (authenticated; only while the event is open, plus 2 h grace) |
| GET | `/api/events/:id/leaderboard?board=crowns\|fastest\|kills` | Event leaderboard (stays readable after the event as its archive) |
| GET | `/api/events/:id/me/rank?board=…` | Your rank on an event board (authenticated) |
| GET | `/api/health` | Health check JSON |

## Profiles and guest accounts

Tapping the name chip at the bottom of the title (or the chip on the leaderboard and events screens) opens the **profile** (scene `profile` in `public/index.html`): avatar, name, @handle or a GUEST badge, join date, rank and best on every Classic board and on the latest event's boards (tap a row to open that board), and lifetime stats from the save. Sign out lives here now. Signed out, the profile shows this device's bests and offers **Sign in with X** or **Play as guest**; the leaderboard, the new best card and the Halloween game over offer both too.

**Guests** are Better Auth anonymous users (`isAnonymous` on `"user"`, migration `006_guests.sql`) named by `guestName()` in `api/_src/guests.ts`, like "Mossy Knight 372". They post to every board and keep a cloud save like anyone signed in. A guest lives only in the device's token, so guest sessions last five years instead of 30 days, and guests cannot rename themselves (`/api/auth/update-user` stays blocked). Production rate limits guest creation to 10 per IP per hour per instance.

**Upgrading**: a guest's Sign in with X goes through `POST /auth/x` with its Bearer token, which records the guest in Better Auth's OAuth state. On the X callback, `mergeGuest()` moves the guest's scores, event scores, telemetry and cloud save into the X account (new or existing) in one transaction, records it in `guest_merges`, and deletes the guest. The cloud save merges as if the guest's save came from a new device; the account's version jumps past both, and the guest device's push record moves over, so the game's next push adds only what it played since its last sync. The game hands its local save to the X account only when `/api/me` lists the guest in `merged`; otherwise it falls back to the normal account switch (the guest's progress is stashed on the device, never dropped). An `/admin` magic link in a guest's browser never absorbs the guest.

## Seasonal events

Events are data. The first is `harvest-2026` (Harvest Moon: the Pumpkin Prince hero and Halloween Endless). Each event is one entry in `EVENTS` in
`public/index.html` and one in `api/_src/events.ts`, and the two must match: id, `startAt`/`endAt` (SAST,
end exclusive), theme. While an event is live, the title wears its skin and offers its mode. After it ends,
the mode is hidden and the title's **EVENTS** button opens the archive.

Event scores live in `event_scores` (migration `002_event_scores.sql`) and never touch the Classic boards.
Balance numbers and the per-chunk notes are in [halloween-event.md](halloween-event.md).

QA on localhost or a preview deployment (ignored on `crown-survivors.vercel.app`):
`?event=harvest-2026` forces the event live, and `?event=ended` shows the post-event title and archive.
The API still enforces the real window for submissions. `?sheet=halloween` opens the enemy review sheet: every event enemy, all
frames, tells and silhouettes, drawn by the live code. The art rules are in [sprite-kit.md](sprite-kit.md).
