import { config } from "./config";
import { store, type VisitorRecord } from "./store";
import type {
  Station, DispatchState, DispatchSlot, DispatchQueueEntry, DispatchCall, DispatchFlag,
  WsServerMsg, WsClientMsg,
} from "@channelers/shared";

const STATION_ORDER: Station[] = ["intake", "bodyscan", "altar"];

/** The minimal bus surface the dispatcher needs (the real Bus implements all of these). */
export interface DispatcherBus {
  broadcast(msg: WsServerMsg): void;
  onConnect(fn: (reply: (m: WsServerMsg) => void, connId: string) => void): void;
  onDisconnect(fn: (connId: string) => void): void;
  onCommand(fn: (cmd: WsClientMsg, reply: (m: WsServerMsg) => void, connId: string) => void): void;
}

type Knobs = typeof config.dispatcher;
type Pending = { station: Station; since: string };

export interface Dispatcher {
  checkin(num: number, station: Station): { record: VisitorRecord; superseded: number[] };
  confirm(visitorId: string): boolean;
  assign(visitorId: string, station: Station): boolean;
  recall(visitorId: string): boolean;
  repool(visitorId: string): boolean;
  markComplete(visitorId: string, station: Station): boolean;
  remove(visitorId: string): boolean;
  clearFlags(visitorId: string): void;
  snapshot(): DispatchState;
  kick(): void;
  stop(): void;
}

