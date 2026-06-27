import { z } from "zod";
import type { ShowEvent } from "./events";
import { Station } from "./schemas";
import { OracleTuning } from "./tuning";

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
  z.object({
    kind: z.literal("station.hello"),
    station: Station,
    kioskId: z.string(),
    slotHint: z.string().optional(),
  }),
  z.object({ kind: z.literal("tuning.set"), tuning: OracleTuning }),
]);
export type WsClientMsg = z.infer<typeof WsClientMsg>;

/** Live choreographer config — flippable at /api/choreo/config (apps/brain/src/choreo.ts). */
export const ChoreoConfig = z.object({
  /** Per-turn cue reacts to utterance + oracle reply (true) or the utterance alone (false). */
  reactToOracle: z.boolean(),
  /** Sustained "dancers mimic the oracle" override — every turn is a mimic turn while on. */
  mimicManual: z.boolean(),
  /** When on, the brain auto-makes every Nth oracle turn a mimic turn. */
  mimicCadenceEnabled: z.boolean(),
  /** Cadence period (turns): mimic fires when turnNumber % mimicEveryNTurns === 0. */
  mimicEveryNTurns: z.number().int().min(1),
});
export type ChoreoConfig = z.infer<typeof ChoreoConfig>;

export const DEFAULT_CHOREO_CONFIG: ChoreoConfig = {
  reactToOracle: true,
  mimicManual: false,
  mimicCadenceEnabled: false,
  mimicEveryNTurns: 3,
};

/** A summary of one active session for the roster broadcast. */
export type SessionSummary = {
  sessionId: string;
  visitorId: string;
  visitorName: string;
  archetype: string;
  turns: number;
};

/** ── Dispatcher state (redesign) — broadcast on the dispatch.state channel, screens-only ── */

/** A review flag the operator sees on a row (spec §10). */
export type DispatchFlag = {
  type: "no-show" | "walk-up" | "auto-reaped";
  /** Present for auto-reaped: "stale" | "superseded" | "station-offline". */
  reason?: string;
  since: string;
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
  /** Epoch-ISO until which this visitor is held out of new assignment (intro wait or no-show cooldown). */
  heldUntil?: string;
  holdReason?: "intro" | "no-show";
};

/** One occupant pinned to a slot. `phase` is the slot-level occupancy stage. */
export type SlotOccupant = {
  visitorId: string;
  number: number;
  phase: "pending" | "called" | "in_progress";
  since: string;
  /** Review flags carried by this occupant (e.g. a no-show on a called participant). */
  flags?: DispatchFlag[];
};

/** A camera the kiosk bound to a slot can offer (reported by the kiosk; id may be label-less until permission). */
export type SlotCamera = { id: string; label: string };

/** An addressable station slot, optionally bound to a kiosk screen (spec §3.2). */
export type Slot = {
  id: string;            // `${station}-${i}`, e.g. "intake-0"
  station: Station;
  kioskId?: string;      // present ⇒ a screen claimed this slot
  online: boolean;       // kiosk bound AND its socket connected
  occupant?: SlotOccupant;
  /** Cameras the bound kiosk reported (bodyscan), so an operator screen can pick one remotely. */
  cameras?: SlotCamera[];
  /** The kiosk's currently-selected camera id. */
  activeCameraId?: string;
};

/** A visitor who finished the whole ritual (sessionEndAt set). */
export type DispatchDone = { id: string; number: number; name?: string; at: string };

/** An altar-ready visitor (intake + bodyscan done, waiting) — divination prerequisites met. */
export type DispatchReady = { id: string; number: number; name?: string };

export type DispatchState = {
  /** All slots across all stations, length = sum of configured counts. */
  slots: Slot[];
  /** Waiting + eligible visitors NOT currently occupying a slot (the left pool). */
  queue: DispatchQueueEntry[];
  /** Finished the experience (sessionEndAt) — the right column. */
  completed: DispatchDone[];
  /** Connected station screens with no free slot to bind (flagged for the operator). */
  surplus: { station: Station; kioskId: string }[];
  /** Derived: a station is "up" if ≥1 of its slots is online. */
  stationsOnline: Record<Station, boolean>;
  /** Dwell (ms) per timed group station, so the operator board can show a remaining-time countdown. */
  timedDwellMs?: Partial<Record<Station, number>>;
  /** Called-but-not-arrived threshold (ms), so a station view can flag a likely no-show. */
  noShowMs?: number;
  /** Operator gate: when false, no new visitor is dispatched to the altar (in-progress readings continue). */
  altarOpen: boolean;
  /** Waiting visitors who are altar-ready (intakeAt && poseAt && !sessionEndAt) — the operator's buffer gauge. */
  altarReady: number;
  /** Altar-ready visitors — the /dispatch right-column roster + the Pluribus broadcast list. */
  altarReadyList: DispatchReady[];
  /** True when ≥1 bodyscan slot is online with no occupant. */
  bodyscanIdle: boolean;
  /** When bodyscan is idle, why nothing is filling it (actionable when "soaking"/"held"). */
  bodyscanBlocked: "none" | "soaking" | "held" | "empty";
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
  | { kind: "choreo.delta"; sessionId: string; text: string }
  /** `prepareToChannel`: this cue is the last before a cadence mimic — warn the dancers to switch. */
  | { kind: "choreo.done"; sessionId: string; text: string; prepareToChannel?: boolean }
  | { kind: "choreo.mimic"; sessionId: string; text: string; archetype: string }
  | { kind: "session.ended"; sessionId: string }
  | { kind: "session.error"; sessionId?: string; visitorId?: string; message: string }
  | { kind: "roster"; sessions: SessionSummary[] }
  | { kind: "dispatch.state"; state: DispatchState }
  | { kind: "tuning.state"; tuning: OracleTuning }
  /** One-shot operator→kiosk command relay (e.g. /station taps Capture; the bodyscan kiosk acts). */
  | { kind: "station.cmd"; station: Station; action: "capture"; visitorId: string }
  /** Operator→kiosk: switch the bodyscan kiosk's camera (targeted by kioskId). */
  | { kind: "station.cmd"; station: Station; action: "set-camera"; kioskId: string; deviceId: string };
