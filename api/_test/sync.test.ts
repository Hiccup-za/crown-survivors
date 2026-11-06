// The game (public/index.html) and the API each keep a copy of a few tables. These tests fail when the copies drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EVENTS } from "../_src/events.js";
import { HERO_PRICE, LEGACY_EVENT, LEGACY_HEROES } from "../_src/heroes.js";
import { META_BASE } from "../_src/save.js";

const GAME = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
/** Evaluates the game's `const NAME=<literal>;` (data only, from our own file). */
const table = (name: string): unknown => {
  const m = GAME.match(new RegExp(`const ${name}=([\\[{][\\s\\S]*?[\\]}]);\\n`));
  assert.ok(m, `const ${name} not found in public/index.html`);
  return new Function(`return (${m[1]})`)();
};

const CH = table("CH") as { id: string; n: string; p: number; ev?: string }[];

test("every hero has a unique id, and the API prices the same heroes", () => {
  const ids = CH.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate hero id");
  for (const id of ids) assert.match(id, /^[a-z0-9-]{1,32}$/);
  assert.deepEqual(Object.fromEntries(CH.map((c) => [c.id, c.p])), HERO_PRICE);
});

test("the old save shape maps heroes the same way on both sides", () => {
  const m = GAME.match(/const HERO_LEGACY=(\[[^\]]*\])/);
  assert.ok(m, "HERO_LEGACY not found in public/index.html");
  assert.deepEqual(new Function(`return ${m[1]}`)(), LEGACY_HEROES);
  assert.ok(GAME.includes(`EV_LEGACY='${LEGACY_EVENT}'`));
  // frozen: the order saves used before stable ids
  assert.deepEqual(LEGACY_HEROES, ["king-cube", "ruby-knight", "mint-mage", "shadow-rogue", "pumpkin-prince"]);
});

test("events match the API", () => {
  const ev = table("EVENTS") as Record<string, { id: string; n: string; startAt: string; endAt: string; theme: string }>;
  assert.deepEqual(
    Object.values(ev).map((e) => ({ id: e.id, name: e.n, startAt: e.startAt, endAt: e.endAt, theme: e.theme })),
    EVENTS.map(({ id, name, startAt, endAt, theme }) => ({ id, name, startAt, endAt, theme })),
  );
  for (const c of CH) if (c.ev) assert.ok(ev[c.ev], `${c.id} belongs to unknown event ${c.ev}`);
});

test("hero-only items point at a real hero", () => {
  const ids = new Set(CH.map((c) => c.id));
  for (const name of ["WP", "PS"]) {
    for (const [k, o] of Object.entries(table(name) as Record<string, { only?: unknown }>))
      if (o.only != null) assert.ok(typeof o.only === "string" && ids.has(o.only), `${name}.${k}.only = ${String(o.only)}`);
  }
});

test("shop prices match the API", () => {
  const meta = table("META") as [string, string, string, number, number][];
  assert.deepEqual(Object.fromEntries(meta.map(([k, , , base]) => [k, base])), META_BASE);
});
