import { pool } from "./db.js";
import { byHero, fromPumpkin, HERO_PRICE, heroId, heroIds, legacyIndex, maxCounts, maxEvents, toLegacy } from "./heroes.js";
import { type Counts, type Events, type Snapshot, validateSnapshot } from "./telemetry.js";

// Cloud save for signed-in players (docs/remaining-tasks.md, section 1). One save per X account, in the
// player_snapshots format plus the fields that snapshots leave out. Every push is merged three-way on the server:
// the cloud save gains only what the device changed since its base (the last save it synced), so devices that
// played offline or at the same time never lose or double-count progress. Never feeds a leaderboard.
// Saves key heroes by id and keep event progress per event (v2). Pages from before (v1: hero indexes, pumpkin_crowns)
// are upgraded on the way in and answered in v1, so an open old tab keeps working until it reloads.

export const SAVE_MAX_BYTES = 128 * 1024;
/** Pushes per user per 10-minute window. The client debounces to one push per 2s at most. */
export const SAVE_HITS_PER_WINDOW = 120;
/** Share of requests that also prune old limit rows. */
const PRUNE_ODDS = 0.01;

/** Shop upgrade base prices (META in public/index.html; _test/sync.test.ts checks they match): level n costs base * n. */
export const META_BASE: Record<string, number> = {
  might: 90, hp: 75, armor: 180, speed: 90, magnet: 60, greed: 120, reroll: 150, choice: 600, revive: 750,
};

const BOARDS = ["fastest", "survival", "kills"] as const;

export interface Save extends Snapshot {
  /** Selected hero id. */
  char: string;
  curse: number;
  tut: boolean;
  muted: boolean;
  gore: boolean;
  last_event: string | null;
  /** Leaderboard bests cache: f = [curse, time_s] of the fastest win, s = longest survival, k = most kills. */
  lb_best: { f: [number, number] | null; s: number; k: number };
  lb_ranks: Partial<Record<(typeof BOARDS)[number], number>>;
}

export interface SavePush {
  install_id: string;
  save: Save;
  /** The last save this device synced, null when it never has. */
  base: Save | null;
  base_version: number | null;
  /** Wire shape of the pushing page: 2 keys heroes by id, 1 by index (pages from before). It gets its answer in the same shape. */
  v: 1 | 2;
}

type V<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HERO_RE = /^[a-z0-9_-]{1,32}$/i;
const EVENT_RE = /^[a-z0-9-]{1,40}$/;

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Validator ranges (validateSnapshot); merged values are clamped to them so the client can push them back. */
const MAX = { gold: 2_000_000_000, crowns: 1_000_000, runs: 10_000_000, kills: 1e12, codex: 100_000_000 };

export const emptySave = (): Save => ({
  gold: 0, runs: 0, wins: 0, kills: 0, best_s: 0, max_curse: 0, meta: {}, chars: ["king-cube"], wins_by: {},
  events: {}, codex: { items: {}, enemies: {} }, char: "king-cube", curse: 0, tut: false, muted: false, gore: false,
  last_event: null, lb_best: { f: null, s: 0, k: 0 }, lb_ranks: {},
});

/** JSON with object keys sorted, so equal saves compare equal whatever order Postgres or the client used. */
export const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

export function validateSave(s: unknown): V<Save> {
  const snap = validateSnapshot(s);
  if (!snap.ok) return snap;
  const o = s as Record<string, unknown>;
  // a hero id, or a v1 index
  if (!isInt(o.char, 0, 63) && !(typeof o.char === "string" && HERO_RE.test(o.char))) return { ok: false, error: "save.char must be a hero id" };
  if (!isInt(o.curse, 0, 5)) return { ok: false, error: "save.curse out of range" };
  if (typeof o.tut !== "boolean" || typeof o.muted !== "boolean" || typeof o.gore !== "boolean")
    return { ok: false, error: "save.tut/muted/gore must be booleans" };
  const last_event = o.last_event ?? null;
  if (last_event !== null && (typeof last_event !== "string" || !EVENT_RE.test(last_event))) return { ok: false, error: "save.last_event is malformed" };
  const b = o.lb_best;
  if (!isObj(b) || !isInt(b.s, 0, 1200) || !isInt(b.k, 0, 50_000)) return { ok: false, error: "save.lb_best is malformed" };
  const f = b.f ?? null;
  if (f !== null && !(Array.isArray(f) && f.length === 2 && isInt(f[0], 0, 5) && isInt(f[1], 0, 1200)))
    return { ok: false, error: "save.lb_best.f must be [curse, time_s]" };
  const r = o.lb_ranks;
  if (!isObj(r)) return { ok: false, error: "save.lb_ranks must be an object" };
  const lb_ranks: Save["lb_ranks"] = {};
  for (const k of BOARDS) {
    if (r[k] == null) continue;
    if (!isInt(r[k], 1, 1_000_000_000)) return { ok: false, error: "save.lb_ranks values must be ranks" };
    lb_ranks[k] = r[k] as number;
  }
  return {
    ok: true,
    value: {
      ...snap.value, char: heroId(o.char) ?? "king-cube", curse: o.curse, tut: o.tut, muted: o.muted, gore: o.gore, last_event,
      lb_best: { f: f as [number, number] | null, s: b.s, k: b.k }, lb_ranks,
    },
  };
}

