// Cloud save merge and validation (api/_src/save.ts). Pure logic: no database, network or clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canon, emptySave, mergeSaves, metaCost, type Save, validatePush, validateSave, wealth } from "../_src/save.js";

const ID = "11111111-1111-4111-8111-111111111111";
const sv = (o: Partial<Save> = {}): Save => ({ ...emptySave(), ...o });
const E = emptySave();

test("first link adds a never-synced device's whole save once", () => {
  const cloud = sv({ runs: 10, wins: 2, kills: 500, wins_by: { "0": 2 }, pumpkin_crowns: 3, pumpkin_by: { "4": 3 } });
  const device = sv({ runs: 4, wins: 1, kills: 120, wins_by: { "0": 1, "1": 1 }, pumpkin_crowns: 1, pumpkin_by: { "4": 1 } });
  const m = mergeSaves(cloud, device, E);
  assert.equal(m.runs, 14);
  assert.equal(m.wins, 3);
  assert.equal(m.kills, 620);
  assert.deepEqual(m.wins_by, { "0": 3, "1": 1 });
  assert.equal(m.pumpkin_crowns, 4);
  assert.deepEqual(m.pumpkin_by, { "4": 4 });
});

test("an empty cloud takes the device save as it is", () => {
  const device = sv({ gold: 340, runs: 7, meta: { might: 2 }, chars: [0, 1], char: 1, muted: true, best_s: 412 });
  assert.equal(canon(mergeSaves(E, device, E)), canon(device));
});

test("syncing again with nothing new changes nothing", () => {
  const cloud = sv({ gold: 500, runs: 9, kills: 300, meta: { hp: 3 }, chars: [0, 2], codex: { items: { "w:bolt": { seen: 1, taken: 4 } }, enemies: {} } });
  // The device just received cloud and pushes it back unchanged, several times.
  let m = cloud;
  for (let i = 0; i < 3; i++) m = mergeSaves(m, cloud, cloud);
  assert.equal(canon(m), canon(cloud));
});

test("counters add only what each device did since its base", () => {
  const base = sv({ runs: 10, kills: 1000, wins_by: { "0": 3 } });
  const cloud = sv({ runs: 13, kills: 1300, wins_by: { "0": 4 } }); // another device played 3 runs
  const device = sv({ runs: 12, kills: 1150, wins_by: { "0": 3, "2": 1 } }); // this device played 2 runs offline
  const m = mergeSaves(cloud, device, base);
  assert.equal(m.runs, 15);
  assert.equal(m.kills, 1450);
  assert.deepEqual(m.wins_by, { "0": 4, "2": 1 });
});

test("a counter below its base never takes from the cloud", () => {
  const m = mergeSaves(sv({ runs: 20 }), sv({ runs: 5 }), sv({ runs: 10 }));
  assert.equal(m.runs, 20);
});

test("best time, max curse and upgrade levels take the highest", () => {
  const m = mergeSaves(sv({ best_s: 300, max_curse: 2, meta: { might: 3, hp: 1 } }), sv({ best_s: 450, max_curse: 1, meta: { might: 1, greed: 2 } }), E);
  assert.equal(m.best_s, 450);
  assert.equal(m.max_curse, 2);
  assert.deepEqual(m.meta, { might: 3, hp: 1, greed: 2 });
});

test("heroes are the union", () => {
  assert.deepEqual(mergeSaves(sv({ chars: [0, 2] }), sv({ chars: [3, 0, 1] }), E).chars, [0, 1, 2, 3]);
});

test("upgrade cost is the sum of base * level", () => {
  assert.equal(metaCost({ might: 3 }), 90 + 180 + 270);
  assert.equal(metaCost({ unknown: 5 }), 0);
  assert.equal(wealth(sv({ gold: 10, meta: { hp: 2 }, chars: [0, 1] })), 10 + 75 + 150 + 500);
});

test("gold earned on both sides is kept", () => {
  const base = sv({ gold: 100 });
  assert.equal(mergeSaves(sv({ gold: 150 }), sv({ gold: 170 }), base).gold, 220);
});

test("gold spent on one side is spent in the merge", () => {
  const base = sv({ gold: 500 });
  const m = mergeSaves(base, sv({ gold: 0, chars: [0, 1] }), base);
  assert.equal(m.gold, 0);
  assert.deepEqual(m.chars, [0, 1]);
});

test("the same purchase made on two never-linked devices comes back as gold", () => {
  // Each device earned its own gold and bought Might 1 (90) and Ruby Knight (500).
  const cloud = sv({ gold: 10, meta: { might: 1 }, chars: [0, 1] });
  const device = sv({ gold: 20, meta: { might: 1 }, chars: [0, 1] });
  const m = mergeSaves(cloud, device, E);
  assert.deepEqual(m.meta, { might: 1 });
  assert.equal(m.gold, 10 + 20 + 90 + 500);
});

test("different upgrades bought from the same base gold are both kept", () => {
  const base = sv({ gold: 200 });
  const m = mergeSaves(sv({ gold: 110, meta: { might: 1 } }), sv({ gold: 125, meta: { hp: 1 } }), base);
  assert.deepEqual(m.meta, { might: 1, hp: 1 });
  assert.equal(m.gold, 200 - 90 - 75);
});

test("spending the same base gold twice leaves 0 gold, never negative", () => {
  const base = sv({ gold: 100 });
  const m = mergeSaves(sv({ gold: 10, meta: { might: 1 } }), sv({ gold: 25, meta: { hp: 1 } }), base);
  assert.deepEqual(m.meta, { might: 1, hp: 1 });
  assert.equal(m.gold, 0);
});

