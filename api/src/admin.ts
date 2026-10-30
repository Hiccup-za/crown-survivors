import { pool } from "./db.js";

// Admin dashboard aggregates over the telemetry tables (docs/telemetry.md). Read-only.
// public/admin.html builds its mock data in this exact shape; keep the two in sync.

/** Days are bucketed in event time (Harvest Moon dates are SAST). */
const TZ = "Africa/Johannesburg";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 120;

/** Emails (any case) allowed to sign in by magic link and read admin stats. Empty = nobody. */
export function isAdminEmail(email: string | null | undefined): boolean {
  const allowed = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email.trim().toLowerCase());
}

/** Admin = verified email in ADMIN_EMAILS (set by the magic link; X sign-ins never verify an email). */
export function isAdmin(user: { email?: string | null; emailVerified?: boolean | null }): boolean {
  return !!user.emailVerified && isAdminEmail(user.email);
}

/** from inclusive, to exclusive, both YYYY-MM-DD in TZ. */
export function parseRange(from: string | undefined, to: string | undefined): { from: string; to: string } | null {
  if (!from || !to || !DAY_RE.test(from) || !DAY_RE.test(to)) return null;
  const a = Date.parse(from + "T00:00:00Z"), b = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || (b - a) / 86_400_000 > MAX_RANGE_DAYS) return null;
  return { from, to };
}

// $1 / $2 are the range days; b.lo / b.hi are the matching instants.
const BOUNDS = `b AS (SELECT ($1::date)::timestamp AT TIME ZONE '${TZ}' AS lo, ($2::date)::timestamp AT TIME ZONE '${TZ}' AS hi)`;
const dayOf = (col: string) => `(${col} AT TIME ZONE '${TZ}')::date`;

const GOLD_BUCKETS = `CASE
  WHEN gold = 0 THEN 0 WHEN gold < 100 THEN 1 WHEN gold < 500 THEN 2 WHEN gold < 1000 THEN 3
  WHEN gold < 2500 THEN 4 WHEN gold < 5000 THEN 5 WHEN gold < 10000 THEN 6 ELSE 7 END`;
const GOLD_LABELS = ["0", "1-99", "100-499", "500-999", "1K-2.5K", "2.5K-5K", "5K-10K", "10K+"];

export interface AdminStats {
  range: { from: string; to: string; tz: string };
  generated_at: string;
  kpis: {
    players: number; new_players: number; sessions: number; avg_session_s: number; runs: number;
    halloween_runs: number; crowns_earned: number; touch_share: number; signed_in_share: number;
  };
  daily: { day: string; players: number; new_players: number; sessions: number; runs_classic: number; runs_halloween: number; crowns: number }[];
  deaths: { cause: string; n: number }[];
  heroes: { hero: string; runs: number; wins: number; crowns: number }[];
  progression: {
    players: number; gold_total: number; gold_median: number; crowns_held: number; crown_holders: number;
    avg_codex_items: number; avg_codex_enemies: number; avg_heroes: number;
    gold_buckets: { label: string; n: number }[];
    codex_buckets: { label: string; n: number }[];
    upgrades: { upgrade: string; level: number; n: number }[];
  };
  funnel: { stage: string; n: number }[];
}