export function validatePush(body: unknown): V<SavePush> {
  if (!isObj(body)) return { ok: false, error: "body must be a JSON object" };
  if (typeof body.install_id !== "string" || !UUID_RE.test(body.install_id)) return { ok: false, error: "install_id must be a UUID" };
  const save = validateSave(body.save);
  if (!save.ok) return save;
  const base_version = body.base_version ?? null;
  if (base_version !== null && !isInt(base_version, 1, 2_000_000_000)) return { ok: false, error: "base_version must be a positive integer" };
  if ((body.base == null) !== (base_version === null)) return { ok: false, error: "base and base_version go together" };
  let base: Save | null = null;
  if (body.base != null) {
    const b = validateSave(body.base);
    if (!b.ok) return { ok: false, error: b.error.replace(/^save\./, "base.") };
    base = b.value;
  }
  if (body.v != null && body.v !== 1 && body.v !== 2) return { ok: false, error: "v must be 1 or 2" };
  const v = body.v === 2 ? 2 : 1;
  return { ok: true, value: { install_id: body.install_id.toLowerCase(), save: save.value, base, base_version, v } };
}

// ---- merge ----

/** What the device added since its base, on top of the cloud value. Counters only grow, so a drop counts as 0. */
const add = (c: number, d: number, b: number, max: number) => Math.min(max, c + Math.max(0, d - b));
const keys = (...ms: object[]) => [...new Set(ms.flatMap((m) => Object.keys(m)))];
const addMap = (c: Record<string, number>, d: Record<string, number>, b: Record<string, number>, max: number) =>
  Object.fromEntries(keys(c, d).map((k) => [k, add(c[k] ?? 0, d[k] ?? 0, b[k] ?? 0, max)]));
/** Settings and selections: the device's value if it changed it since its base, else the cloud's. */
const pick = <T>(c: T, d: T, b: T): T => (canon(d) === canon(b) ? c : d);

export const metaCost = (meta: Record<string, number>) =>
  Object.entries(meta).reduce((sum, [k, l]) => sum + ((META_BASE[k] ?? 0) * l * (l + 1)) / 2, 0);
export const heroCost = (chars: string[]) => [...new Set(chars)].reduce((sum, id) => sum + (HERO_PRICE[id] ?? 0), 0);
/** Gold plus everything bought with gold. */
export const wealth = (s: Save) => s.gold + metaCost(s.meta) + heroCost(s.chars);

type Fastest = Save["lb_best"]["f"];
/** Fastest win: higher curse first, then lower time (lbBetter in public/index.html). */
const fastest = (a: Fastest, b: Fastest): Fastest => (!a ? b : !b ? a : b[0] > a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a);

/**
 * Three-way merge: cloud is the account's save, device the pushed save, base the save the device last synced
 * (emptySave() for a device that never synced, which adds its whole save once). Pure; inputs are not changed.
 */
