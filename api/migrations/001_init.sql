-- Crown Survivors Classic leaderboard: Better Auth core tables (+ handle) and scores.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS "user" (
  "id"            text PRIMARY KEY,
  "name"          text NOT NULL,
  "email"         text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image"         text,
  "handle"        text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  "id"        text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token"     text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId"    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session"("userId");

CREATE TABLE IF NOT EXISTS "account" (
  "id"                    text PRIMARY KEY,
  "accountId"             text NOT NULL,
  "providerId"            text NOT NULL,
  "userId"                text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope"                 text,
  "password"              text,
  "createdAt"             timestamptz NOT NULL DEFAULT now(),
  "updatedAt"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON "account"("userId");

CREATE TABLE IF NOT EXISTS "verification" (
  "id"         text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value"      text NOT NULL,
  "expiresAt"  timestamptz NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification"("identifier");

CREATE TABLE IF NOT EXISTS scores (
  id         bigserial PRIMARY KEY,
  user_id    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  hero       text NOT NULL CHECK (char_length(hero) BETWEEN 1 AND 32),
  curse      smallint NOT NULL CHECK (curse BETWEEN 0 AND 5),
  won        boolean NOT NULL,
  time_s     integer NOT NULL CHECK (time_s BETWEEN 0 AND 1200),
  kills      integer NOT NULL CHECK (kills BETWEEN 0 AND 50000),
  bosses     smallint NOT NULL CHECK (bosses BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT won_requires_all_bosses CHECK (NOT won OR bosses = 5)
);
CREATE INDEX IF NOT EXISTS scores_user_created_idx ON scores (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scores_fastest_idx ON scores (user_id, curse DESC, time_s ASC) WHERE won;
CREATE INDEX IF NOT EXISTS scores_survival_idx ON scores (user_id, time_s DESC);
CREATE INDEX IF NOT EXISTS scores_kills_idx ON scores (user_id, kills DESC);
