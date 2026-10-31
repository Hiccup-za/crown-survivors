// HTTP + Postgres through the Hono app. Needs DATABASE_URL pointing at a throwaway database with
// migrations applied (tables are truncated). Resend is stubbed. See the PR #11 test plan (R1-R4).
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

const DB = process.env.DATABASE_URL;
// The suite truncates tables, so refuse anything that is not a local *_test database (e.g. production Neon).
if (DB) {
  const u = new URL(DB);
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || !u.pathname.endsWith("_test"))
    throw new Error(`Integration tests truncate tables: DATABASE_URL must be a local *_test database, got ${u.hostname}${u.pathname}`);
}
const BASE = "http://localhost:3000";
const ADMIN = "admin@example.com";

describe("integration", { skip: !DB && "DATABASE_URL is not set" }, () => {
  let app: typeof import("../_src/app.js").app;
  let pool: typeof import("../_src/db.js").pool;
  let ipHash: typeof import("../_src/telemetry.js").ipHash;

  // Resend calls are captured; every other fetch goes through.
  const realFetch = globalThis.fetch;
  let emails: { to: string[]; text: string }[] = [];
  let resendStatus = 200;
  // X OAuth answers for the guest upgrade tests: the profile users/me returns.
  let xProfile: { id: string; name: string; username: string; profile_image_url: string } | null = null;

  before(async () => {
    Object.assign(process.env, {
      BETTER_AUTH_URL: BASE,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      ADMIN_EMAILS: ADMIN,
      RESEND_API_KEY: "re_test",
      X_CLIENT_ID: "x-client",
      X_CLIENT_SECRET: "x-secret",
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).startsWith("https://api.resend.com/")) {
        emails.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "x" }), { status: resendStatus });
      }
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://api.x.com/2/oauth2/token")
        return Response.json({ access_token: "x-access", token_type: "bearer", expires_in: 7200, scope: "users.read tweet.read" });
      if (url.startsWith("https://api.x.com/2/users/me"))
        return url.includes("confirmed_email") ? Response.json({ data: {} }) : Response.json({ data: xProfile });
      return realFetch(input, init);
    }) as typeof fetch;
    ({ app } = await import("../_src/app.js"));
    ({ pool } = await import("../_src/db.js"));
    ({ ipHash } = await import("../_src/telemetry.js"));
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await pool?.end();
  });

  beforeEach(async () => {
    emails = [];
    resendStatus = 200;
    await pool.query(`TRUNCATE "user", verification, telemetry_runs, telemetry_sessions, player_snapshots,
      telemetry_limits, telemetry_ip_installs, player_saves, player_save_devices, save_limits CASCADE`);
  });

  const requestLink = (email: string, callbackURL = "/admin") =>
    app.request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ email, callbackURL, errorCallbackURL: callbackURL }),
    });
  const linkFromEmail = () => emails[0].text.match(/https?:\/\/\S+/)![0];
  const cookieFrom = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const stats = (headers: Record<string, string> = {}) => app.request(`${BASE}/api/admin/stats?from=2026-10-01&to=2026-10-08`, { headers });
  const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n);

  describe("magic link", () => {
    test("R2 an admin email gets one link to the verify endpoint", async () => {
      const res = await requestLink(ADMIN);
      assert.equal(res.status, 200);
      assert.equal(emails.length, 1);
      assert.deepEqual(emails[0].to, [ADMIN]);
      assert.ok(linkFromEmail().startsWith(`${BASE}/api/auth/magic-link/verify?token=`));
    });

    test("R2 any other email gets the same reply, no email and no account", async () => {
      const res = await requestLink("stranger@example.com");
      assert.equal(res.status, 200);
      assert.equal(emails.length, 0);
      assert.equal(await count(`SELECT count(*) AS n FROM "user"`), 0);
    });

    test("R3 a valid link signs in once and redirects to /admin; reuse fails", async () => {
      await requestLink(ADMIN);
      const link = linkFromEmail();
      const first = await app.request(link);
      assert.equal(first.status, 302);
      // A relative callbackURL resolves against Better Auth's baseURL, the host that just set the cookie.
      assert.equal(first.headers.get("location"), `${BASE}/admin`);
      const cookie = cookieFrom(first);
      assert.match(cookie, /session_token=/);
      assert.equal((await stats({ Cookie: cookie })).status, 200, "R1 the admin can read stats");

      const again = await app.request(link);
      assert.equal(again.status, 302);
      assert.match(again.headers.get("location") ?? "", /^http:\/\/localhost:3000\/admin\?error=/);
    });

    test("R3 an expired link fails", async () => {
      await requestLink(ADMIN);
      await pool.query(`UPDATE verification SET "expiresAt" = now() - interval '1 minute'`);
      const res = await app.request(linkFromEmail());
      assert.equal(res.status, 302);
      assert.match(res.headers.get("location") ?? "", /^http:\/\/localhost:3000\/admin\?error=/);
      assert.equal(res.headers.getSetCookie().some((c) => /session_token=[^;]+/.test(c) && !/Max-Age=0/i.test(c)), false);
    });

    test("R3 a callbackURL on another origin is rejected", async () => {
      const res = await requestLink(ADMIN, "https://evil.example/admin");
      assert.equal(res.status, 403);
      assert.equal(emails.length, 0);
    });

    test("R3 a Resend failure returns an error instead of a false success", async () => {
      resendStatus = 500;
      const res = await requestLink(ADMIN);
      assert.ok(res.status >= 500, `expected 5xx, got ${res.status}`);
    });
  });

  test("health reports the environment so /admin can label its data", async () => {
    const body = await (await app.request(`${BASE}/api/health`)).json();
    assert.deepEqual(body, { ok: true, service: "crown-survivors-api", env: process.env.VERCEL_ENV ?? "development" });
  });

  describe("admin stats access", () => {
    test("R1 signed out gets 401", async () => {
      assert.equal((await stats()).status, 401);
    });

    test("R1 an X user whose email is listed but not verified gets 403", async () => {
      await pool.query(`INSERT INTO "user" (id, name, email, "emailVerified", handle) VALUES ('u1', 'X user', $1, false, 'xuser')`, [ADMIN]);
      await pool.query(`INSERT INTO session (id, "expiresAt", token, "userId") VALUES ('s1', now() + interval '1 day', 'tok-x-user', 'u1')`);
      assert.equal((await stats({ Authorization: "Bearer tok-x-user" })).status, 403);
    });
  });

  describe("admin players", () => {
    const A1 = "00000000-0000-4000-8000-0000000000a1", A2 = "00000000-0000-4000-8000-0000000000a2";
    const ANON = "00000000-0000-4000-8000-0000000000b1", OLD = "00000000-0000-4000-8000-0000000000c1";
    const DAY = "2026-10-05 12:00+02";
    let cookie = "";

    const get = (path: string) => app.request(`${BASE}/api/admin${path}`, { headers: { Cookie: cookie } });
    const session = (install: string, user: string | null, at = DAY) =>
      pool.query(`INSERT INTO telemetry_sessions (session_id, install_id, user_id, started_at, last_seen) VALUES (gen_random_uuid(), $1, $2, $3, $3)`, [install, user, at]);
    const snapshot = (install: string, user: string | null, gold: number, lastSeen = DAY) =>
      pool.query(
        `INSERT INTO player_snapshots (install_id, user_id, gold, pumpkin_crowns, runs, wins, kills, best_s, max_curse, codex_items,
           codex_enemies, meta, chars, wins_by, pumpkin_by, codex, first_seen, last_seen)
         VALUES ($1, $2, $3, 0, 4, 1, 100, 300, 1, 12, 5, '{"might":3}', '[0,1]', '{}', '{}', '{"items":{},"enemies":{}}', $4, $4)`,
        [install, user, gold, lastSeen],
      );

    beforeEach(async () => {
      await requestLink(ADMIN);
      cookie = cookieFrom(await app.request(linkFromEmail()));
      await pool.query(`INSERT INTO "user" (id, name, email, handle) VALUES ('u1', 'Player One', 'u1@x.invalid', 'playerone'), ('u2', 'Second', 'u2@x.invalid', 'second')`);
      // u1: phone (played signed out first, then signed in) and laptop, with different saves.
      await session(A1, null, "2026-10-04 09:00+02");
      await session(A1, "u1", "2026-10-05 10:00+02");
      await snapshot(A1, "u1", 500, "2026-10-05 10:00+02");
      await session(A2, "u1", "2026-10-06 10:00+02");
      await snapshot(A2, "u1", 900, "2026-10-06 10:00+02");
      await pool.query(`INSERT INTO telemetry_runs (install_id, session_id, user_id, mode, hero, result, time_s, kills, level, gold_earned, created_at)
        VALUES ($1, gen_random_uuid(), NULL, 'classic', 'king-cube', 'death', 200, 50, 5, 30, '2026-10-04 09:30+02')`, [A1]);
      await pool.query(`INSERT INTO scores (user_id, hero, curse, won, time_s, kills, bosses, created_at) VALUES ('u1', 'king-cube', 0, false, 300, 120, 2, $1)`, [DAY]);
      // An anonymous player, and one only active outside the range.
      await session(ANON, null);
      await snapshot(ANON, null, 70);
      await session(OLD, null, "2026-09-01 12:00+02");
    });

    test("signed out gets 401 on every admin route", async () => {
      cookie = "";
      for (const p of ["/players?from=2026-10-01&to=2026-10-08", "/players/user/u1", `/players/install/${ANON}`, "/leaderboard", "/events/harvest-2026/leaderboard"])
        assert.equal((await get(p)).status, 401, p);
    });

    test("lists each account once across its devices, and anonymous installs on their own", async () => {
      const { rows, truncated } = await (await get("/players?from=2026-10-01&to=2026-10-08")).json();
      assert.equal(truncated, false);
      assert.equal(rows.length, 2);
      const u1 = rows.find((r: { user_id: string }) => r.user_id === "u1");
      assert.equal(u1.handle, "playerone");
      assert.equal(u1.devices, 2);
      assert.equal(u1.gold, 900, "gold comes from the most recently seen device");
      assert.equal(u1.runs, 1, "the run played before signing in still counts for the account");
      assert.equal(u1.install_id, null);
      const anon = rows.find((r: { install_id: string }) => r.install_id === ANON);
      assert.equal(anon.user_id, null);
      assert.equal(anon.gold, 70);
    });

    test("hour ranges roll with the clock and bucket stats by hour", async () => {
      await session(ANON, null, new Date().toISOString());
      await session(OLD, null, new Date(Date.now() - 30 * 3_600_000).toISOString());
      const players = async (h: number) => (await (await get(`/players?hours=${h}`)).json()).rows.map((r: { install_id: string }) => r.install_id);
      assert.deepEqual(await players(24), [ANON]);
      assert.deepEqual((await players(48)).sort(), [ANON, OLD].sort());
      const s = await (await get("/stats?hours=24")).json();
      assert.equal(s.range.bucket, "hour");
      assert.equal(s.daily.length, 24);
      assert.match(s.daily[0].day, /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
      assert.equal(s.daily.at(-1).players, 1, "the current hour is the last bucket");
      assert.equal(s.kpis.players, 1);
      assert.equal((await get("/stats?hours=0")).status, 400);
      assert.equal((await get("/stats?hours=169")).status, 400);
    });

    test("filters by handle and by install id prefix", async () => {
      const byHandle = await (await get("/players?from=2026-10-01&to=2026-10-08&q=PLAYER")).json();
      assert.deepEqual(byHandle.rows.map((r: { user_id: string }) => r.user_id), ["u1"]);
      const byInstall = await (await get(`/players?from=2026-10-01&to=2026-10-08&q=${ANON.slice(0, 30)}`)).json();
      assert.deepEqual(byInstall.rows.map((r: { install_id: string }) => r.install_id), [ANON]);
      const wildcard = await (await get("/players?from=2026-10-01&to=2026-10-08&q=%25")).json();
      assert.equal(wildcard.rows.length, 0, "% is matched literally");
    });

    test("the cloud save is the account's one save in the list and the profile; device saves stay as history", async () => {
      assert.equal((await (await get("/players/user/u1")).json()).save, null, "no cloud save until the account syncs");
      await pool.query(
        `INSERT INTO player_saves (user_id, version, install_id, gold, pumpkin_crowns, runs, wins, kills, best_s, max_curse, codex_items,
           codex_enemies, meta, chars, wins_by, pumpkin_by, codex, char, curse, tut, muted, gore, last_event, lb_best, lb_ranks, updated_at)
         VALUES ('u1', 3, $1, 1400, 0, 8, 2, 200, 300, 1, 12, 5, '{"might":3}', '[0,1]', '{}', '{}', '{"items":{},"enemies":{}}',
           1, 0, true, false, false, NULL, '{"f":null,"s":300,"k":120}', '{}', '2026-10-04 12:00+02')`,
        [A1],
      );
      const u1 = (await (await get("/players?from=2026-10-01&to=2026-10-08")).json()).rows.find((r: { user_id: string }) => r.user_id === "u1");
      assert.equal(u1.gold, 1400, "the cloud save wins over a more recently seen device");
      assert.equal(u1.total_runs, 8);
      const p = await (await get("/players/user/u1")).json();
      assert.equal(p.save.gold, 1400);
      assert.equal(p.save.kills, 200);
      assert.equal(p.save.version, 3);
      assert.equal(p.save.install_id, A1);
      assert.equal(p.devices.length, 2);
      assert.equal(p.devices[0].snapshot.gold, 900);
    });

    test("a user profile has every device's save, runs and leaderboard standing", async () => {
      const p = await (await get("/players/user/u1")).json();
      assert.equal(p.kind, "user");
      assert.equal(p.user.handle, "playerone");
      assert.deepEqual(p.devices.map((d: { install_id: string }) => d.install_id), [A2, A1], "newest device first");
      assert.equal(p.devices[0].snapshot.gold, 900);
      assert.deepEqual(p.devices[0].snapshot.meta, { might: 3 });
      assert.equal(p.devices[1].sessions, 2);
      assert.equal(p.runs.total, 1);
      assert.equal(p.boards.survival.rank, 1);
      assert.equal(p.boards.fastest.rank, null, "no win, so not on the fastest board");
    });

    test("an install that signed in resolves to its account; an anonymous one stands alone", async () => {
      assert.equal((await (await get(`/players/install/${A1}`)).json()).user.id, "u1");
      const anon = await (await get(`/players/install/${ANON}`)).json();
      assert.equal(anon.kind, "install");
      assert.equal(anon.user, null);
      assert.equal(anon.boards, null);
      assert.equal(anon.devices[0].snapshot.gold, 70);
    });

    test("unknown ids get 404 and malformed ids 400", async () => {
      assert.equal((await get("/players/user/nobody")).status, 404);
      assert.equal((await get("/players/install/00000000-0000-4000-8000-00000000ffff")).status, 404);
      assert.equal((await get("/players/install/not-a-uuid")).status, 400);
      assert.equal((await get("/players/user/bad%20id")).status, 400);
    });

    test("the admin leaderboard carries user_id; the public one does not", async () => {
      const admin = await (await get("/leaderboard?board=survival")).json();
      assert.equal(admin.rows[0].user_id, "u1");
      const pub = await (await app.request(`${BASE}/api/leaderboard?board=survival`)).json();
      assert.equal("user_id" in pub.rows[0], false);
    });

    test("the admin event boards carry user_id on every board", async () => {
      await pool.query(`INSERT INTO event_scores (event_id, user_id, hero, time_s, kills, crowns, rituals, first_crown_s)
        VALUES ('harvest-2026', 'u1', 'pumpkin-prince', 700, 900, 1, 4, 250)`);
      for (const b of ["crowns", "fastest", "survival", "kills"]) {
        const res = await (await get(`/events/harvest-2026/leaderboard?board=${b}`)).json();
        assert.deepEqual([res.rows.length, res.rows[0].user_id], [1, "u1"], b);
      }
      assert.equal((await get("/events/harvest-2026/leaderboard?board=nope")).status, 400);
      assert.equal((await get("/events/nope/leaderboard")).status, 404);
    });
  });

  describe("telemetry", () => {
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const ping = (install: number, ip: string, run = false) =>
      app.request(`${BASE}/api/t`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({
          v: 1, install_id: uuid(install), session_id: uuid(install), touch: false, snap: null,
          run: run ? { mode: "classic", hero: "king-cube", result: "death", time_s: 60, kills: 10, level: 1, gold_earned: 5 } : null,
        }),
      });

    test("R4 an oversized body gets 413", async () => {
      const res = await app.request(`${BASE}/api/t`, { method: "POST", body: "x".repeat(32 * 1024 + 1) });
      assert.equal(res.status, 413);
    });

    test("R4 the 121st request in a window gets 429", async () => {
      const ip = "203.0.113.10";
      assert.equal((await ping(1, ip)).status, 200);
      // Jump the counter to the limit rather than sending 119 more requests.
      await pool.query(`UPDATE telemetry_limits SET hits = 120 WHERE ip_hash = $1`, [ipHash(ip)]);
      assert.equal((await ping(1, ip)).status, 429);
    });

    test("R4 the 21st new install from one IP in a day gets 429; known installs still pass", async () => {
      const ip = "203.0.113.20";
      for (let i = 1; i <= 20; i++) assert.equal((await ping(i, ip)).status, 200, `install ${i}`);
      assert.equal((await ping(21, ip)).status, 429);
      assert.equal((await ping(5, ip)).status, 200);
    });

    test("R4 a second run from the same install within 5 s is dropped", async () => {
      const ip = "203.0.113.30";
      assert.deepEqual(await (await ping(1, ip, true)).json(), { ok: true, run: true });
      assert.deepEqual(await (await ping(1, ip, true)).json(), { ok: true, run: false });
      assert.equal(await count(`SELECT count(*) AS n FROM telemetry_runs`), 1);
    });
  });

  describe("cloud save", () => {
    const DEV_A = "aaaaaaaa-0000-4000-8000-000000000001";
    const DEV_B = "bbbbbbbb-0000-4000-8000-000000000002";
    const save = (o: Record<string, unknown> = {}) => ({
      gold: 0, pumpkin_crowns: 0, runs: 0, wins: 0, kills: 0, best_s: 0, max_curse: 0, meta: {}, chars: [0], wins_by: {},
      pumpkin_by: {}, codex: { items: {}, enemies: {} }, char: 0, curse: 0, tut: false, muted: false, gore: false,
      last_event: null, lb_best: { f: null, s: 0, k: 0 }, lb_ranks: {}, ...o,
    });
    type Res = { save: ReturnType<typeof save>; version: number };
    const auth = { Authorization: "Bearer tok-1" };
    const get = (headers: Record<string, string> = auth) => app.request(`${BASE}/api/save`, { headers });
    const put = (body: unknown, headers: Record<string, string> = auth) =>
      app.request(`${BASE}/api/save`, { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const push = async (install_id: string, s: unknown, base: unknown = null, base_version: number | null = null) => {
      const res = await put({ install_id, save: s, base, base_version });
      assert.equal(res.status, 200);
      return (await res.json()) as Res;
    };

    beforeEach(async () => {
      await pool.query(`INSERT INTO "user" (id, name, email, handle) VALUES ('u1', 'Player One', 'u1@x.invalid', 'playerone')`);
      await pool.query(`INSERT INTO session (id, "expiresAt", token, "userId") VALUES ('s1', now() + interval '1 day', 'tok-1', 'u1')`);
    });

    test("signed-out requests get 401", async () => {
      assert.equal((await get({})).status, 401);
      assert.equal((await put({ install_id: DEV_A, save: save(), base: null, base_version: null }, {})).status, 401);
    });

    test("an account with no save gets nulls", async () => {
      assert.deepEqual(await (await get()).json(), { save: null, version: null });
    });

    test("a never-linked device's first push becomes the save, in audit columns", async () => {
      const s = save({ gold: 340, runs: 7, kills: 900, meta: { might: 2 }, chars: [0, 1], char: 1, muted: true,
        codex: { items: { "w:bolt": { seen: 1, taken: 3 } }, enemies: { blob: { seen: 1, kills: 50 } } } });
      const r = await push(DEV_A, s);
      assert.equal(r.version, 1);
      assert.deepEqual(r.save, s);
      assert.deepEqual(await (await get()).json(), { save: s, version: 1 });
      const row = (await pool.query(`SELECT install_id::text, gold, runs, kills, codex_items, codex_enemies, char, muted FROM player_saves WHERE user_id = 'u1'`)).rows[0];
      assert.deepEqual(row, { install_id: DEV_A, gold: 340, runs: 7, kills: "900", codex_items: 1, codex_enemies: 1, char: 1, muted: true });
    });

    test("a second never-linked device is merged in once", async () => {
      await push(DEV_A, save({ runs: 10, gold: 100 }));
      const r = await push(DEV_B, save({ runs: 4, gold: 50 }));
      assert.equal(r.save.runs, 14);
      assert.equal(r.save.gold, 150);
      assert.equal(r.version, 2);
    });

    test("devices playing at the same time both keep their progress", async () => {
      const v1 = await push(DEV_A, save({ runs: 10 }));
      const linked = await push(DEV_B, save()); // B links with nothing new and receives the cloud save
      assert.equal(linked.version, 1);
      const b = await push(DEV_B, save({ runs: 13 }), linked.save, linked.version);
      const a = await push(DEV_A, save({ runs: 12 }), v1.save, v1.version);
      assert.equal(b.save.runs, 13);
      assert.equal(a.save.runs, 15);
    });

    test("a push repeated after a lost response is not counted twice", async () => {
      const v1 = await push(DEV_A, save({ runs: 10 }));
      await push(DEV_A, save({ runs: 12 }), v1.save, v1.version); // response lost: device still has base v1
      const r = await push(DEV_A, save({ runs: 13 }), v1.save, v1.version);
      assert.equal(r.save.runs, 13);
    });

    test("a push with nothing new does not bump the version", async () => {
      const v1 = await push(DEV_A, save({ runs: 3 }));
      const r = await push(DEV_A, v1.save, v1.save, v1.version);
      assert.equal(r.version, 1);
      assert.equal(await count(`SELECT count(*) AS n FROM player_save_devices WHERE user_id = 'u1'`), 1);
    });

    test("bad bodies get 400, oversized 413", async () => {
      assert.equal((await put({ install_id: DEV_A, save: save({ curse: 9 }), base: null, base_version: null })).status, 400);
      assert.equal((await put({ install_id: DEV_A, save: save(), base: save(), base_version: null })).status, 400);
      const big = await app.request(`${BASE}/api/save`, { method: "PUT", headers: auth, body: "x".repeat(128 * 1024 + 1) });
      assert.equal(big.status, 413);
    });

    test("the 121st push in a window gets 429 and changes nothing", async () => {
      await push(DEV_A, save({ runs: 1 }));
      await pool.query(`UPDATE save_limits SET hits = 120 WHERE user_id = 'u1'`);
      const res = await put({ install_id: DEV_A, save: save({ runs: 2 }), base: null, base_version: null });
      assert.equal(res.status, 429);
      assert.equal(((await (await get()).json()) as Res).save.runs, 1);
    });

    test("deleting the account deletes its save", async () => {
      await push(DEV_A, save({ runs: 1 }));
      await pool.query(`DELETE FROM "user" WHERE id = 'u1'`);
      assert.equal(await count(`SELECT count(*) AS n FROM player_saves`), 0);
      assert.equal(await count(`SELECT count(*) AS n FROM player_save_devices`), 0);
    });
  });

  describe("event boards", () => {
    const EV = "harvest-2026";
    const run = (user: string, hero: string, crowns: number, rituals: number, kills: number, first: number | null, at: string) =>
      pool.query(
        `INSERT INTO event_scores (event_id, user_id, hero, time_s, kills, crowns, rituals, first_crown_s, created_at)
         VALUES ($1, $2, $3, 600, $4, $5, $6, $7, $8)`,
        [EV, user, hero, kills, crowns, rituals, first, at],
      );
    type Row = { rank: number; handle: string; hero: string; time_s: number; crowns: number; rituals: number; kills: number; first_crown_s: number | null };
    const board = async (b: string) =>
      ((await (await app.request(`${BASE}/api/events/${EV}/leaderboard?board=${b}`)).json()) as { rows: Row[] }).rows;

    beforeEach(async () => {
      await pool.query(`INSERT INTO "user" (id, name, email, handle) VALUES
        ('u1', 'Player One', 'u1@x.invalid', 'playerone'), ('u2', 'Second', 'u2@x.invalid', 'second'), ('u3', 'Third', 'u3@x.invalid', 'third')`);
      await pool.query(`INSERT INTO session (id, "expiresAt", token, "userId") VALUES ('s1', now() + interval '1 day', 'tok-1', 'u1')`);
      // u1: a crown then death late in Night 2, a crown then death early in Night 2 (new hero), then a run with no crown.
      await run("u1", "king-cube", 1, 7, 1771, 239, "2026-10-31 00:12+02");
      await run("u1", "pumpkin-prince", 1, 4, 900, 250, "2026-10-31 00:30+02");
      await run("u1", "king-cube", 0, 2, 300, null, "2026-10-31 00:40+02");
      await run("u2", "king-cube", 1, 5, 1827, 302, "2026-10-31 00:29+02");
      await run("u3", "king-cube", 0, 1, 50, null, "2026-10-31 00:35+02");
    });

    test("most crowns totals every run's crowns and shows the hero of the latest crowning run", async () => {
      assert.deepEqual(
        (await board("crowns")).map((r) => [r.rank, r.handle, r.crowns, r.rituals, r.hero]),
        [[1, "playerone", 2, 13, "pumpkin-prince"], [2, "second", 1, 5, "king-cube"], [3, "third", 0, 1, "king-cube"]],
      );
      const me = (await (await app.request(`${BASE}/api/events/${EV}/me/rank?board=crowns`, { headers: { Authorization: "Bearer tok-1" } })).json()) as {
        rank: number; total: number; row: Row;
      };
      assert.deepEqual([me.rank, me.total, me.row.crowns, me.row.hero], [1, 3, 2, "pumpkin-prince"]);
    });

    test("a tied crown total goes to whoever reached it first", async () => {
      // u3 matches u1's 2 crowns and 13 rituals, but their second crown came later.
      await run("u3", "king-cube", 1, 5, 10, 400, "2026-10-31 00:50+02");
      await run("u3", "king-cube", 1, 7, 10, 400, "2026-10-31 01:00+02");
      assert.deepEqual((await board("crowns")).slice(0, 2).map((r) => [r.rank, r.handle, r.crowns, r.rituals]), [[1, "playerone", 2, 13], [1, "third", 2, 13]]);
    });

    test("a retried run is stored once, so its crowns never count twice", async () => {
      const { insertEventScore } = await import("../_src/event-scores.js");
      const prince = { hero: "pumpkin-prince", time_s: 700, kills: 950, crowns: 1, rituals: 4, first_crown_s: 260 };
      const id = await insertEventScore(EV, "u2", prince);
      assert.ok(id);
      // the retry lands inside the 30s rate limit window and still gets the same row back
      assert.equal(await insertEventScore(EV, "u2", prince), id);
      assert.equal(await count(`SELECT count(*) AS n FROM event_scores WHERE user_id = 'u2'`), 2);
      assert.equal(await insertEventScore(EV, "u2", { ...prince, kills: 951 }), null);
      assert.deepEqual((await board("crowns")).map((r) => [r.handle, r.crowns]).find((r) => r[0] === "second"), ["second", 2]);
    });

    test("fastest crown and most kills still rank each player's best single run", async () => {
      assert.deepEqual((await board("fastest")).map((r) => [r.handle, r.first_crown_s, r.hero]), [["playerone", 239, "king-cube"], ["second", 302, "king-cube"]]);
      assert.deepEqual((await board("kills")).map((r) => [r.handle, r.kills]), [["second", 1827], ["playerone", 1771], ["third", 50]]);
    });

    test("longest survival ranks each player's longest single run, win or no crown", async () => {
      await pool.query(`UPDATE event_scores SET time_s = CASE WHEN kills = 300 THEN 1500 WHEN user_id = 'u3' THEN 900 ELSE time_s END`);
      assert.deepEqual(
        (await board("survival")).map((r) => [r.rank, r.handle, r.time_s, r.hero]),
        [[1, "playerone", 1500, "king-cube"], [2, "third", 900, "king-cube"], [3, "second", 600, "king-cube"]],
      );
    });
  });

  describe("guests", () => {
    const json = { "Content-Type": "application/json", Origin: BASE };
    const DEV = "aaaaaaaa-0000-4000-8000-000000000001";
    const save = (o: Record<string, unknown> = {}) => ({
      gold: 0, pumpkin_crowns: 0, runs: 0, wins: 0, kills: 0, best_s: 0, max_curse: 0, meta: {}, chars: [0], wins_by: {},
      pumpkin_by: {}, codex: { items: {}, enemies: {} }, char: 0, curse: 0, tut: false, muted: false, gore: false,
      last_event: null, lb_best: { f: null, s: 0, k: 0 }, lb_ranks: {}, ...o,
    });
    const score = { hero: "king-cube", curse: 0, won: false, time_s: 300, kills: 400, bosses: 2 };
    const signInGuest = async () => {
      const res = await app.request(`${BASE}/api/auth/sign-in/anonymous`, { method: "POST", headers: json, body: "{}" });
      assert.equal(res.status, 200);
      const j = (await res.json()) as { token: string; user: { id: string; name: string } };
      return { ...j, cookie: cookieFrom(res), auth: { Authorization: `Bearer ${j.token}` } };
    };
    const me = async (headers: Record<string, string>) =>
      ((await (await app.request(`${BASE}/api/me`, { headers })).json()) as { user: { id: string; name: string; handle: string | null; guest: boolean; merged: string[] } | null }).user;
    const post = (path: string, body: unknown, headers: Record<string, string>) =>
      app.request(`${BASE}${path}`, { method: path === "/api/save" ? "PUT" : "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) });
    /** POST /auth/x as the guest, then X's redirect back to the callback. Returns the handoff response. */
    const signInX = async (guest: { auth: Record<string, string> } | null, profile: NonNullable<typeof xProfile>) => {
      xProfile = profile;
      const start = await post("/auth/x", { returnTo: `${BASE}/` }, guest?.auth ?? {});
      assert.equal(start.status, 200);
      const { url } = (await start.json()) as { url: string };
      const state = new URL(url).searchParams.get("state")!;
      const cb = await app.request(`${BASE}/api/auth/callback/twitter?code=c1&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookieFrom(start) } });
      assert.equal(cb.status, 302, await cb.clone().text());
      return app.request(cb.headers.get("location")!, { headers: { Cookie: cookieFrom(cb) } });
    };
    const xPerson = { id: "x-42", name: "X Person", username: "xperson", profile_image_url: "https://pbs.twimg.com/a_normal.jpg" };

    test("a guest gets a generated name, a years-long session and a spot on the board", async () => {
      const g = await signInGuest();
      assert.match(g.user.name, /^[A-Z][a-z]+ [A-Z][a-z]+ \d{3}$/);
      assert.deepEqual(await me(g.auth), { id: g.user.id, name: g.user.name, handle: null, avatar: null, guest: true, merged: [] });
      const exp = (await pool.query(`SELECT "expiresAt" FROM session WHERE "userId" = $1`, [g.user.id])).rows[0].expiresAt as Date;
      assert.ok(exp.getTime() > Date.now() + 4 * 365 * 864e5);
      assert.equal((await post("/api/scores", score, g.auth)).status, 201);
      const lb = (await (await app.request(`${BASE}/api/leaderboard?board=survival`)).json()) as { rows: { name: string; handle: string | null }[] };
      assert.deepEqual(lb.rows.map((r) => [r.name, r.handle]), [[g.user.name, null]]);
    });

    test("the profile lists the account and its standing on every board", async () => {
      const g = await signInGuest();
      await post("/api/scores", score, g.auth);
      assert.equal((await app.request(`${BASE}/api/me/profile`)).status, 401);
      const p = (await (await app.request(`${BASE}/api/me/profile`, { headers: g.auth })).json()) as {
        user: { name: string; guest: boolean }; boards: Record<string, { rank: number | null; total: number; row: { time_s: number } | null }>;
        events: { id: string; boards: Record<string, { rank: number | null }> }[];
      };
      assert.equal(p.user.name, g.user.name);
      assert.equal(p.user.guest, true);
      assert.deepEqual([p.boards.fastest.rank, p.boards.survival.rank, p.boards.survival.total, p.boards.survival.row?.time_s], [null, 1, 1, 300]);
      assert.deepEqual(Object.keys(p.events[0]?.boards ?? {}).sort(), ["crowns", "fastest", "kills", "survival"]);
    });

    test("signing in with X merges the guest's scores and save into the new account", async () => {
      const g = await signInGuest();
      await post("/api/scores", score, g.auth);
      const pushed = (await (await post("/api/save", { install_id: DEV, save: save({ gold: 120, runs: 4 }), base: null, base_version: null }, g.auth)).json()) as { version: number };
      const hand = await signInX(g, xPerson);
      const token = decodeURIComponent(new URL(hand.headers.get("location")!).hash.match(/lb_token=([^&]+)/)![1]);
      const x = await me({ Authorization: `Bearer ${token}` });
      assert.deepEqual([x?.handle, x?.guest, x?.merged], ["xperson", false, [g.user.id]]);
      assert.equal(await count(`SELECT count(*) AS n FROM "user" WHERE id = '${g.user.id}'`), 0);
      const lb = (await (await app.request(`${BASE}/api/leaderboard?board=survival`)).json()) as { rows: { handle: string | null }[] };
      assert.deepEqual(lb.rows.map((r) => r.handle), ["xperson"]);
      const s = (await (await app.request(`${BASE}/api/save`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { save: { gold: number; runs: number }; version: number };
      assert.deepEqual([s.save.gold, s.save.runs], [120, 4]);
      assert.ok(s.version > pushed.version);
      // the guest device's next push, still based on its guest save, only adds what it played since
      const r = (await (await post("/api/save", { install_id: DEV, save: save({ gold: 150, runs: 5 }), base: save({ gold: 120, runs: 4 }), base_version: pushed.version }, { Authorization: `Bearer ${token}` })).json()) as { save: { gold: number; runs: number } };
      assert.deepEqual([r.save.gold, r.save.runs], [150, 5]);
    });

    test("signing in with X without a guest works as before", async () => {
      const hand = await signInX(null, xPerson);
      assert.match(hand.headers.get("location") ?? "", /#lb_token=/);
      assert.equal(await count(`SELECT count(*) AS n FROM guest_merges`), 0);
    });

    test("merging into an existing account adds both sides and moves event runs", async () => {
      const { mergeGuest } = await import("../_src/guests.js");
      const { pushSave } = await import("../_src/save.js");
      const g = await signInGuest();
      await pool.query(`INSERT INTO "user" (id, name, email, handle) VALUES ('u1', 'Player One', 'u1@x.invalid', 'playerone')`);
      await pushSave("u1", { install_id: "bbbbbbbb-0000-4000-8000-000000000002", save: save({ gold: 50, runs: 2, chars: [0, 1] }) as never, base: null, base_version: null });
      await pushSave(g.user.id, { install_id: DEV, save: save({ gold: 100, runs: 3 }) as never, base: null, base_version: null });
      await pool.query(`INSERT INTO event_scores (event_id, user_id, hero, time_s, kills, crowns, rituals, first_crown_s) VALUES ('harvest-2026', $1, 'king-cube', 600, 900, 1, 4, 300)`, [g.user.id]);
      assert.equal(await mergeGuest(g.user.id, "u1"), true);
      const row = (await pool.query(`SELECT gold, runs, chars FROM player_saves WHERE user_id = 'u1'`)).rows[0];
      assert.deepEqual(row, { gold: 150, runs: 5, chars: [0, 1] });
      assert.equal(await count(`SELECT count(*) AS n FROM event_scores WHERE user_id = 'u1'`), 1);
      assert.equal(await count(`SELECT count(*) AS n FROM player_save_devices WHERE user_id = 'u1'`), 2);
      assert.equal(await mergeGuest(g.user.id, "u1"), false, "a second merge finds no guest");
      await assert.rejects(mergeGuest("u1", "u1"), /not a guest/);
    });

    test("an /admin magic link in a guest's browser leaves the guest alone", async () => {
      const g = await signInGuest();
      await requestLink(ADMIN);
      const res = await app.request(linkFromEmail(), { headers: { Cookie: g.cookie } });
      assert.equal(res.status, 302);
      assert.equal(await count(`SELECT count(*) AS n FROM "user" WHERE id = '${g.user.id}'`), 1);
      assert.equal(await count(`SELECT count(*) AS n FROM guest_merges`), 0);
    });

    test("sign-out through the game's path ends the session on the server", async () => {
      const g = await signInGuest();
      assert.equal((await post("/api/auth/sign-out", {}, g.auth)).status, 200);
      assert.equal(await me(g.auth), null);
    });

    test("guests cannot rename themselves", async () => {
      const g = await signInGuest();
      assert.equal((await post("/api/auth/update-user", { name: "Admin" }, g.auth)).status, 403);
    });
  });
});
