// Pure logic: no database, network or clock. See the PR #11 test plan (R1, R4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAdmin, isAdminEmail, parseRange } from "../src/admin.js";
import { ipHash, validateTelemetry } from "../src/telemetry.js";
import { publicUrl } from "../src/origins.js";

function withAdmins(value: string | undefined, fn: () => void) {
  const prev = process.env.ADMIN_EMAILS;
  if (value === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prev;
  }
}

test("R1 isAdminEmail matches listed emails regardless of case and spaces", () =>
  withAdmins(" Admin@Example.com , second@example.com", () => {
    assert.equal(isAdminEmail("admin@example.com"), true);
    assert.equal(isAdminEmail("  ADMIN@example.COM "), true);
    assert.equal(isAdminEmail("second@example.com"), true);
    assert.equal(isAdminEmail("someone@example.com"), false);
    assert.equal(isAdminEmail(null), false);
    assert.equal(isAdminEmail(""), false);
  }));

test("R1 isAdminEmail allows nobody when ADMIN_EMAILS is empty or unset", () => {
  withAdmins("", () => assert.equal(isAdminEmail("admin@example.com"), false));
  withAdmins(" , ", () => assert.equal(isAdminEmail("admin@example.com"), false));
  withAdmins(undefined, () => assert.equal(isAdminEmail("admin@example.com"), false));
});

test("R1 isAdmin needs a verified email that is listed", () =>
  withAdmins("admin@example.com", () => {
    assert.equal(isAdmin({ email: "admin@example.com", emailVerified: true }), true);
    // An X sign-in with the same address but no verified email is not an admin.
    assert.equal(isAdmin({ email: "admin@example.com", emailVerified: false }), false);
    assert.equal(isAdmin({ email: "admin@example.com", emailVerified: null }), false);
    assert.equal(isAdmin({ email: "other@example.com", emailVerified: true }), false);
  }));

test("R4 parseRange accepts up to 120 days and rejects bad ranges", () => {
  assert.deepEqual(parseRange("2026-01-01", "2026-05-01"), { from: "2026-01-01", to: "2026-05-01" }); // 120 days
  assert.equal(parseRange("2026-01-01", "2026-05-02"), null); // 121 days
  assert.deepEqual(parseRange("2026-10-28", "2026-10-29"), { from: "2026-10-28", to: "2026-10-29" });
  assert.equal(parseRange("2026-10-28", "2026-10-28"), null);
  assert.equal(parseRange("2026-10-29", "2026-10-28"), null);
  assert.equal(parseRange("2026-10-28", undefined), null);
  assert.equal(parseRange("28-10-2026", "2026-11-01"), null);
  assert.equal(parseRange("2026-13-01", "2026-13-05"), null);
});

test("R4 ipHash is null without an IP and changes with the day", () => {
  assert.equal(ipHash(undefined), null);
  assert.equal(ipHash(""), null);
  const a = ipHash("203.0.113.7", new Date("2026-10-30T12:00:00Z"));
  assert.equal(a, ipHash("203.0.113.7", new Date("2026-10-30T23:59:59Z")));
  assert.notEqual(a, ipHash("203.0.113.7", new Date("2026-10-31T00:00:00Z")));
  assert.notEqual(a, ipHash("203.0.113.8", new Date("2026-10-30T12:00:00Z")));
});

const ID = "11111111-1111-4111-8111-111111111111";
const snap = () => ({
  gold: 0, pumpkin_crowns: 0, runs: 0, wins: 0, kills: 0, best_s: 0, max_curse: 0,
  meta: {}, chars: [0], wins_by: {}, pumpkin_by: {}, codex: {},
});
const run = (o: Record<string, unknown> = {}) => ({
  mode: "classic", hero: "king-cube", result: "death", time_s: 60, kills: 10, level: 1, gold_earned: 0, ...o,
});
const ping = (o: Record<string, unknown> = {}) => ({ v: 1, install_id: ID, session_id: ID, touch: false, snap: snap(), run: run(), ...o });
const ok = (body: unknown) => validateTelemetry(body).ok;

test("R4 validateTelemetry accepts a valid ping and a ping with no snap or run", () => {
  assert.equal(ok(ping()), true);
  assert.equal(ok(ping({ snap: null, run: null })), true);
});

test("R4 validateTelemetry rejects bad envelopes", () => {
  assert.equal(ok(null), false);
  assert.equal(ok([]), false);
  assert.equal(ok(ping({ v: 2 })), false);
  assert.equal(ok(ping({ install_id: "not-a-uuid" })), false);
  assert.equal(ok(ping({ session_id: 7 })), false);
});

test("R4 validateTelemetry checks run boundaries", () => {
  assert.equal(ok(ping({ run: run({ time_s: 0 }) })), true);
  assert.equal(ok(ping({ run: run({ time_s: 86400 }) })), true);
  assert.equal(ok(ping({ run: run({ time_s: 86401 }) })), false);
  assert.equal(ok(ping({ run: run({ time_s: 1.5 }) })), false);
  assert.equal(ok(ping({ run: run({ curse: 5 }) })), true);
  assert.equal(ok(ping({ run: run({ curse: 6 }) })), false);
  assert.equal(ok(ping({ run: run({ level: 1 }) })), true);
  assert.equal(ok(ping({ run: run({ level: 0 }) })), false);
  assert.equal(ok(ping({ run: run({ mode: "ranked" }) })), false);
  assert.equal(ok(ping({ run: run({ hero: "<script>" }) })), false);
});

test("R4 validateTelemetry drops bad nested entries from old saves instead of rejecting", () => {
  const r = validateTelemetry(ping({ snap: { ...snap(), meta: { might: 3, "bad key!": 2, hp: -1, speed: "5" } } }));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value.snap?.meta, { might: 3 });
  // A wrong type for the whole map is still an error.
  assert.equal(ok(ping({ snap: { ...snap(), meta: [1, 2] } })), false);
});

test("R4 validateTelemetry lowercases ids", () => {
  const r = validateTelemetry(ping({ install_id: ID.toUpperCase().replace(/1/g, "A") }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.install_id, ID.replace(/1/g, "a"));
});

test("publicUrl uses the branch URL on Vercel previews and BETTER_AUTH_URL elsewhere", () => {
  const prod = "https://crown-survivors.vercel.app";
  const branch = "crown-survivors-git-feature-x-team.vercel.app";
  assert.equal(publicUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: branch, BETTER_AUTH_URL: prod }), `https://${branch}`);
  assert.equal(publicUrl({ VERCEL_ENV: "production", VERCEL_BRANCH_URL: branch, BETTER_AUTH_URL: prod }), prod);
  assert.equal(publicUrl({ VERCEL_ENV: "preview", BETTER_AUTH_URL: prod }), prod);
  assert.equal(publicUrl({ BETTER_AUTH_URL: "http://localhost:3000" }), "http://localhost:3000");
});
