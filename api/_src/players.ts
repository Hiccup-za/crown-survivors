import { pool } from "./db.js";
import { BOARDS, type Board, getMyRank } from "./scores.js";
import { TZ } from "./admin.js";

// Admin player list and profiles (docs/telemetry.md). Read-only. A player is an X account (every device it ever
// signed in on) or, for people who never signed in, a single anonymous install.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const PLAYERS_LIMIT = 200;
export const PROFILE_RUNS = 50;

export const isInstallId = (v: string) => UUID_RE.test(v);
export const isUserId = (v: string) => USER_ID_RE.test(v);

/** Which account each install belongs to: any signed-in session or snapshot links it. */
const INSTALL_USER = `iu AS (
  SELECT install_id, max(user_id) AS user_id FROM (
    SELECT install_id, user_id FROM telemetry_sessions WHERE user_id IS NOT NULL
    UNION ALL SELECT install_id, user_id FROM player_snapshots WHERE user_id IS NOT NULL
  ) x GROUP BY install_id
)`;

/** Escapes LIKE wildcards so a search is matched literally. Exported for tests. */
export const likeEscape = (q: string) => q.replace(/[\\%_]/g, (c) => "\\" + c);

export interface PlayerRow {
  user_id: string | null;
  install_id: string | null; // set only for anonymous players
  handle: string | null;
  name: string | null;
  avatar: string | null;
  last_active: string;
  runs: number; // runs in the range
  devices: number;
  gold: number | null; // from the cloud save, else the most recent device save; null when none arrived yet
  total_runs: number | null;
  codex_items: number | null;
}

/**
 * Players active in [from, to): a session, run or leaderboard score in the range. q filters by handle, name or
 * install id prefix. Newest activity first.
 */
export async function listPlayers(from: string, to: string, q: string | null): Promise<{ rows: PlayerRow[]; truncated: boolean }> {
  const { rows } = await pool.query<PlayerRow>(
    `WITH b AS (SELECT ($1::date)::timestamp AT TIME ZONE '${TZ}' AS lo, ($2::date)::timestamp AT TIME ZONE '${TZ}' AS hi),
     ${INSTALL_USER},
     act AS (
       SELECT coalesce(s.user_id, iu.user_id) AS user_id, s.install_id, s.started_at AS at, 0 AS run
       FROM telemetry_sessions s CROSS JOIN b LEFT JOIN iu USING (install_id)
       WHERE s.started_at >= b.lo AND s.started_at < b.hi
       UNION ALL
       SELECT coalesce(r.user_id, iu.user_id), r.install_id, r.created_at, 1
       FROM telemetry_runs r CROSS JOIN b LEFT JOIN iu USING (install_id)
       WHERE r.created_at >= b.lo AND r.created_at < b.hi
       UNION ALL
       SELECT sc.user_id, NULL, sc.created_at, 0 FROM scores sc, b WHERE sc.created_at >= b.lo AND sc.created_at < b.hi
     ),
     p AS (
       SELECT user_id, CASE WHEN user_id IS NULL THEN install_id END AS install_id, max(at) AS last_active, sum(run)::int AS runs
       FROM act GROUP BY 1, 2
     )
     SELECT p.user_id, p.install_id::text, u.handle, u.name, u.image AS avatar, p.last_active, p.runs,
       CASE WHEN p.user_id IS NULL THEN 1 ELSE (SELECT count(*) FROM iu WHERE iu.user_id = p.user_id) END::int AS devices,
       snap.gold, snap.runs AS total_runs, snap.codex_items
     FROM p
     LEFT JOIN "user" u ON u.id = p.user_id
     LEFT JOIN LATERAL (
       SELECT * FROM (
         SELECT cs.gold, cs.runs, cs.codex_items, 0 AS pri, cs.updated_at AS at FROM player_saves cs WHERE cs.user_id = p.user_id
         UNION ALL
         SELECT ps.gold, ps.runs, ps.codex_items, 1, ps.last_seen FROM player_snapshots ps
         WHERE ps.install_id = p.install_id OR ps.install_id IN (SELECT install_id FROM iu WHERE iu.user_id = p.user_id)
       ) x ORDER BY pri, at DESC LIMIT 1
     ) snap ON true
     WHERE $3::text IS NULL
        OR u.handle ILIKE '%' || $3 || '%' OR u.name ILIKE '%' || $3 || '%'
        OR p.install_id::text LIKE lower($3) || '%'
     ORDER BY p.last_active DESC
     LIMIT $4`,
    [from, to, q ? likeEscape(q) : null, PLAYERS_LIMIT + 1],
  );
  return { rows: rows.slice(0, PLAYERS_LIMIT), truncated: rows.length > PLAYERS_LIMIT };
}

