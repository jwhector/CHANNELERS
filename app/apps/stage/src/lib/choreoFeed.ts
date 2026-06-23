import type { WsServerMsg } from "@channelers/shared";

export type CueLine = { sessionId: string; text: string };

/**
 * Pure state for the /choreo feed. The choreo.* channel is broadcast to every screen
 * tagged by sessionId, so concurrent altar sessions can interleave on the wire. This
 * reducer keeps the single teleprompter coherent: one session "holds" the line at a
 * time (the focused session), others accumulate silently until it's free — so the
 * dancer never sees two cues mashed together or hears two voiced at once.
 */
export type ChoreoFeedState = {
  cue: string; // text shown on the teleprompter
  active: string | null; // session currently holding the teleprompter
  buffers: Record<string, string>; // per-session in-progress deltas (no cross-session mixing)
  log: CueLine[]; // completed cues, newest first
  speak: CueLine | null; // transient: the cue to voice for the event just folded, else null
};

export const initialChoreoFeed: ChoreoFeedState = {
  cue: "",
  active: null,
  buffers: {},
  log: [],
  speak: null,
};

type ChoreoMsg = Extract<WsServerMsg, { kind: "choreo.delta" | "choreo.done" }>;

/** Fold one choreo.* message into the feed state. Non-choreo messages pass through unchanged. */
export function reduceChoreoFeed(state: ChoreoFeedState, msg: WsServerMsg): ChoreoFeedState {
  if (msg.kind !== "choreo.delta" && msg.kind !== "choreo.done") return state;
  const { sessionId, text } = msg as ChoreoMsg;
  const focused = state.active === null || state.active === sessionId;

  if (msg.kind === "choreo.delta") {
    const buf = (state.buffers[sessionId] ?? "") + text;
    const buffers = { ...state.buffers, [sessionId]: buf };
    // The focused session drives the cue; a competing session just accumulates.
    return focused
      ? { ...state, active: sessionId, cue: buf, buffers, speak: null }
      : { ...state, buffers, speak: null };
  }

  // choreo.done — drop this session's working buffer and record the finished cue.
  const { [sessionId]: _spent, ...buffers } = state.buffers;
  const entry: CueLine = { sessionId, text };
  const log = [entry, ...state.log].slice(0, 30);
  // Only the focused (or an unclaimed) session shows and voices its cue; a background
  // completion is logged but neither disturbs the live line nor talks over it.
  return focused
    ? { ...state, cue: text, active: null, buffers, log, speak: entry }
    : { ...state, buffers, log, speak: null };
}
