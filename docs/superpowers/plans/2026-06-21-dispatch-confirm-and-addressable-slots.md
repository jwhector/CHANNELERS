# Dispatch Redesign — Confirm-at-Station + Addressable Kiosk Slots + 3-Zone Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Cross-machine handoff note (read this first):** This plan is the durable transfer artifact. It builds **on top of the Tier 3 dispatcher** (branch `tier3-dispatcher-board-console`). Before starting, confirm you are on a branch that contains the Tier 3 work — check that `app/apps/brain/src/dispatcher.ts` exists and `pnpm --filter @channelers/brain test` is green (≈46 tests). The design rationale + decision log is `docs/superpowers/specs/2026-06-20-dispatch-confirm-and-addressable-slots-design.md` — read it. The original Tier 3 plan (for conventions/structure) is `docs/superpowers/plans/2026-06-20-tier3-dispatcher-board-console.md`.

**Goal:** Replace the type-your-number station check-in with an explicit **confirm-at-station** arrival, backed by an **addressable, kiosk-bound, config-scalable slot model**, and rebuild `/dispatch` as a no-scroll **3-zone board**.

**Architecture:** The Tier 3 dispatcher modeled slots as *counts* per station. This plan makes slots **addressable**: every station is an array of named slots (`${station}-${i}`, count from `config.dispatcher.slots`); each slot is **bound to a kiosk screen** (via `station.hello { kioskId, slotHint? }`), is **online** only while that screen is connected, and holds a **pinned occupant** (`pending → called → in_progress`). The dispatcher only fills **free online** slots. A station's `called → in_progress` transition is driven by an explicit **Confirm arrival** on the kiosk screen (not a typed number). `/dispatch` renders the slots as a dynamic grid (left = waiting pool, center = slot rectangles, right = completed).

**Tech Stack:** TypeScript, pnpm workspace; brain = Fastify + `ws` + OpenAI SDK; stage = Vite + React + react-router-dom; shared = zod. Tests: **vitest** (brain — engine unit-tested against a fake bus with `vi.useFakeTimers()`); typecheck + build + written manual browser smoke (stage).

**Spec:** `docs/superpowers/specs/2026-06-20-dispatch-confirm-and-addressable-slots-design.md` (read §3 slot model, §4 binding lifecycle, §5 confirm flow, §6 board).

## Global Constraints

