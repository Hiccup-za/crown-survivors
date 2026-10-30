import { randomInt } from "node:crypto";
import { pool } from "./db.js";
import { emptySave, fromRow, mergeSaves, type SaveRow, COLS, writeSave } from "./save.js";

// Guest accounts (Better Auth anonymous plugin, migration 006_guests.sql). A guest plays under a generated name and
// can post to every leaderboard. Signing in with X merges the guest into that X account: scores, event scores,
// telemetry and the cloud save move over, then the guest is deleted. Nothing a guest earned is ever dropped.

const ADJ = [
  "Brave", "Mossy", "Gilded", "Royal", "Rusty", "Swift", "Sly", "Jolly", "Grim", "Lucky", "Bold", "Merry", "Noble", "Wild",
  "Sleepy", "Stout", "Sunny", "Misty", "Crimson", "Golden", "Silver", "Thorny", "Stormy", "Plucky", "Dapper", "Humble",
  "Clever", "Fuzzy", "Cosmic", "Spooky",
];
const NOUN = [
  "Knight", "Squire", "Blob", "Bat", "Wisp", "Imp", "Frog", "Harpy", "Ghost", "Turnip", "Pumpkin", "Crown", "Cube", "Archer",
  "Mage", "Rogue", "Baron", "Duke", "Jester", "Goblin", "Slime", "Sprout", "Gourd", "Beetle", "Badger", "Raven", "Toad",
  "Pip", "Shade", "Golem",
];

/** "Mossy Knight 372": 30 x 30 x 900 names, so two guests rarely share one. Exported for tests. */
export const guestName = (rand: (n: number) => number = randomInt) =>
  `${ADJ[rand(ADJ.length)]} ${NOUN[rand(NOUN.length)]} ${100 + rand(900)}`;

/** Guest sessions outlive the 30-day default: the device's token is the only way back into a guest account. */
export const GUEST_SESSION_DAYS = 5 * 365;

/** Guests this account absorbed. The game checks it before treating a local guest save as the account's. */
export async function mergedGuests(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ guest_id: string }>(`SELECT guest_id FROM guest_merges WHERE user_id = $1 ORDER BY merged_at`, [userId]);
  return rows.map((r) => r.guest_id);
}

/**
 * Moves everything the guest owns to the X account and deletes the guest, in one transaction. Throws (and changes
 * nothing) when the guest is not a guest or the target is one. Returns false when the guest is already gone.
 */
export async function mergeGuest(guestId: string, userId: string): Promise<boolean> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // The same lock as pushSave, so no push lands on either save mid-merge.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('player_saves:' || $1))`, [userId]);
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('player_saves:' || $1))`, [guestId]);
    const users = await c.query<{ id: string; guest: boolean }>(`SELECT id, "isAnonymous" AS guest FROM "user" WHERE id = ANY($1::text[]) FOR UPDATE`, [[guestId, userId]]);
    const g = users.rows.find((u) => u.id === guestId), u = users.rows.find((u) => u.id === userId);
    if (!g) {
      await c.query("ROLLBACK");
      return false;
    }
    if (!g.guest) throw new Error(`mergeGuest: ${guestId} is not a guest`);
    if (!u || u.guest) throw new Error(`mergeGuest: ${userId} is not a signed-in account`);

    for (const t of ["scores", "event_scores", "telemetry_sessions", "telemetry_runs", "player_snapshots"])
      await c.query(`UPDATE ${t} SET user_id = $2 WHERE user_id = $1`, [guestId, userId]);

    const saves = await c.query<SaveRow & { user_id: string; install_id: string }>(
      `SELECT user_id, install_id::text, version, ${COLS} FROM player_saves WHERE user_id = ANY($1::text[])`,
      [[guestId, userId]],
    );
    const gs = saves.rows.find((r) => r.user_id === guestId), us = saves.rows.find((r) => r.user_id === userId);
    if (gs) {
      const guest = fromRow(gs), mine = us ? fromRow(us) : null;
      // The guest's whole save is new to the account (base = empty). The version jumps past both so the guest
      // device's next push, still numbered from the guest's versions, can never be mistaken for a repeat.
      const save = mergeSaves(mine?.save ?? emptySave(), guest.save, emptySave());
      await writeSave(c, userId, Math.max(guest.version, mine?.version ?? 0) + 1, gs.install_id, save);
      // The guest's devices keep their last push, so a push whose response was lost still merges once.
      await c.query(
        `DELETE FROM player_save_devices WHERE user_id = $2 AND install_id IN (SELECT install_id FROM player_save_devices WHERE user_id = $1)`,
        [guestId, userId],
      );
      await c.query(`UPDATE player_save_devices SET user_id = $2 WHERE user_id = $1`, [guestId, userId]);
    }
    await c.query(`INSERT INTO guest_merges (guest_id, user_id) VALUES ($1, $2) ON CONFLICT (guest_id) DO NOTHING`, [guestId, userId]);
    await c.query(`DELETE FROM "user" WHERE id = $1`, [guestId]);
    await c.query("COMMIT");
    return true;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
