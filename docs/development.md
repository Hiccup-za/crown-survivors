# Crown Survivors: development guide

Everything needed to configure, run, test and deploy Crown Survivors Classic and its leaderboard API. For the overview, see the [README](../README.md).

## Contents

- [Environment variables](#environment-variables-vercel--local)
- [X developer app (OAuth 2.0)](#x-developer-app-oauth-20)
- [Local development](#local-development)
- [Asset viewer](#asset-viewer)
- [Deploy (Vercel)](#deploy-vercel)
- [API routes](#api-routes-summary)
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

## Asset viewer

`npm run assets`, then open http://localhost:8790. It lists every hero, enemy, boss, pickup, icon and emblem, drawn by the live code in `public/index.html`, and plays each one's animations (cycles, tells, boss phases, hit flash, silhouette) with frame stepping, scrubbing, zoom, hitbox, grid and onion skin overlays, a lineup mode and PNG or sprite sheet export.

Attacks (weapons at every level and evolved, enemy ranged attacks, and every Classic and ritual boss attack) play in a combat sandbox: a real run driven by the game's own `update()` and `drawWorld()` with spawning off, the hero pinned and invulnerable, target dummies that never die, and the boss's attack choice and phase held so one attack repeats on a loop.

It runs the game script in a hidden iframe with storage, network and the main loop switched off, so it never touches saves or sends telemetry, and it reloads when `public/index.html` changes. It lives in `tools/asset-viewer/` and is not deployed.

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
| GET | `/auth/handoff` | Internal OAuth return (token hand-off) |
| * | `/api/auth/*` | Better Auth (session, sign-out, X callback, …) |
| GET | `/api/me` | Current user or `{ user: null }` |
| POST | `/api/scores` | Submit score (authenticated) |
| GET | `/api/leaderboard?board=fastest\|survival\|kills` | Public leaderboard |
| GET | `/api/me/rank?board=…` | Your rank (authenticated) |
| POST | `/api/events/:id/scores` | Submit an event run (authenticated; only while the event is open, plus 2 h grace) |
| GET | `/api/events/:id/leaderboard?board=crowns\|fastest\|kills` | Event leaderboard (stays readable after the event as its archive) |
| GET | `/api/events/:id/me/rank?board=…` | Your rank on an event board (authenticated) |
| GET | `/api/health` | Health check JSON |

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
