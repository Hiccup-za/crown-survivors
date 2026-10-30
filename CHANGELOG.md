# Changelog

## [0.6.0] - 2026-10-30

### Added
- An asset viewer for developers (`npm run assets`) that browses every hero, enemy, boss, pickup, icon and emblem, drawn by the live game code.
- Each asset's animations can be played, paused, stepped frame by frame and scrubbed, including attack tells, boss phases, hit flashes and silhouettes.
- The viewer has zoom with a phone 1:1 preset, arena backdrops, hitbox, grid and onion skin overlays, a lineup mode for comparing sizes, and PNG frame and sprite sheet export.
- The viewer reloads by itself when `public/index.html` changes, runs offline without touching saves, and is never deployed.

## [0.5.0] - 2026-10-30

### Added
- The admin dashboard has 24, 48 and 72 hour ranges that roll with the clock and chart players and runs per hour.
- The Players tab follows the same hour ranges, listing everyone active in the last 24, 48 or 72 hours.
- The admin stats and players endpoints accept `?hours=N` (1 to 168) for a rolling window bucketed by hour.

## [0.4.2] - 2026-10-30

### Changed
- The README is now a short overview with a quick start, and the full setup, deploy, API and event details live in a new development guide under `docs/`.

### Removed
- The Flight Games section from the README.

## [0.4.1] - 2026-10-30

### Fixed
- Cloud save now syncs in production: save uploads were rejected before reaching the server, so no account had synced yet.

## [0.4.0] - 2026-10-30

### Added
- Cloud save: players signed in with X keep one save across all their devices, including gold, upgrades, heroes, codex, stats, settings and leaderboard bests.
- Saves already on several devices are merged on first sign-in, so nobody loses progress, and duplicate purchases come back as gold.
- Progress made offline or while signed out syncs to its account later, and progress from another account on the same device is kept aside until that account signs in again.
- Admin player profiles open on the account's cloud save, with each device's last upload still available as history.
- A guide to the browser end-to-end harness used to test cloud save, for turning it into an official test.

### Changed
- The admin player list shows an account's cloud save numbers when it has one.

## [0.3.0] - 2026-10-30

### Added
- A Players tab on /admin lists everyone who played in the chosen range or on a single day, with search by X handle, name or device id.
- The Players tab shows the all-time leaderboard, and every row opens that player's profile.
- Player profiles show gold, shop upgrades, unlocked heroes, codex, leaderboard ranks and recent runs, for X accounts and for players who never signed in.
- Accounts that played on more than one device show each device's save separately until cloud save ships.

### Changed
- The /admin dashboard now fills wide screens, lays charts out in as many columns as fit, and works on phones and touch screens.

## [0.2.0] - 2026-10-30

### Changed
- The /admin page shows only a sign-in card when you are signed out, headed "Sign in" with no extra copy.
- Sending a sign-in link now confirms with "Sent".

### Removed
- The Mock data toggle, "View mock data" buttons and `?mock=1` option on the /admin dashboard.