- **Verification split (governs every task's test step):** brain logic uses **vitest**; the dispatcher engine is built **bus-injectable** (`createDispatcher(bus, opts)`) so tests drive it against a fake bus with `autoStart:false` + `vi.useFakeTimers()`. Stage UI uses **`pnpm -r typecheck` + `pnpm --filter @channelers/stage build` + a written manual browser smoke**. Do not add a React test harness.
- **Typecheck gate:** every task ends green on `pnpm -r typecheck` (0 errors, all packages).
- **Offline-resilient:** the brain runs with **no `OPENAI_API_KEY`**. Nothing here requires a key.
- **OpenAI provider** (do not introduce Anthropic): the brain uses the `openai` SDK. This plan touches no AI calls.
- **Knobs stay config-driven:** read every threshold from `config.dispatcher.*`; the engine accepts a `knobs` override for tests. **Slot counts are `config.dispatcher.slots: Record<Station, number>`** — nothing hardcodes a count (no literal `4`, no literal `2` for intake). The board, capacity, and binding all derive from these counts.
- **Dispatch state is screens-only:** publish with `bus.broadcast` (WS), **never** `bus.publish` (OSC). Do not add dispatcher data to the `ShowEvent` union.
- **Keep `visitor.location` as the per-visitor truth** (`waiting | called | in_progress` + `station`), synced to the slot occupant for `called`/`in_progress`. The slot registry is an *addressing layer on top*; eligibility/`/channel`/`/console` keep reading `visitor.location`.
- **Don't regress:** Tier 1 (intake/bodyscan/altar work UIs, divination session loop + reaper, `/channel`) and the Tier 3 warm-up/anti-starvation/no-show/`T_stale` *concepts* stay working. Touch `divination.ts` not at all.
- **Commit after every task.** Conventional commits, each ending with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

**Shared (`packages/shared/src/`)**
- `protocol.ts` — **modify**: add `kioskId`/`slotHint` to the `station.hello` `WsClientMsg`; replace the dispatch types — `Slot`, `SlotOccupant`, reshape `DispatchState` (`slots: Slot[]`, add `completed`, `surplus`, `stationsOnline`), add `DispatchDone`.

**Brain (`apps/brain/src/`)**
- `dispatcher.ts` — **rewrite**: addressable slot registry derived from config; kiosk binding lifecycle; pinned dispatch; per-slot recovery; `Slot[]` snapshot.
- `app.ts` — **modify**: add `POST /api/dispatch/arrive`; change `POST /api/dispatch/assign` body to `{ visitorId, slotId }`; keep `POST /api/checkin` as the `/console` manual override.
- `config.ts` — **unchanged** (`slots` already `Record<Station, number>`; you may raise a count for testing).
- `test/dispatcher.test.ts` — **rewrite** (slot model). `test/endpoints.test.ts` — **modify** (arrive + assign-by-slot).

**Stage (`apps/stage/src/`)**
- `lib/api.ts` — **modify**: `arrive(visitorId)`; change `dispatch.assign` to `(visitorId, slotId)`.
- `lib/useStationPresence.ts` — **modify**: send `{ station, kioskId, slotHint? }`; expose the bound slot from `dispatch.state`.
- `components/CalledGate.tsx` — **create**: the confirm-at-station gate (replaces `NumberGate` at stations).
- `routes/Intake.tsx`, `routes/BodyScan.tsx`, `routes/Altar.tsx` — **modify**: wrap the existing work UI in `CalledGate`.
- `routes/Dispatch.tsx` — **rewrite**: 3-zone board.
- `routes/Console.tsx` — **modify**: read `slots[]`; keep the manual override.
- `index.css` (or the app's stylesheet) — **modify**: board layout, slot grid, tooltip, pulse.

---

# TASKS

## Task 1: Shared protocol — Slot types, reshaped DispatchState, station.hello identity

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/brain/test/schema.test.ts`

**Interfaces:**
- Produces:
  - `WsClientMsg` `station.hello` becomes `{ kind: "station.hello"; station: Station; kioskId: string; slotHint?: string }`.
  - `SlotOccupant = { visitorId: string; number: number; phase: "pending" | "called" | "in_progress"; since: string }`.
  - `Slot = { id: string; station: Station; kioskId?: string; online: boolean; occupant?: SlotOccupant }`.
  - `DispatchDone = { id: string; number: number; name?: string; at: string }`.
  - `DispatchState = { slots: Slot[]; queue: DispatchQueueEntry[]; completed: DispatchDone[]; surplus: { station: Station; kioskId: string }[]; stationsOnline: Record<Station, boolean>; warmedUp: boolean }`.
  - `DispatchQueueEntry`/`DispatchFlag` keep their Tier 3 shape.

- [ ] **Step 1: Write the failing test.** Append to `apps/brain/test/schema.test.ts`:

```ts
describe("schema: station.hello identity", () => {
  it("parses station.hello with kioskId + optional slotHint", () => {
    expect(WsClientMsg.safeParse({ kind: "station.hello", station: "intake", kioskId: "k1" }).success).toBe(true);
    expect(WsClientMsg.safeParse({ kind: "station.hello", station: "intake", kioskId: "k1", slotHint: "intake-1" }).success).toBe(true);
  });
  it("rejects station.hello missing kioskId", () => {
    expect(WsClientMsg.safeParse({ kind: "station.hello", station: "intake" }).success).toBe(false);
  });
});
```

(`WsClientMsg` is already imported at the top of `schema.test.ts` from Tier 3; if not, add it to the existing `@channelers/shared` import.)

- [ ] **Step 2: Run it, verify it fails.**

```bash
pnpm --filter @channelers/brain test test/schema.test.ts
```

Expected: FAIL — `station.hello` currently has no `kioskId`.

- [ ] **Step 3: Update `packages/shared/src/protocol.ts`.** Change the `station.hello` arm of `WsClientMsg`:

```ts
  z.object({
    kind: z.literal("station.hello"),
    station: Station,
    kioskId: z.string(),
    slotHint: z.string().optional(),
  }),
```

Replace the Tier 3 dispatch types block (the `DispatchSlot`/`DispatchState` etc. added in the Tier 3 protocol) with the new shapes. **Keep** `DispatchFlag` and `DispatchQueueEntry` exactly as Tier 3 defined them; **replace** `DispatchSlot`/`DispatchCall` usage and the `DispatchState` body:

```ts
/** One occupant pinned to a slot. `phase` is the slot-level occupancy stage. */
export type SlotOccupant = {
  visitorId: string;
  number: number;
  phase: "pending" | "called" | "in_progress";
  since: string;
};

/** An addressable station slot, optionally bound to a kiosk screen (spec §3.2). */
export type Slot = {
  id: string;            // `${station}-${i}`, e.g. "intake-0"
  station: Station;
  kioskId?: string;      // present ⇒ a screen claimed this slot
  online: boolean;       // kiosk bound AND its socket connected
  occupant?: SlotOccupant;
};

/** A visitor who finished the whole ritual (sessionEndAt set). */
export type DispatchDone = { id: string; number: number; name?: string; at: string };

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
  /** False during the warm-up window (spec §9 of the Tier 3 spec). */
  warmedUp: boolean;
};
```

Add the `dispatch.state` variant to `WsServerMsg` (it already exists from Tier 3 as `{ kind: "dispatch.state"; state: DispatchState }` — leave that line, it now references the new `DispatchState`).

- [ ] **Step 4: Run the test + typecheck.**

```bash
pnpm --filter @channelers/brain test test/schema.test.ts && pnpm -r typecheck
```

Expected: schema test PASSES. Typecheck will now FAIL in `dispatcher.ts`, `app.ts`, and the stage files that consume the old `DispatchState`/`DispatchSlot` — **that is expected**; those are rewritten in later tasks. Confirm the *only* failures are old-shape references, not new schema errors.

- [ ] **Step 5: Commit.**

```bash
git add packages/shared/src/protocol.ts apps/brain/test/schema.test.ts
git commit -m "feat(shared): addressable Slot types + station.hello kiosk identity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Dispatcher engine — slot registry + kiosk binding + snapshot

**Files:**
- Modify: `apps/brain/src/dispatcher.ts` (rewrite the internal model; dispatch logic stubbed until Task 3)
- Modify: `apps/brain/test/dispatcher.test.ts` (rewrite for the slot model)

**Interfaces:**
- Consumes: `store` (with `register/get/getByNumber/list/setLocation/stampMilestone/remove`), `config.dispatcher` (`slots: Record<Station,number>`, plus `K/warmupMs/maxWaitMs/noShowMs/staleMs/graceMs/tickMs/autoConfirm/noShowAutoRepool`), shared `Slot`/`SlotOccupant`/`DispatchState` (Task 1).
- Produces: `createDispatcher(bus, opts?)` → `Dispatcher` with `snapshot()`, `kick()`, `stop()`, and (stubbed here, real in Task 3) `confirm`/`arrive`/`assign`/`repool`/`markComplete`/`remove`. `DispatcherBus` = `{ broadcast, onConnect, onDisconnect, onCommand }` (same as Tier 3).
- Binding behavior (spec §4): `station.hello { station, kioskId, slotHint? }` binds a slot; reclaim on reconnect by `kioskId`; auto-claim next free slot; collision (newest wins, flagged); surplus (no free slot, flagged); per-slot socket-drop → `graceMs` → slot offline + unbind (occupant repool added in Task 3).

- [ ] **Step 1: Write the failing test** — replace the contents of `apps/brain/test/dispatcher.test.ts` with this (Task 3 appends more):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { store } from "../src/store";
import { createDispatcher, type DispatcherBus } from "../src/dispatcher";
import type { WsServerMsg, DispatchState } from "@channelers/shared";

function fakeBus() {
  const broadcasts: WsServerMsg[] = [];
  let connectFn: ((reply: (m: WsServerMsg) => void, c: string) => void) | null = null;
  let disconnectFn: ((c: string) => void) | null = null;
  let commandFn: ((cmd: any, reply: (m: WsServerMsg) => void, c: string) => void) | null = null;
  const bus: DispatcherBus = {
    broadcast: (m) => broadcasts.push(m),
    onConnect: (fn) => { connectFn = fn; },
    onDisconnect: (fn) => { disconnectFn = fn; },
    onCommand: (fn) => { commandFn = fn; },
  };
  return {
    bus, broadcasts,
    fireConnect: (reply: (m: WsServerMsg) => void, c = "c1") => connectFn?.(reply, c),
    fireDisconnect: (c: string) => disconnectFn?.(c),
    hello: (station: string, kioskId: string, connId: string, slotHint?: string) =>
      commandFn?.({ kind: "station.hello", station, kioskId, slotHint }, () => {}, connId),
    lastState: (): DispatchState | undefined => {
      const m = [...broadcasts].reverse().find((x) => x.kind === "dispatch.state");
      return m && m.kind === "dispatch.state" ? m.state : undefined;
    },
  };
}

// Counts chosen to exercise multi-slot + singletons; engine must derive everything from these.
const SLOTS = { intake: 3, bodyscan: 2, altar: 1 } as const;
const KNOBS = { slots: SLOTS, K: 1, warmupMs: 0, graceMs: 20_000, tickMs: 5_000 };

let f: ReturnType<typeof fakeBus>;
let d: ReturnType<typeof createDispatcher>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-21T00:00:00.000Z"));
  store.clear();
  f = fakeBus();
  d = createDispatcher(f.bus, { knobs: KNOBS, autoStart: false });
});
afterEach(() => { d.stop(); vi.useRealTimers(); });

describe("slot derivation from config counts", () => {
  it("creates one slot per configured count, named ${station}-${i}, all offline", () => {
    const s = d.snapshot();
    expect(s.slots.map((x) => x.id).sort()).toEqual(
      ["altar-0", "bodyscan-0", "bodyscan-1", "intake-0", "intake-1", "intake-2"],
    );
    expect(s.slots.every((x) => x.online === false && !x.kioskId)).toBe(true);
    expect(s.stationsOnline).toEqual({ intake: false, bodyscan: false, altar: false });
  });
});

