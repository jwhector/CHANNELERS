import { z } from "zod";
import type { ShowEvent } from "./events";

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
  | { kind: "roster"; sessions: SessionSummary[] };
