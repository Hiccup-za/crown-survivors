# Browser end-to-end harness

How the cloud save was checked in a real browser (`feature/cloud-save`, 2026-10-30), written so it can be rebuilt as an
official, reusable test. The original was a throwaway in `api/node_modules/.cache/cloud-save-e2e/` and has been deleted;
the code below is that harness, with two additions marked **(added)** that the throwaway did not have.

It has three parts:

1. **`serve.mts`**: one local HTTP server for the game page and the real API (the Hono `app`), against a local test database.
2. **`e2e.mjs`**: Playwright drives the game as two devices and checks the database after each step.
3. **`admin.mjs`**: renders `public/admin.html` with stubbed API answers and takes screenshots.

The API unit and integration tests (`npm test` in `api/`) cover the merge and the endpoints. This harness covers what
they cannot: the game client's sync code in `public/index.html` (debounce, run end, tab hidden, offline, account switch).

## Requirements

- Local Postgres 17 (Homebrew: `/opt/homebrew/opt/postgresql@17`) with a database whose name ends in `_test`.
  This machine has `crown_test`.
- All migrations applied to it:
  ```sh
  cd api && DATABASE_URL="postgresql://localhost/crown_test" npm run migrate
  ```
  Check there is no `api/.env` first: `migrate.ts` loads it.
- Playwright and a Chromium build. The throwaway imported Playwright 1.63.0 from the npx cache
  (`~/.npm/_npx/<hash>/node_modules/playwright/index.mjs`) with browsers from `~/Library/Caches/ms-playwright`.
  Officially, add it as a dev dependency instead (see "Making it official").

**Safety.** The harness truncates tables. Like `api/_test/integration.test.ts`, it must only ever run against a local
`*_test` database. Both scripts below refuse anything else **(added)**.

## 1. The server: `serve.mts`

Serves `/` as `public/index.html` and passes everything else to the Hono app, so the game's `LB_API = '/api'` works
same-origin, as on Vercel.

```ts
// serve.mts. Run with: npx tsx serve.mts   (from a folder inside api/, so tsx and pg resolve)
import http from "node:http";
import { readFileSync } from "node:fs";

const DB = "postgresql://localhost/crown_test";
// (added) refuse anything but a local *_test database
const u = new URL(DB);
if (!["localhost", "127.0.0.1"].includes(u.hostname) || !u.pathname.endsWith("_test")) throw new Error(`not a local *_test database: ${DB}`);

// Env must be set before the app (and its db pool and Better Auth) is imported.
Object.assign(process.env, {
  DATABASE_URL: DB,
  BETTER_AUTH_URL: "http://localhost:3999",
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
});
const { app } = await import("../../../_src/app.ts"); // adjust to the script's location
const html = new URL("../../../../public/index.html", import.meta.url); // adjust likewise

http.createServer(async (req, res) => {
  if (req.url === "/" || req.url!.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(readFileSync(html));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await app.fetch(new Request("http://localhost:3999" + req.url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: ["GET", "HEAD"].includes(req.method!) ? undefined : Buffer.concat(chunks),
  }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(3999, () => console.log("listening"));
```

Gotchas:
- The file must be `.mts`, not `.ts`. `api/package.json` is `"type": "module"`, but a `.ts` file outside the project
  is compiled as CommonJS by tsx, and top-level `await` then fails with `ERR_REQUIRE_ASYNC_MODULE`.
- Start it in the background and wait for it before running the tests:
  ```sh
  for i in $(seq 1 30); do curl -s localhost:3999/api/health && break; sleep 0.5; done
  ```
- Stop it afterwards: `kill $(lsof -ti tcp:3999)`.

## 2. Seeding signed-in players

Sign-in with X cannot run locally, so the harness creates users and Better Auth sessions directly. The game sends the
session token as `Authorization: Bearer <token>` (it stores it in `localStorage["crownsurv_classic_lb"].tok`), and the
API accepts a raw session token from the `session` table.

