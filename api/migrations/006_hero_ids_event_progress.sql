-- Stable hero ids and per-event progress (docs/architecture-proposal.md, Phase 0). Additive only: nothing is dropped
-- or rewritten, so the API from before keeps working on top of it. Idempotent: safe to run more than once.
--
-- heroes    unlocked hero ids                     (was chars: CH indexes)
-- hero      selected hero id                      (was char)
-- hero_wins Classic wins per hero id              (was wins_by, keyed by index)
-- events    {event_id: {currency, by: {hero: n}}} (was pumpkin_crowns / pumpkin_by, Harvest Moon only)
--
-- The old columns stay and the API keeps writing them as an exact copy for every hero below, until nothing reads them.
-- The index -> id map is LEGACY_HEROES in api/_src/heroes.ts: frozen, never reordered.

ALTER TABLE player_saves
  ADD COLUMN IF NOT EXISTS heroes    jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS hero      text CHECK (hero ~ '^[a-z0-9_-]{1,32}$'),
  ADD COLUMN IF NOT EXISTS hero_wins jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS events    jsonb NOT NULL DEFAULT '{}';

ALTER TABLE player_snapshots
  ADD COLUMN IF NOT EXISTS heroes    jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS hero_wins jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS events    jsonb NOT NULL DEFAULT '{}';

-- Backfill rows the new API has not written yet (heroes still '[]'; every save has at least King Cube). The API also
-- reads the old columns and takes the higher value, so rows an older deployment writes after this stay correct.
WITH legacy_heroes (i, id) AS (VALUES ('0', 'king-cube'), ('1', 'ruby-knight'), ('2', 'mint-mage'), ('3', 'shadow-rogue'), ('4', 'pumpkin-prince'))
UPDATE player_saves p SET
  heroes    = coalesce((SELECT jsonb_agg(DISTINCT h.id ORDER BY h.id) FROM jsonb_array_elements(p.chars) c JOIN legacy_heroes h ON h.i = c::text), '[]'),
  hero      = (SELECT h.id FROM legacy_heroes h WHERE h.i = p.char::text),
  hero_wins = coalesce((SELECT jsonb_object_agg(h.id, w.value) FROM jsonb_each(p.wins_by) w JOIN legacy_heroes h ON h.i = w.key), '{}'),
  events    = CASE WHEN p.pumpkin_crowns > 0 OR p.pumpkin_by <> '{}' THEN jsonb_build_object('harvest-2026', jsonb_build_object(
                'currency', p.pumpkin_crowns,
                'by', coalesce((SELECT jsonb_object_agg(h.id, b.value) FROM jsonb_each(p.pumpkin_by) b JOIN legacy_heroes h ON h.i = b.key), '{}')))
              ELSE '{}' END
WHERE p.heroes = '[]';

WITH legacy_heroes (i, id) AS (VALUES ('0', 'king-cube'), ('1', 'ruby-knight'), ('2', 'mint-mage'), ('3', 'shadow-rogue'), ('4', 'pumpkin-prince'))
UPDATE player_snapshots p SET
  heroes    = coalesce((SELECT jsonb_agg(DISTINCT h.id ORDER BY h.id) FROM jsonb_array_elements(p.chars) c JOIN legacy_heroes h ON h.i = c::text), '[]'),
  hero_wins = coalesce((SELECT jsonb_object_agg(h.id, w.value) FROM jsonb_each(p.wins_by) w JOIN legacy_heroes h ON h.i = w.key), '{}'),
  events    = CASE WHEN p.pumpkin_crowns > 0 OR p.pumpkin_by <> '{}' THEN jsonb_build_object('harvest-2026', jsonb_build_object(
                'currency', p.pumpkin_crowns,
                'by', coalesce((SELECT jsonb_object_agg(h.id, b.value) FROM jsonb_each(p.pumpkin_by) b JOIN legacy_heroes h ON h.i = b.key), '{}')))
              ELSE '{}' END
WHERE p.heroes = '[]';
