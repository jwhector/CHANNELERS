import { config } from "./config";
import { store, type VisitorRecord } from "./store";
import type {
  Station, DispatchState, Slot, SlotOccupant, DispatchDone, DispatchQueueEntry, DispatchFlag,
  WsServerMsg, WsClientMsg,
} from "@channelers/shared";

const STATION_ORDER: Station[] = ["intake", "bodyscan", "altar"];

export interface DispatcherBus {
  broadcast(msg: WsServerMsg): void;
  onConnect(fn: (reply: (m: WsServerMsg) => void, connId: string) => void): void;
  onDisconnect(fn: (connId: string) => void): void;
  onCommand(fn: (cmd: WsClientMsg, reply: (m: WsServerMsg) => void, connId: string) => void): void;
}

type Knobs = typeof config.dispatcher;

/** Internal slot record. `occupant` mirrors the visitor's location phase for called/in_progress. */
type SlotState = {
  id: string;
  station: Station;
  kioskId?: string;
  connId?: string;
  occupant?: SlotOccupant;
};

export interface Dispatcher {
  confirm(visitorId: string): boolean;
  arrive(visitorId: string): boolean;
  assign(visitorId: string, slotId: string): boolean;
  repool(visitorId: string): boolean;
  markComplete(visitorId: string): boolean;
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

  // Derive the addressable slots from the configured per-station counts.
  const slots = new Map<string, SlotState>();
  for (const station of STATION_ORDER) {
    const count = knobs.slots[station] ?? 0;
    for (let i = 0; i < count; i++) {
      const id = `${station}-${i}`;
      slots.set(id, { id, station });
    }
  }

  const flags = new Map<string, DispatchFlag[]>();
  const surplus = new Map<string, { station: Station; kioskId: string }>(); // connId → {station, kioskId} (connected screen with no free slot)
  const offlineTimers = new Map<string, ReturnType<typeof setTimeout>>(); // slotId → grace timer

  const nowIso = () => new Date().toISOString();
  const ageMs = (iso: string) => Date.now() - Date.parse(iso);

  function addFlag(id: string, ff: DispatchFlag): void {
    const arr = flags.get(id) ?? [];
    if (!arr.some((x) => x.type === ff.type && x.reason === ff.reason)) arr.push(ff);
    flags.set(id, arr);
  }
  function clearFlags(id: string): void {
    flags.delete(id);
  }

  const slotsOf = (station: Station) => [...slots.values()].filter((s) => s.station === station);
  const isOnline = (s: SlotState) => !!s.connId;
  const occupiedVisitorIds = () =>
    new Set([...slots.values()].flatMap((s) => (s.occupant ? [s.occupant.visitorId] : [])));
  const slotOfVisitor = (visitorId: string) =>
    [...slots.values()].find((s) => s.occupant?.visitorId === visitorId);

  // ── eligibility (spec §3.3 of the Tier 3 spec, unchanged) ──
  function eligibleStations(v: VisitorRecord): Station[] {
    if (v.location.state !== "waiting") return [];
    const out: Station[] = [];
    if (!v.intakeAt) out.push("intake");
    if (!v.poseAt) out.push("bodyscan");
    if (v.intakeAt && v.poseAt && !v.sessionEndAt) out.push("altar");
    return out;
  }

  // ── kiosk binding (spec §4) ──
  function bind(station: Station, kioskId: string, connId: string, slotHint?: string): void {
    // 1. reclaim: this kioskId already owns a slot of this station
    const owned = slotsOf(station).find((s) => s.kioskId === kioskId);
    if (owned) {
      const t = offlineTimers.get(owned.id);
      if (t) { clearTimeout(t); offlineTimers.delete(owned.id); }
      owned.connId = connId;
      surplus.delete(connId);
      broadcastState();
      return;
    }
    // 2. explicit slotHint → take that slot (newest wins on collision)
    let target = slotHint ? slots.get(slotHint) : undefined;
    if (target && target.station !== station) target = undefined;
    // 3. else auto-claim the next free (unbound) slot
    if (!target) target = slotsOf(station).find((s) => !s.kioskId);
    if (!target) {
      surplus.set(connId, { station, kioskId }); // 4. no free slot
      broadcastState();
      return;
    }
    if (target.kioskId && target.connId && target.connId !== connId) {
      addFlag(`slot:${target.id}`, { type: "auto-reaped", reason: "kiosk-collision", since: nowIso() });
    }
    const t = offlineTimers.get(target.id);
    if (t) { clearTimeout(t); offlineTimers.delete(target.id); }
    target.kioskId = kioskId;
    target.connId = connId;
    surplus.delete(connId);
    broadcastState();
  }

