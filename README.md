# Crown Survivors Classic

Static **Crown Survivors Classic** plus a Hono leaderboard API (Sign in with X, Neon Postgres), deployed as one Vercel project at [crown-survivors.vercel.app](https://crown-survivors.vercel.app).

The game lives at `/` (`public/index.html`). The API is under `/api/*` with Better Auth at `/api/auth/*`. OAuth entry is `/auth/x` (same origin, first-party cookies).

## Repository layout

| Path | Purpose |
| --- | --- |
| `public/` | Static game (Classic) |
| `api/` | Leaderboard API (Vercel serverless via `api/index.ts`) |

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
| GET | `/api/health` | Health check JSON |

## Flight Games

The [Flight Games](https://hiccup-za.github.io/flight-games/) monorepo on GitHub Pages is unchanged. This repository is the standalone Classic + leaderboard deployment for Christopher Zeuch (Hiccup-za).