describe("kiosk binding", () => {
  it("auto-claims the next free slot and marks it online", () => {
    f.hello("intake", "kioskA", "connA");
    const s = d.snapshot();
    const bound = s.slots.filter((x) => x.station === "intake" && x.online);
    expect(bound.length).toBe(1);
    expect(bound[0].kioskId).toBe("kioskA");
    expect(s.stationsOnline.intake).toBe(true);
  });

  it("binds the explicit slotHint when given", () => {
    f.hello("intake", "kioskB", "connB", "intake-2");
    const slot = d.snapshot().slots.find((x) => x.id === "intake-2");
    expect(slot?.online).toBe(true);
    expect(slot?.kioskId).toBe("kioskB");
  });

  it("reclaims the same slot when the same kioskId reconnects", () => {
    f.hello("bodyscan", "kioskC", "conn1");
    const first = d.snapshot().slots.find((x) => x.kioskId === "kioskC")!.id;
    f.fireDisconnect("conn1");
    vi.advanceTimersByTime(5); // within grace
    f.hello("bodyscan", "kioskC", "conn2");
    const again = d.snapshot().slots.find((x) => x.kioskId === "kioskC")!.id;
    expect(again).toBe(first);
    expect(d.snapshot().slots.find((x) => x.id === again)!.online).toBe(true);
  });

  it("flags a surplus screen when no slot is free (altar has 1)", () => {
    f.hello("altar", "kioskD", "connD");
    f.hello("altar", "kioskE", "connE"); // no free altar slot
    const s = d.snapshot();
    expect(s.slots.filter((x) => x.station === "altar" && x.online).length).toBe(1);
    expect(s.surplus.some((x) => x.station === "altar" && x.kioskId === "kioskE")).toBe(true);
  });
});

describe("socket-drop → slot offline after grace", () => {
  it("takes the slot offline and unbinds it after the grace window", () => {
    f.hello("intake", "kioskF", "connF");
    expect(d.snapshot().stationsOnline.intake).toBe(true);
    f.fireDisconnect("connF");
    // still bound during grace
    expect(d.snapshot().slots.some((x) => x.kioskId === "kioskF")).toBe(true);
    vi.advanceTimersByTime(KNOBS.graceMs + 10);
    const s = d.snapshot();
    expect(s.slots.some((x) => x.kioskId === "kioskF")).toBe(false);
    expect(s.stationsOnline.intake).toBe(false);
  });
});
```

> Note: `store.clear()` was added to `store.ts` during Tier 3 for test isolation. If it is missing on this branch, add it: `clear() { visitors.clear(); byNumber.clear(); }`.

- [ ] **Step 2: Run it, verify it fails.**

```bash
pnpm --filter @channelers/brain test test/dispatcher.test.ts
```

Expected: FAIL — the current `dispatcher.ts` snapshot has no `slots: Slot[]` / `surplus` / `stationsOnline`; `station.hello` binding not implemented.

- [ ] **Step 3: Rewrite `apps/brain/src/dispatcher.ts`** — the registry + binding + snapshot, with dispatch stubbed:

```ts
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
  const surplus = new Map<string, Station>(); // connId → station (connected screen with no free slot)
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
      surplus.set(connId, station); // 4. no free slot
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
      surplus: [...surplus.entries()].map(([kioskId, station]) => ({ station, kioskId })),
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
```

- [ ] **Step 4: Run the test + typecheck.**

```bash
pnpm --filter @channelers/brain test test/dispatcher.test.ts && pnpm -r typecheck
```

Expected: the Task-2 dispatcher tests PASS. Typecheck still fails in `app.ts`/stage (old dispatcher API) — fixed in Tasks 4–8.

- [ ] **Step 5: Commit.**

```bash
git add apps/brain/src/dispatcher.ts apps/brain/test/dispatcher.test.ts
git commit -m "feat(brain): addressable slot registry + kiosk binding lifecycle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Dispatcher engine — pinned dispatch + per-slot recovery

**Files:**
- Modify: `apps/brain/src/dispatcher.ts` (fill in the stubs)
- Modify: `apps/brain/test/dispatcher.test.ts` (append)

**Interfaces:**
- Produces (fills Task 2 stubs):
  - `fill()` — for each **free online** slot, if `warmedUp()`, pick an eligible waiting visitor (anti-starvation over random) and pin a `pending` occupant; `confirm` it immediately when `autoConfirm`.
  - `confirm(visitorId)` — `pending → called` on the visitor's slot; sets `visitor.location` to `called` + station.
  - `arrive(visitorId)` — `called → in_progress`; sets `visitor.location` to `in_progress` + station.
  - `assign(visitorId, slotId)` — operator manual pin to a specific free online slot (waiting visitor only).
  - `repool(visitorId)` / `markComplete(visitorId)` / `remove(visitorId)` — operator backstops.
  - `reconcile()` — completion frees the slot; `T_stale` reap; `called` no-show flag/auto-repool.
  - `reapOccupant(slot, reason)` — repool a slot's occupant to `waiting` (used by the per-slot socket-drop reaper).

- [ ] **Step 1: Append failing tests** to `apps/brain/test/dispatcher.test.ts`:

```ts
const NUM = () => 500000 + Math.floor(Math.random() * 400000);

describe("pinned dispatch only fills free ONLINE slots", () => {
  it("does not dispatch when no slot is online", () => {
    store.register(NUM());
    d.kick();
    expect(d.snapshot().slots.every((s) => !s.occupant)).toBe(true);
  });

  it("pins a pending occupant to an online slot, then confirm→arrive progress the phase", () => {
    f.hello("intake", "kioskA", "connA"); // intake-0 online
    const v = store.register(NUM());
    d.kick();
    const pendingSlot = d.snapshot().slots.find((s) => s.occupant?.phase === "pending");
    expect(pendingSlot?.occupant?.visitorId).toBe(v.id);
    expect(pendingSlot?.station).toBe("intake");

    expect(d.confirm(v.id)).toBe(true);
    expect(store.get(v.id)?.location).toMatchObject({ state: "called", station: "intake" });
    expect(d.snapshot().slots.find((s) => s.occupant?.visitorId === v.id)?.occupant?.phase).toBe("called");

    expect(d.arrive(v.id)).toBe(true);
    expect(store.get(v.id)?.location).toMatchObject({ state: "in_progress", station: "intake" });
    expect(d.snapshot().slots.find((s) => s.occupant?.visitorId === v.id)?.occupant?.phase).toBe("in_progress");
  });

  it("effective capacity = online slots: 2 online intake slots hold at most 2 occupants", () => {
    f.hello("intake", "kA", "cA");
    f.hello("intake", "kB", "cB"); // 2 of 3 intake slots online
    for (let i = 0; i < 5; i++) store.register(NUM());
    d.kick();
    const intakeOccupied = d.snapshot().slots.filter((s) => s.station === "intake" && s.occupant).length;
    expect(intakeOccupied).toBe(2);
  });
});

describe("completion frees the slot", () => {
  it("an in_progress intake occupant with intakeAt set is freed on the next kick", () => {
    f.hello("intake", "kA", "cA");
    const v = store.register(NUM());
    d.kick(); d.confirm(v.id); d.arrive(v.id);
    store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] }); // stamps intakeAt
    d.kick();
    expect(d.snapshot().slots.find((s) => s.occupant?.visitorId === v.id)).toBeUndefined();
    expect(store.get(v.id)?.location.state).toBe("waiting");
  });
});

describe("recovery", () => {
  it("T_stale reaps an in_progress occupant with no completion", () => {
    const d2 = createDispatcher(f.bus, { knobs: { ...KNOBS, staleMs: 300_000 }, autoStart: false });
    f.hello("bodyscan", "kA", "cA");
    const v = store.register(NUM());
    d2.kick(); d2.confirm(v.id); d2.arrive(v.id);
    vi.setSystemTime(new Date("2026-06-21T00:06:00.000Z"));
    d2.kick();
    expect(store.get(v.id)?.location.state).toBe("waiting");
    d2.stop();
  });

  it("flags a no-show by default", () => {
    const d2 = createDispatcher(f.bus, { knobs: { ...KNOBS, noShowMs: 90_000 }, autoStart: false });
    f.hello("intake", "kA", "cA");
    const v = store.register(NUM());
    d2.kick(); d2.confirm(v.id); // called
    vi.setSystemTime(new Date("2026-06-21T00:02:00.000Z"));
    d2.kick();
    expect(store.get(v.id)?.location.state).toBe("called");
    const slot = d2.snapshot().slots.find((s) => s.occupant?.visitorId === v.id);
    expect(slot?.occupant?.phase).toBe("called");
    d2.stop();
  });

  it("socket-drop after grace repools the slot's occupant", () => {
    f.hello("altar", "kA", "cA");
    const v = store.register(NUM());
    store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] });
    store.setPoseTemplate(v.id, { angles: [0], weights: [1] }); // now altar-eligible
    store.setLocation(v.id, { state: "waiting", since: new Date().toISOString() });
    d.kick(); d.confirm(v.id); d.arrive(v.id); // in_progress@altar
    f.fireDisconnect("cA");
    vi.advanceTimersByTime(KNOBS.graceMs + 10);
    expect(store.get(v.id)?.location.state).toBe("waiting");
    expect(d.snapshot().slots.find((s) => s.id === "altar-0")?.occupant).toBeUndefined();
  });
});

describe("operator backstops", () => {
  it("assign pins a waiting visitor to a specific free online slot", () => {
    f.hello("intake", "kA", "cA"); // intake-0
    const v = store.register(NUM());
    expect(d.assign(v.id, "intake-0")).toBe(true);
    expect(d.snapshot().slots.find((s) => s.id === "intake-0")?.occupant?.visitorId).toBe(v.id);
  });
  it("repool clears a visitor's slot back to waiting", () => {
    f.hello("intake", "kA", "cA");
    const v = store.register(NUM());
    d.kick(); d.confirm(v.id);
    expect(d.repool(v.id)).toBe(true);
    expect(store.get(v.id)?.location.state).toBe("waiting");
    expect(d.snapshot().slots.every((s) => s.occupant?.visitorId !== v.id)).toBe(true);
  });
  it("remove deletes the record and frees its slot", () => {
    f.hello("intake", "kA", "cA");
    const v = store.register(NUM());
    d.kick(); d.confirm(v.id);
    expect(d.remove(v.id)).toBe(true);
    expect(store.get(v.id)).toBeUndefined();
    expect(d.snapshot().slots.every((s) => s.occupant?.visitorId !== v.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify failure.**

```bash
pnpm --filter @channelers/brain test test/dispatcher.test.ts
```

Expected: FAIL — `confirm`/`arrive`/`assign`/etc. throw `added in Task 3`; `fill`/`reconcile` are no-ops.

- [ ] **Step 3: Replace the stubs in `apps/brain/src/dispatcher.ts`.** Replace the `reapOccupant`/`reconcile`/`fill`/`notImplemented` block and the `return {...}` with the real implementations:

```ts
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
    kick();
    return true;
  }

  function markComplete(visitorId: string): boolean {
    const slot = slotOfVisitor(visitorId);
    const v = store.get(visitorId);
    if (!v) return false;
    const station = slot?.station ?? (v.location.station as Station | undefined);
    const field = station === "intake" ? "intakeAt" : station === "bodyscan" ? "poseAt" : "sessionEndAt";
    if (station) store.stampMilestone(visitorId, field);
    freeSlotOf(visitorId);
    store.setLocation(visitorId, { state: "waiting", since: nowIso() });
    clearFlags(visitorId);
    kick();
    return true;
  }

  function remove(visitorId: string): boolean {
    freeSlotOf(visitorId);
    flags.delete(visitorId);
    const ok = store.remove(visitorId);
    if (ok) kick();
    return ok;
  }

  function completionMilestoneSet(v: VisitorRecord, station: Station): boolean {
    if (station === "intake") return !!v.intakeAt;
    if (station === "bodyscan") return !!v.poseAt;
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
      if (occ.phase === "in_progress") {
        if (completionMilestoneSet(v, slot.station)) {
          slot.occupant = undefined;
          store.setLocation(v.id, { state: "waiting", since: nowIso() });
        } else if (ageMs(occ.since) > knobs.staleMs) {
          reapOccupant(slot, "stale");
        }
      } else if (occ.phase === "called") {
        if (ageMs(occ.since) > knobs.noShowMs) {
          if (knobs.noShowAutoRepool) reapOccupant(slot, "no-show");
          else addFlag(v.id, { type: "no-show", since: nowIso() });
        }
      }
    }
    if (knobs.autoConfirm) {
      for (const slot of slots.values()) {
        if (slot.occupant?.phase === "pending") confirm(slot.occupant.visitorId);
      }
    }
  }
```

Then update the `return {...}` to expose the real methods (drop `notImplemented`):

```ts
  return { confirm, arrive, assign, repool, markComplete, remove, clearFlags, snapshot, kick, stop };
```

Delete the now-unused `notImplemented`. (The Task-2 `reapOccupant`/`reconcile`/`fill` stub definitions are replaced by these real ones — remove the stub versions.)

- [ ] **Step 4: Run the full dispatcher suite + typecheck.**

```bash
pnpm --filter @channelers/brain test test/dispatcher.test.ts && pnpm -r typecheck
```

Expected: all dispatcher tests (Task 2 + Task 3) PASS. Typecheck still fails in `app.ts`/stage — next tasks.

- [ ] **Step 5: Commit.**

```bash
git add apps/brain/src/dispatcher.ts apps/brain/test/dispatcher.test.ts
git commit -m "feat(brain): pinned per-slot dispatch + recovery (confirm/arrive, no-show, stale, drop)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Brain endpoints — arrive + assign-by-slot; checkin stays as override

**Files:**
- Modify: `apps/brain/src/app.ts`
- Modify: `apps/brain/test/endpoints.test.ts`

**Interfaces:**
- Produces (HTTP):
  - `POST /api/dispatch/arrive { visitorId }` → `{ ok }` (called → in_progress).
  - `POST /api/dispatch/assign { visitorId, slotId }` → `{ ok }` (changed body: `slotId`, not `station`).
  - `POST /api/dispatch/{confirm,recall?,repool,complete,remove}` — keep, but `complete` now takes only `{ visitorId }` (the dispatcher infers the station from the slot). `recall` is dropped (no-show is handled by repool/leave-flagged).
  - `POST /api/checkin { number, station }` — retained, now the **`/console` manual override** only.