  function handleCommand(cmd: WsClientMsg, connId: string): void {
    if (cmd.kind !== "station.hello") return;
    bind(cmd.station, cmd.kioskId, connId, cmd.slotHint);
  }

  function handleDisconnect(connId: string): void {
    if (surplus.delete(connId)) { broadcastState(); return; }
    const slot = [...slots.values()].find((s) => s.connId === connId);
    if (!slot) return;
    slot.connId = undefined; // offline immediately; binding held through grace for reclaim
    const slotId = slot.id;
    const timer = setTimeout(() => {
      offlineTimers.delete(slotId);
      const s = slots.get(slotId);
      if (!s || s.connId) return; // reconnected
      s.kioskId = undefined; // unbind
      reapOccupant(s, "kiosk-offline"); // no-op here; real impl in Task 3
      broadcastState();
    }, knobs.graceMs);
    offlineTimers.set(slotId, timer);
    broadcastState();
  }

  // Stubs replaced in Task 3.
  function reapOccupant(_slot: SlotState, _reason: string): void { /* Task 3 */ }
  function reconcile(): void { /* Task 3 */ }
  function fill(): void { /* Task 3 */ }
  function notImplemented(): never { throw new Error("dispatcher: method added in Task 3"); }

  function kick(): void {
    reconcile();
    fill();
    broadcastState();
  }

  // ── snapshot ──
  function toSlot(s: SlotState): Slot {
    return { id: s.id, station: s.station, kioskId: s.kioskId, online: isOnline(s), occupant: s.occupant };
  }
  function queueEntries(): DispatchQueueEntry[] {
    const occupied = occupiedVisitorIds();
    return store.list()
      .filter((v) => !occupied.has(v.id) && eligibleStations(v).length > 0)
      .map((v) => ({
        id: v.id, number: v.number, name: v.survey?.name,
        eligible: eligibleStations(v), waitingSince: v.location.since,
        flags: flags.get(v.id) ?? [],
      }));
  }
  function completedEntries(): DispatchDone[] {
    return store.list()
      .filter((v) => !!v.sessionEndAt)
      .map((v) => ({ id: v.id, number: v.number, name: v.survey?.name, at: v.sessionEndAt as string }));
  }
  function snapshot(): DispatchState {
    const slotList = [...slots.values()].map(toSlot);
    const stationsOnline = {
      intake: slotsOf("intake").some(isOnline),
      bodyscan: slotsOf("bodyscan").some(isOnline),
      altar: slotsOf("altar").some(isOnline),
    };
    return {
      slots: slotList,
      queue: queueEntries(),
      completed: completedEntries(),
      surplus: [...surplus.values()],
      stationsOnline,
      warmedUp: warmedUp(),
    };
  }
  function broadcastState(): void {
    bus.broadcast({ kind: "dispatch.state", state: snapshot() });
  }

  // warm-up (Task 3 uses this in fill; defined here for the snapshot)
  function warmedUp(): boolean {
    const visitors = store.list();
    const occupied = occupiedVisitorIds();
    const pool = visitors.filter((v) => !occupied.has(v.id) && eligibleStations(v).length > 0);
    if (pool.length >= knobs.K) return true;
    const earliest = visitors.reduce<number | null>((min, v) => {
      const t = Date.parse(v.createdAt);
      return min === null || t < min ? t : min;
    }, null);
    return earliest !== null && Date.now() - earliest >= knobs.warmupMs;
  }

  // ── lifecycle ──
  bus.onConnect((reply) => reply({ kind: "dispatch.state", state: snapshot() }));
  bus.onCommand((cmd, _reply, connId) => handleCommand(cmd, connId));
  bus.onDisconnect((connId) => handleDisconnect(connId));

  let tick: ReturnType<typeof setInterval> | null = null;
  if (opts.autoStart !== false) tick = setInterval(() => kick(), knobs.tickMs);
  function stop(): void {
    if (tick) clearInterval(tick);
    for (const t of offlineTimers.values()) clearTimeout(t);
    offlineTimers.clear();
  }

  return {
    confirm: notImplemented,
    arrive: notImplemented,
    assign: notImplemented,
    repool: notImplemented,
    markComplete: notImplemented,
    remove: notImplemented,
    clearFlags,
    snapshot,
    kick,
    stop,
  };
}
