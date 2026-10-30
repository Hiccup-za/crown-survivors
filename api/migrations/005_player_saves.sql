-- Cloud save for signed-in players (docs/remaining-tasks.md, section 1). One merged save per X account, in the
-- player_snapshots format so it can be audited the same way. Idempotent: safe to run more than once.

-- The account's one save. version counts writes; install_id is the device that last changed it.
CREATE TABLE IF NOT EXISTS player_saves (
  user_id        text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  version        integer NOT NULL DEFAULT 1,
  install_id     uuid NOT NULL,
  gold           integer NOT NULL,
  pumpkin_crowns integer NOT NULL,
  runs           integer NOT NULL,
  wins           integer NOT NULL,
  kills          bigint NOT NULL,
  best_s         integer NOT NULL,
  max_curse      smallint NOT NULL,
  codex_items    integer NOT NULL,    -- codex entries seen (weapons, passives, items, evolutions)
  codex_enemies  integer NOT NULL,    -- enemies and bosses seen
  meta           jsonb NOT NULL,      -- shop upgrade levels {might, hp, ...}
  chars          jsonb NOT NULL,      -- unlocked hero indexes
  wins_by        jsonb NOT NULL,
  pumpkin_by     jsonb NOT NULL,
  codex          jsonb NOT NULL,      -- full {items, enemies} records
  char           smallint NOT NULL,   -- selected hero
  curse          smallint NOT NULL,   -- selected curse level
  tut            boolean NOT NULL,
  muted          boolean NOT NULL,
  gore           boolean NOT NULL,
  last_event     text,
  lb_best        jsonb NOT NULL,      -- leaderboard bests cache {f: [curse, time_s] | null, s, k}
  lb_ranks       jsonb NOT NULL,      -- leaderboard ranks cache {fastest, survival, kills}
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Each device's last push and the version it was based on. A repeated push (lost response) is merged against
-- the device's previous push instead of its stale base, so nothing is counted twice.
CREATE TABLE IF NOT EXISTS player_save_devices (
  user_id      text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  install_id   uuid NOT NULL,
  base_version integer,             -- null: the device had never synced
  sent         jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, install_id)
);

-- Pushes per user per 10-minute window. Pruned by the API itself.
CREATE TABLE IF NOT EXISTS save_limits (
  user_id      text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, window_start)
);
