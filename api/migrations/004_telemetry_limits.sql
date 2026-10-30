-- Per-IP rate limits for POST /api/t (docs/telemetry.md). ip_hash is sha256(secret + UTC day + IP),
-- so no IP is stored and hashes stop matching at midnight UTC. Rows older than a day or two are pruned
-- by the API itself. Idempotent: safe to run more than once.

-- Requests per IP per 10-minute window.
CREATE TABLE IF NOT EXISTS telemetry_limits (
  ip_hash      text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_start)
);

-- Installs first seen from each IP today (installs we already know are never counted).
CREATE TABLE IF NOT EXISTS telemetry_ip_installs (
  ip_hash    text NOT NULL,
  install_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip_hash, install_id)
);
CREATE INDEX IF NOT EXISTS telemetry_ip_installs_created_idx ON telemetry_ip_installs (created_at);