> The Tier 3 `markComplete(visitorId, station)` became `markComplete(visitorId)`. The Tier 3 `recall` is removed. Update the endpoints accordingly.

- [ ] **Step 1: Write the failing test.** Append to `apps/brain/test/endpoints.test.ts`:

```ts
import WebSocket from "ws";

describe("arrive + assign-by-slot endpoints", () => {
  it("a bound kiosk gets a pending→called→arrive flow over HTTP", async () => {
    // bind an intake kiosk over a real socket so a slot is online
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ kind: "station.hello", station: "intake", kioskId: "kioskZ" }));
    await new Promise((r) => setTimeout(r, 50));

    const reg = await app.inject({ method: "POST", url: "/api/register", payload: { number: 5101 } });
    const id = reg.json().id;

    // kick happens on register; the engine should have pinned a pending occupant. Confirm it:
    const conf = await app.inject({ method: "POST", url: "/api/dispatch/confirm", payload: { visitorId: id } });
    expect(conf.json().ok).toBe(true);

    const arrive = await app.inject({ method: "POST", url: "/api/dispatch/arrive", payload: { visitorId: id } });
    expect(arrive.json().ok).toBe(true);

    const lookup = await app.inject({ method: "GET", url: "/api/visitors/by-number/5101" });
    expect(lookup.json().location).toMatchObject({ state: "in_progress", station: "intake" });
    ws.close();
  });

  it("assign requires a slotId and 400s on a missing one", async () => {
    const reg = await app.inject({ method: "POST", url: "/api/register", payload: { number: 5102 } });
    const res = await app.inject({ method: "POST", url: "/api/dispatch/assign", payload: { visitorId: reg.json().id } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run, verify failure.**

```bash
pnpm --filter @channelers/brain test test/endpoints.test.ts
```

Expected: FAIL — `/api/dispatch/arrive` is 404; `assign` still expects `station`.

- [ ] **Step 3: Update `apps/brain/src/app.ts`.** In the dispatcher-endpoints block, replace the `assign`/`recall`/`complete` routes and add `arrive`:

```ts
  app.post("/api/dispatch/arrive", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.arrive(parsed.data.visitorId) };
  });

  const AssignBody = z.object({ visitorId: z.string(), slotId: z.string() });
  app.post("/api/dispatch/assign", async (req, reply) => {
    const parsed = AssignBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.assign(parsed.data.visitorId, parsed.data.slotId) };
  });

  app.post("/api/dispatch/complete", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.markComplete(parsed.data.visitorId) };
  });
```

Delete the Tier 3 `/api/dispatch/recall` route (no longer in the `Dispatcher` API). Keep `/api/dispatch/confirm`, `/api/dispatch/repool`, `/api/dispatch/remove` (all `{ visitorId }`) and `POST /api/checkin` (the override) as-is.

- [ ] **Step 4: Run the full brain suite + typecheck.**

```bash
pnpm --filter @channelers/brain test && pnpm -r typecheck
```

Expected: ALL brain tests PASS (schema, store, dispatcher, endpoints incl. the arrive flow + WS coexistence). Typecheck now fails **only** in stage files — fixed in Tasks 5–8.

- [ ] **Step 5: Commit.**

```bash
git add apps/brain/src/app.ts apps/brain/test/endpoints.test.ts
git commit -m "feat(brain): /api/dispatch/arrive + assign-by-slot; checkin demoted to override

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Stage — api.arrive, slot-aware presence, CalledGate component

**Files:**
- Modify: `apps/stage/src/lib/api.ts`
- Modify: `apps/stage/src/lib/useStationPresence.ts`
- Create: `apps/stage/src/components/CalledGate.tsx`

**Interfaces:**
- Consumes: `api.dispatch.*`, `useBrainSocket`, `DispatchState`/`Slot`/`Station`.
- Produces:
  - `api.arrive(visitorId)`; `api.dispatch.assign(visitorId, slotId)`.
  - `useStationPresence(station, opts?)` → `{ connected, slot }` — sends `station.hello { station, kioskId, slotHint? }` (kioskId from `?kiosk=` or a stable localStorage id; slotHint from `?slot=`), tracks `dispatch.state`, and returns **this screen's bound slot** (matched by `kioskId`).
  - `<CalledGate station onArrived={(visitor) => ...}>` — idle until a visitor is `called` to this screen's slot, shows the number + **Confirm arrival**, calls `api.arrive`, loads the record by number, hands it up.

- [ ] **Step 1: Extend `apps/stage/src/lib/api.ts`.** Add to the `api` object: `arrive`, and change `dispatch.assign`:

```ts
  arrive: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/arrive", { visitorId }),
```

and within the `dispatch` group replace `assign`:

```ts
    assign: (visitorId: string, slotId: string) =>
      post<{ ok: boolean }>("/api/dispatch/assign", { visitorId, slotId }),
```

(Drop `dispatch.recall`. Keep `confirm`/`repool`/`complete`/`remove`/`state`. `complete` now takes only `visitorId`: `complete: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/complete", { visitorId })`.)

- [ ] **Step 2: Rewrite `apps/stage/src/lib/useStationPresence.ts`:**

```ts
import { useEffect, useMemo, useState } from "react";
import type { Station, Slot, DispatchState, WsServerMsg } from "@channelers/shared";
import { useBrainSocket } from "./useBrainSocket";

/** Stable per-screen kiosk id: from ?kiosk=, else a localStorage UUID. */
function kioskId(): string {
  const url = new URLSearchParams(location.search).get("kiosk");
  if (url) return url;
  const KEY = "channelers.kioskId";
  let id = localStorage.getItem(KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
  return id;
}

/**
 * Announce this screen as a station kiosk and track its bound slot.
 * Sends station.hello { station, kioskId, slotHint? } on every (re)connect (spec §4),
 * and returns the slot this kiosk is bound to (from dispatch.state), or undefined.
 */
export function useStationPresence(station: Station): { connected: boolean; slot: Slot | undefined } {
  const id = useMemo(kioskId, []);
  const slotHint = useMemo(() => new URLSearchParams(location.search).get("slot") ?? undefined, []);
  const [slots, setSlots] = useState<Slot[]>([]);

  const { connected, send } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setSlots((m.state as DispatchState).slots);
  });

  useEffect(() => {
    if (connected) send({ kind: "station.hello", station, kioskId: id, slotHint });
  }, [connected, send, station, id, slotHint]);

  const slot = slots.find((s) => s.kioskId === id);
  return { connected, slot };
}
```

- [ ] **Step 3: Create `apps/stage/src/components/CalledGate.tsx`:**