```sh
psql "postgresql://localhost/crown_test" -qc "
  TRUNCATE \"user\" CASCADE;
  INSERT INTO \"user\" (id, name, email, handle) VALUES
    ('e2e1', 'One', 'e1@x.invalid', 'one'), ('e2e2', 'Two', 'e2@x.invalid', 'two');
  INSERT INTO session (id, \"expiresAt\", token, \"userId\") VALUES
    ('se1', now() + interval '1 day', 'tokE1', 'e2e1'), ('se2', now() + interval '1 day', 'tokE2', 'e2e2');"
```

`TRUNCATE "user" CASCADE` also empties sessions, scores, telemetry, `player_saves`, `player_save_devices` and
`save_limits`. Between reruns without reseeding users, truncate just those:

```sh
psql "postgresql://localhost/crown_test" -qc "TRUNCATE player_saves, player_save_devices, save_limits,
  telemetry_sessions, telemetry_runs, player_snapshots, telemetry_limits, telemetry_ip_installs"
```

Running `npm test` in `api/` truncates `"user"` too, so reseed after it.

## 3. Two devices: `e2e.mjs`

Each device is its own Playwright browser context, so each gets its own `localStorage` and install id, like two
phones. A device is prepared by writing a save and a session into `localStorage` and reloading; the game then boots
signed in and syncs.

**Out of date (2026-10-30):** the game no longer exposes `window.__cs`; those console hooks were removed so players
cannot cheat from the console. Rebuilding this harness needs another way in: seed `localStorage` and reload (as above),
read state back from `localStorage`, and play runs through the UI. The script below still shows the old hooks:
- `S`: the live save; `G`: the current run
- `addGold(n)`: adds gold and calls `save()`, which schedules a push after 2 s
- `start()`, `god(on)`, `setHp(f)`: start a run and end it by dying

Storage keys: `crownsurv_classic_v1` (save), `crownsurv_classic_lb` (session and leaderboard cache),
`crownsurv_sync` (sync state: `owner`, `base`, `ver`, `stash`).

```js
// e2e.mjs. Run with: node e2e.mjs   (server from step 1 running, users from step 2 seeded)
import { chromium } from "playwright"; // the throwaway imported it from the npx cache path instead
import pg from "pg";

const DB = "postgresql://localhost/crown_test";
// (added) refuse anything but a local *_test database
const url = new URL(DB);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.endsWith("_test")) throw new Error(`not a local *_test database: ${DB}`);

const db = new pg.Client({ connectionString: DB });
await db.connect();
const B = "http://localhost:3999/";
const U = {
  e2e1: { tok: "tokE1", user: { id: "e2e1", name: "One", handle: "one", avatar: null } },
  e2e2: { tok: "tokE2", user: { id: "e2e2", name: "Two", handle: "two", avatar: null } },
};
const row = async (u) => (await db.query(`SELECT version, gold, runs, meta, install_id FROM player_saves WHERE user_id = $1`, [u])).rows[0];
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) fails++; };

const browser = await chromium.launch();
async function device(save, who) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(B);
  await page.evaluate(([s, lb]) => {
    localStorage.setItem("crownsurv_classic_v1", JSON.stringify(s));
    localStorage.setItem("crownsurv_classic_lb", JSON.stringify(lb));
  }, [save, U[who]]);
  return page; // caller reloads so the game boots with this state
}
// Resolves with "PUT 200" / "GET 200" for the next /api/save call
const synced = (page) => page.waitForResponse((r) => r.url().endsWith("/api/save"), { timeout: 8000 })
  .then((r) => r.request().method() + " " + r.status());
const S = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__cs.S)));
const signIn = async (page, who) => {
  await page.evaluate((lb) => {
    const o = JSON.parse(localStorage.getItem("crownsurv_classic_lb"));
    Object.assign(o, lb);
    localStorage.setItem("crownsurv_classic_lb", JSON.stringify(o));
  }, U[who]);
  const p = synced(page);
  await page.reload();
  return p;
};

// First sign-in on a never-linked device uploads its save
const A = await device({ gold: 500, runs: 3 }, "e2e1");
let r = synced(A); await A.reload(); console.log("A boot:", await r);
check((await row("e2e1"))?.gold === 500 && (await row("e2e1")).runs === 3, "A's first sign-in uploads its save (gold 500, runs 3)");

// A second never-linked device is merged in once
const Bp = await device({ gold: 200, runs: 2, meta: { might: 1 }, muted: true }, "e2e1");
r = synced(Bp); await Bp.reload(); console.log("B boot:", await r);
let s = await S(Bp);
check(s.gold === 700 && s.runs === 5 && s.meta.might === 1, `B is merged in once: gold ${s.gold} (want 700), runs ${s.runs} (want 5)`);
check((await row("e2e1")).gold === 700, "cloud has the merged save");

// A change on one device reaches the cloud after the 2 s debounce, and the device gets the other's progress
r = synced(A); await A.evaluate(() => window.__cs.addGold(50)); console.log("A push:", await r);
check((await row("e2e1")).gold === 750, `A's +50 gold reaches the cloud after the debounce: ${(await row("e2e1")).gold}`);
s = await S(A);
check(s.gold === 750 && s.runs === 5 && s.muted === true, `A now has B's progress and settings: gold ${s.gold}, runs ${s.runs}, muted ${s.muted}`);

