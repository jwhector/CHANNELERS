import { z } from "zod";
import type { ShowEvent } from "./events";
import { Station } from "./schemas";

/**
 * Live divination protocol over the /ws socket.
 *
 * Client → server commands (validated with zod on arrival):
 *   session.start   performer claims a visitor for divination (archetype read from visitor record)
 *   session.say     a visitor utterance (from mic STT or typed); must include sessionId
 *   session.rejoin  re-attach to an existing session by sessionId (after a refresh/reconnect, or to
 *                   reclaim an orphaned one); the brain replies with session.resumed (full state)
 *   session.end     close a specific divination by sessionId
 *
 * The brain tracks MULTIPLE active sessions concurrently (one per visitor in a divination).
 * Each session has a unique sessionId; clients filter incoming messages by sessionId.
 */
export const WsClientMsg = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("session.start"), visitorId: z.string() }),
  z.object({ kind: z.literal("session.say"), sessionId: z.string(), text: z.string() }),
  z.object({ kind: z.literal("session.rejoin"), sessionId: z.string() }),
  z.object({ kind: z.literal("session.end"), sessionId: z.string() }),
  z.object({ kind: z.literal("station.hello"), station: Station }),
]);
export type WsClientMsg = z.infer<typeof WsClientMsg>;

/** A summary of one active session for the roster broadcast. */
export type SessionSummary = {
  sessionId: string;
  visitorId: string;
  visitorName: string;
  archetype: string;
  turns: number;
};

/** ── Dispatcher state (Tier 3) — broadcast on the dispatch.state channel, screens-only ── */

/** A review flag the operator sees on a row (spec §10). */
export type DispatchFlag = {
  type: "no-show" | "walk-up" | "auto-reaped";
  /** Present for auto-reaped: "stale" | "superseded" | "station-offline". */
  reason?: string;
  since: string;
};

/** One station's capacity + who currently holds a slot (called/in_progress/pending). */
export type DispatchSlot = {
  station: Station;
  capacity: number;
  occupants: { id: string; number: number; state: "called" | "in_progress" | "pending"; since: string }[];
};

/** A waiting visitor in the callable pool. */
export type DispatchQueueEntry = {
  id: string;
  number: number;
  name?: string;
  /** Stations this visitor is eligible to be called to right now (spec §3.3). */
  eligible: Station[];
  waitingSince: string;
  flags: DispatchFlag[];
};

/** A pending (awaiting confirm) or called (on the board) assignment. */
export type DispatchCall = {
  id: string;
  number: number;
  station: Station;
  since: string;
  flags?: DispatchFlag[];
};

export type DispatchState = {
  slots: Record<Station, DispatchSlot>;
  /** Waiting + eligible visitors (the pool). */
  queue: DispatchQueueEntry[];
  /** Assigned, awaiting operator confirm. */
  pending: DispatchCall[];
  /** Called → shown on /board. */
  board: DispatchCall[];
  /** Station-screen online indicators (from station.hello connections). */
  stations: Record<Station, boolean>;
  /** False during the warm-up window (spec §9 — the deliberate early delay). */
  warmedUp: boolean;
};

/** Server → client messages. The server constructs these, so a plain union is enough. */
export type WsServerMsg =
  | { kind: "hello" }
  | { kind: "event"; event: ShowEvent }
  | {
      kind: "session.started";
      sessionId: string;
      visitorId: string;
      visitorName: string;
      archetype: string;
      opening: string;
    }
  | {
      kind: "session.resumed";
      sessionId: string;
      visitorId: string;
      visitorName: string;
      archetype: string;
      history: { role: "visitor" | "oracle"; text: string }[];
      teleprompter: string;
    }
  | { kind: "session.transcript"; sessionId: string; role: "visitor" | "oracle"; text: string }
  | { kind: "oracle.delta"; sessionId: string; text: string }
  | { kind: "oracle.done"; sessionId: string; text: string }
  | { kind: "session.ended"; sessionId: string }
  | { kind: "session.error"; sessionId?: string; visitorId?: string; message: string }
  | { kind: "roster"; sessions: SessionSummary[] }
  | { kind: "dispatch.state"; state: DispatchState };
