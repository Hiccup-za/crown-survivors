# Changelog

## [0.9.0] - 2026-10-31

### Added
- A player profile: tap your name at the bottom of the title screen, or the name chip on the leaderboard and events screens, to see your avatar, name and handle, your rank and best on every Classic and Harvest Moon board, and your lifetime stats. Tap a board row to open that board.
- Guest accounts: players who don't want to sign in with X can play as a guest with a generated name, like "Mossy Knight 372", and post to every leaderboard. The option sits next to Sign in with X on the profile, the leaderboard, the new best card and the Halloween game over screen.
- A guest who later signs in with X keeps everything: their scores, Pumpkin Crowns and saved progress move to the X account, counted once.

### Changed
- Sign out moved from the title screen to the profile.

### Fixed
- Signing out now also ends the session on the server, not just on the device.
- Your own row on the leaderboard is highlighted for players without an X handle too.

## [0.8.0] - 2026-10-31

### Added
- The Harvest Moon boards have a Longest Survival tab that ranks each player's longest single Halloween run, with or without a crown.
- The admin dashboard's Players view shows all four Harvest Moon boards, and each row opens that player's profile.

## [0.7.2] - 2026-10-31

### Fixed
- A Halloween run whose post fails (offline, timeout, server error, expired sign-in or rate limit) is kept on the device and retried until it reaches the Harvest Moon boards, instead of being dropped.
- A run that earns a Pumpkin Crown while signed out is posted once the player signs in.
- The server stores a retried run only once, so its crowns never count twice.

## [0.7.1] - 2026-10-31

### Fixed
- Most Crowns on the Harvest Moon boards is now each player's total for the event, so every Pumpkin Crown counts, not just the crowns from their best run. Crowns already earned this event are included.
- The Most Crowns row shows the hero from the player's latest run that earned a crown, and a tied total goes to whoever reached it first.
- A run that earns a crown while signed out is always offered for posting after sign-in.

## [0.7.0] - 2026-10-30

### Added
- The asset viewer is now the Crown Survivors Workshop (`npm run workshop`; `npm run assets` still works), one local page with Assets, Playground, Balance and Reports tabs and a Play (debug) link that serves the game at `/play` without analytics.
- Playground: a configurable live run for testing mechanics, with the mode, hero, curse, start time, arena phase, every weapon and passive level, target dummies (type, count, layout, elite, pinned or moving, immortal or real HP), a held Classic or ritual boss phase, spawning, god mode and free move, plus live DPS, time to kill, computed stats, entity counts and frame times, and saved presets.
- Balance: every data table read from the running code, plus XP per level, Halloween tier scaling and ritual costs, each with its source line, Copy JSON, and a Download config.json for everything.
- An in-game debug menu in dev mode (backtick, or the DBG tab): god mode, time scale and frame step, time jumps, hitbox and FPS overlays, player, weapon and passive controls, spawning enemies and bosses, and Halloween shortcuts. Debug runs never reach the leaderboard, the save or telemetry.
- F8 bug reports: a screenshot, a note, recent errors and the full game state saved to `dev/reports/<id>/` with a README an agent can read, listed in the Workshop's Reports tab where they can be resolved and reopened.
- Any report can be replayed at that exact moment with `/play?report=<id>`, frozen, without touching saves, cloud sync or telemetry, and followed up with another report.

### Changed
- The asset viewer moved from `tools/asset-viewer/` to `tools/workshop/`.

## [0.6.0] - 2026-10-30

### Added
- An asset viewer for developers (`npm run assets`) that browses every hero, enemy, boss, pickup, icon and emblem, drawn by the live game code.
- Each asset's animations can be played, paused, stepped frame by frame and scrubbed, including attack tells, boss phases, hit flashes and silhouettes.
- The viewer has zoom with a phone 1:1 preset, arena backdrops, hitbox, grid and onion skin overlays, a lineup mode for comparing sizes, and PNG frame and sprite sheet export.
- Attack animations play live in a combat sandbox: every weapon at levels 1 to 5 and evolved, enemy ranged attacks, and each Classic and ritual boss attack with its tell, forced and repeated on a loop.
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
