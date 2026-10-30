# Remaining tasks

Status as of 2026-10-30, after admin player profiles shipped (#13).

## 1. Cloud save and device sync (built on `feature/cloud-save`, PR #14; migration 005 applied to production 2026-10-30)

Fixes the reported "no device sync" issue: progress lives only in each browser's localStorage (`crownsurv_classic_v1`).
Applies to players signed in with X. Players who never sign in keep local-only saves per device.

Ground rules (decided):
- No progress reset, ever. The leaderboard and existing saves stay.
- Saves already on several devices are merged; nobody loses progress.
- Progress belongs to the account it was earned on. Switching accounts never moves progress between accounts.
- Offline play syncs: progress made offline, or while signed out on a linked device, is merged into its account later.
- Unsynced progress never expires. (The browser itself can still delete it: cleared site data, or Safari's 7-day limit for sites not visited.)
- Syncing is invisible to the player: no indicator, no toasts.
- Merged saves never touch the leaderboard. Scores come only from submitted runs (`scores`).

What syncs: every save field, plus the leaderboard cache (`LBS.best`, `LBS.ranks`). Not synced: the login token, the
device install id and a pending score waiting for sign-in (`LBS.pend`), because they belong to the device or the session.

Tasks:
- [x] Migration `api/migrations/005_player_saves.sql` (002 is taken by `feature/halloween-event`, already applied to production)
  - `player_saves`: one row per user, real columns in the `player_snapshots` format (`best_s`, `max_curse`, `wins_by`, `pumpkin_by`, `codex`, ...)
    plus `char`, `curse`, `tut`, `muted`, `gore`, `last_event`, `lb_best`, `lb_ranks`; `version`; `install_id` of the device that last wrote it
  - `player_save_devices`: per user and device, the last save pushed and the version it was based on (makes pushes safe to repeat)
  - `save_limits`: per-user rate limit windows
- [x] `GET /api/save` returns `{ save, version }` for the signed-in user
- [x] `PUT /api/save` with `{ install_id, save, base, base_version }`: the server merges the push onto the cloud save and returns the result
  - Save validator built on `validateSnapshot` from `api/_src/telemetry.ts` (exported), with the extra fields
  - Per-user rate limit: 120 pushes per 10 minutes, `429` over it (the client keeps its changes and retries later)
- [x] Merge function as its own module (`api/_src/save.ts`), with thorough unit tests (the risky part)
  - Three-way: each push adds only what changed since the device's last sync (`cloud + (device - base)`).
    A device that was never linked has an empty base, so its whole save is added once.
  - Runs, wins, kills, `winsBy`, Pumpkin Crowns, `pumpkinBy`, codex counts: three-way add
  - Upgrades (`meta`): highest level per upgrade
  - Heroes (`chars`): union
  - Codex seen, tutorial seen: seen anywhere
  - Best time, max curse, leaderboard bests: highest (fastest board: higher curse, then lower time)
  - Gold, by total wealth: `wealth = gold + cost of upgrades bought + cost of heroes unlocked`
    - Upgrade level n costs `base * n` (META in `public/index.html`), so level L cost `base * L(L+1)/2` in total; heroes have fixed prices (CH `p`)
    - Merged gold = `cloud wealth + (device wealth - base wealth) - cost of merged upgrades and heroes`, never below 0 (duplicate purchases come back as gold)
  - Selected hero, curse, sound, gore, last event, leaderboard ranks: the device's value if it changed it since its base, else the cloud's
  - A push whose response was lost is safe to repeat: the server uses that device's last push as the base
- [x] Game client (`public/index.html`)
  - Push after `save()` with a 2 second debounce, plus at run end and when the tab is hidden; retry when back online
  - On boot and sign-in: sync, and apply the cloud save in place when it arrives
  - Keep the last-synced save locally as the merge base, and which account the local save belongs to (its owner)
  - First sign-in on a device that was never linked: the local save is merged in once
  - Signing in to a different account than the owner: unsynced progress is set aside for the owner, merged the next time
    the owner signs in on this device; the new account loads its own cloud save (or its set-aside progress)
  - Sign-out: keep the local save and its owner, stop syncing until the owner signs in again
- [x] Integration tests for the save endpoints (`api/_test/integration.test.ts`)
- [x] Admin profiles read `player_saves` as the player's one save; per-device `player_snapshots` stay as history
- [x] When `feature/halloween-event` is rebased: its client must send `pumpkinCrowns`, `pumpkinBy` and `lastEvent` (the table and merge already handle them)
  - Rebased 2026-10-30. Main's cloud-save client already sent the three fields; the branch adds them to `DEF`, so Halloween progress now syncs

## 2. Open decisions

- [ ] Player-facing profile: own profile only (`GET /api/me/profile` + an in-game screen) or public profiles opened from the leaderboard? Build after cloud save.
- [ ] If a Pumpkin Crown shop is added later: crowns would then need to merge by wealth, like gold.

## 3. Separate projects

- [ ] Flagging and anti-cheat
  - Plausibility caps on scores (minimum win time, maximum kill rate) and on saves (upgrade and hero limits)
  - Cross-checks: a leaderboard score with no matching telemetry run; gold jumps larger than recorded `gold_earned`
  - Flags on admin profiles, plus admin actions to hide a score or reset a player
  - Open: cap values, and what "reset a player" means given the no-progress-reset rule
- [ ] Heartbeat telemetry (only if true session length is wanted)
  - Periodic ping while the tab is visible, so menu time counts
  - Needs a new rate-limit budget in `api/_src/telemetry.ts`

## 4. Small leftovers

- [ ] Overview "Avg session" note says "bounces left out", which is misleading. Change it to "sessions with a run or save change" (`public/admin.html`)
- [ ] Document the Players tab, profiles and `/api/admin/players*`, `/api/admin/leaderboard` in `docs/telemetry.md`
- [ ] Merge `feature/halloween-event` after cloud save (rebased 2026-10-30, ready for review): its `002_event_scores.sql` is already applied to production but not in `main`