export interface Device {
  install_id: string;
  sessions: number;
  first_seen: string | null;
  last_seen: string | null;
  touch: boolean;
  /** Latest save from this device, null until one arrives. */
  snapshot: {
    gold: number; pumpkin_crowns: number; runs: number; wins: number; kills: number; best_s: number; max_curse: number;
    codex_items: number; codex_enemies: number; meta: Record<string, number>; chars: number[];
    wins_by: Record<string, number>; pumpkin_by: Record<string, number>;
    codex: { items: Record<string, { seen: number; taken: number }>; enemies: Record<string, { seen: number; kills: number }> };
    last_seen: string;
  } | null;
}

export interface Profile {
  kind: "user" | "install";
  user: { id: string; name: string; handle: string | null; avatar: string | null; created_at: string } | null;
  devices: Device[];
  runs: {
    total: number; wins: number; classic: number; halloween: number; crowns: number; gold_earned: number;
    recent: {
      created_at: string; mode: string; event_id: string | null; hero: string; result: string; time_s: number; kills: number;
      level: number; gold_earned: number; curse: number | null; bosses: number | null; crowns: number | null;
      night_rank: number | null; death_cause: string | null; build: Record<string, Record<string, number>>;
    }[];
  };
  /** The account's one cloud save (player_saves); null for anonymous players and accounts that never synced. */
  save: (Device["snapshot"] & { version: number; install_id: string; updated_at: string }) | null;
  /** Leaderboard standing per board; null for anonymous players. */
  boards: Record<Board, { rank: number | null; total: number; time_s: number | null; kills: number | null; curse: number | null; hero: string | null }> | null;
}

/**
 * Profile of an X account or an anonymous install. An install that has ever signed in resolves to its account,
 * so callers should follow `kind`/`user.id`. Null when nothing is known about the id.
 */
