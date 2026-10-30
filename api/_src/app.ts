import { createHmac } from "node:crypto";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { auth, type Session } from "./auth.js";
import { ALLOWED_ORIGINS, isAllowedReturnUrl, PUBLIC_URL } from "./origins.js";
import { BOARDS, type Board, getLeaderboard, getMyRank, insertScore, validateScore, RATE_LIMIT_SECONDS } from "./scores.js";
import { ipHash, recordTelemetry, TELEMETRY_MAX_BYTES, validateTelemetry } from "./telemetry.js";
import { getAdminStats, isAdmin, MAX_RANGE_DAYS, MAX_RANGE_HOURS, parseHours, parseRange } from "./admin.js";
import { getProfile, isInstallId, isUserId, listPlayers } from "./players.js";
import { getSave, pushSave, SAVE_MAX_BYTES, validatePush } from "./save.js";
import { mergedGuests } from "./guests.js";
import { getMyProfile } from "./profile.js";
import { acceptsScores, eventState, findEvent } from "./events.js";
import {
  EVENT_BOARDS,
  type EventBoard,
  getEventLeaderboard,
  getMyEventRank,
  insertEventScore,
  validateEventScore,
} from "./event-scores.js";

type Vars = { user: Session["user"] | null; session: Session["session"] | null };

export const app = new Hono<{ Variables: Vars }>();

app.use(
  "*",
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["set-auth-token"],
    maxAge: 600,
  }),
);

// Better Auth routes: /api/auth/sign-in/social, /api/auth/sign-in/magic-link, /api/auth/magic-link/verify, /api/auth/callback/twitter, /api/auth/get-session, /api/auth/sign-out ...
// Users must not edit name/handle/avatar themselves; they always come from X.
app.all("/api/auth/update-user", (c) => c.json({ error: "not allowed" }, 403));
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Resolve the session (cookie or Bearer token) for everything else.
app.use("*", async (c, next) => {
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", s?.user ?? null);
  c.set("session", s?.session ?? null);
  await next();
});

// env tells /admin which database it is reading: previews get their own Neon branch (docs/telemetry.md).
app.get("/api/health", (c) => c.json({ ok: true, service: "crown-survivors-api", env: process.env.VERCEL_ENV ?? "development" }));

/**
 * The request's headers with the session as Better Auth's signed session cookie. Better Auth applies the bearer
 * plugin's token-to-cookie swap only after every before-hook has run, so the anonymous plugin's /sign-in/social
 * hook, which records the guest to merge, would not see a guest that arrived as a Bearer token.
 */