export async function getAdminStats(from: string, to: string): Promise<AdminStats> {
  const p = [from, to];
  const [kpis, daily, deaths, heroes, prog, gold, codex, upgrades, funnel] = await Promise.all([
    pool.query(
      `WITH ${BOUNDS},
       s AS (SELECT t.* FROM telemetry_sessions t, b WHERE t.started_at >= b.lo AND t.started_at < b.hi),
       r AS (SELECT t.* FROM telemetry_runs t, b WHERE t.created_at >= b.lo AND t.created_at < b.hi),
       firsts AS (SELECT install_id, min(started_at) AS at FROM telemetry_sessions GROUP BY install_id)
       SELECT
         (SELECT count(DISTINCT install_id) FROM s)::int AS players,
         (SELECT count(*) FROM firsts, b WHERE at >= b.lo AND at < b.hi)::int AS new_players,
         (SELECT count(*) FROM s)::int AS sessions,
         -- single-ping sessions are bounces with no length; leave them out of the average
         coalesce((SELECT avg(extract(epoch FROM last_seen - started_at)) FROM s WHERE last_seen > started_at), 0)::float AS avg_session_s,
         (SELECT count(*) FROM r)::int AS runs,
         (SELECT count(*) FROM r WHERE mode = 'halloween')::int AS halloween_runs,
         (SELECT coalesce(sum(crowns), 0) FROM r)::int AS crowns_earned,
         coalesce((SELECT avg(touch::int) FROM s), 0)::float AS touch_share,
         coalesce((SELECT count(DISTINCT install_id) FILTER (WHERE user_id IS NOT NULL)::float / nullif(count(DISTINCT install_id), 0) FROM s), 0)::float AS signed_in_share`,
      p,
    ),
    pool.query(
      `WITH ${BOUNDS},
       days AS (SELECT generate_series($1::date, $2::date - 1, interval '1 day')::date AS day),
       s AS (SELECT ${dayOf("t.started_at")} AS day, t.install_id FROM telemetry_sessions t, b WHERE t.started_at >= b.lo AND t.started_at < b.hi),
       f AS (SELECT ${dayOf("min(started_at)")} AS day FROM telemetry_sessions GROUP BY install_id),
       r AS (SELECT ${dayOf("t.created_at")} AS day, t.mode, t.crowns FROM telemetry_runs t, b WHERE t.created_at >= b.lo AND t.created_at < b.hi)
       SELECT d.day::text AS day,
         (SELECT count(DISTINCT install_id) FROM s WHERE s.day = d.day)::int AS players,
         (SELECT count(*) FROM f WHERE f.day = d.day)::int AS new_players,
         (SELECT count(*) FROM s WHERE s.day = d.day)::int AS sessions,
         (SELECT count(*) FROM r WHERE r.day = d.day AND mode = 'classic')::int AS runs_classic,
         (SELECT count(*) FROM r WHERE r.day = d.day AND mode = 'halloween')::int AS runs_halloween,
         (SELECT coalesce(sum(crowns), 0) FROM r WHERE r.day = d.day)::int AS crowns
       FROM days d ORDER BY d.day`,
      p,
    ),
    pool.query(
      `WITH ${BOUNDS}
       SELECT coalesce(death_cause, 'other') AS cause, count(*)::int AS n
       FROM telemetry_runs t, b
       WHERE t.created_at >= b.lo AND t.created_at < b.hi AND mode = 'halloween' AND result = 'death'
       GROUP BY 1 ORDER BY 2 DESC`,
      p,
    ),
    pool.query(
      `WITH ${BOUNDS}
       SELECT hero, count(*)::int AS runs, count(*) FILTER (WHERE result = 'win')::int AS wins, coalesce(sum(crowns), 0)::int AS crowns
       FROM telemetry_runs t, b WHERE t.created_at >= b.lo AND t.created_at < b.hi
       GROUP BY hero ORDER BY runs DESC`,
      p,
    ),
    // Progression is each install's latest save, for installs active in the range.
    pool.query(
      `WITH ${BOUNDS}, a AS (SELECT p.* FROM player_snapshots p, b WHERE p.last_seen >= b.lo AND p.first_seen < b.hi)
       SELECT count(*)::int AS players, coalesce(sum(gold), 0)::float AS gold_total,
         coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY gold), 0)::float AS gold_median,
         coalesce(sum(pumpkin_crowns), 0)::int AS crowns_held, count(*) FILTER (WHERE pumpkin_crowns > 0)::int AS crown_holders,
         coalesce(avg(codex_items), 0)::float AS avg_codex_items, coalesce(avg(codex_enemies), 0)::float AS avg_codex_enemies,
         coalesce(avg(jsonb_array_length(chars)), 0)::float AS avg_heroes
       FROM a`,
      p,
    ),
    pool.query(
      `WITH ${BOUNDS}, a AS (SELECT p.* FROM player_snapshots p, b WHERE p.last_seen >= b.lo AND p.first_seen < b.hi)
       SELECT ${GOLD_BUCKETS} AS i, count(*)::int AS n FROM a GROUP BY 1`,
      p,
    ),
    pool.query(
      `WITH ${BOUNDS}, a AS (SELECT p.* FROM player_snapshots p, b WHERE p.last_seen >= b.lo AND p.first_seen < b.hi)
       SELECT least(codex_items / 10, 5) AS i, count(*)::int AS n FROM a GROUP BY 1`,
      p,
    ),
    pool.query(
      `WITH ${BOUNDS}, a AS (SELECT p.* FROM player_snapshots p, b WHERE p.last_seen >= b.lo AND p.first_seen < b.hi)
       SELECT m.key AS upgrade, m.value::int AS level, count(*)::int AS n
       FROM a, jsonb_each_text(a.meta) m WHERE m.value ~ '^[0-9]+$'
       GROUP BY 1, 2 ORDER BY 1, 2`,
      p,
    ),
    pool.query(
      `WITH ${BOUNDS},
       s AS (SELECT DISTINCT t.install_id FROM telemetry_sessions t, b WHERE t.started_at >= b.lo AND t.started_at < b.hi),
       h AS (SELECT install_id, max(rituals) AS rituals, sum(crowns) AS crowns
             FROM telemetry_runs t, b WHERE t.created_at >= b.lo AND t.created_at < b.hi AND mode = 'halloween' GROUP BY install_id)
       SELECT (SELECT count(*) FROM s)::int AS visited, (SELECT count(*) FROM h)::int AS played,
         (SELECT count(*) FROM h WHERE rituals >= 1)::int AS ritual, (SELECT count(*) FROM h WHERE crowns >= 1)::int AS crowned,
         (SELECT count(*) FROM h WHERE crowns >= 3)::int AS crowned3`,
      p,
    ),
  ]);

  const goldN = new Map(gold.rows.map((r) => [Number(r.i), r.n as number]));
  const codexN = new Map(codex.rows.map((r) => [Number(r.i), r.n as number]));
  const f = funnel.rows[0];
  return {
    range: { from, to, tz: TZ },
    generated_at: new Date().toISOString(),
    kpis: kpis.rows[0],
    daily: daily.rows,
    deaths: deaths.rows,
    heroes: heroes.rows,
    progression: {
      ...prog.rows[0],
      gold_buckets: GOLD_LABELS.map((label, i) => ({ label, n: goldN.get(i) ?? 0 })),
      codex_buckets: ["0-9", "10-19", "20-29", "30-39", "40-49", "50+"].map((label, i) => ({ label, n: codexN.get(i) ?? 0 })),
      upgrades: upgrades.rows,
    },
    funnel: [
      { stage: "Played the game", n: f.visited },
      { stage: "Played Halloween Endless", n: f.played },
      { stage: "Cleared a ritual", n: f.ritual },
      { stage: "Earned a Pumpkin Crown", n: f.crowned },
      { stage: "Earned 3+ crowns", n: f.crowned3 },
    ],
  };
}