// The other device picks it up on its next visit (no local changes, so a GET)
r = synced(Bp); await Bp.reload(); console.log("B reload:", await r);
s = await S(Bp);
check(s.gold === 750, `B picks up A's gold on its next visit: ${s.gold}`);

// A visit with nothing new does not bump the version
const v = (await row("e2e1")).version;
r = synced(Bp); await Bp.reload(); await r;
check((await row("e2e1")).version === v, "a visit with nothing new writes nothing");

// Signed out: progress stays local
await Bp.evaluate(() => window.__cs.addGold(10)); // still signed in in memory: the reload below pushes it (tab hidden)
await Bp.evaluate(() => {
  const o = JSON.parse(localStorage.getItem("crownsurv_classic_lb"));
  o.tok = null; o.user = null;
  localStorage.setItem("crownsurv_classic_lb", JSON.stringify(o));
});
await Bp.reload(); await Bp.evaluate(() => window.__cs.addGold(5)); await Bp.waitForTimeout(2500);
{ const g = (await row("e2e1")).gold; check(g === 760, `progress while signed out is not pushed (the +10 made signed in is): ${g}`); }

// A different account signs in on B: e2e1's unsynced +5 is set aside, e2e2 gets its own save
console.log("B as e2e2:", await signIn(Bp, "e2e2"));
s = await S(Bp);
check(s.gold === 0 && s.runs === 0, `the other account starts from its own (empty) save: gold ${s.gold}`);
check((await row("e2e2"))?.gold === 0, "the other account gets its own cloud save");
const stash = await Bp.evaluate(() => JSON.parse(localStorage.getItem("crownsurv_sync")).stash);
check(stash.e2e1?.save.gold === 765, `e2e1's unsynced progress is set aside: ${JSON.stringify(stash.e2e1?.save.gold)}`);
await Bp.evaluate(() => window.__cs.addGold(7)); await Bp.waitForTimeout(2600);
check((await row("e2e2")).gold === 7, `e2e2 progress syncs to e2e2: ${(await row("e2e2")).gold}`);

// e2e1 signs back in on B: the set-aside progress is merged
console.log("B back as e2e1:", await signIn(Bp, "e2e1"));
s = await S(Bp);
check(s.gold === 765 && (await row("e2e1")).gold === 765, `e2e1's set-aside progress is merged when it signs back in: local ${s.gold}, cloud ${(await row("e2e1")).gold}`);
check((await row("e2e2")).gold === 7, "e2e2 keeps its own progress");
const st2 = await Bp.evaluate(() => JSON.parse(localStorage.getItem("crownsurv_sync")).stash);
check(!st2.e2e2, "e2e2 was synced, so nothing of it is set aside");