async function withSessionCookie(c: Context): Promise<Headers> {
  const headers = new Headers(c.req.raw.headers);
  const session = c.get("session") as Session["session"] | null;
  if (!session) return headers;
  const ctx = await auth.$context;
  const sig = createHmac("sha256", ctx.secret).update(session.token).digest("base64");
  headers.set("cookie", `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${sig}`)}`);
  return headers;
}

/** Starts Sign in with X; the response redirects to X and carries Better Auth's OAuth state cookie. */
async function startX(c: Context, returnTo: string): Promise<{ url?: string; cookies: string[] }> {
  const base = PUBLIC_URL ?? new URL(c.req.url).origin;
  const callbackURL = `${base}/auth/handoff?returnTo=${encodeURIComponent(returnTo)}`;
  const res = await auth.api.signInSocial({
    body: { provider: "twitter", callbackURL, errorCallbackURL: callbackURL },
    headers: await withSessionCookie(c),
    asResponse: true,
  });
  const data = (await res.json()) as { url?: string };
  return { url: data.url, cookies: res.headers.getSetCookie() };
}

/**
 * Top-level sign-in entry the game links to (window.location = ...):
 *   GET /auth/x?returnTo=<game url>
 * Runs the OAuth dance first-party on this domain, then /auth/handoff sends the
 * browser back to the game with #lb_token=... so it works even where
 * third-party cookies are blocked (Safari / iOS).
 */
app.get("/auth/x", async (c) => {
  const returnTo = c.req.query("returnTo");
  if (!isAllowedReturnUrl(returnTo)) return c.json({ error: "returnTo must be a game URL" }, 400);
  const { url, cookies } = await startX(c, returnTo);
  if (!url) return c.json({ error: "could not start sign-in" }, 500);
  const out = new Response(null, { status: 302, headers: { Location: url } });
  for (const cookie of cookies) out.headers.append("Set-Cookie", cookie);
  return out;
});

/**
 * The same for a guest: POST /auth/x {returnTo} with the guest's Bearer token answers {url} for the game to open.
 * A navigation cannot carry the token, and the token is what tells the X callback which guest to merge.
 */
app.post("/auth/x", async (c) => {
  let body: { returnTo?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const returnTo = typeof body?.returnTo === "string" ? body.returnTo : undefined;
  if (!isAllowedReturnUrl(returnTo)) return c.json({ error: "returnTo must be a game URL" }, 400);
  const { url, cookies } = await startX(c, returnTo);
  if (!url) return c.json({ error: "could not start sign-in" }, 500);
  for (const cookie of cookies) c.header("Set-Cookie", cookie, { append: true });
  c.header("Cache-Control", "private, no-store");
  return c.json({ url });
});

app.get("/auth/handoff", (c) => {
  const returnTo = c.req.query("returnTo");
  if (!isAllowedReturnUrl(returnTo)) return c.json({ error: "bad returnTo" }, 400);
  const url = new URL(returnTo);
  const session = c.get("session");
  url.hash = session ? `lb_token=${encodeURIComponent(session.token)}` : `lb_error=${encodeURIComponent(c.req.query("error") ?? "signin_failed")}`;
  return c.redirect(url.toString(), 302);
});

/** Current user (handle/avatar) or null. guest: a generated-name account; merged: guests this account absorbed. */
app.get("/api/me", async (c) => {
  const u = c.get("user") as (Session["user"] & { handle?: string | null; isAnonymous?: boolean | null }) | null;
  if (!u) return c.json({ user: null });
  const guest = !!u.isAnonymous;
  return c.json({
    user: { id: u.id, name: u.name, handle: u.handle ?? null, avatar: u.image ?? null, guest, merged: guest ? [] : await mergedGuests(u.id) },
  });
});

/** The player's own profile: account and standing on every Classic and event board. */
app.get("/api/me/profile", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "sign in required" }, 401);
  const p = await getMyProfile(user.id);
  if (!p) return c.json({ error: "no such player" }, 404);
  c.header("Cache-Control", "private, no-store");
  return c.json(p);
});

function parseBoard(v: string | undefined): Board | null {
  return BOARDS.includes(v as Board) ? (v as Board) : null;
}

app.post("/api/scores", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "sign in required" }, 401);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const v = validateScore(body);
  if (!v.ok) return c.json({ error: v.error }, 400);
  const id = await insertScore(user.id, v.value);
  if (id === null) {
    c.header("Retry-After", String(RATE_LIMIT_SECONDS));
    return c.json({ error: `one submission per ${RATE_LIMIT_SECONDS}s` }, 429);
  }
  return c.json({ ok: true, id }, 201);
});

app.get("/api/leaderboard", async (c) => {
  const board = parseBoard(c.req.query("board") ?? "fastest");
  if (!board) return c.json({ error: "board must be fastest|survival|kills" }, 400);
  const raw = Number(c.req.query("limit") ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 50;
  const rows = await getLeaderboard(board, limit);
  c.header("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
  return c.json({ board, rows });
});

app.get("/api/me/rank", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "sign in required" }, 401);
  const board = parseBoard(c.req.query("board") ?? "fastest");
  if (!board) return c.json({ error: "board must be fastest|survival|kills" }, 400);
  const { row, total } = await getMyRank(board, user.id);
  c.header("Cache-Control", "private, no-store");
  return c.json({ board, total, rank: row?.rank ?? null, row });
});

// ---- First-party telemetry (docs/telemetry.md). Anonymous by install id; linked to the X user when signed in. ----

app.post("/api/t", async (c) => {
  const text = await c.req.text();
  if (text.length > TELEMETRY_MAX_BYTES) return c.json({ error: "payload too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const v = validateTelemetry(body);
  if (!v.ok) return c.json({ error: v.error }, 400);
  // Vercel sets x-forwarded-for itself (client values are overwritten), so it is safe to key limits on.
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip");
  const res = await recordTelemetry(c.get("user")?.id ?? null, ipHash(ip), v.value);
  if ("limited" in res) return c.json({ error: res.limited }, 429);
  return c.json({ ok: true, run: res.run });
});

// ---- Cloud save (docs/remaining-tasks.md, section 1). One merged save per X account. ----

app.get("/api/save", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "sign in required" }, 401);
  const s = await getSave(user.id);
  c.header("Cache-Control", "private, no-store");
  return c.json({ save: s?.save ?? null, version: s?.version ?? null });
});

/** Merges the device's save into the account's (three-way, against base) and answers with the result. */
app.put("/api/save", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "sign in required" }, 401);
  const text = await c.req.text();
  if (text.length > SAVE_MAX_BYTES) return c.json({ error: "payload too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const v = validatePush(body);
  if (!v.ok) return c.json({ error: v.error }, 400);
  const res = await pushSave(user.id, v.value);
  if ("limited" in res) {
    c.header("Retry-After", "60");
    return c.json({ error: res.limited }, 429);
  }
  c.header("Cache-Control", "private, no-store");
  return c.json(res);
});

// ---- Admin dashboard (public/admin.html). Only ADMIN_EMAILS, signed in by magic link. ----

app.use("/api/admin/*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "sign in required" }, 401);
  if (!isAdmin(user)) return c.json({ error: "not an admin" }, 403);
  c.header("Cache-Control", "private, no-store");
  await next();
});

const RANGE_ERROR = `give hours=1..${MAX_RANGE_HOURS}, or from/to as YYYY-MM-DD with to after from, at most ${MAX_RANGE_DAYS} days`;
/** ?hours=N is the last N hours; otherwise ?from=&to= whole days. */
const queryRange = (c: Context) => (c.req.query("hours") !== undefined ? parseHours(c.req.query("hours")) : parseRange(c.req.query("from"), c.req.query("to")));

app.get("/api/admin/stats", async (c) => {
  const range = queryRange(c);
  if (!range) return c.json({ error: RANGE_ERROR }, 400);
  return c.json(await getAdminStats(range));
});

/** Players active in the range (session, run or score), optionally filtered by handle, name or install id. */
app.get("/api/admin/players", async (c) => {
  const range = queryRange(c);
  if (!range) return c.json({ error: RANGE_ERROR }, 400);
  const q = c.req.query("q")?.trim().slice(0, 64) || null;
  return c.json(await listPlayers(range, q));
});

app.get("/api/admin/players/user/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUserId(id)) return c.json({ error: "bad user id" }, 400);
  const p = await getProfile({ user: id });
  return p ? c.json(p) : c.json({ error: "no such player" }, 404);
});

/** An install that ever signed in answers with its account's profile (kind "user"). */
app.get("/api/admin/players/install/:id", async (c) => {
  const id = c.req.param("id");
  if (!isInstallId(id)) return c.json({ error: "install id must be a UUID" }, 400);
  const p = await getProfile({ install: id });
  return p ? c.json(p) : c.json({ error: "no such player" }, 404);
});

/** The public leaderboard plus user_id, so the dashboard can open each player's profile. */
app.get("/api/admin/leaderboard", async (c) => {
  const board = parseBoard(c.req.query("board") ?? "fastest");
  if (!board) return c.json({ error: "board must be fastest|survival|kills" }, 400);
  return c.json({ board, rows: await getLeaderboard(board, 100, true) });
});

// ---- Seasonal event boards (Halloween Endless). Separate table; Classic routes above are unchanged. ----

function parseEventBoard(v: string | undefined): EventBoard | null {
  return EVENT_BOARDS.includes(v as EventBoard) ? (v as EventBoard) : null;
}
const EVENT_BOARD_ERR = `board must be ${EVENT_BOARDS.join("|")}`;

app.post("/api/events/:id/scores", async (c) => {
  const ev = findEvent(c.req.param("id"));
  if (!ev) return c.json({ error: "unknown event" }, 404);
  const user = c.get("user");
  if (!user) return c.json({ error: "sign in required" }, 401);
  if (!acceptsScores(ev)) return c.json({ error: "event is not open for scores" }, 403);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const v = validateEventScore(body);
  if (!v.ok) return c.json({ error: v.error }, 400);
  const id = await insertEventScore(ev.id, user.id, v.value);
  if (id === null) {
    c.header("Retry-After", String(RATE_LIMIT_SECONDS));
    return c.json({ error: `one submission per ${RATE_LIMIT_SECONDS}s` }, 429);
  }
  return c.json({ ok: true, id }, 201);
});

app.get("/api/events/:id/leaderboard", async (c) => {
  const ev = findEvent(c.req.param("id"));
  if (!ev) return c.json({ error: "unknown event" }, 404);
  const board = parseEventBoard(c.req.query("board") ?? "crowns");
  if (!board) return c.json({ error: EVENT_BOARD_ERR }, 400);
  const raw = Number(c.req.query("limit") ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 50;
  const rows = await getEventLeaderboard(ev.id, board, limit);
  c.header("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
  return c.json({ event: ev.id, state: eventState(ev), board, rows });
});

/** An event board plus user_id, so the dashboard can open each player's profile. */
app.get("/api/admin/events/:id/leaderboard", async (c) => {
  const ev = findEvent(c.req.param("id"));
  if (!ev) return c.json({ error: "unknown event" }, 404);
  const board = parseEventBoard(c.req.query("board") ?? "crowns");
  if (!board) return c.json({ error: EVENT_BOARD_ERR }, 400);
  return c.json({ event: ev.id, board, rows: await getEventLeaderboard(ev.id, board, 100, true) });
});

app.get("/api/events/:id/me/rank", async (c) => {
  const ev = findEvent(c.req.param("id"));
  if (!ev) return c.json({ error: "unknown event" }, 404);
  const user = c.get("user");
  if (!user) return c.json({ error: "sign in required" }, 401);
  const board = parseEventBoard(c.req.query("board") ?? "crowns");
  if (!board) return c.json({ error: EVENT_BOARD_ERR }, 400);
  const { row, total } = await getMyEventRank(ev.id, board, user.id);
  c.header("Cache-Control", "private, no-store");
  return c.json({ event: ev.id, board, total, rank: row?.rank ?? null, row });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});
