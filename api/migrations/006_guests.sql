-- Guest accounts (Better Auth anonymous plugin): players who never signed in with X can play under a generated name
-- and still reach the leaderboards. Signing in with X later merges the guest into that account (api/_src/guests.ts).
-- Idempotent: safe to run more than once.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "isAnonymous" boolean NOT NULL DEFAULT false;

-- Guests merged into an X account. The game checks this (via /api/me) before treating its local guest save as the
-- account's, so progress is never counted twice or dropped when a merge did not happen.
CREATE TABLE IF NOT EXISTS guest_merges (
  guest_id  text PRIMARY KEY,
  user_id   text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  merged_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_merges_user_idx ON guest_merges (user_id);