// Run end pushes immediately
r = synced(A);
await A.evaluate(() => { window.__cs.start(); window.__cs.G.t = 70; });
await A.waitForTimeout(300);
await A.evaluate(() => { window.__cs.god(false); window.__cs.setHp(0.0001); });
let ended = false;
for (let i = 0; i < 40 && !ended; i++) {
  await A.waitForTimeout(250);
  ended = await A.evaluate(() => !!(window.__cs.G && window.__cs.G.over));
  if (!ended) await A.evaluate(() => window.__cs.setHp(0));
}
console.log("run ended:", ended, "push:", await r.catch((e) => "none: " + e.message));
check((await row("e2e1")).runs === 6, `the finished run reaches the cloud: runs ${(await row("e2e1")).runs}`);

// Offline while signed in: nothing is sent, and the progress goes up when the connection comes back
{
  const before = (await row("e2e1")).gold;
  await A.context().setOffline(true);
  await A.evaluate(() => window.__cs.addGold(20));
  await A.waitForTimeout(2600);
  check((await row("e2e1")).gold === before, "offline: nothing reaches the cloud");
  const back = synced(A);
  await A.context().setOffline(false); // fires the page's "online" event
  console.log("A back online:", await back);
  check((await row("e2e1")).gold === before + 20, `back online: the offline +20 is pushed: ${(await row("e2e1")).gold}`);
}

