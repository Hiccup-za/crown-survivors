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
  let app: typeof import("../src/app.js").app;
  let pool: typeof import("../src/db.js").pool;
  let ipHash: typeof import("../src/telemetry.js").ipHash;

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
    ({ app } = await import("../src/app.js"));
    ({ pool } = await import("../src/db.js"));
    ({ ipHash } = await import("../src/telemetry.js"));
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
