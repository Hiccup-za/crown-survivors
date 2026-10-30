# Crown Survivors Classic

Static **Crown Survivors Classic** plus a Hono leaderboard API (Sign in with X, Neon Postgres), deployed as one Vercel project at [crown-survivors.vercel.app](https://crown-survivors.vercel.app).

The game lives at `/` (`public/index.html`). The API is under `/api/*` with Better Auth at `/api/auth/*`.

## Quick start

```bash
cd api && npm install && cd ..
cp api/.env.example api/.env   # fill in at least DATABASE_URL
npm run migrate                # idempotent schema
cd api && npx vercel dev       # game + API on one origin (usually http://localhost:3000)
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `public/` | Static game (Classic + seasonal event modes) |
| `api/` | Leaderboard API (Vercel serverless via `api/index.ts`) |
| `api/_src`, `api/_scripts`, `api/_test` | API code, CLI scripts and tests (`_` prefix keeps Vercel from deploying each file as a function) |
| `docs/` | Development guide, event notes and art rules |
| `tools/workshop/` | Workshop: local asset viewer, mechanics playground, balance tables and bug reports (`npm run workshop`) |
| `dev/` | Local bug reports from F8 (`dev/reports/`, git-ignored) |

## Documentation

- **[Development guide](docs/development.md)**: environment variables, X OAuth setup, local dev and tests, database access, deploy, API routes and seasonal events
- [Halloween event](docs/halloween-event.md): Harvest Moon build notes and balance tables
- [Sprite kit](docs/sprite-kit.md): enemy art rules
- [Telemetry](docs/telemetry.md)
- [UI spacing](docs/ui-spacing.md)
- [Remaining tasks](docs/remaining-tasks.md)
