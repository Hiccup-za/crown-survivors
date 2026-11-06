import type { Counts, EventProgress, Events } from "./telemetry.js";

/**
 * Heroes by stable id (CH[].id in public/index.html; _test/sync.test.ts checks they match). Saves, boards and
 * telemetry key heroes by id, so CH can be reordered and heroes renamed without touching anyone's progress.
 * Price in gold; event heroes are earned, not bought.
 */
export const HERO_PRICE: Record<string, number> = {
  "king-cube": 0, "ruby-knight": 500, "mint-mage": 1600, "shadow-rogue": 1000, "pumpkin-prince": 0,
};

// ---- saves from before stable ids (v1) ----
// v1 saves keyed heroes by their CH index and held one event's currency as pumpkin_crowns / pumpkin_by. Old pages
// still in open tabs keep sending that shape, and the old DB columns stay written in it until nothing reads them.

/** The CH order v1 saves used. Frozen: never reorder or append. Heroes added later simply have no v1 index. */
export const LEGACY_HEROES: readonly string[] = ["king-cube", "ruby-knight", "mint-mage", "shadow-rogue", "pumpkin-prince"];
/** The event v1's pumpkin_crowns / pumpkin_by belong to. */
export const LEGACY_EVENT = "harvest-2026";

/** A hero id, or a v1 index (number or digit string) as its id. Undefined for an index no hero ever had. */
export const heroId = (v: unknown): string | undefined =>
  typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)) ? LEGACY_HEROES[Number(v)] : typeof v === "string" ? v : undefined;
export const legacyIndex = (id: string): number | undefined => {
  const i = LEGACY_HEROES.indexOf(id);
  return i < 0 ? undefined : i;
};

/** Heroes as sorted ids without duplicates, from ids, v1 indexes or a mix. */
export const heroIds = (a: unknown[]): string[] => [...new Set(a.map(heroId).filter((x): x is string => !!x))].sort();
/** Highest count per key. Counts only grow, so the higher of two copies of one count is the newer. */
export const maxCounts = (...ms: Counts[]): Counts => {
  const out: Counts = {};
  for (const m of ms) for (const [k, n] of Object.entries(m)) out[k] = Math.max(out[k] ?? 0, n);
  return out;
};
/** {hero: n} re-keyed by id. A hero under both its index and its id keeps the higher count, never the sum. */
export const byHero = (m: Counts): Counts => {
  const out: Counts = {};
  for (const [k, n] of Object.entries(m)) {
    const id = heroId(k);
    if (id) out[id] = Math.max(out[id] ?? 0, n);
  }
  return out;
};
/** Event progress from two copies (new and v1), per event and per count the higher. */
export const maxEvents = (a: Events, b: Events): Events =>
  Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])].map((id): [string, EventProgress] => [id, {
      currency: Math.max(a[id]?.currency ?? 0, b[id]?.currency ?? 0),
      by: maxCounts(a[id]?.by ?? {}, b[id]?.by ?? {}),
    }]),
  );
/** v1 pumpkin_crowns / pumpkin_by as event progress. */
export const fromPumpkin = (crowns: number, by: Counts): Events =>
  crowns > 0 || Object.keys(by).length ? { [LEGACY_EVENT]: { currency: crowns, by: byHero(by) } } : {};

const byIndex = (m: Counts): Counts =>
  Object.fromEntries(Object.entries(m).flatMap(([k, n]) => {
    const i = legacyIndex(k);
    return i === undefined ? [] : [[String(i), n]];
  }));

/** The v1 fields of an id-keyed save: heroes that have a v1 index, and the legacy event. Exact for every v1 hero. */
export function toLegacy(s: { chars: string[]; wins_by: Counts; events: Events }) {
  const ev = s.events[LEGACY_EVENT];
  return {
    chars: s.chars.map(legacyIndex).filter((i): i is number => i !== undefined).sort((a, b) => a - b),
    wins_by: byIndex(s.wins_by),
    pumpkin_crowns: ev?.currency ?? 0,
    pumpkin_by: byIndex(ev?.by ?? {}),
  };
}
