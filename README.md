# Crown Survivors Classic

Static **Crown Survivors Classic** plus a Hono leaderboard API (Sign in with X, Neon Postgres), deployed as one Vercel project at [crown-survivors.vercel.app](https://crown-survivors.vercel.app).

The game lives at `/` (`public/index.html`). The API is under `/api/*` with Better Auth at `/api/auth/*`. OAuth entry is `/auth/x` (same origin, first-party cookies).

## Repository layout

| Path | Purpose |
| --- | --- |
| `public/` | Static game (Classic + seasonal event modes) |
| `api/` | Leaderboard API (Vercel serverless via `api/index.ts`) |
| `docs/` | Event build notes and balance tables (`docs/halloween-event.md`) |

## Environment variables (Vercel + local)

Set these in the Vercel project (Production and Preview as needed). Do **not** commit secrets.

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string (`…-pooler…neon.tech/neondb?sslmode=require`) |
| `BETTER_AUTH_SECRET` | 32+ random characters (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | `https://crown-survivors.vercel.app` (no trailing slash) |
| `X_CLIENT_ID` | X app OAuth 2.0 Client ID |
| `X_CLIENT_SECRET` | X app OAuth 2.0 Client Secret |
| `EXTRA_ORIGINS` | Optional comma-separated extra CORS / trusted origins |

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

Serve the game locally (optional): `npx serve public -p 8799` — add that origin via `EXTRA_ORIGINS` if you point the game at a separate API URL.

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

Events are data. The first is `halloween-2026` (Halloween Endless). Each event is one row in `EVENTS` in
`public/index.html` and one in `api/src/events.ts`, and the two must match: id, `startAt`/`endAt` (SAST,
end exclusive), theme. While an event is live, the title wears its skin and offers its mode. After it ends,
the mode is hidden and the title's **EVENTS** button opens the archive.

Event scores live in `event_scores` (migration `002_event_scores.sql`) and never touch the Classic boards.
Balance numbers and the per-chunk notes are in `docs/halloween-event.md`.

QA on localhost or a preview deployment (ignored on `crown-survivors.vercel.app`):
`?event=halloween-2026` forces the event live, and `?event=ended` shows the post-event title and archive.
The API still enforces the real window for submissions. `?sheet=halloween` opens the enemy review sheet: every event enemy, all
frames, tells and silhouettes, drawn by the live code. The art rules are in `docs/sprite-kit.md`.

## Flight Games

The [Flight Games](https://hiccup-za.github.io/flight-games/) monorepo on GitHub Pages is unchanged. This repository is the standalone Classic + leaderboard deployment for Christopher Zeuch (Hiccup-za).
