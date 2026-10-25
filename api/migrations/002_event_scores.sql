-- Seasonal event leaderboards (first: halloween-2026). Kept apart from Classic `scores`
-- so event runs never touch the Classic boards. One row per submitted run, scoped by event_id.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS event_scores (
  id            bigserial PRIMARY KEY,
  event_id      text NOT NULL CHECK (event_id ~ '^[a-z0-9-]{1,40}$'),
  user_id       text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  hero          text NOT NULL CHECK (char_length(hero) BETWEEN 1 AND 32),
  time_s        integer NOT NULL CHECK (time_s BETWEEN 0 AND 86400),
  kills         integer NOT NULL CHECK (kills BETWEEN 0 AND 1000000),
  crowns        smallint NOT NULL CHECK (crowns BETWEEN 0 AND 999),
  rituals       integer NOT NULL CHECK (rituals BETWEEN 0 AND 9999),
  first_crown_s integer CHECK (first_crown_s BETWEEN 0 AND 86400),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- a crown is a Night Gourd kill: it needs a first-crown time, and R4 is every 4th ritual
  CONSTRAINT crown_time_iff_crowns CHECK ((crowns = 0) = (first_crown_s IS NULL)),
  CONSTRAINT first_crown_in_run CHECK (first_crown_s IS NULL OR first_crown_s <= time_s),
  CONSTRAINT crowns_match_rituals CHECK (crowns BETWEEN rituals / 4 AND (rituals + 1) / 4)
);
CREATE INDEX IF NOT EXISTS event_scores_user_created_idx ON event_scores (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_scores_crowns_idx ON event_scores (event_id, user_id, crowns DESC, rituals DESC, kills DESC);
CREATE INDEX IF NOT EXISTS event_scores_fastest_idx ON event_scores (event_id, user_id, first_crown_s ASC) WHERE first_crown_s IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_scores_kills_idx ON event_scores (event_id, user_id, kills DESC);