```tsx
import { useEffect, useState } from "react";
import type { Station, VisitorProfile } from "@channelers/shared";
import { api } from "../lib/api";
import { useStationPresence } from "../lib/useStationPresence";

/**
 * Confirm-at-station gate (spec §5). Replaces typing a number. Watches this screen's bound
 * slot; when a visitor is `called` there, shows the number + Confirm arrival. On confirm it
 * marks the visitor in_progress, loads their record, and hands it up to render the station work.
 */
export function CalledGate({
  station,
  title,
  onArrived,
}: {
  station: Station;
  title: string;
  onArrived: (visitor: VisitorProfile) => void;
}) {
  const { connected, slot } = useStationPresence(station);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const occ = slot?.occupant;

  // Auto-advance once arrival is confirmed for THIS slot's occupant.
  useEffect(() => {
    if (occ?.phase !== "in_progress") return;
    let cancelled = false;
    void api.getByNumber(occ.number).then((v) => { if (!cancelled) onArrived(v); }).catch((e) => setError(String(e)));
    return () => { cancelled = true; };
  }, [occ?.phase, occ?.number, onArrived]);

  async function confirmArrival() {
    if (!occ) return;
    setBusy(true); setError(null);
    try { await api.arrive(occ.visitorId); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <main className="void calledgate">
      <header>
        <h1>{title}</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
      </header>
      {!slot && <p className="dim">No slot bound — open this screen with <code>?kiosk=&lt;id&gt;</code> or wait for a free {station} slot.</p>}
      {slot && !occ && <p className="dim">Slot {slot.id} ready. Waiting to be called…</p>}
      {occ && occ.phase !== "in_progress" && (
        <section className="called">
          <p className="dim">Now calling</p>
          <div className="called-number">#{occ.number}</div>
          <button className="submit" disabled={busy} onClick={() => void confirmArrival()}>
            {busy ? "…" : "Confirm arrival"}
          </button>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
```

- [ ] **Step 4: Verify typecheck + build.**

```bash
cd /Users/jared/Documents/Projects/CHANNELERS/app && pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: `api.ts`, `useStationPresence.ts`, `CalledGate.tsx` compile. The station routes (`Intake/BodyScan/Altar`) still reference the old `useStationPresence` return shape / `NumberGate station=` — those are fixed in Task 6, so typecheck may still flag them; confirm the only failures are in those three route files.

- [ ] **Step 5: Commit.**

```bash
git add apps/stage/src/lib/api.ts apps/stage/src/lib/useStationPresence.ts apps/stage/src/components/CalledGate.tsx
git commit -m "feat(stage): api.arrive, slot-aware useStationPresence, CalledGate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Stage — wire CalledGate into /intake, /bodyscan, /altar

**Files:**
- Modify: `apps/stage/src/routes/Intake.tsx`
- Modify: `apps/stage/src/routes/BodyScan.tsx`
- Modify: `apps/stage/src/routes/Altar.tsx`

**Interfaces:**
- Consumes: `CalledGate` (Task 5). Each station replaces its `NumberGate`/`useStationPresence` gate with `CalledGate`, keeping its existing work component unchanged.

> Each of these files today does: `const [visitor, setVisitor] = useState<VisitorProfile | null>(null); useStationPresence(<station>); if (!visitor) return <NumberGate ... onResolved={setVisitor} />; return <Work visitor={visitor} />`. Replace the gate with `CalledGate` (which itself calls `useStationPresence`), so the screen no longer calls `useStationPresence` directly and no longer imports `NumberGate`.

- [ ] **Step 1: Update `apps/stage/src/routes/Intake.tsx`.** Replace the `useStationPresence` import + call and the `NumberGate` gate. Remove `import { useStationPresence } ...` and `import { NumberGate } ...`; add `import { CalledGate } from "../components/CalledGate";`. Remove the `useStationPresence("intake")` line. Replace the gate line:

```tsx
  if (!visitor) return <CalledGate station="intake" title="Intake" onArrived={setVisitor} />;
```

- [ ] **Step 2: Update `apps/stage/src/routes/BodyScan.tsx`** identically with `station="bodyscan"`:

```tsx
  if (!visitor) return <CalledGate station="bodyscan" title="Body Scan" onArrived={setVisitor} />;
```

(Remove the `useStationPresence`/`NumberGate` imports + the `useStationPresence("bodyscan")` line; add the `CalledGate` import.)

- [ ] **Step 3: Update `apps/stage/src/routes/Altar.tsx`** identically with `station="altar"`:

```tsx
  if (!visitor) return <CalledGate station="altar" title="Altar" onArrived={setVisitor} />;
```

(Remove the `useStationPresence`/`NumberGate` imports + the `useStationPresence("altar")` line; add the `CalledGate` import.)

- [ ] **Step 4: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS (all stage files compile; `NumberGate` is now only used by `/dispatch` arrivals — Task 7 — and the `/console` override — Task 8).

- [ ] **Step 5: Manual browser smoke.** `pnpm dev`; open `/dispatch` and `/intake?kiosk=intake-A` in two tabs:
  1. `/intake?kiosk=intake-A` shows "Slot intake-0 ready. Waiting to be called…" and the LED is lit.
  2. On `/dispatch`, register a number; confirm its call to intake. The `/intake` tab now shows "Now calling #N" + **Confirm arrival**.
  3. Press Confirm arrival → the intake survey form appears for that visitor (the existing work UI). Submit → it completes and the slot frees. ✔

- [ ] **Step 6: Commit.**

