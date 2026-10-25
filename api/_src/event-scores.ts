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

/** Inserts the run unless this user posted an event score in the last 30s. Returns the id, or null when rate limited. */
export async function insertEventScore(eventId: string, userId: string, s: EventScoreInput): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO event_scores (event_id, user_id, hero, time_s, kills, crowns, rituals, first_crown_s)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8
     WHERE NOT EXISTS (
       SELECT 1 FROM event_scores
       WHERE user_id = $2 AND created_at > now() - make_interval(secs => $9)
     )
     RETURNING id`,
    [eventId, userId, s.hero, s.time_s, s.kills, s.crowns, s.rituals, s.first_crown_s, RATE_LIMIT_SECONDS],
  );
  return rows[0]?.id ?? null;
}

// Per board: which rows count, how to pick each user's best row, and the ranking order.
const BOARD_SQL: Record<EventBoard, { where: string; order: string }> = {
  crowns: { where: "true", order: "crowns DESC, rituals DESC, kills DESC, created_at ASC" },
  fastest: { where: "first_crown_s IS NOT NULL", order: "first_crown_s ASC, created_at ASC" },
  kills: { where: "true", order: "kills DESC, created_at ASC" },
};

/** CTE yielding each user's single best row for the event ($1) with its rank on the board. */
function rankedCte(board: EventBoard): string {
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
