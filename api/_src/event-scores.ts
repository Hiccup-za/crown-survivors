import { pool } from "./db.js";
import { RATE_LIMIT_SECONDS } from "./scores.js";

// Event boards (Halloween Endless). Boards are a placeholder set until Christopher picks them.
export type EventBoard = "crowns" | "fastest" | "kills";
export const EVENT_BOARDS: EventBoard[] = ["crowns", "fastest", "kills"];

export interface EventScoreInput {
  hero: string;
  time_s: number;
  kills: number;
  crowns: number;
  rituals: number;
  first_crown_s: number | null;
}

const HERO_RE = /^[a-z0-9_-]{1,32}$/i;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export function validateEventScore(body: unknown): { ok: true; value: EventScoreInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (typeof b.hero !== "string" || !HERO_RE.test(b.hero)) return { ok: false, error: "hero must be 1-32 chars [a-z0-9_-]" };
  if (!isInt(b.time_s, 0, 86400)) return { ok: false, error: "time_s must be an integer 0-86400" };
  if (!isInt(b.kills, 0, 1_000_000)) return { ok: false, error: "kills must be an integer 0-1000000" };
  if (!isInt(b.crowns, 0, 999)) return { ok: false, error: "crowns must be an integer 0-999" };
  if (!isInt(b.rituals, 0, 9999)) return { ok: false, error: "rituals must be an integer 0-9999" };
  const first = b.first_crown_s ?? null;
  if (first !== null && !isInt(first, 0, b.time_s)) return { ok: false, error: "first_crown_s must be null or an integer 0-time_s" };
  if ((b.crowns === 0) !== (first === null)) return { ok: false, error: "first_crown_s is required exactly when crowns > 0" };
  // R4 (the Night Gourd) is every 4th ritual; a crown can land just before its ritual clears.
  if (b.crowns < Math.floor(b.rituals / 4) || b.crowns > Math.floor((b.rituals + 1) / 4))
    return { ok: false, error: "crowns do not match rituals cleared" };
  return {
    ok: true,
    value: { hero: b.hero, time_s: b.time_s, kills: b.kills, crowns: b.crowns, rituals: b.rituals, first_crown_s: first },
  };
}

/**
 * Inserts the run unless this user posted an event score in the last 30s. Returns the id, or null when rate limited.
 * The game retries runs whose post failed, so a run identical to one already stored returns that row's id instead
 * of inserting again; crowns are a running total and must not count twice.
 */
export async function insertEventScore(eventId: string, userId: string, s: EventScoreInput): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `WITH dup AS (
       SELECT id FROM event_scores
       WHERE event_id = $1 AND user_id = $2 AND hero = $3 AND time_s = $4 AND kills = $5 AND crowns = $6
         AND rituals = $7 AND first_crown_s IS NOT DISTINCT FROM $8
       LIMIT 1
     ),
     ins AS (
       INSERT INTO event_scores (event_id, user_id, hero, time_s, kills, crowns, rituals, first_crown_s)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8
       WHERE NOT EXISTS (SELECT 1 FROM dup) AND NOT EXISTS (
         SELECT 1 FROM event_scores
         WHERE user_id = $2 AND created_at > now() - make_interval(secs => $9)
       )
       RETURNING id
     )
     SELECT id FROM ins UNION ALL SELECT id FROM dup`,
    [eventId, userId, s.hero, s.time_s, s.kills, s.crowns, s.rituals, s.first_crown_s, RATE_LIMIT_SECONDS],
  );
  return rows[0]?.id ?? null;
}

// Best-run boards: which rows count, how to pick each user's best row, and the ranking order.
const BOARD_SQL: Record<Exclude<EventBoard, "crowns">, { where: string; order: string }> = {
  fastest: { where: "first_crown_s IS NOT NULL", order: "first_crown_s ASC, created_at ASC" },
  kills: { where: "true", order: "kills DESC, created_at ASC" },
};

/**
 * Crowns is a running total: every crown from every run counts. Each user's row sums their runs, shows the hero
 * of their latest crowning run (latest run if none crowned), and is dated by that run, so ties go to who got there first.
 */
const CROWNS_CTE = `
    best AS (
      SELECT s.user_id,
        (array_agg(s.hero ORDER BY s.crowns > 0 DESC, s.created_at DESC))[1] AS hero,
        sum(s.time_s)::int AS time_s, sum(s.kills)::int AS kills, sum(s.crowns)::int AS crowns,
        sum(s.rituals)::int AS rituals, min(s.first_crown_s) AS first_crown_s,
        coalesce(max(s.created_at) FILTER (WHERE s.crowns > 0), max(s.created_at)) AS created_at
      FROM event_scores s
      WHERE s.event_id = $1
      GROUP BY s.user_id
    ),
    ranked AS (
      SELECT b.*, RANK() OVER (ORDER BY crowns DESC, rituals DESC) AS rank
      FROM best b
    )`;

/** CTE yielding each user's row for the event ($1) with its rank on the board. */
function rankedCte(board: EventBoard): string {
  if (board === "crowns") return CROWNS_CTE;
  const { where, order } = BOARD_SQL[board];
  return `
    best AS (
      SELECT DISTINCT ON (s.user_id) s.*
      FROM event_scores s
      WHERE s.event_id = $1 AND ${where}
      ORDER BY s.user_id, ${order}
    ),
    ranked AS (
      SELECT b.*, RANK() OVER (ORDER BY ${order.replace(", created_at ASC", "")}) AS rank
      FROM best b
    )`;
}

export interface EventLeaderboardRow {
  rank: number;
  handle: string | null;
  name: string;
  avatar: string | null;
  hero: string;
  time_s: number;
  kills: number;
  crowns: number;
  rituals: number;
  first_crown_s: number | null;
  created_at: string;
}

const SELECT_COLS = `
  r.rank::int AS rank, u.handle, u.name, u.image AS avatar,
  r.hero, r.time_s, r.kills, r.crowns, r.rituals, r.first_crown_s, r.created_at`;

export async function getEventLeaderboard(eventId: string, board: EventBoard, limit: number): Promise<EventLeaderboardRow[]> {
  const { rows } = await pool.query<EventLeaderboardRow>(
    `WITH ${rankedCte(board)}
     SELECT ${SELECT_COLS}
     FROM ranked r JOIN "user" u ON u.id = r.user_id
     ORDER BY r.rank, r.created_at
     LIMIT $2`,
    [eventId, limit],
  );
  return rows;
}

export async function getMyEventRank(
  eventId: string,
  board: EventBoard,
  userId: string,
): Promise<{ row: EventLeaderboardRow | null; total: number }> {
  const { rows } = await pool.query<EventLeaderboardRow & { total: number }>(
    `WITH ${rankedCte(board)}
     SELECT ${SELECT_COLS}, (SELECT count(*)::int FROM ranked) AS total
     FROM ranked r JOIN "user" u ON u.id = r.user_id
     WHERE r.user_id = $2`,
    [eventId, userId],
  );
  if (rows[0]) {
    const { total, ...row } = rows[0];
    return { row, total };
  }
  const t = await pool.query<{ total: number }>(`WITH ${rankedCte(board)} SELECT count(*)::int AS total FROM ranked`, [eventId]);
  return { row: null, total: t.rows[0]?.total ?? 0 };
}
