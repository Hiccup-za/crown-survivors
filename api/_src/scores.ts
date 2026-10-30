import { pool } from "./db.js";

export type Board = "fastest" | "survival" | "kills";
export const BOARDS: Board[] = ["fastest", "survival", "kills"];

export interface ScoreInput {
  hero: string;
  curse: number;
  won: boolean;
  time_s: number;
  kills: number;
  bosses: number;
}

const HERO_RE = /^[a-z0-9_-]{1,32}$/i;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export function validateScore(body: unknown): { ok: true; value: ScoreInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (typeof b.hero !== "string" || !HERO_RE.test(b.hero)) return { ok: false, error: "hero must be 1-32 chars [a-z0-9_-]" };
  if (!isInt(b.curse, 0, 5)) return { ok: false, error: "curse must be an integer 0-5" };
  if (typeof b.won !== "boolean") return { ok: false, error: "won must be a boolean" };
  if (!isInt(b.time_s, 0, 1200)) return { ok: false, error: "time_s must be an integer 0-1200" };
  if (!isInt(b.kills, 0, 50000)) return { ok: false, error: "kills must be an integer 0-50000" };
  if (!isInt(b.bosses, 0, 5)) return { ok: false, error: "bosses must be an integer 0-5" };
  if (b.won && b.bosses !== 5) return { ok: false, error: "a win requires bosses = 5" };
  return {
    ok: true,
    value: { hero: b.hero, curse: b.curse, won: b.won, time_s: b.time_s, kills: b.kills, bosses: b.bosses },
  };
}

export const RATE_LIMIT_SECONDS = 30;

/**
 * Inserts the score unless this user submitted within the last 30s.
 * Done in one statement so it is safe across serverless instances.
 * Returns the new row id, or null when rate limited.
 */
export async function insertScore(userId: string, s: ScoreInput): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scores (user_id, hero, curse, won, time_s, kills, bosses)
     SELECT $1, $2, $3, $4, $5, $6, $7
     WHERE NOT EXISTS (
       SELECT 1 FROM scores
       WHERE user_id = $1 AND created_at > now() - make_interval(secs => $8)
     )
     RETURNING id`,
    [userId, s.hero, s.curse, s.won, s.time_s, s.kills, s.bosses, RATE_LIMIT_SECONDS],
  );
  return rows[0]?.id ?? null;
}

// Per board: which rows count, how to pick each user's best row, and the ranking order.
const BOARD_SQL: Record<Board, { where: string; order: string }> = {
  fastest: { where: "won = true", order: "curse DESC, time_s ASC, created_at ASC" },
  survival: { where: "true", order: "time_s DESC, created_at ASC" },
  kills: { where: "true", order: "kills DESC, created_at ASC" },
};

/** CTE yielding each user's single best row with its rank on the board. */
function rankedCte(board: Board): string {
  const { where, order } = BOARD_SQL[board];
  return `
    best AS (
      SELECT DISTINCT ON (s.user_id) s.*
      FROM scores s
      WHERE ${where}
      ORDER BY s.user_id, ${order}
    ),
    ranked AS (
      SELECT b.*, RANK() OVER (ORDER BY ${order.replace(", created_at ASC", "")}) AS rank
      FROM best b
    )`;
}

export interface LeaderboardRow {
  rank: number;
  handle: string | null;
  name: string;
  avatar: string | null;
  hero: string;
  curse: number;
  won: boolean;
  time_s: number;
  kills: number;
  bosses: number;
  created_at: string;
}

const SELECT_COLS = `
  r.rank::int AS rank, u.handle, u.name, u.image AS avatar,
  r.hero, r.curse, r.won, r.time_s, r.kills, r.bosses, r.created_at`;

/** withUserId adds user_id for the admin dashboard; the public board never exposes it. */
export async function getLeaderboard(board: Board, limit: number, withUserId = false): Promise<(LeaderboardRow & { user_id?: string })[]> {
  const { rows } = await pool.query<LeaderboardRow & { user_id?: string }>(
    `WITH ${rankedCte(board)}
     SELECT ${SELECT_COLS}${withUserId ? ", r.user_id" : ""}
     FROM ranked r JOIN "user" u ON u.id = r.user_id
     ORDER BY r.rank, r.created_at
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function getMyRank(
  board: Board,
  userId: string,
): Promise<{ row: LeaderboardRow | null; total: number }> {
  const { rows } = await pool.query<LeaderboardRow & { total: number }>(
    `WITH ${rankedCte(board)}
     SELECT ${SELECT_COLS}, (SELECT count(*)::int FROM ranked) AS total
     FROM ranked r JOIN "user" u ON u.id = r.user_id
     WHERE r.user_id = $1`,
    [userId],
  );
  if (rows[0]) {
    const { total, ...row } = rows[0];
    return { row, total };
  }
  const t = await pool.query<{ total: number }>(`WITH ${rankedCte(board)} SELECT count(*)::int AS total FROM ranked`);
  return { row: null, total: t.rows[0]?.total ?? 0 };
}
