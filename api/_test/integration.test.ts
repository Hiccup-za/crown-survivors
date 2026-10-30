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

  before(async () => {
    Object.assign(process.env, {
      BETTER_AUTH_URL: BASE,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      ADMIN_EMAILS: ADMIN,
      RESEND_API_KEY: "re_test",
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).startsWith("https://api.resend.com/")) {
        emails.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "x" }), { status: resendStatus });
      }
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
      telemetry_limits, telemetry_ip_installs CASCADE`);
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
      for (const p of ["/players?from=2026-10-01&to=2026-10-08", "/players/user/u1", `/players/install/${ANON}`, "/leaderboard"])
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

    test("filters by handle and by install id prefix", async () => {
      const byHandle = await (await get("/players?from=2026-10-01&to=2026-10-08&q=PLAYER")).json();
      assert.deepEqual(byHandle.rows.map((r: { user_id: string }) => r.user_id), ["u1"]);
      const byInstall = await (await get(`/players?from=2026-10-01&to=2026-10-08&q=${ANON.slice(0, 30)}`)).json();
      assert.deepEqual(byInstall.rows.map((r: { install_id: string }) => r.install_id), [ANON]);
      const wildcard = await (await get("/players?from=2026-10-01&to=2026-10-08&q=%25")).json();
      assert.equal(wildcard.rows.length, 0, "% is matched literally");
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
});