test("codex: seen anywhere, counts added three-way", () => {
  const base = sv({ codex: { items: { "w:bolt": { seen: 1, taken: 5 } }, enemies: { blob: { seen: 1, kills: 100 } } } });
  const cloud = sv({ codex: { items: { "w:bolt": { seen: 1, taken: 7 } }, enemies: { blob: { seen: 1, kills: 150 }, bat: { seen: 1, kills: 0 } } } });
  const device = sv({ codex: { items: { "w:bolt": { seen: 1, taken: 6 }, "p:tome": { seen: 1, taken: 0 } }, enemies: { blob: { seen: 1, kills: 120 } } } });
  const m = mergeSaves(cloud, device, base);
  assert.deepEqual(m.codex.items, { "w:bolt": { seen: 1, taken: 8 }, "p:tome": { seen: 1, taken: 0 } });
  assert.deepEqual(m.codex.enemies, { blob: { seen: 1, kills: 170 }, bat: { seen: 1, kills: 0 } });
});

test("settings and selections: the device's change wins, otherwise the cloud's value stays", () => {
  const base = sv({ char: 0, curse: 0, muted: false, gore: false, last_event: null, lb_ranks: { fastest: 9 } });
  const cloud = sv({ char: 2, curse: 1, muted: true, gore: false, last_event: "harvest", lb_ranks: { fastest: 7 } });
  const device = sv({ char: 0, curse: 3, muted: false, gore: true, last_event: null, lb_ranks: { fastest: 9 } });
  const m = mergeSaves(cloud, device, base);
  assert.equal(m.char, 2);
  assert.equal(m.curse, 3);
  assert.equal(m.muted, true);
  assert.equal(m.gore, true);
  assert.equal(m.last_event, "harvest");
  assert.deepEqual(m.lb_ranks, { fastest: 7 });
});

test("tutorial seen anywhere stays seen", () => {
  assert.equal(mergeSaves(sv({ tut: true }), sv({ tut: false }), sv({ tut: false })).tut, true);
  assert.equal(mergeSaves(sv({ tut: false }), sv({ tut: true }), E).tut, true);
});

test("leaderboard bests: fastest is higher curse then lower time; survival and kills take the highest", () => {
  const lb = (f: [number, number] | null, s = 0, k = 0) => sv({ lb_best: { f, s, k } });
  assert.deepEqual(mergeSaves(lb([1, 600], 700, 900), lb([2, 800], 650, 1200), E).lb_best, { f: [2, 800], s: 700, k: 1200 });
  assert.deepEqual(mergeSaves(lb([2, 600]), lb([2, 500]), E).lb_best.f, [2, 500]);
  assert.deepEqual(mergeSaves(lb(null), lb([0, 900]), E).lb_best.f, [0, 900]);
  assert.deepEqual(mergeSaves(lb([0, 900]), lb(null), E).lb_best.f, [0, 900]);
});

test("merged values stay inside the validator's ranges", () => {
  const big = sv({ gold: 1_500_000_000, runs: 9_000_000, pumpkin_crowns: 900_000 });
  const m = mergeSaves(big, big, E);
  assert.equal(m.gold, 2_000_000_000);
  assert.equal(m.runs, 10_000_000);
  assert.equal(m.pumpkin_crowns, 1_000_000);
  assert.equal(validateSave(m).ok, true);
});

test("merge does not change its inputs", () => {
  const cloud = sv({ runs: 3, meta: { might: 1 }, chars: [0, 1], codex: { items: { "w:bolt": { seen: 1, taken: 1 } }, enemies: {} } });
  const device = sv({ runs: 5, meta: { hp: 2 }, chars: [0, 2] });
  const before = canon([cloud, device]);
  mergeSaves(cloud, device, E);
  assert.equal(canon([cloud, device]), before);
});

test("canon ignores key order", () => {
  assert.equal(canon({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } }), canon({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }));
});

test("validateSave accepts a full save and rejects bad extra fields", () => {
  assert.equal(validateSave(sv()).ok, true);
  assert.equal(validateSave(sv({ last_event: "harvest", lb_best: { f: [5, 1200], s: 1200, k: 50000 }, lb_ranks: { kills: 3 } })).ok, true);
  for (const bad of [
    { char: 64 }, { curse: 6 }, { tut: 1 }, { muted: "no" }, { last_event: "Bad Event" },
    { lb_best: { f: [6, 10], s: 0, k: 0 } }, { lb_best: { f: null, s: 1201, k: 0 } }, { lb_best: null },
    { lb_ranks: { kills: 0 } }, { lb_ranks: [] }, { gold: -1 },
  ])
    assert.equal(validateSave({ ...sv(), ...bad }).ok, false, JSON.stringify(bad));
});

test("validateSave drops unknown leaderboard boards", () => {
  const r = validateSave({ ...sv(), lb_ranks: { fastest: 4, weekly: 2 } });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value.lb_ranks, { fastest: 4 });
});

test("validatePush needs a UUID, and base with base_version", () => {
  const push = (o: Record<string, unknown> = {}) => ({ install_id: ID, save: sv(), base: null, base_version: null, ...o });
  assert.equal(validatePush(push()).ok, true);
  assert.equal(validatePush(push({ base: sv(), base_version: 3 })).ok, true);
  assert.equal(validatePush(push({ base: sv() })).ok, false);
  assert.equal(validatePush(push({ base_version: 3 })).ok, false);
  assert.equal(validatePush(push({ base: sv(), base_version: 0 })).ok, false);
  assert.equal(validatePush(push({ install_id: "nope" })).ok, false);
  assert.equal(validatePush(push({ save: { ...sv(), curse: 9 } })).ok, false);
  const r = validatePush(push({ install_id: ID.replace(/1/g, "A") }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.install_id, ID.replace(/1/g, "a"));
});