export function mergeSaves(cloud: Save, device: Save, base: Save): Save {
  const meta = Object.fromEntries(keys(cloud.meta, device.meta).map((k) => [k, Math.max(cloud.meta[k] ?? 0, device.meta[k] ?? 0)]));
  const chars = [...new Set([...cloud.chars, ...device.chars])].sort();
  // Gold by wealth: both sides keep what they earned; a purchase made on both comes back as gold.
  const gold = Math.max(0, Math.min(MAX.gold, add(wealth(cloud), wealth(device), wealth(base), Infinity) - metaCost(meta) - heroCost(chars)));
  const cx = <C extends "taken" | "kills">(c: Record<string, { seen: number } & Record<C, number>>, d: typeof c, b: typeof c, n: C) =>
    Object.fromEntries(
      keys(c, d).map((k) => [k, { seen: Math.max(c[k]?.seen ?? 0, d[k]?.seen ?? 0), [n]: add(c[k]?.[n] ?? 0, d[k]?.[n] ?? 0, b[k]?.[n] ?? 0, MAX.codex) }]),
    ) as typeof c;
  return {
    gold,
    runs: add(cloud.runs, device.runs, base.runs, MAX.runs),
    wins: add(cloud.wins, device.wins, base.wins, MAX.runs),
    kills: add(cloud.kills, device.kills, base.kills, MAX.kills),
    best_s: Math.max(cloud.best_s, device.best_s),
    max_curse: Math.max(cloud.max_curse, device.max_curse),
    meta,
    chars,
    wins_by: addMap(cloud.wins_by, device.wins_by, base.wins_by, MAX.runs),
    events: Object.fromEntries(
      keys(cloud.events, device.events).map((id) => {
        const [c, d, b] = [cloud.events[id], device.events[id], base.events[id]];
        return [id, {
          currency: add(c?.currency ?? 0, d?.currency ?? 0, b?.currency ?? 0, MAX.crowns),
          by: addMap(c?.by ?? {}, d?.by ?? {}, b?.by ?? {}, MAX.crowns),
        }];
      }),
    ),
    codex: {
      items: cx(cloud.codex.items, device.codex.items, base.codex.items, "taken"),
      enemies: cx(cloud.codex.enemies, device.codex.enemies, base.codex.enemies, "kills"),
    },
    char: pick(cloud.char, device.char, base.char),
    curse: pick(cloud.curse, device.curse, base.curse),
    tut: cloud.tut || device.tut,
    muted: pick(cloud.muted, device.muted, base.muted),
    gore: pick(cloud.gore, device.gore, base.gore),
    last_event: pick(cloud.last_event, device.last_event, base.last_event),
    lb_best: {
      f: fastest(cloud.lb_best.f, device.lb_best.f),
      s: Math.max(cloud.lb_best.s, device.lb_best.s),
      k: Math.max(cloud.lb_best.k, device.lb_best.k),
    },
    lb_ranks: pick(cloud.lb_ranks, device.lb_ranks, base.lb_ranks),
  };
}

// ---- wire ----

/** A save in the shape the page asked for: v2 as stored, v1 with hero indexes and pumpkin_crowns / pumpkin_by. */
export function toWire(s: Save, v: 1 | 2) {
  if (v === 2) return s;
  const { events: _events, ...rest } = s;
  return { ...rest, ...toLegacy(s), char: legacyIndex(s.char) ?? 0 };
}

// ---- storage ----
// heroes / hero / hero_wins / events hold the save. The v1 columns (chars, char, wins_by, pumpkin_crowns, pumpkin_by) are
// still written as an exact copy for every v1 hero, so the admin views and an older API version keep working. Reading
// takes the higher of the two, which also picks up anything an older API version wrote after migration 006.

const COLS = ["gold", "runs", "wins", "kills", "best_s", "max_curse", "meta", "codex", "curse", "tut", "muted", "gore",
  "last_event", "lb_best", "lb_ranks", "heroes", "hero", "hero_wins", "events", "chars", "char", "wins_by", "pumpkin_crowns", "pumpkin_by"] as const;
const SEL = COLS.join(", ");

const json = (v: unknown) => JSON.stringify(v);
function colValues(s: Save): unknown[] {
  const v1 = toLegacy(s);
  const row: Record<(typeof COLS)[number], unknown> = {
    gold: s.gold, runs: s.runs, wins: s.wins, kills: s.kills, best_s: s.best_s, max_curse: s.max_curse, meta: json(s.meta),
    codex: json(s.codex), curse: s.curse, tut: s.tut, muted: s.muted, gore: s.gore, last_event: s.last_event,
    lb_best: json(s.lb_best), lb_ranks: json(s.lb_ranks), heroes: json(s.chars), hero: s.char, hero_wins: json(s.wins_by),
    events: json(s.events), chars: json(v1.chars), char: legacyIndex(s.char) ?? 0, wins_by: json(v1.wins_by),
    pumpkin_crowns: v1.pumpkin_crowns, pumpkin_by: json(v1.pumpkin_by),
  };
  return COLS.map((k) => row[k]);
}

