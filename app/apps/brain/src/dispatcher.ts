import { config } from "./config";
import { store, type VisitorRecord } from "./store";
import type {
  Station, DispatchState, Slot, SlotOccupant, DispatchDone, DispatchQueueEntry, DispatchFlag,
  WsServerMsg, WsClientMsg,
} from "@channelers/shared";

const STATION_ORDER: Station[] = ["intake", "bodyscan", "altar", "paper"];

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
  checkin(num: number, station: Station): { record: VisitorRecord };
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

  // A timed group station (e.g. `paper`): kiosk-less, always-online slots, completed by a dwell
  // timer from Confirm-call instead of a task milestone (spec 2026-06-22).
  const isTimed = (s: Station): boolean => !!knobs.timed?.[s];
  const dwellMs = (s: Station): number => knobs.timed?.[s]?.dwellMs ?? Infinity;

  function addFlag(id: string, ff: DispatchFlag): void {
    const arr = flags.get(id) ?? [];
    if (!arr.some((x) => x.type === ff.type && x.reason === ff.reason)) arr.push(ff);
    flags.set(id, arr);
  }
  function clearFlags(id: string): void {
    flags.delete(id);
  }

  const slotsOf = (station: Station) => [...slots.values()].filter((s) => s.station === station);
  const isOnline = (s: SlotState) => isTimed(s.station) || !!s.connId;
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
    if (!v.paperAt) out.push("paper"); // non-gating, ungated timed station (spec 2026-06-22)
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
      reapOccupant(s, "kiosk-offline"); // repool the slot's occupant
      broadcastState();
    }, knobs.graceMs);
    offlineTimers.set(slotId, timer);
    broadcastState();
  }

  // ── selection (anti-starvation over random; excludes occupied + non-waiting) ──
  function select(station: Station): VisitorRecord | undefined {
    const occupied = occupiedVisitorIds();
    const eligible = store.list().filter(
      (v) => !occupied.has(v.id) && eligibleStations(v).includes(station),
    );
    if (eligible.length === 0) return undefined;
    const starving = eligible.filter((v) => ageMs(v.location.since) > knobs.maxWaitMs);
    const pool = starving.length > 0 ? starving : eligible;
    if (starving.length > 0) {
      return pool.reduce((oldest, v) =>
        Date.parse(v.location.since) < Date.parse(oldest.location.since) ? v : oldest);
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function fill(): void {
    if (!warmedUp()) return;
    for (const slot of slots.values()) {
      if (!isOnline(slot) || slot.occupant) continue;
      const pick = select(slot.station);
      if (!pick) continue;
      slot.occupant = { visitorId: pick.id, number: pick.number, phase: "pending", since: nowIso() };
      if (knobs.autoConfirm) confirm(pick.id);
    }
  }

  function confirm(visitorId: string): boolean {
    const slot = slotOfVisitor(visitorId);
    if (!slot || slot.occupant?.phase !== "pending") return false;
    slot.occupant.phase = "called";
    slot.occupant.since = nowIso();
    store.setLocation(visitorId, { state: "called", station: slot.station, since: nowIso() });
    clearFlags(visitorId);
    broadcastState();
    return true;
  }

  function arrive(visitorId: string): boolean {
    const slot = slotOfVisitor(visitorId);
    if (!slot || slot.occupant?.phase !== "called") return false;
    slot.occupant.phase = "in_progress";
    slot.occupant.since = nowIso();
    store.setLocation(visitorId, { state: "in_progress", station: slot.station, since: nowIso() });
    clearFlags(visitorId);
    broadcastState();
    return true;
  }

  function assign(visitorId: string, slotId: string): boolean {
    const v = store.get(visitorId);
    const slot = slots.get(slotId);
    if (!v || v.location.state !== "waiting" || !slot || !isOnline(slot) || slot.occupant) return false;
    if (occupiedVisitorIds().has(visitorId)) return false;
    slot.occupant = { visitorId, number: v.number, phase: "pending", since: nowIso() };
    if (knobs.autoConfirm) confirm(visitorId);
    broadcastState();
    return true;
  }

  function freeSlotOf(visitorId: string): void {
    const slot = slotOfVisitor(visitorId);
    if (slot) slot.occupant = undefined;
  }

  function repool(visitorId: string): boolean {
    const v = store.get(visitorId);
    if (!v) return false;
    freeSlotOf(visitorId);
    store.setLocation(visitorId, { state: "waiting", since: nowIso() });
    clearFlags(visitorId);
    broadcastState();
    return true;
  }

  function markComplete(visitorId: string): boolean {
    const slot = slotOfVisitor(visitorId);
    const v = store.get(visitorId);
    if (!v) return false;
    const station = slot?.station ?? (v.location.station as Station | undefined);
    if (station) {
      store.stampMilestone(visitorId, milestoneField(station));
    }
    freeSlotOf(visitorId);
    store.setLocation(visitorId, { state: "waiting", since: nowIso() });
    clearFlags(visitorId);
    broadcastState();
    return true;
  }

  function remove(visitorId: string): boolean {
    freeSlotOf(visitorId);
    const ok = store.remove(visitorId);
    if (ok) {
      flags.delete(visitorId);
      broadcastState();
    }
    return ok;
  }

  /**
   * Manual operator override (spec §5 / decision log) — the `/console` type-a-number
   * safety net for when a station screen misbehaves. Forces the visitor in_progress at
   * `station`, bypassing the slot/confirm flow. Best-effort: if a free online slot exists
   * at that station, pin the visitor to it so the board reflects it; otherwise just force
   * the location (the screen may be offline — the override must still work).
   */
  function checkin(num: number, station: Station): { record: VisitorRecord } {
    const record = store.getByNumber(num) ?? store.register(num);
    freeSlotOf(record.id); // drop any existing slot pin → no split state
    store.setLocation(record.id, { state: "in_progress", station, since: nowIso() });
    clearFlags(record.id);
    const slot = slotsOf(station).find((s) => isOnline(s) && !s.occupant);
    if (slot) slot.occupant = { visitorId: record.id, number: record.number, phase: "in_progress", since: nowIso() };
    broadcastState();
    return { record };
  }

  function milestoneField(station: Station): "intakeAt" | "poseAt" | "paperAt" | "sessionEndAt" {
    if (station === "intake") return "intakeAt";
    if (station === "bodyscan") return "poseAt";
    if (station === "paper") return "paperAt";
    return "sessionEndAt"; // altar held through the reading
  }

  function completionMilestoneSet(v: VisitorRecord, station: Station): boolean {
    if (station === "intake") return !!v.intakeAt;
    if (station === "bodyscan") return !!v.poseAt;
    if (station === "paper") return !!v.paperAt;
    return !!v.sessionEndAt; // altar held through the reading
  }

  function reapOccupant(slot: SlotState, reason: string): void {
    const occ = slot.occupant;
    slot.occupant = undefined;
    if (!occ) return;
    if (store.get(occ.visitorId)) {
      store.setLocation(occ.visitorId, { state: "waiting", since: nowIso() });
      addFlag(occ.visitorId, { type: "auto-reaped", reason, since: nowIso() });
    }
  }

  function reconcile(): void {
    for (const slot of slots.values()) {
      const occ = slot.occupant;
      if (!occ) continue;
      const v = store.get(occ.visitorId);
      if (!v) { slot.occupant = undefined; continue; }

      // ── called: awaiting arrival. No-show now applies to EVERY station, timed
      //    included — a person called but never confirmed-arrived must not complete. ──
      if (occ.phase === "called") {
        if (ageMs(occ.since) > knobs.noShowMs) {
          if (knobs.noShowAutoRepool) reapOccupant(slot, "no-show");
          else addFlag(v.id, { type: "no-show", since: nowIso() });
        }
        continue;
      }

      // ── in_progress ──
      if (isTimed(slot.station)) {
        // Dwell measured from ARRIVAL (occ.since was reset by arrive()); it completes the visit.
        const dwell = dwellMs(slot.station);
        if (ageMs(occ.since) > dwell) {
          store.stampMilestone(occ.visitorId, milestoneField(slot.station));
          slot.occupant = undefined;
          store.setLocation(occ.visitorId, { state: "waiting", since: nowIso() });
          clearFlags(occ.visitorId);
        } else if (!Number.isFinite(dwell) && ageMs(occ.since) > knobs.staleMs) {
          // Backstop only when a timed station has NO finite dwell to complete it
          // (misconfiguration). A finite dwell always completes first and is never preempted.
          reapOccupant(slot, "stale");
        }
        continue;
      }

      // ── kiosk in_progress: external milestone completes; stale reaps a hung occupant. ──
      if (completionMilestoneSet(v, slot.station)) {
        slot.occupant = undefined;
        store.setLocation(v.id, { state: "waiting", since: nowIso() });
      } else if (ageMs(occ.since) > knobs.staleMs) {
        reapOccupant(slot, "stale");
      }
    }

    if (knobs.autoConfirm) {
      for (const slot of slots.values()) {
        if (slot.occupant?.phase === "pending") confirm(slot.occupant.visitorId);
      }
    }
    if (knobs.autoArrive) {
      for (const slot of slots.values()) {
        if (slot.occupant?.phase === "called") arrive(slot.occupant.visitorId);
      }
    }
  }

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
      paper: slotsOf("paper").some(isOnline),
    };
    const timedDwellMs: Partial<Record<Station, number>> = {};
    for (const s of STATION_ORDER) if (isTimed(s)) timedDwellMs[s] = dwellMs(s);
    return {
      slots: slotList,
      queue: queueEntries(),
      completed: completedEntries(),
      surplus: [...surplus.values()],
      stationsOnline,
      timedDwellMs,
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

  return { confirm, arrive, assign, repool, markComplete, remove, checkin, clearFlags, snapshot, kick, stop };
}