export async function getProfile(id: { user: string } | { install: string }): Promise<Profile | null> {
  let userId: string | null = "user" in id ? id.user : null;
  let installs: string[];
  if ("install" in id) {
    const { rows } = await pool.query<{ user_id: string | null }>(`WITH ${INSTALL_USER} SELECT user_id FROM iu WHERE install_id = $1`, [id.install]);
    userId = rows[0]?.user_id ?? null;
  }
  let user: Profile["user"] = null;
  if (userId) {
    const u = await pool.query<NonNullable<Profile["user"]>>(
      `SELECT id, name, handle, image AS avatar, "createdAt" AS created_at FROM "user" WHERE id = $1`,
      [userId],
    );
    user = u.rows[0] ?? null;
    if (!user) return null;
    const i = await pool.query<{ install_id: string }>(`WITH ${INSTALL_USER} SELECT install_id::text FROM iu WHERE user_id = $1`, [userId]);
    installs = i.rows.map((r) => r.install_id);
  } else {
    installs = [(id as { install: string }).install.toLowerCase()];
  }

  const [devices, runs, recent] = await Promise.all([
    pool.query<Device & { snap: Device["snapshot"] }>(
      `SELECT i.install_id,
         (SELECT count(*) FROM telemetry_sessions s WHERE s.install_id = i.install_id::uuid)::int AS sessions,
         (SELECT min(started_at) FROM telemetry_sessions s WHERE s.install_id = i.install_id::uuid) AS first_seen,
         greatest((SELECT max(last_seen) FROM telemetry_sessions s WHERE s.install_id = i.install_id::uuid), ps.last_seen) AS last_seen,
         coalesce((SELECT bool_or(touch) FROM telemetry_sessions s WHERE s.install_id = i.install_id::uuid), false) AS touch,
         CASE WHEN ps.install_id IS NULL THEN NULL ELSE jsonb_build_object(
           'gold', ps.gold, 'pumpkin_crowns', ps.pumpkin_crowns, 'runs', ps.runs, 'wins', ps.wins, 'kills', ps.kills,
           'best_s', ps.best_s, 'max_curse', ps.max_curse, 'codex_items', ps.codex_items, 'codex_enemies', ps.codex_enemies,
           'meta', ps.meta, 'chars', ps.chars, 'wins_by', ps.wins_by, 'pumpkin_by', ps.pumpkin_by, 'codex', ps.codex,
           'last_seen', ps.last_seen) END AS snap
       FROM unnest($1::text[]) AS i(install_id)
       LEFT JOIN player_snapshots ps ON ps.install_id = i.install_id::uuid
       ORDER BY last_seen DESC NULLS LAST`,
      [installs],
    ),
    pool.query<Omit<Profile["runs"], "recent">>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE result = 'win')::int AS wins,
         count(*) FILTER (WHERE mode = 'classic')::int AS classic, count(*) FILTER (WHERE mode = 'halloween')::int AS halloween,
         coalesce(sum(crowns), 0)::int AS crowns, coalesce(sum(gold_earned), 0)::int AS gold_earned
       FROM telemetry_runs WHERE install_id = ANY($1::uuid[]) OR ($2::text IS NOT NULL AND user_id = $2)`,
      [installs, userId],
    ),
    pool.query<Profile["runs"]["recent"][number]>(
      `SELECT created_at, mode, event_id, hero, result, time_s, kills, level, gold_earned, curse, bosses, crowns, night_rank, death_cause, build
       FROM telemetry_runs WHERE install_id = ANY($1::uuid[]) OR ($2::text IS NOT NULL AND user_id = $2)
       ORDER BY created_at DESC LIMIT $3`,
      [installs, userId, PROFILE_RUNS],
    ),
  ]);

  const devs: Device[] = devices.rows.map(({ snap, ...d }) => ({ ...d, snapshot: snap }));
  // An anonymous id we have never heard from.
  if (!user && devs.every((d) => !d.sessions && !d.snapshot) && runs.rows[0].total === 0) return null;

  let boards: Profile["boards"] = null;
  let save: Profile["save"] = null;
  if (user) {
    const cs = await pool.query<NonNullable<Profile["save"]>>(
      `SELECT gold, pumpkin_crowns, runs, wins, kills::float8 AS kills, best_s, max_curse, codex_items, codex_enemies, meta, chars,
         wins_by, pumpkin_by, codex, version, install_id::text, updated_at, updated_at AS last_seen
       FROM player_saves WHERE user_id = $1`,
      [user.id],
    );
    save = cs.rows[0] ?? null;
    const ranks = await Promise.all(BOARDS.map((b) => getMyRank(b, user!.id)));
    boards = Object.fromEntries(
      BOARDS.map((b, i) => {
        const { row, total } = ranks[i];
        return [b, { rank: row?.rank ?? null, total, time_s: row?.time_s ?? null, kills: row?.kills ?? null, curse: row?.curse ?? null, hero: row?.hero ?? null }];
      }),
    ) as Profile["boards"];
  }

  return { kind: user ? "user" : "install", user, devices: devs, runs: { ...runs.rows[0], recent: recent.rows }, save, boards };
}
