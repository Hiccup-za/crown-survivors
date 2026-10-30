# Changelog

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