await browser.close();
await db.end();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exitCode = fails ? 1 : 0;
```

### Where the expected numbers come from

Getting these wrong was the only source of failures in the original run, so they are worked out here:

| Step | Expected | Why |
|---|---|---|
| A uploads | gold 500, runs 3 | A's save as written, merged onto an empty cloud |
| B merges | gold **700**, runs 5 | Wealth = gold + upgrades bought. A: 500. B: 200 + 90 (Might 1 costs 90) = 290. Merged wealth 790, minus the merged upgrades (Might 1 = 90) = 700 gold. Runs add: 3 + 2. |
| A +50 | 750 | |
| B +10, then sign out | cloud 760 | The +10 was made while signed in. The reload fires `visibilitychange` (hidden), which pushes it. Editing `localStorage` does not sign out the running page. |
| B +5 signed out | local 765, cloud 760 | Signed out: no push |
| e2e2 on B | local 0, stash e2e1 = 765 | e2e1's unsynced save is set aside; e2e2 has no cloud save yet |
| e2e1 back on B | 765 | Stash restored and pushed with its old base: 760 + 5 |
| Run end | runs 6 | |
| Offline +20 | cloud + 20 on reconnect | |

### Expected output

```
A boot: PUT 200
PASS A's first sign-in uploads its save (gold 500, runs 3)
B boot: PUT 200
PASS B is merged in once: gold 700 (want 700), runs 5 (want 5)
...
A back online: PUT 200
PASS back online: the offline +20 is pushed: 785
ALL PASS
```

There should be no `pageerror` lines.

## 4. Admin profile screenshots: `admin.mjs`

The admin page needs a magic-link session, so instead of signing in, Playwright serves `admin.html` and answers its
API calls from a fixture. Nothing in it needs the server or the database. On load the page calls `/api/me`,
`/api/health` and `/api/admin/players/user/<id>`.

```js
// admin.mjs. Run with: node admin.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../../../public/admin.html", import.meta.url), "utf8"); // adjust to location
const snap = (gold, runs, at) => ({
  gold, pumpkin_crowns: 0, runs, wins: 1, kills: 300, best_s: 412, max_curse: 1, codex_items: 12, codex_enemies: 5,
  meta: { might: 3, hp: 1 }, chars: [0, 1], wins_by: { 0: 1 }, pumpkin_by: {}, codex: { items: {}, enemies: {} }, last_seen: at,
});
const now = new Date(Date.now() - 3600e3).toISOString();
const profile = {
  kind: "user",
  user: { id: "u1", name: "Player One", handle: "playerone", avatar: null, created_at: "2026-10-01T10:00:00Z" },
  devices: [
    { install_id: "aaaaaaaa-0000-4000-8000-000000000001", sessions: 4, first_seen: "2026-10-02T10:00:00Z", last_seen: now, touch: true, snapshot: snap(900, 5, now) },
    { install_id: "bbbbbbbb-0000-4000-8000-000000000002", sessions: 2, first_seen: "2026-10-03T10:00:00Z", last_seen: now, touch: false, snapshot: snap(500, 3, now) },
  ],
  runs: { total: 8, wins: 2, classic: 8, halloween: 0, crowns: 0, gold_earned: 1200, recent: [] },
  save: { ...snap(1400, 8, now), meta: { might: 3, hp: 2, greed: 1 }, chars: [0, 1, 3], version: 7,
    install_id: "aaaaaaaa-0000-4000-8000-000000000001", updated_at: now }, // set to null to see an account that never synced
  boards: Object.fromEntries(["fastest", "survival", "kills"].map((b) => [b, { rank: null, total: 3, time_s: null, kills: null, curse: null, hero: null }])),
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.route("**/*", (route) => {
  const u = new URL(route.request().url());
  const json = (b) => route.fulfill({ contentType: "application/json", body: JSON.stringify(b) });
  if (u.pathname === "/admin") return route.fulfill({ contentType: "text/html", body: html });
  if (u.pathname === "/api/me") return json({ user: { id: "a", name: "Admin", handle: null, avatar: null } });
  if (u.pathname === "/api/health") return json({ ok: true, env: "development" });
  if (u.pathname.startsWith("/api/admin/players/")) return json(profile);
  if (u.pathname.startsWith("/api/")) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  return route.abort(); // fonts, analytics: not needed
});
// Nothing listens on this port: every request is answered by page.route
await page.goto("http://localhost:3998/admin#player/user/u1");
await page.waitForTimeout(1200);
await page.screenshot({ path: "admin-cloud.png" }); // opens on "Cloud save"
await page.click("#devs button[data-i='0']");
await page.waitForTimeout(300);
await page.screenshot({ path: "admin-device.png" }); // first device's last upload, as history
console.log(await page.locator(".note").first().innerText());
await browser.close();
```

Check by eye: "Cloud save" is selected first, the Synced tile shows the version, and the note under the switcher
changes to "Last save this device uploaded, kept as history." for a device.

## Making it official

Suggested shape for checking this in. None of it exists yet.

- **Location:** an `e2e/` folder at the repo root with `serve.mts`, `sync.e2e.mjs`, `admin.e2e.mjs` and a short README
  pointing here. Keep it out of `api/_test/` so `npm test` (`tsx --test _test/*.test.ts`) does not pick it up.
- **Dependency:** add `@playwright/test` or `playwright` as a dev dependency, pin the version, and install browsers
  with `npx playwright install chromium`. Use `import { chromium } from "playwright"` instead of the npx cache path.
- **Assertions:** port `check()` to `node:test` + `assert` (like the API tests), or to `@playwright/test`, which can
  also start the server for you (`webServer` in its config) and keep screenshots on failure.
- **Script:** an `npm run e2e` that migrates `crown_test`, seeds the two users, starts `serve.mts`, waits for
  `/api/health`, runs the tests and stops the server, even when a test fails.
- **Isolation:** reseed at the start of each test file rather than relying on order. The sync scenarios above build
  on each other (each step's numbers depend on the last), so either keep them as one ordered test or give each
  scenario its own users.
- **Timing:** the waits of 2.5 to 2.6 s cover the client's 2 s push debounce. If the debounce changes, change them, or
  wait on `synced(page)` instead of a fixed time wherever a push is expected.
- **Reuse:** `serve.mts` plus the seeding step work for any feature that needs a signed-in player in the real game
  (leaderboard submits, future profile screens). `device()`, `synced()` and `S()` are the reusable helpers.
