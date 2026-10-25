/**
 * Seasonal events. Data only, so the next event is one more row.
 * Keep id / startAt / endAt in sync with EVENTS in public/index.html.
 * Times are SAST (Africa/Johannesburg); endAt is exclusive.
 */
export interface GameEvent {
  id: string;
  name: string;
  startAt: string;
  endAt: string;
  theme: string;
}

export const EVENTS: GameEvent[] = [
  // Window is a placeholder until Christopher signs off (docs/halloween-event.md).
  { id: "halloween-2026", name: "Halloween", startAt: "2026-10-27T00:00:00+02:00", endAt: "2026-11-03T00:00:00+02:00", theme: "halloween" },
];

/** Runs still in progress when an event closes may post for this long after endAt. */
export const SUBMIT_GRACE_MS = 2 * 60 * 60 * 1000;

export function findEvent(id: string | undefined): GameEvent | null {
  return EVENTS.find((e) => e.id === id) ?? null;
}

export type EventState = "soon" | "live" | "ended";

export function eventState(e: GameEvent, now = Date.now()): EventState {
  if (now < Date.parse(e.startAt)) return "soon";
  return now < Date.parse(e.endAt) ? "live" : "ended";
}

/** Scores are accepted from startAt until endAt + grace; boards stay readable forever (archive). */
export function acceptsScores(e: GameEvent, now = Date.now()): boolean {
  return now >= Date.parse(e.startAt) && now < Date.parse(e.endAt) + SUBMIT_GRACE_MS;
}