type SaveRow = Omit<Save, "kills" | "chars" | "char" | "wins_by" | "events"> & {
  version: number; kills: string | number; heroes: string[]; hero: string | null; hero_wins: Counts; events: Events;
  chars: number[]; char: number; wins_by: Counts; pumpkin_crowns: number; pumpkin_by: Counts;
};
const fromRow = ({ version, kills, heroes, hero, hero_wins, events, chars, char, wins_by, pumpkin_crowns, pumpkin_by, ...r }: SaveRow) => {
  // The selected hero is a setting, not a count: the v1 column wins only when an older API version changed it after this one wrote
  const h = legacyIndex(hero ?? "");
  const sel = hero == null || (h !== undefined && h !== char) ? (heroId(char) ?? "king-cube") : hero;
  const save: Save = {
    ...r, kills: Number(kills), chars: heroIds([...heroes, ...chars]), char: sel,
    wins_by: maxCounts(hero_wins, byHero(wins_by)), events: maxEvents(events, fromPumpkin(pumpkin_crowns, pumpkin_by)),
  };
  return { save, version };
};

export async function getSave(userId: string): Promise<{ save: Save; version: number } | null> {
  const { rows } = await pool.query<SaveRow>(`SELECT version, ${SEL} FROM player_saves WHERE user_id = $1`, [userId]);
  return rows[0] ? fromRow(rows[0]) : null;
}

/** A device's last push as stored: v2 since migration 006, v1 before. */
const sentSave = (sent: unknown): Save | null => {
  const v = validateSave(sent);
  return v.ok ? v.value : null;
};

/**
 * Merges one push into the user's save in a single transaction, after counting it against the user's limit.
 * Returns the merged save and its version, or the limit hit.
 */
export async function pushSave(userId: string, p: SavePush): Promise<{ limited: string } | { save: Save; version: number }> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (Math.random() < PRUNE_ODDS) await c.query(`DELETE FROM save_limits WHERE window_start < now() - interval '1 hour'`);
    const hit = await c.query<{ hits: number }>(
      `INSERT INTO save_limits (user_id, window_start)
       VALUES ($1, date_bin('10 minutes', now(), timestamptz '2000-01-01'))
       ON CONFLICT (user_id, window_start) DO UPDATE SET hits = save_limits.hits + 1
       RETURNING hits`,
      [userId],
    );
    if (hit.rows[0].hits > SAVE_HITS_PER_WINDOW) {
      await c.query("COMMIT");
      return { limited: "too many saves" };
    }
    // One push per user at a time, also when the row does not exist yet.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('player_saves:' || $1))`, [userId]);
    const cur = await c.query<SaveRow>(`SELECT version, ${SEL} FROM player_saves WHERE user_id = $1`, [userId]);
    const dev = await c.query<{ base_version: number | null; sent: unknown }>(
      `SELECT base_version, sent FROM player_save_devices WHERE user_id = $1 AND install_id = $2`,
      [userId, p.install_id],
    );
    // Same base as this device's previous push: that push already landed (its response was lost, or the device kept
    // playing while it was in flight), so the device's save now builds on what it sent then.
    const prev = dev.rows[0];
    const sent = prev && prev.base_version === p.base_version ? sentSave(prev.sent) : null;
    const base = sent ?? p.base ?? emptySave();
    const now = cur.rows[0] ? fromRow(cur.rows[0]) : null;
    const cloud = now?.save ?? emptySave();
    const save = mergeSaves(cloud, p.save, base);
    let version = now?.version ?? 0;
    if (!now || canon(save) !== canon(cloud)) {
      version++;
      const codexItems = Object.values(save.codex.items).filter((r) => r.seen).length;
      const codexEnemies = Object.values(save.codex.enemies).filter((r) => r.seen).length;
      await c.query(
        `INSERT INTO player_saves (user_id, version, install_id, codex_items, codex_enemies, ${SEL})
         VALUES ($1, $2, $3, $4, $5, ${COLS.map((_, i) => "$" + (i + 6)).join(", ")})
         ON CONFLICT (user_id) DO UPDATE SET
           version = EXCLUDED.version, install_id = EXCLUDED.install_id, codex_items = EXCLUDED.codex_items,
           codex_enemies = EXCLUDED.codex_enemies, ${COLS.map((k) => `${k} = EXCLUDED.${k}`).join(", ")}, updated_at = now()`,
        [userId, version, p.install_id, codexItems, codexEnemies, ...colValues(save)],
      );
    }
    await c.query(
      `INSERT INTO player_save_devices (user_id, install_id, base_version, sent) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, install_id) DO UPDATE SET base_version = EXCLUDED.base_version, sent = EXCLUDED.sent, updated_at = now()`,
      [userId, p.install_id, p.base_version, JSON.stringify(p.save)],
    );
    await c.query("COMMIT");
    return { save, version };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
