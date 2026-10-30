import { createHash } from "node:crypto";
import type pg from "pg";
import { pool } from "./db.js";

// First-party telemetry (docs/telemetry.md). One POST carries the session ping, the latest save
// snapshot and, at run end, the finished run. Data only for our dashboards; never feeds leaderboards.

export const TELEMETRY_MAX_BYTES = 32 * 1024;
/** A second run from the same install inside this window is dropped (runs take far longer). */
export const RUN_MIN_GAP_SECONDS = 5;
/** Per IP: requests per 10-minute window, and installs we have never seen before per UTC day. */
export const IP_HITS_PER_WINDOW = 120;
export const IP_NEW_INSTALLS_PER_DAY = 20;
/** Share of requests that also prune old limit rows. */
const PRUNE_ODDS = 0.01;

/** Daily-salted IP hash: rate limiting without storing the IP. Null when there is no IP (local dev). */
export function ipHash(ip: string | null | undefined, now = new Date()): string | null {
  if (!ip) return null;
  const day = now.toISOString().slice(0, 10);
  return createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET ?? ""}|${day}|${ip}`).digest("hex").slice(0, 32);
}

export interface Snapshot {
  gold: number;
  pumpkin_crowns: number;
  runs: number;
  wins: number;
  kills: number;
  best_s: number;
  max_curse: number;
  meta: Record<string, number>;
  chars: number[];
  wins_by: Record<string, number>;
  pumpkin_by: Record<string, number>;
  codex: { items: Record<string, { seen: number; taken: number }>; enemies: Record<string, { seen: number; kills: number }> };
}

export interface Run {
  mode: "classic" | "halloween";
  event_id: string | null;
  hero: string;
  result: "win" | "death" | "quit";
  time_s: number;
  kills: number;
  level: number;
  gold_earned: number;
  curse: number | null;
  bosses: number | null;
  crowns: number | null;
  rituals: number | null;
  night_rank: number | null;
  embers: number | null;
  death_cause: string | null;
  build: { w: Record<string, number>; ps: Record<string, number>; evo: Record<string, number>; inf: Record<string, number> };
}

export interface TelemetryInput {
  install_id: string;
  session_id: string;
  touch: boolean;
  snap: Snapshot | null;
  run: Run | null;
}

type V<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HERO_RE = /^[a-z0-9_-]{1,32}$/i;
const EVENT_RE = /^[a-z0-9-]{1,40}$/;
const KEY_RE = /^[a-z0-9:_-]{1,48}$/i;
const CAUSE_RE = /^[a-z_]{1,24}$/;
const MAX_KEYS = 600;

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const optInt = (v: unknown, min: number, max: number): v is number | null | undefined => v == null || isInt(v, min, max);

// Nested maps come straight from old saves, so a bad entry is dropped rather than failing the whole ping.

/** {key: int} with bounded keys and values (meta levels, wins per hero, build levels). */
function intMap(v: unknown, max: number): Record<string, number> | null {
  if (v == null) return {};
  if (!isObj(v)) return null;
  const out: Record<string, number> = {};
  for (const k of Object.keys(v).slice(0, MAX_KEYS)) if (KEY_RE.test(k) && isInt(v[k], 0, max)) out[k] = v[k] as number;
  return out;
}

/** Codex records {id: {seen, <count>}}; unknown fields are dropped. */
function codexMap<C extends string>(v: unknown, count: C): Record<string, { seen: number } & Record<C, number>> | null {
  if (v == null) return {};
  if (!isObj(v)) return null;
  const out: Record<string, { seen: number } & Record<C, number>> = {};
  for (const k of Object.keys(v).slice(0, MAX_KEYS)) {
    const r = v[k];
    if (!KEY_RE.test(k) || !isObj(r)) continue;
    const n = r[count] ?? 0;
    out[k] = { seen: r.seen ? 1 : 0, [count]: isInt(n, 0, 100_000_000) ? n : 0 } as { seen: number } & Record<C, number>;
  }
  return out;
}

function validateSnapshot(s: unknown): V<Snapshot> {
  if (!isObj(s)) return { ok: false, error: "snap must be an object" };
  if (!isInt(s.gold, 0, 2_000_000_000)) return { ok: false, error: "snap.gold out of range" };
  if (!isInt(s.pumpkin_crowns, 0, 1_000_000)) return { ok: false, error: "snap.pumpkin_crowns out of range" };
  if (!isInt(s.runs, 0, 10_000_000) || !isInt(s.wins, 0, 10_000_000)) return { ok: false, error: "snap.runs/wins out of range" };
  if (!isInt(s.kills, 0, 1e12)) return { ok: false, error: "snap.kills out of range" };
  if (!isInt(s.best_s, 0, 86400)) return { ok: false, error: "snap.best_s out of range" };
  if (!isInt(s.max_curse, 0, 5)) return { ok: false, error: "snap.max_curse out of range" };
  const meta = intMap(s.meta, 999), wins_by = intMap(s.wins_by, 10_000_000), pumpkin_by = intMap(s.pumpkin_by, 1_000_000);
  if (!meta || !wins_by || !pumpkin_by) return { ok: false, error: "snap.meta/wins_by/pumpkin_by must be {key: int}" };
  if (!Array.isArray(s.chars) || s.chars.length > 64 || !s.chars.every((c) => isInt(c, 0, 63)))
    return { ok: false, error: "snap.chars must be hero indexes" };
  const cx = isObj(s.codex) ? s.codex : {};
  const items = codexMap(cx.items, "taken"), enemies = codexMap(cx.enemies, "kills");
  if (!items || !enemies) return { ok: false, error: "snap.codex is malformed" };
  return {
    ok: true,
    value: {
      gold: s.gold, pumpkin_crowns: s.pumpkin_crowns, runs: s.runs, wins: s.wins, kills: s.kills, best_s: s.best_s,
      max_curse: s.max_curse, meta, chars: s.chars as number[], wins_by, pumpkin_by, codex: { items, enemies },
    },
  };
}

function validateRun(r: unknown): V<Run> {
  if (!isObj(r)) return { ok: false, error: "run must be an object" };
  if (r.mode !== "classic" && r.mode !== "halloween") return { ok: false, error: "run.mode must be classic|halloween" };
  const event_id = r.event_id ?? null;
  if (event_id !== null && (typeof event_id !== "string" || !EVENT_RE.test(event_id))) return { ok: false, error: "run.event_id is malformed" };
  if (typeof r.hero !== "string" || !HERO_RE.test(r.hero)) return { ok: false, error: "run.hero must be 1-32 chars [a-z0-9_-]" };
  if (r.result !== "win" && r.result !== "death" && r.result !== "quit") return { ok: false, error: "run.result must be win|death|quit" };
  if (!isInt(r.time_s, 0, 86400)) return { ok: false, error: "run.time_s out of range" };
  if (!isInt(r.kills, 0, 1_000_000)) return { ok: false, error: "run.kills out of range" };
  if (!isInt(r.level, 1, 999)) return { ok: false, error: "run.level out of range" };
  if (!isInt(r.gold_earned, 0, 10_000_000)) return { ok: false, error: "run.gold_earned out of range" };
  if (!optInt(r.curse, 0, 5) || !optInt(r.bosses, 0, 5)) return { ok: false, error: "run.curse/bosses out of range" };
  if (!optInt(r.crowns, 0, 999) || !optInt(r.rituals, 0, 9999) || !optInt(r.night_rank, 1, 999) || !optInt(r.embers, 0, 10_000_000))
    return { ok: false, error: "run.crowns/rituals/night_rank/embers out of range" };
  const death_cause = r.death_cause ?? null;
  if (death_cause !== null && (typeof death_cause !== "string" || !CAUSE_RE.test(death_cause))) return { ok: false, error: "run.death_cause is malformed" };
  const b = isObj(r.build) ? r.build : {};
  const w = intMap(b.w, 9999), ps = intMap(b.ps, 9999), evo = intMap(b.evo, 9999), inf = intMap(b.inf, 9999);
  if (!w || !ps || !evo || !inf) return { ok: false, error: "run.build is malformed" };
  return {
    ok: true,
    value: {
      mode: r.mode, event_id, hero: r.hero, result: r.result, time_s: r.time_s, kills: r.kills, level: r.level,
      gold_earned: r.gold_earned, curse: r.curse ?? null, bosses: r.bosses ?? null, crowns: r.crowns ?? null,
      rituals: r.rituals ?? null, night_rank: r.night_rank ?? null, embers: r.embers ?? null, death_cause, build: { w, ps, evo, inf },
    },
  };
}

export function validateTelemetry(body: unknown): V<TelemetryInput> {
  if (!isObj(body)) return { ok: false, error: "body must be a JSON object" };
  if (body.v !== 1) return { ok: false, error: "v must be 1" };
  if (typeof body.install_id !== "string" || !UUID_RE.test(body.install_id)) return { ok: false, error: "install_id must be a UUID" };
  if (typeof body.session_id !== "string" || !UUID_RE.test(body.session_id)) return { ok: false, error: "session_id must be a UUID" };
  let snap: Snapshot | null = null, run: Run | null = null;
  if (body.snap != null) {
    const s = validateSnapshot(body.snap);
    if (!s.ok) return s;
    snap = s.value;
  }
  if (body.run != null) {
    const r = validateRun(body.run);
    if (!r.ok) return r;
    run = r.value;
  }
  return { ok: true, value: { install_id: body.install_id.toLowerCase(), session_id: body.session_id.toLowerCase(), touch: body.touch === true, snap, run } };
}

/** Counts this request against the IP's limits. Returns why it is over, or null when it may proceed. */
async function overLimit(c: pg.PoolClient, ip: string, installId: string): Promise<string | null> {
  const hit = await c.query<{ hits: number }>(
    `INSERT INTO telemetry_limits (ip_hash, window_start)
     VALUES ($1, date_bin('10 minutes', now(), timestamptz '2000-01-01'))
     ON CONFLICT (ip_hash, window_start) DO UPDATE SET hits = telemetry_limits.hits + 1
     RETURNING hits`,
    [ip],
  );
  if (hit.rows[0].hits > IP_HITS_PER_WINDOW) return "too many requests";
  // Known installs always pass; a new one is admitted while this IP has room today.
  const inst = await c.query<{ ok: boolean }>(
    `WITH ins AS (
       INSERT INTO telemetry_ip_installs (ip_hash, install_id)
       SELECT $1, $2
       WHERE NOT EXISTS (SELECT 1 FROM telemetry_sessions WHERE install_id = $2)
         AND (SELECT count(*) FROM telemetry_ip_installs WHERE ip_hash = $1) < $3
       ON CONFLICT DO NOTHING
       RETURNING 1
     )
     SELECT EXISTS (SELECT 1 FROM ins)
         OR EXISTS (SELECT 1 FROM telemetry_sessions WHERE install_id = $2)
         OR EXISTS (SELECT 1 FROM telemetry_ip_installs WHERE ip_hash = $1 AND install_id = $2) AS ok`,
    [ip, installId, IP_NEW_INSTALLS_PER_DAY],
  );
  return inst.rows[0].ok ? null : "too many new installs";
}

/**
 * Records one ping in a single transaction, after counting it against the IP's limits (skipped when
 * ip is null). Returns the limit hit, or whether the run (if any) was stored.
 */
export async function recordTelemetry(
  userId: string | null,
  ip: string | null,
  t: TelemetryInput,
): Promise<{ limited: string } | { run: boolean }> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (Math.random() < PRUNE_ODDS) {
      await c.query(`DELETE FROM telemetry_limits WHERE window_start < now() - interval '1 hour'`);
      await c.query(`DELETE FROM telemetry_ip_installs WHERE created_at < now() - interval '2 days'`);
    }
    const limited = ip ? await overLimit(c, ip, t.install_id) : null;
    if (limited) {
      // keep the hit count, write nothing else
      await c.query("COMMIT");
      return { limited };
    }
    let ranStored = false;
    if (t.run) {
      const r = t.run;
      const ins = await c.query(
        `INSERT INTO telemetry_runs (install_id, session_id, user_id, mode, event_id, hero, result, time_s, kills, level,
           gold_earned, curse, bosses, crowns, rituals, night_rank, embers, death_cause, build)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
         WHERE NOT EXISTS (
           SELECT 1 FROM telemetry_runs
           WHERE install_id = $1 AND created_at > now() - make_interval(secs => $20)
         )`,
        [t.install_id, t.session_id, userId, r.mode, r.event_id, r.hero, r.result, r.time_s, r.kills, r.level, r.gold_earned,
          r.curse, r.bosses, r.crowns, r.rituals, r.night_rank, r.embers, r.death_cause, JSON.stringify(r.build), RUN_MIN_GAP_SECONDS],
      );
      ranStored = ins.rowCount === 1;
    }
    await c.query(
      `INSERT INTO telemetry_sessions (session_id, install_id, user_id, touch, runs)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id) DO UPDATE SET
         user_id = COALESCE(EXCLUDED.user_id, telemetry_sessions.user_id),
         runs = telemetry_sessions.runs + EXCLUDED.runs,
         last_seen = now()
       WHERE telemetry_sessions.install_id = EXCLUDED.install_id`,
      [t.session_id, t.install_id, userId, t.touch, ranStored ? 1 : 0],
    );
    if (t.snap) {
      const s = t.snap;
      const codexItems = Object.values(s.codex.items).filter((r) => r.seen).length;
      const codexEnemies = Object.values(s.codex.enemies).filter((r) => r.seen).length;
      await c.query(
        `INSERT INTO player_snapshots (install_id, user_id, gold, pumpkin_crowns, runs, wins, kills, best_s, max_curse,
           codex_items, codex_enemies, meta, chars, wins_by, pumpkin_by, codex)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (install_id) DO UPDATE SET
           user_id = COALESCE(EXCLUDED.user_id, player_snapshots.user_id),
           gold = EXCLUDED.gold, pumpkin_crowns = EXCLUDED.pumpkin_crowns, runs = EXCLUDED.runs, wins = EXCLUDED.wins,
           kills = EXCLUDED.kills, best_s = EXCLUDED.best_s, max_curse = EXCLUDED.max_curse,
           codex_items = EXCLUDED.codex_items, codex_enemies = EXCLUDED.codex_enemies, meta = EXCLUDED.meta,
           chars = EXCLUDED.chars, wins_by = EXCLUDED.wins_by, pumpkin_by = EXCLUDED.pumpkin_by, codex = EXCLUDED.codex,
           last_seen = now()`,
        [t.install_id, userId, s.gold, s.pumpkin_crowns, s.runs, s.wins, s.kills, s.best_s, s.max_curse, codexItems, codexEnemies,
          JSON.stringify(s.meta), JSON.stringify(s.chars), JSON.stringify(s.wins_by), JSON.stringify(s.pumpkin_by), JSON.stringify(s.codex)],
      );
    }
    await c.query("COMMIT");
    return { run: ranStored };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