```bash
git add apps/stage/src/routes/Intake.tsx apps/stage/src/routes/BodyScan.tsx apps/stage/src/routes/Altar.tsx
git commit -m "feat(stage): stations gate on confirm-at-station (CalledGate)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Stage — /dispatch 3-zone board + CSS

**Files:**
- Modify: `apps/stage/src/routes/Dispatch.tsx` (rewrite)
- Modify: `apps/stage/src/index.css` (append board styles — confirm the actual global stylesheet path; the app imports one global CSS in `main.tsx`)

**Interfaces:**
- Consumes: `useBrainSocket`, `api.register`, `api.dispatch.{confirm,repool,remove,assign}`, `DispatchState`/`Slot`/`Station`.
- Produces: the 3-zone board (spec §6): left = waiting pool w/ elapsed + hover tooltip; center = slot rectangles (dynamic grid, online LED, bound number, pending pulse + Confirm call); right = completed.

- [ ] **Step 1: Rewrite `apps/stage/src/routes/Dispatch.tsx`:**

```tsx
import { useEffect, useState } from "react";
import type { DispatchState, Slot, WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

const elapsed = (since: string) =>
  `${Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000))}s`;

/** Lobby-operator board (spec §6): waiting pool · slots · completed. No-scroll 3-zone. */
export function Dispatch() {
  const [state, setState] = useState<DispatchState | null>(null);
  const [arrival, setArrival] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setState(m.state);
  });

  useEffect(() => {
    void api.dispatch.state().then(setState).catch(() => {});
    const t = setInterval(() => tick((n) => n + 1), 1000); // refresh elapsed clocks
    return () => clearInterval(t);
  }, []);

  async function register() {
    const n = Number(arrival);
    if (!Number.isInteger(n) || n <= 0) { setError("Enter a ticket number."); return; }
    setError(null);
    try { await api.register(n); setArrival(""); }
    catch (e) { setError(String(e)); }
  }

  if (!state) {
    return <main className="void board"><header><h1>Dispatch</h1><span className={connected ? "led on" : "led"} /></header><p className="dim">Connecting…</p></main>;
  }

  const pendingBySlot = (s: Slot) => s.occupant?.phase === "pending" ? s.occupant : undefined;

  return (
    <main className="void board board-3zone">
      <header>
        <h1>Dispatch</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
        {!state.warmedUp && <span className="dim">warming up…</span>}
        <span className="arrivals">
          <input
            inputMode="numeric" value={arrival} placeholder="add #"
            onChange={(e) => setArrival(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") void register(); }}
          />
          <button className="submit" disabled={!arrival} onClick={() => void register()}>Add</button>
        </span>
      </header>
      {error && <p className="error">{error}</p>}
      {state.surplus.length > 0 && (
        <p className="error">Surplus screens: {state.surplus.map((s) => `${s.station}/${s.kioskId.slice(0, 6)}`).join(", ")}</p>
      )}

      <div className="zones">
        {/* LEFT — waiting pool */}
        <section className="zone pool">
          <h3>Waiting ({state.queue.length})</h3>
          <ul className="pool-list">
            {state.queue.map((v) => (
              <li key={v.id} className="pool-item" title={`${v.name || "(no name)"} · eligible: ${v.eligible.join(", ") || "—"}${v.flags.length ? " · " + v.flags.map((f) => f.type).join(",") : ""}`}>
                <strong>#{v.number}</strong>
                <span className="dim">{elapsed(v.waitingSince)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* CENTER — slots */}
        <section className="zone slots">
          <h3>Stations</h3>
          <div className="slot-grid">
            {state.slots.map((s) => {
              const pend = pendingBySlot(s);
              return (
                <div key={s.id} className="slot-wrap">
                  {pend && (
                    <div className="pending-call pulse">
                      <span>#{pend.number}</span>
                      <span className="arrow">→</span>
                      <button className="submit" onClick={() => void api.dispatch.confirm(pend.visitorId)}>Confirm call</button>
                      <button className="end" title="skip" onClick={() => void api.dispatch.repool(pend.visitorId)}>×</button>
                    </div>
                  )}
                  <div className={`slot-box ${s.online ? "on" : "off"} ${s.occupant ? s.occupant.phase : ""}`}>
                    <div className="slot-head">
                      <span className={s.online ? "led on" : "led"} />
                      <code>{s.id}</code>
                    </div>
                    <div className="slot-body">
                      {s.occupant && s.occupant.phase !== "pending" ? (
                        <>
                          <div className="slot-number">#{s.occupant.number}</div>
                          <div className="dim">{s.occupant.phase} · {elapsed(s.occupant.since)}</div>
                          <div className="slot-actions">
                            <button className="end" onClick={() => void api.dispatch.repool(s.occupant!.visitorId)}>re-pool</button>
                          </div>
                        </>
                      ) : (
                        <div className="dim">{s.online ? "idle" : "offline"}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* RIGHT — completed */}
        <section className="zone completed">
          <h3>Completed ({state.completed.length})</h3>
          <ul className="pool-list">
            {state.completed.map((v) => (
              <li key={v.id} className="pool-item" title={v.name || "(no name)"}>
                <strong>#{v.number}</strong>
                <span className="dim">done</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Append board styles.** Find the app's global stylesheet (the one imported in `apps/stage/src/main.tsx` — likely `index.css`) and append:

```css
/* ── /dispatch 3-zone board ── */
.board-3zone .arrivals { margin-left: auto; display: inline-flex; gap: 0.4rem; }
.board-3zone .arrivals input { width: 5rem; }
.zones { display: grid; grid-template-columns: 1fr 2.4fr 1fr; gap: 1rem; align-items: start; }
.zone { min-width: 0; }
.pool-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.pool-item { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.35rem 0.5rem; border: 1px solid #333; border-radius: 4px; cursor: default; }
.slot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.75rem; }
.slot-wrap { position: relative; }
.slot-box { border: 2px solid #444; border-radius: 8px; padding: 0.5rem; min-height: 90px; }
.slot-box.on { border-color: #2a7; }
.slot-box.off { opacity: 0.5; }
.slot-box.called { border-color: #fb3; }
.slot-box.in_progress { border-color: #39f; }
.slot-head { display: flex; align-items: center; gap: 0.4rem; }
.slot-number, .called-number { font-size: 1.6rem; font-weight: 700; }
.pending-call { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.4rem; padding: 0.3rem 0.5rem; border: 2px solid #fd5; border-radius: 6px; }
.pending-call .arrow { opacity: 0.7; }
.pulse { animation: dispatch-pulse 1s ease-in-out infinite; }
@keyframes dispatch-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,221,85,0.7); } 50% { box-shadow: 0 0 0 6px rgba(255,221,85,0); } }
```

- [ ] **Step 3: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS.

- [ ] **Step 4: Manual browser smoke.** `pnpm dev`; open `/dispatch`, `/intake?kiosk=intake-A`, `/intake?kiosk=intake-B`:
  1. Center shows the configured slots as rectangles (intake-0/1/2, bodyscan-0, altar-0 by default). The two intake kiosks light intake-0 and intake-1 (online); intake-2/bodyscan/altar show offline.
  2. Add a couple of numbers (header). They appear in the **left** pool with elapsed time; hover shows name/eligibility.
  3. A pending assignment **pulses beside** an online intake slot with **Confirm call**. Click it → the number moves **inside** the slot (called); the `/intake?kiosk=...` screen shows Confirm arrival.
  4. Confirm arrival on the kiosk → slot shows `in_progress`; complete the survey → slot frees. A visitor who finishes the whole ritual appears in the **right** completed column. ✔

- [ ] **Step 5: Commit.**

```bash
git add apps/stage/src/routes/Dispatch.tsx apps/stage/src/index.css
git commit -m "feat(stage): /dispatch 3-zone board (pool · slots · completed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Stage — /console adapts to slots[]; keep type-a-number override

**Files:**
- Modify: `apps/stage/src/routes/Console.tsx`

**Interfaces:**
- Consumes: the new `DispatchState` (`slots: Slot[]`, `stationsOnline`, `completed`). The Tier 3 `/console` read `dispatch.slots[station].occupants` and `dispatch.stations[s]` — both shapes are gone. Update the flow panel to iterate `dispatch.slots` (array) and use `dispatch.stationsOnline`. Add the hidden manual override (type a number + pick a station → `api.checkin`).

- [ ] **Step 1: Update the flow/station panel in `apps/stage/src/routes/Console.tsx`.** Replace the Tier 3 block that maps `(["intake","bodyscan","altar"] as const)` over `dispatch.slots[s]`/`dispatch.stations[s]` with a per-slot render off the array:

```tsx
      {dispatch && (
        <ul className="visitors">
          {dispatch.slots.map((s) => (
            <li key={s.id}>
              <div className="row">
                <strong>{s.id}</strong>
                <span className={s.online ? "led on" : "led"} title={s.online ? "online" : "offline"} />
                <span className="dim">
                  {s.occupant ? `#${s.occupant.number} (${s.occupant.phase})` : (s.online ? "idle" : "offline")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
```

If the Tier 3 flow-funnel counts referenced `dispatch.stations`, switch any such reference to `dispatch.stationsOnline`. Leave the visitor table, sessions, and event log panels unchanged except: the visitor-row `re-pool`/`remove` buttons keep calling `api.dispatch.repool`/`api.dispatch.remove` (unchanged signatures).

- [ ] **Step 2: Add the hidden manual override.** Below the visitors panel, add a small operator override that reuses the retained `/api/checkin`:

```tsx
      <h3>Manual override</h3>
      <ManualCheckin />
```

and define the component at the bottom of the file (after `Console`):

```tsx
function ManualCheckin() {
  const [num, setNum] = useState("");
  const [station, setStation] = useState<"intake" | "bodyscan" | "altar">("intake");
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    const n = Number(num);
    if (!Number.isInteger(n) || n <= 0) { setMsg("enter a number"); return; }
    try {
      const r = await api.checkin(n, station);
      setMsg(`#${r.record.number} → in_progress @ ${station}`);
      setNum("");
    } catch (e) { setMsg(String(e)); }
  }
  return (
    <div className="row">
      <input className="choice" inputMode="numeric" value={num} placeholder="#"
        onChange={(e) => setNum(e.target.value.replace(/[^0-9]/g, ""))} style={{ width: "4rem" }} />
      <select className="choice" value={station} onChange={(e) => setStation(e.target.value as typeof station)}>
        <option value="intake">intake</option>
        <option value="bodyscan">bodyscan</option>
        <option value="altar">altar</option>
      </select>
      <button className="choice" onClick={() => void go()}>force check-in</button>
      {msg && <span className="dim">{msg}</span>}
    </div>
  );
}
```

Ensure `useState` and `api` are already imported in `Console.tsx` (they are from Tier 3).

- [ ] **Step 3: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS.

- [ ] **Step 4: Manual browser smoke.** `pnpm dev`; open `/console`:
  1. The flow panel lists each slot (`intake-0`…`altar-0`) with online LED + occupant phase, live.
  2. The visitor table, sessions, and event log still work.
  3. **Manual override:** type a number + pick `bodyscan` + "force check-in" → that visitor goes `in_progress@bodyscan` (visible in the slot list / visitor row), proving the override path survives. ✔

- [ ] **Step 5: Commit.**

```bash
git add apps/stage/src/routes/Console.tsx
git commit -m "feat(stage): /console reads slot array + keeps manual check-in override

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Docs reconciliation

**Files:**
- Modify: `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `app/CLAUDE.md`

> Per-task commits updated `CHANGELOG.md` piecemeal; this task adds the roll-up and reconciles ARCHITECTURE + app/CLAUDE.md to the new reality. (Reconciling ARCHITECTURE/CLAUDE — not just CHANGELOG — was a real miss in a prior tier.)

- [ ] **Step 1: CHANGELOG roll-up** (newest on top): the confirm-at-station arrival, the addressable+scalable+kiosk-bound slot model, `station.hello { kioskId, slotHint }`, the `/api/dispatch/arrive` endpoint + assign-by-slot, the 3-zone `/dispatch` board, `/console` slot-array + manual override. Format: what / why / files-areas / docs-touched.

- [ ] **Step 2: Reconcile `docs/ARCHITECTURE.md`:**
  - **§4 data model:** note the `VisitorLocation` stays `waiting | called | in_progress`; the **addressable slot registry** (kiosk-bound) is an addressing layer in the dispatcher, with the new `Slot`/`SlotOccupant`/`DispatchState` shapes.
  - **§8 WS protocol:** update `station.hello` to carry `{ kioskId, slotHint? }`; note `dispatch.state.slots` is now a `Slot[]` and `arrival` is an explicit confirm (`POST /api/dispatch/arrive`), not a typed check-in.
  - **Dispatcher section:** replace the count-based slot description with the addressable model — config-driven counts, kiosk binding (explicit/auto-claim/reclaim), capacity = free online slots, per-slot drop reap, the 0/1/k/N/>N kiosk-count behavior, and the two confirms (operator "Confirm call" + station "Confirm arrival").
  - **§12 open questions:** mark "scannable/displayed check-in" **resolved** (confirm-at-station). Add the deferred items from the spec §10 (stylized per-kiosk display; no-scroll board at large kiosk counts; surplus-kiosk UX).

- [ ] **Step 3: Reconcile `app/CLAUDE.md`:** the stations now gate on **confirm-at-station** (`CalledGate`), not typing; `/dispatch` is the 3-zone board; `/console` reads the slot array and keeps a manual override; kiosks identify via `?kiosk=` / localStorage and `station.hello { kioskId, slotHint }`.

- [ ] **Step 4: Final green check.**

```bash
cd /Users/jared/Documents/Projects/CHANNELERS/app && pnpm -r typecheck && pnpm --filter @channelers/brain test && pnpm --filter @channelers/stage build
```

Expected: typecheck 0 errors; all brain tests PASS; stage build OK.

- [ ] **Step 5: Commit.**

```bash
git add docs/CHANGELOG.md docs/ARCHITECTURE.md app/CLAUDE.md
git commit -m "docs: reconcile to confirm-at-station + addressable kiosk slots

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (against the spec)

**Spec coverage:**
- §3 addressable, config-scalable slots → Task 1 (types) + Task 2 (registry derived from `config.dispatcher.slots`). ✔
- §3.3 capacity = free online slots → Task 3 `fill()` (skips offline/occupied). ✔
- §4 binding (explicit/auto-claim/reclaim), online, collision, surplus → Task 2. ✔
- §4.2 per-slot socket-drop grace → offline+unbind (Task 2) + occupant repool (Task 3 `reapOccupant`). ✔
- §4.4 0/1/k/N/>N kiosk-count → falls out of online-slot capacity (Task 2 surplus test + Task 3 capacity test). ✔
- §5 two confirms + station flow → operator `confirm` (Task 3 / Task 7 button), station `arrive` (Task 3 + Task 5 `CalledGate` + Task 6 wiring). ✔
- §5 type-a-number survives as `/console` override → Task 4 (checkin retained) + Task 8 (`ManualCheckin`). ✔
- §6 `dispatch.state` reshape (`slots[]`, `completed`, `surplus`, `stationsOnline`) → Task 1 + Task 2 snapshot. ✔
- §6 3-zone board → Task 7. ✔
- §6 `/console` adapts → Task 8. ✔
- Testing split → vitest engine tests (Tasks 2–4), typecheck+build+manual (Tasks 5–8). ✔

**Type consistency:** `Slot`/`SlotOccupant`/`DispatchState`/`DispatchDone` defined in Task 1 and consumed unchanged in Tasks 2/5/7/8. `Dispatcher` method names (`confirm`/`arrive`/`assign(visitorId,slotId)`/`repool`/`markComplete(visitorId)`/`remove`/`clearFlags`/`snapshot`/`kick`/`stop`) match across `dispatcher.ts` (Tasks 2–3), `app.ts` (Task 4), and the stage `api` (Task 5). `station.hello { station, kioskId, slotHint? }` consistent across Task 1 (schema), Task 2 (engine), Task 5 (`useStationPresence`). `markComplete` is `(visitorId)` everywhere (Tier 3's `(visitorId, station)` is intentionally changed; Task 4 updates the endpoint).

**Placeholder scan:** no TBD/TODO; every code step is complete. The Task-2 `notImplemented`/stub `reapOccupant`/`reconcile`/`fill` are intentional interim, replaced wholesale in Task 3; Task-2 tests never call the stubbed public methods.

## Execution Handoff

Plan complete. Because this is being executed on a different machine, the receiving agent should:
1. Be on a branch containing the Tier 3 work (this plan's base).
2. Read the spec (`docs/superpowers/specs/2026-06-20-dispatch-confirm-and-addressable-slots-design.md`) and this plan.
3. Execute task-by-task with **superpowers:subagent-driven-development** (fresh implementer + spec/quality reviewer per task; final whole-branch review).
4. Verify green (`pnpm -r typecheck`, `pnpm --filter @channelers/brain test`, stage build) before finishing.
