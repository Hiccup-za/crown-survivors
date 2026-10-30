-- First-party telemetry: anonymous per-install progression, sessions and runs (docs/telemetry.md).
-- Never feeds leaderboards. install_id is a random UUID the game keeps in localStorage; user_id is set
-- only when the player is signed in with X. Idempotent: safe to run more than once.

-- One row per page load. last_seen moves on every ping, so last_seen - started_at ~ session length.
CREATE TABLE IF NOT EXISTS telemetry_sessions (
  session_id uuid PRIMARY KEY,
  install_id uuid NOT NULL,
  user_id    text REFERENCES "user"("id") ON DELETE SET NULL,
  touch      boolean NOT NULL DEFAULT false,
  runs       integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telemetry_sessions_started_idx ON telemetry_sessions (started_at);
CREATE INDEX IF NOT EXISTS telemetry_sessions_install_idx ON telemetry_sessions (install_id);

-- One row per finished run, from every player. Classic fills curse/bosses; Halloween fills event_id..embers.
CREATE TABLE IF NOT EXISTS telemetry_runs (
  id          bigserial PRIMARY KEY,
  install_id  uuid NOT NULL,
  session_id  uuid NOT NULL,
  user_id     text REFERENCES "user"("id") ON DELETE SET NULL,
  mode        text NOT NULL CHECK (mode IN ('classic', 'halloween')),
  event_id    text CHECK (event_id ~ '^[a-z0-9-]{1,40}$'),
  hero        text NOT NULL CHECK (char_length(hero) BETWEEN 1 AND 32),
  result      text NOT NULL CHECK (result IN ('win', 'death', 'quit')),
  time_s      integer NOT NULL CHECK (time_s BETWEEN 0 AND 86400),
  kills       integer NOT NULL CHECK (kills BETWEEN 0 AND 1000000),
  level       smallint NOT NULL CHECK (level BETWEEN 1 AND 999),
  gold_earned integer NOT NULL CHECK (gold_earned BETWEEN 0 AND 10000000),
  curse       smallint CHECK (curse BETWEEN 0 AND 5),
  bosses      smallint CHECK (bosses BETWEEN 0 AND 5),
  crowns      smallint CHECK (crowns BETWEEN 0 AND 999),
  rituals     integer CHECK (rituals BETWEEN 0 AND 9999),
  night_rank  smallint CHECK (night_rank BETWEEN 1 AND 999),
  embers      integer CHECK (embers BETWEEN 0 AND 10000000),
  death_cause text CHECK (death_cause ~ '^[a-z_]{1,24}$'),
  build       jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telemetry_runs_created_idx ON telemetry_runs (created_at);
CREATE INDEX IF NOT EXISTS telemetry_runs_install_idx ON telemetry_runs (install_id, created_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_runs_event_idx ON telemetry_runs (event_id, created_at) WHERE event_id IS NOT NULL;

-- Latest saved progression per install (upserted on every ping). Mirrors the game's S save object.
CREATE TABLE IF NOT EXISTS player_snapshots (
  install_id     uuid PRIMARY KEY,
  user_id        text REFERENCES "user"("id") ON DELETE SET NULL,
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
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_snapshots_last_seen_idx ON player_snapshots (last_seen);
