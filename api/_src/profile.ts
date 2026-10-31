import { pool } from "./db.js";
import { BOARDS, type Board, getMyRank, type LeaderboardRow } from "./scores.js";
import { EVENT_BOARDS, type EventBoard, type EventLeaderboardRow, getMyEventRank } from "./event-scores.js";
import { EVENTS, eventState, type EventState } from "./events.js";

// The signed-in player's own profile page in the game (scene 'profile'): who they are and where they stand on every
// board. Lifetime stats come from the game's own save, which cloud save keeps in step.

type Standing<R> = { rank: number | null; total: number; row: R | null };

export interface MyProfile {
  user: { id: string; name: string; handle: string | null; avatar: string | null; guest: boolean; created_at: string };
  boards: Record<Board, Standing<LeaderboardRow>>;
  /** Every event that has started, newest first. */
  events: { id: string; state: EventState; boards: Record<EventBoard, Standing<EventLeaderboardRow>> }[];
}

const standing = <R extends { rank: number }>({ row, total }: { row: R | null; total: number }): Standing<R> => ({ rank: row?.rank ?? null, total, row });

export async function getMyProfile(userId: string, now = Date.now()): Promise<MyProfile | null> {
  const u = await pool.query<MyProfile["user"]>(
    `SELECT id, name, handle, image AS avatar, "isAnonymous" AS guest, "createdAt" AS created_at FROM "user" WHERE id = $1`,
    [userId],
  );
  const user = u.rows[0];
  if (!user) return null;
  const evs = EVENTS.filter((e) => eventState(e, now) !== "soon").reverse();
  const [classic, ...events] = await Promise.all([
    Promise.all(BOARDS.map((b) => getMyRank(b, userId))),
    ...evs.map((e) => Promise.all(EVENT_BOARDS.map((b) => getMyEventRank(e.id, b, userId)))),
  ]);
  return {
    user,
    boards: Object.fromEntries(BOARDS.map((b, i) => [b, standing(classic[i])])) as MyProfile["boards"],
    events: evs.map((e, j) => ({
      id: e.id,
      state: eventState(e, now),
      boards: Object.fromEntries(EVENT_BOARDS.map((b, i) => [b, standing(events[j][i])])) as MyProfile["events"][number]["boards"],
    })),
  };
}