export function createDispatcher(
  bus: DispatcherBus,
  opts: { knobs?: Partial<Knobs>; autoStart?: boolean } = {},
): Dispatcher {
  const knobs: Knobs = { ...config.dispatcher, ...opts.knobs };
  const pending = new Map<string, Pending>(); // visitorId → assignment awaiting confirm
  const flags = new Map<string, DispatchFlag[]>(); // visitorId → review flags
  const stationConns = new Map<string, Station>(); // connId → station (from station.hello)
  const offlineTimers = new Map<Station, ReturnType<typeof setTimeout>>();

  const nowIso = () => new Date().toISOString();
  const ageMs = (iso: string) => Date.now() - Date.parse(iso);

  // ── predicates (spec §3.3) ──
  function eligibleStations(v: VisitorRecord): Station[] {
    if (v.location.state !== "waiting") return [];
    const out: Station[] = [];
    if (!v.intakeAt) out.push("intake");
    if (!v.poseAt) out.push("bodyscan");
    if (v.intakeAt && v.poseAt && !v.sessionEndAt) out.push("altar");
    return out;
  }
  /** A station's completion milestone. Altar is held through the reading → frees on session end. */
  function completionMilestoneSet(v: VisitorRecord, s: Station): boolean {
    if (s === "intake") return !!v.intakeAt;
    if (s === "bodyscan") return !!v.poseAt;
    return !!v.sessionEndAt;
  }
  function occupancy(s: Station): number {
    const live = store.list().filter(
      (v) =>
        (v.location.state === "called" || v.location.state === "in_progress") &&
        v.location.station === s,
    ).length;
    const pend = [...pending.values()].filter((p) => p.station === s).length;
    return live + pend;
  }
  function addFlag(id: string, f: DispatchFlag): void {
    const arr = flags.get(id) ?? [];
    if (!arr.some((x) => x.type === f.type && x.reason === f.reason)) arr.push(f);
    flags.set(id, arr);
  }
  function clearFlags(id: string): void {
    flags.delete(id);
  }
  function stationOnline(s: Station): boolean {
    return [...stationConns.values()].includes(s);
  }

  // ── warm-up + selection ──
  function warmedUp(): boolean {
    const visitors = store.list();
    const pool = visitors.filter((v) => eligibleStations(v).length > 0);
    if (pool.length >= knobs.K) return true;
    const earliest = visitors.reduce<number | null>((min, v) => {
      const t = Date.parse(v.createdAt);
      return min === null || t < min ? t : min;
    }, null);
    return earliest !== null && Date.now() - earliest >= knobs.warmupMs;
  }
  function select(s: Station): VisitorRecord | undefined {
    const eligible = store.list().filter((v) => !pending.has(v.id) && eligibleStations(v).includes(s));
    if (eligible.length === 0) return undefined;
    const starving = eligible.filter((v) => ageMs(v.location.since) > knobs.maxWaitMs);
    if (starving.length > 0) {
      return starving.reduce((oldest, v) =>
        Date.parse(v.location.since) < Date.parse(oldest.location.since) ? v : oldest,
      );
    }
    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  // ── core loop ──
  function fill(): void {
    if (!warmedUp()) return;
    for (const s of STATION_ORDER) {
      let free = knobs.slots[s] - occupancy(s);
      while (free > 0) {
        const pick = select(s);
        if (!pick) break;
        pending.set(pick.id, { station: s, since: nowIso() });
        if (knobs.autoConfirm) confirm(pick.id);
        free--;
      }
    }
  }
  /** Placeholder until Task 3.4 — completion/no-show/stale reconciliation lives here. */
  function reconcile(): void {
    // Return finished in_progress visitors to the pool so their slot frees.
    for (const v of store.list()) {
      if (v.location.state !== "in_progress" || !v.location.station) continue;
      if (completionMilestoneSet(v, v.location.station)) {
        store.setLocation(v.id, { state: "waiting", since: nowIso() });
        pending.delete(v.id);
      }
    }
    if (knobs.autoConfirm) for (const id of [...pending.keys()]) confirm(id);
  }

  function confirm(visitorId: string): boolean {
    const p = pending.get(visitorId);
    if (!p) return false;
    const v = store.get(visitorId);
    if (!v) { pending.delete(visitorId); return false; }
    pending.delete(visitorId);
    store.setLocation(visitorId, { state: "called", station: p.station, since: nowIso() });
    clearFlags(visitorId);
    broadcastState();
    return true;
  }
  function assign(visitorId: string, station: Station): boolean {
    if (!store.get(visitorId)) return false;
    pending.set(visitorId, { station, since: nowIso() });
    if (knobs.autoConfirm) confirm(visitorId);
    broadcastState();
    return true;
  }

  function evaluate(): void {
    reconcile();
    fill();
    broadcastState();
  }
  function kick(): void {
    evaluate();
  }

  // ── snapshot + broadcast ──
  function snapshot(): DispatchState {
    const visitors = store.list();
    const slots = {} as Record<Station, DispatchSlot>;
    for (const s of STATION_ORDER) {
      const live = visitors
        .filter(
          (v) =>
            (v.location.state === "called" || v.location.state === "in_progress") &&
            v.location.station === s,
        )
        .map((v) => ({
          id: v.id,
          number: v.number,
          state: v.location.state as "called" | "in_progress",
          since: v.location.since,
        }));
      const pend = [...pending.entries()]
        .filter(([, p]) => p.station === s)
        .map(([id, p]) => ({
          id,
          number: store.get(id)?.number ?? -1,
          state: "pending" as const,
          since: p.since,
        }));
      slots[s] = { station: s, capacity: knobs.slots[s], occupants: [...live, ...pend] };
    }
    const queue: DispatchQueueEntry[] = visitors
      .filter((v) => eligibleStations(v).length > 0)
      .map((v) => ({
        id: v.id,
        number: v.number,
        name: v.survey?.name,
        eligible: eligibleStations(v),
        waitingSince: v.location.since,
        flags: flags.get(v.id) ?? [],
      }));
    const pendingList: DispatchCall[] = [...pending.entries()].map(([id, p]) => ({
      id,
      number: store.get(id)?.number ?? -1,
      station: p.station,
      since: p.since,
      flags: flags.get(id) ?? [],
    }));
    const board: DispatchCall[] = visitors
      .filter((v) => v.location.state === "called" && !!v.location.station)
      .map((v) => ({
        id: v.id,
        number: v.number,
        station: v.location.station as Station,
        since: v.location.since,
        flags: flags.get(v.id) ?? [],
      }));
    const stations: Record<Station, boolean> = {
      intake: stationOnline("intake"),
      bodyscan: stationOnline("bodyscan"),
      altar: stationOnline("altar"),
    };
    return { slots, queue, pending: pendingList, board, stations, warmedUp: warmedUp() };
  }
  function broadcastState(): void {
    bus.broadcast({ kind: "dispatch.state", state: snapshot() });
  }

  // ── lifecycle ──
  bus.onConnect((reply) => reply({ kind: "dispatch.state", state: snapshot() }));

  let tick: ReturnType<typeof setInterval> | null = null;
  if (opts.autoStart !== false) tick = setInterval(() => evaluate(), knobs.tickMs);
  function stop(): void {
    if (tick) clearInterval(tick);
    for (const t of offlineTimers.values()) clearTimeout(t);
    offlineTimers.clear();
  }

  // checkin/recall/repool/markComplete/remove + station identity are added in Task 3.4.
  function notImplemented(): never {
    throw new Error("dispatcher: method added in Task 3.4");
  }
  return {
    checkin: notImplemented,
    confirm,
    assign,
    recall: notImplemented,
    repool: notImplemented,
    markComplete: notImplemented,
    remove: notImplemented,
    clearFlags,
    snapshot,
    kick,
    stop,
  };
}
