# Tier 3 — Dispatcher, Board & Master Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the app-managed visitor queue (the **dispatcher**) that calls people to stations, plus the public `/board` call display and the master `/console` overhaul, on top of the already-implemented Tier 0/1 identity spine.

**Architecture:** A brain-side `dispatcher` module (mirroring `divination.ts`'s subsystem pattern) owns transient queue state in memory: per-station slots (intake 2 / bodyscan 1 / altar 1), an **ephemeral pending-assignment map** that reserves a slot until an operator confirms (`pending → called`), warm-up + anti-starvation selection, and recovery detectors (auto-supersede, `T_stale` reap, socket-drop reap). It re-evaluates **event-driven** (arrival / check-in / completion / operator action) **plus on a periodic tick** for time thresholds. Queue/board state is pushed to screens over a new **`dispatch.state` WS broadcast** (screens-only, never OSC). Station screens identify their role with a **`station.hello`** WS message (drives the online LED + socket-drop reap). Check-in is **permissive + reconcile**. A `dispatcherAutoConfirm` knob and a `noShowAutoRepool` knob let rehearsal flip operator steps to automatic without code changes.

**Tech Stack:** TypeScript, pnpm workspace; brain = Fastify + `ws` + OpenAI SDK; stage = Vite + React + react-router-dom; shared = zod. Tests: **vitest** (brain) — the dispatcher engine is unit-tested directly against a fake bus; stage UI = `pnpm -r typecheck` + `pnpm --filter @channelers/stage build` + a written manual browser smoke.

**Spec:** `docs/superpowers/specs/2026-06-19-multi-station-architecture-design.md` — Tier 3 scope = §9 (dispatcher) + §10 (failure handling) + §11 (console). Decision log §12 (Q10–Q12), gotchas §13.

**Design decisions settled for this plan (grilled 2026-06-20):**
- **3 screens** as spec'd: `/dispatch`, `/board`, full `/console` overhaul.
- **Assign model:** in-memory `pending` reserves the slot; `confirm()` promotes `pending → called`; `dispatcherAutoConfirm` knob (default off) fires confirm automatically; operator can manually `assign`/`repool`.
- **Knobs (rehearsal-fast defaults, all env-overridable):** K=3, `T_warmup`=60s, `T_max`=240s, `T_noshow`=90s, `T_stale`=300s, grace=20s, tick=5s, autoConfirm=false, noShowAutoRepool=false.
- **No-show:** flag by default; `noShowAutoRepool` knob makes it auto-re-pool.
- **Presence:** operator-keyed arrivals on `/dispatch` via the existing `POST /api/register`; `/waiting` deferred.
- **Check-in:** permissive + reconcile (supersede prior occupant, clear pending, flag walk-ups). A scannable check-in is a post-rehearsal open question.
- **Transport:** new `dispatch.state` `WsServerMsg` broadcast (push-on-change + on-connect), screens-only.
- **Station identity:** `station.hello {station}` WS msg → `connId → station` map → online LED + detector 3 (last screen for a station drops → grace → re-pool its `in_progress` occupants). Detectors 1 (supersede) + 2 (`T_stale`) are pure engine logic.

## Global Constraints

- **Verification split (governs every task's test step):** brain logic uses **vitest**. The dispatcher engine is built **bus-injectable** (`createDispatcher(bus, opts)`) so tests drive it against a fake bus with `autoStart:false` + `vi.useFakeTimers()`; HTTP wiring is tested with Fastify `app.inject()`. Stage UI uses **`pnpm -r typecheck` + `pnpm --filter @channelers/stage build` + a written manual browser smoke**. Do not add a React test harness — none exists.
- **Typecheck gate:** every task ends green on `pnpm -r typecheck` (0 errors across all packages). Primary correctness signal — never skip it.
- **Offline-resilient:** the brain runs with **no `OPENAI_API_KEY`** (stub seeds, offline oracle fallback). Nothing in this plan may require a key.
- **OpenAI provider:** the brain uses the `openai` SDK (`config.oracleModel` / `config.transformModel`, default `gpt-4o`). Tier 3 touches no AI calls — do not introduce Anthropic.
- **Knobs are config, never hardcoded in logic:** read every threshold from `config.dispatcher.*`; the engine accepts a `knobs` override for tests.
- **Dispatch state is screens-only:** publish queue/board state with `bus.broadcast` (WS), **never** `bus.publish` (which mirrors to OSC). Do **not** add dispatcher events to the `ShowEvent` union.
- **Don't regress Tier 0/1:** `register/intake/pose/persona/verify`, the divination session loop + reaper, and the `/channel` lobby stay working. `divination.ts` is also Tier 2's file — touch it only for the one-line `setCommandHandler → onCommand` rename (Task 3.5).
- **Commit after every task.** Conventional-commit messages, ending each with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

**Shared (`packages/shared/src/`)**
- `schemas.ts` — **modify**: extract a shared `Station` zod enum + type; reuse it in `VisitorLocation`.
- `protocol.ts` — **modify**: add `station.hello` to `WsClientMsg`; add `DispatchState`/`DispatchSlot`/`DispatchQueueEntry`/`DispatchCall`/`DispatchFlag` types + the `dispatch.state` `WsServerMsg` variant.

**Brain (`apps/brain/src/`)**
- `config.ts` — **modify**: add the `dispatcher` knob block.
- `store.ts` — **modify**: add `stampMilestone(id, field)` + `remove(id)`.
- `bus.ts` — **modify**: multiplex `onConnect`/`onDisconnect`/`onCommand` (arrays, not single slots); replace `setCommandHandler` with additive `onCommand`.
- `divination.ts` — **modify**: one line, `bus.setCommandHandler(` → `bus.onCommand(`.
- `dispatcher.ts` — **create**: `createDispatcher(bus, opts)` — the engine.
- `app.ts` — **modify**: construct the dispatcher; add `/api/checkin`, `GET /api/dispatch`, `POST /api/dispatch/{confirm,assign,recall,repool,complete,remove}`; `kick()` after register/intake/pose; `onClose` → `dispatcher.stop()`.
- `test/` — **create**: `dispatcher.test.ts` (engine, fake bus); **modify**: `endpoints.test.ts` (dispatch HTTP + a WS round-trip), `schema.test.ts` (`station.hello`).

**Stage (`apps/stage/src/`)**
- `lib/api.ts` — **modify**: `checkin(number, station)` + a `dispatch` action group.
- `lib/useStationPresence.ts` — **create**: opens the brain socket, sends `station.hello` on (re)connect.
- `components/NumberGate.tsx` — **modify**: optional `station` prop → check-in instead of register.
- `routes/Board.tsx` — **create**: public `#N → Station` display.
- `routes/Dispatch.tsx` — **create**: arrivals entry, pending confirm, live queue, slot occupancy, flags.
- `routes/Console.tsx` — **overhaul**: 3 panels (visitors + controls / flow + stations / sessions + events).
- `routes/Intake.tsx`, `routes/BodyScan.tsx`, `routes/Altar.tsx` — **modify**: pass `station` to `NumberGate`, mount `useStationPresence`.
- `App.tsx` — **modify**: add `/board` + `/dispatch` routes and Home links.

---

# TIER 3 — Dispatcher, Board & Console

## Task 3.1: Shared types — `Station` enum, `station.hello`, `DispatchState`

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/brain/test/schema.test.ts`

**Interfaces:**
- Produces:
  - `Station` (zod enum `["intake","bodyscan","altar"]`) + `type Station`.
  - `WsClientMsg` gains `{ kind: "station.hello"; station: Station }`.
  - Types: `DispatchFlag`, `DispatchSlot`, `DispatchQueueEntry`, `DispatchCall`, `DispatchState`.
  - `WsServerMsg` gains `{ kind: "dispatch.state"; state: DispatchState }`.

- [ ] **Step 1: Write the failing test.** Append to `apps/brain/test/schema.test.ts`:

```ts
import { WsClientMsg, Station } from "@channelers/shared";

describe("schema: Station + station.hello", () => {
  it("exports a Station enum", () => {
    expect(Station.safeParse("intake").success).toBe(true);
    expect(Station.safeParse("nope").success).toBe(false);
  });
  it("parses a station.hello command", () => {
    const r = WsClientMsg.safeParse({ kind: "station.hello", station: "bodyscan" });
    expect(r.success).toBe(true);
  });
  it("rejects station.hello with an unknown station", () => {
    expect(WsClientMsg.safeParse({ kind: "station.hello", station: "lobby" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

```bash
pnpm --filter @channelers/brain test test/schema.test.ts
```

Expected: FAIL — `Station` is not an export; `station.hello` is not a `WsClientMsg` variant.

- [ ] **Step 3: Extract the `Station` enum in `packages/shared/src/schemas.ts`.** Add it just above `VisitorLocation`, and reuse it inside `VisitorLocation`:

```ts
/** The three dispatchable stations (spec §4). */
export const Station = z.enum(["intake", "bodyscan", "altar"]);
export type Station = z.infer<typeof Station>;

/** Transient dispatch location — a visitor is in exactly one place at a time (spec §3.2). */
export const VisitorLocation = z.object({
  state: z.enum(["waiting", "called", "in_progress"]),
  station: Station.optional(),
  since: z.string(),
});
export type VisitorLocation = z.infer<typeof VisitorLocation>;
```

(Delete the old inline `station: z.enum([...]).optional()` — it is replaced by `Station.optional()`.)

- [ ] **Step 4: Add the protocol types in `packages/shared/src/protocol.ts`.** Add the `station.hello` variant to the `WsClientMsg` union (alongside the `session.*` variants):

```ts
  z.object({ kind: z.literal("session.end"), sessionId: z.string() }),
  z.object({ kind: z.literal("station.hello"), station: Station }),
]);
```

Add the `Station` import at the top of `protocol.ts`:

```ts
import { Station } from "./schemas";
```

Then add the dispatch state types (place them after `SessionSummary`, before the `WsServerMsg` union):

```ts
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
```

Add the `dispatch.state` variant to the `WsServerMsg` union (after `roster`):

```ts
  | { kind: "roster"; sessions: SessionSummary[] }
  | { kind: "dispatch.state"; state: DispatchState };
```

- [ ] **Step 5: Run the test + typecheck.**

```bash
pnpm --filter @channelers/brain test test/schema.test.ts && pnpm -r typecheck
```

Expected: schema test PASSES; typecheck PASSES (the change is additive — existing `VisitorLocation` consumers still see the same shape).

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/protocol.ts apps/brain/test/schema.test.ts
git commit -m "feat(shared): Station enum, station.hello command, and dispatch.state types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.2: Config knobs + store helpers (`stampMilestone`, `remove`)

**Files:**
- Modify: `apps/brain/src/config.ts`
- Modify: `apps/brain/src/store.ts`
- Modify: `apps/brain/test/store.test.ts`

**Interfaces:**
- Produces:
  - `config.dispatcher = { slots, K, warmupMs, maxWaitMs, noShowMs, staleMs, graceMs, tickMs, autoConfirm, noShowAutoRepool }`.
  - `store.stampMilestone(id, field)` — sets a milestone timestamp to `now()`; `field ∈ { intakeAt, poseAt, personaAt, poseVerifiedAt, sessionStartAt, sessionEndAt }`.
  - `store.remove(id): boolean` — deletes the record + its number index entry.

- [ ] **Step 1: Write the failing test.** Append to `apps/brain/test/store.test.ts`:

```ts
describe("store milestone stamp + remove", () => {
  it("stampMilestone sets an arbitrary milestone timestamp", () => {
    const r = store.register(NUM());
    const out = store.stampMilestone(r.id, "sessionEndAt");
    expect(out?.sessionEndAt).toBeTruthy();
  });
  it("remove deletes the record and frees the number", () => {
    const n = NUM();
    const r = store.register(n);
    expect(store.remove(r.id)).toBe(true);
    expect(store.get(r.id)).toBeUndefined();
    expect(store.getByNumber(n)).toBeUndefined();
    // number is now reusable → a fresh record
    expect(store.register(n).id).not.toBe(r.id);
  });
  it("remove returns false for an unknown id", () => {
    expect(store.remove("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

```bash
pnpm --filter @channelers/brain test test/store.test.ts
```

Expected: FAIL — `store.stampMilestone`/`store.remove` are not functions.

- [ ] **Step 3: Add the `dispatcher` block to `apps/brain/src/config.ts`** (inside the `config` object, after `osc`):

```ts
  dispatcher: {
    /** Per-station slot capacity (spec §9). Altar slot is held through the whole reading. */
    slots: { intake: 2, bodyscan: 1, altar: 1 } as Record<"intake" | "bodyscan" | "altar", number>,
    /** Warm-up pool size — don't dispatch until this many are waiting OR T_warmup elapses. */
    K: Number(process.env.DISPATCH_K ?? 3),
    warmupMs: Number(process.env.DISPATCH_T_WARMUP_MS ?? 60_000),
    /** Anti-starvation: waiting longer than this jumps the random pick. */
    maxWaitMs: Number(process.env.DISPATCH_T_MAX_MS ?? 240_000),
    /** Called-but-not-arrived past this → flagged (or auto-repooled if noShowAutoRepool). */
    noShowMs: Number(process.env.DISPATCH_T_NOSHOW_MS ?? 90_000),
    /** in_progress past this with no completion → auto-reap to waiting. */
    staleMs: Number(process.env.DISPATCH_T_STALE_MS ?? 300_000),
    /** Station-screen socket-drop grace before reaping its in_progress occupants. */
    graceMs: Number(process.env.DISPATCH_GRACE_MS ?? 20_000),
    /** Periodic re-evaluation cadence for the time-threshold detectors. */
    tickMs: Number(process.env.DISPATCH_TICK_MS ?? 5_000),
    /** Flip ON to skip the operator confirm step (pending auto-promotes to called). */
    autoConfirm: process.env.DISPATCH_AUTO_CONFIRM === "true",
    /** Flip ON to auto-re-pool no-shows instead of just flagging them. */
    noShowAutoRepool: process.env.DISPATCH_NOSHOW_AUTOREPOOL === "true",
  },
```

- [ ] **Step 4: Add the store helpers in `apps/brain/src/store.ts`** (inside the `store` object, after `addScan`):

```ts
  /** Stamp a milestone timestamp directly (operator "mark-complete" backstop, spec §10). */
  stampMilestone(
    id: string,
    field: "intakeAt" | "poseAt" | "personaAt" | "poseVerifiedAt" | "sessionStartAt" | "sessionEndAt",
  ): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v[field] = now();
    return v;
  },
  /** Remove a record entirely (operator "remove", spec §10). Frees the number for reuse. */
  remove(id: string): boolean {
    const v = visitors.get(id);
    if (!v) return false;
    visitors.delete(id);
    byNumber.delete(v.number);
    return true;
  },
```

- [ ] **Step 5: Run the test + typecheck.**

```bash
pnpm --filter @channelers/brain test test/store.test.ts && pnpm -r typecheck
```

Expected: store tests PASS; typecheck PASSES.

- [ ] **Step 6: Commit.**

```bash
git add apps/brain/src/config.ts apps/brain/src/store.ts apps/brain/test/store.test.ts
git commit -m "feat(brain): dispatcher knob config + store stampMilestone/remove

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.3: Dispatcher engine — eligibility, warm-up, anti-starvation, fill, confirm

**Files:**
- Create: `apps/brain/src/dispatcher.ts`
- Create: `apps/brain/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `store` (Task 3.2), `config.dispatcher`, the shared dispatch types (Task 3.1).
- Produces: `createDispatcher(bus, opts?)` returning a `Dispatcher` controller:
  - `kick(): void` — reconcile + fill + broadcast (the public re-evaluate trigger).
  - `confirm(visitorId): boolean` — `pending → called`.
  - `assign(visitorId, station): boolean` — operator manual assign → `pending`.
  - `snapshot(): DispatchState`.
  - `stop(): void` — clear the tick + timers.
  - (recovery methods `checkin`/`recall`/`repool`/`markComplete`/`remove`/`clearFlags` + station identity arrive in Task 3.4.)
- `DispatcherBus` = the minimal bus surface the engine needs: `{ broadcast, onConnect, onDisconnect, onCommand }`.

> **Why bus-injectable + `autoStart`:** the engine is unit-tested directly against a fake bus that captures `broadcast` calls; `autoStart:false` means no real `setInterval`, so tests drive `kick()` deterministically. `vi.useFakeTimers()` controls `Date.now()` for the time-threshold tests.

- [ ] **Step 1: Write the failing test** `apps/brain/test/dispatcher.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { store } from "../src/store";
import { createDispatcher, type DispatcherBus } from "../src/dispatcher";
import type { WsServerMsg, DispatchState } from "@channelers/shared";

// A fake bus that captures broadcasts and exposes the hook fns the engine registers.
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
    fireCommand: (cmd: any, c: string) => commandFn?.(cmd, () => {}, c),
    lastState: (): DispatchState | undefined => {
      const m = [...broadcasts].reverse().find((x) => x.kind === "dispatch.state");
      return m && m.kind === "dispatch.state" ? m.state : undefined;
    },
  };
}

// Knobs with a tiny warm-up pool so a couple of registrations are immediately dispatchable.
const KNOBS = { K: 2, warmupMs: 60_000, maxWaitMs: 240_000, tickMs: 5_000 };
const NUM = () => 100_000 + Math.floor(Math.random() * 800_000);

let f: ReturnType<typeof fakeBus>;
let dispatcher: ReturnType<typeof createDispatcher>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-20T00:00:00.000Z"));
  f = fakeBus();
  dispatcher = createDispatcher(f.bus, { knobs: KNOBS, autoStart: false });
});
afterEach(() => { dispatcher.stop(); vi.useRealTimers(); });

describe("warm-up gate", () => {
  it("does not assign until the pool reaches K", () => {
    const a = store.register(NUM());
    dispatcher.kick();
    expect(f.lastState()?.warmedUp).toBe(false);
    expect(f.lastState()?.pending.length).toBe(0);

    store.register(NUM()); // now 2 waiting ≥ K
    dispatcher.kick();
    expect(f.lastState()?.warmedUp).toBe(true);
    expect(f.lastState()!.pending.length).toBeGreaterThan(0);
  });

  it("warms up via T_warmup even below K", () => {
    store.register(NUM());
    dispatcher.kick();
    expect(f.lastState()?.warmedUp).toBe(false);
    vi.setSystemTime(new Date("2026-06-20T00:02:00.000Z")); // +2min > warmupMs
    dispatcher.kick();
    expect(f.lastState()?.warmedUp).toBe(true);
  });
});

describe("eligibility + fill", () => {
  it("a fresh visitor is eligible for intake and bodyscan, not altar", () => {
    store.register(NUM()); store.register(NUM());
    dispatcher.kick();
    const q = f.lastState()!.queue.concat(); // some may now be pending
    // After fill, intake(2) + bodyscan(1) slots take up to 3 picks from 2 visitors.
    const pend = f.lastState()!.pending;
    expect(pend.every((p) => p.station === "intake" || p.station === "bodyscan")).toBe(true);
  });

  it("respects slot capacity: intake holds at most 2 pending+called+in_progress", () => {
    for (let i = 0; i < 5; i++) store.register(NUM());
    dispatcher.kick();
    const intakePending = f.lastState()!.pending.filter((p) => p.station === "intake").length;
    expect(intakePending).toBeLessThanOrEqual(2);
  });
});

describe("confirm promotes pending → called", () => {
  it("moves the visitor to called and onto the board", () => {
    const a = store.register(NUM());
    store.register(NUM());
    dispatcher.kick();
    const p = f.lastState()!.pending[0];
    expect(dispatcher.confirm(p.id)).toBe(true);
    expect(store.get(p.id)?.location.state).toBe("called");
    expect(f.lastState()!.board.some((b) => b.id === p.id)).toBe(true);
    expect(f.lastState()!.pending.some((x) => x.id === p.id)).toBe(false);
  });

  it("confirm returns false for a non-pending id", () => {
    expect(dispatcher.confirm("nope")).toBe(false);
  });
});

describe("anti-starvation", () => {
  it("prioritises a visitor waiting longer than T_max", () => {
    const old = store.register(NUM());
    vi.setSystemTime(new Date("2026-06-20T00:05:00.000Z")); // old has waited 5min > maxWaitMs(4min)
    for (let i = 0; i < 3; i++) store.register(NUM());
    dispatcher.kick();
    // the starving visitor must be among those picked
    const picked = f.lastState()!.pending.map((p) => p.id);
    expect(picked).toContain(old.id);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

```bash
pnpm --filter @channelers/brain test test/dispatcher.test.ts
```

Expected: FAIL — `createDispatcher` is not exported.

- [ ] **Step 3: Create `apps/brain/src/dispatcher.ts`:**

```ts
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
```

- [ ] **Step 4: Run the test + typecheck.**

```bash
pnpm --filter @channelers/brain test test/dispatcher.test.ts && pnpm -r typecheck
```

Expected: all Task-3.3 dispatcher tests PASS; typecheck PASSES.

- [ ] **Step 5: Commit.**

```bash
git add apps/brain/src/dispatcher.ts apps/brain/test/dispatcher.test.ts
git commit -m "feat(brain): dispatcher engine — eligibility, warm-up, anti-starvation, confirm

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.4: Dispatcher recovery — check-in, no-show, stale, supersede, station identity

**Files:**
- Modify: `apps/brain/src/dispatcher.ts`
- Modify: `apps/brain/test/dispatcher.test.ts`

**Interfaces:**
- Produces (fills the `notImplemented` stubs from Task 3.3):
  - `checkin(num, station)` — permissive create-or-fetch + `in_progress@station`, supersede over-capacity occupants, clear pending, flag walk-ups.
  - `recall(visitorId)` — refresh a `called` visitor's `since` (re-call a no-show) + clear flags.
  - `repool(visitorId)` — return to `waiting`, clear pending + flags, re-evaluate.
  - `markComplete(visitorId, station)` — stamp the station milestone + return to `waiting`.
  - `remove(visitorId)` — drop from store + dispatcher state.
  - `reconcile()` gains `T_stale` reap + no-show handling; `station.hello` handling + socket-drop reap (detector 3) + online LED.

- [ ] **Step 1: Write the failing tests.** Append to `apps/brain/test/dispatcher.test.ts`:

```ts
const STALE = { K: 1, warmupMs: 0, staleMs: 300_000, noShowMs: 90_000, graceMs: 20_000, tickMs: 5_000 };

describe("check-in (permissive + reconcile)", () => {
  it("places the visitor in_progress at the station and flags an uncalled walk-up", () => {
    const d = createDispatcher(f.bus, { knobs: STALE, autoStart: false });
    const n = NUM();
    const { record } = d.checkin(n, "bodyscan");
    expect(store.get(record.id)?.location).toMatchObject({ state: "in_progress", station: "bodyscan" });
    const q = d.snapshot();
    const slot = q.slots.bodyscan.occupants.find((o) => o.id === record.id);
    expect(slot?.state).toBe("in_progress");
    d.stop();
  });

  it("auto-supersedes the prior occupant of a 1-slot station", () => {
    const d = createDispatcher(f.bus, { knobs: STALE, autoStart: false });
    const a = d.checkin(NUM(), "altar").record;
    const b = d.checkin(NUM(), "altar").record;
    expect(store.get(a.id)?.location.state).toBe("waiting"); // a walked off
    expect(store.get(b.id)?.location).toMatchObject({ state: "in_progress", station: "altar" });
    d.stop();
  });
});

describe("recovery reconciliation", () => {
  it("T_stale reaps an in_progress visitor with no completion", () => {
    const d = createDispatcher(f.bus, { knobs: STALE, autoStart: false });
    const r = d.checkin(NUM(), "bodyscan").record;
    vi.setSystemTime(new Date("2026-06-20T00:06:00.000Z")); // +6min > staleMs(5min)
    d.kick();
    expect(store.get(r.id)?.location.state).toBe("waiting");
    d.stop();
  });

  it("flags a no-show by default (no auto-repool)", () => {
    const d = createDispatcher(f.bus, { knobs: { ...STALE, K: 1, warmupMs: 0 }, autoStart: false });
    store.register(NUM());
    d.kick();
    const p = d.snapshot().pending[0];
    d.confirm(p.id); // now called
    vi.setSystemTime(new Date("2026-06-20T00:02:00.000Z")); // +2min > noShowMs
    d.kick();
    expect(store.get(p.id)?.location.state).toBe("called"); // NOT repooled
    expect(d.snapshot().board[0]?.flags?.some((fl) => fl.type === "no-show")).toBe(true);
    d.stop();
  });

  it("auto-repools a no-show when noShowAutoRepool is on", () => {
    const d = createDispatcher(f.bus, { knobs: { ...STALE, K: 1, warmupMs: 0, noShowAutoRepool: true }, autoStart: false });
    store.register(NUM());
    d.kick();
    const p = d.snapshot().pending[0];
    d.confirm(p.id);
    vi.setSystemTime(new Date("2026-06-20T00:02:00.000Z"));
    d.kick();
    expect(store.get(p.id)?.location.state).toBe("waiting");
    d.stop();
  });
});

describe("operator actions", () => {
  it("repool returns a called visitor to waiting", () => {
    const d = createDispatcher(f.bus, { knobs: { ...STALE, K: 1, warmupMs: 0 }, autoStart: false });
    store.register(NUM());
    d.kick();
    const p = d.snapshot().pending[0];
    d.confirm(p.id);
    expect(d.repool(p.id)).toBe(true);
    expect(store.get(p.id)?.location.state).toBe("waiting");
    d.stop();
  });
  it("markComplete stamps the milestone and frees the slot", () => {
    const d = createDispatcher(f.bus, { knobs: STALE, autoStart: false });
    const r = d.checkin(NUM(), "intake").record;
    expect(d.markComplete(r.id, "intake")).toBe(true);
    expect(store.get(r.id)?.intakeAt).toBeTruthy();
    expect(store.get(r.id)?.location.state).toBe("waiting");
    d.stop();
  });
  it("remove deletes the record", () => {
    const d = createDispatcher(f.bus, { knobs: STALE, autoStart: false });
    const r = d.checkin(NUM(), "intake").record;
    expect(d.remove(r.id)).toBe(true);
    expect(store.get(r.id)).toBeUndefined();
    d.stop();
  });
});

describe("station identity (online LED + detector 3)", () => {
  it("station.hello marks a station online; disconnect after grace reaps its in_progress occupant", () => {
    const d = createDispatcher(f.bus, { knobs: STALE, autoStart: false });
    f.fireCommand({ kind: "station.hello", station: "bodyscan" }, "conn-A");
    expect(d.snapshot().stations.bodyscan).toBe(true);
    const r = d.checkin(NUM(), "bodyscan").record;
    f.fireDisconnect("conn-A"); // last screen for bodyscan dropped → grace timer
    expect(d.snapshot().stations.bodyscan).toBe(false);
    vi.advanceTimersByTime(STALE.graceMs + 10);
    expect(store.get(r.id)?.location.state).toBe("waiting"); // reaped
    d.stop();
  });
});
```

> Note: the new tests construct their own dispatcher with `autoStart:false`; the shared `dispatcher` from `beforeEach` is unused by them but harmless. Keep the `beforeEach`/`afterEach` as-is.

- [ ] **Step 2: Run them, verify they fail.**

```bash
pnpm --filter @channelers/brain test test/dispatcher.test.ts
```

Expected: FAIL — `checkin`/`recall`/`repool`/`markComplete`/`remove` throw `added in Task 3.4`; no-show/stale not yet reconciled; `station.hello` not handled.

- [ ] **Step 3: Replace the `reconcile()` body in `dispatcher.ts`** with the full recovery logic:

```ts
  function reconcile(): void {
    const visitors = store.list();
    // in_progress: completion frees the slot; otherwise T_stale auto-reap (detector 2).
    for (const v of visitors) {
      if (v.location.state !== "in_progress" || !v.location.station) continue;
      if (completionMilestoneSet(v, v.location.station)) {
        store.setLocation(v.id, { state: "waiting", since: nowIso() });
        pending.delete(v.id);
      } else if (ageMs(v.location.since) > knobs.staleMs) {
        store.setLocation(v.id, { state: "waiting", since: nowIso() });
        addFlag(v.id, { type: "auto-reaped", reason: "stale", since: nowIso() });
      }
    }
    // called: no-show past T_noshow → flag (or auto-repool if the knob is on).
    for (const v of visitors) {
      if (v.location.state !== "called") continue;
      if (ageMs(v.location.since) <= knobs.noShowMs) continue;
      if (knobs.noShowAutoRepool) {
        pending.delete(v.id);
        store.setLocation(v.id, { state: "waiting", since: nowIso() });
        addFlag(v.id, { type: "auto-reaped", reason: "no-show", since: nowIso() });
      } else {
        addFlag(v.id, { type: "no-show", since: nowIso() });
      }
    }
    if (knobs.autoConfirm) for (const id of [...pending.keys()]) confirm(id);
  }
```

- [ ] **Step 4: Add the recovery + station-identity methods in `dispatcher.ts`** (place these functions above the `return` statement, after `assign`):

```ts
  function checkin(num: number, station: Station): { record: VisitorRecord; superseded: number[] } {
    const record = store.getByNumber(num) ?? store.register(num);
    const wasCalledHere = record.location.state === "called" && record.location.station === station;
    store.setLocation(record.id, { state: "in_progress", station, since: nowIso() });
    pending.delete(record.id);
    clearFlags(record.id);
    if (!wasCalledHere) addFlag(record.id, { type: "walk-up", since: nowIso() });

    // Auto-supersede (detector 1): keep the station within capacity by re-pooling the oldest.
    const superseded: number[] = [];
    const here = store
      .list()
      .filter(
        (v) =>
          v.location.state === "in_progress" && v.location.station === station && v.id !== record.id,
      )
      .sort((a, b) => Date.parse(a.location.since) - Date.parse(b.location.since)); // oldest first
    const overBy = here.length + 1 - knobs.slots[station];
    for (const old of here.slice(0, Math.max(0, overBy))) {
      store.setLocation(old.id, { state: "waiting", since: nowIso() });
      addFlag(old.id, { type: "auto-reaped", reason: "superseded", since: nowIso() });
      superseded.push(old.number);
    }
    kick();
    return { record, superseded };
  }

  function recall(visitorId: string): boolean {
    const v = store.get(visitorId);
    if (!v || v.location.state !== "called" || !v.location.station) return false;
    store.setLocation(visitorId, { state: "called", station: v.location.station, since: nowIso() });
    clearFlags(visitorId);
    broadcastState();
    return true;
  }

  function repool(visitorId: string): boolean {
    const v = store.get(visitorId);
    if (!v) return false;
    pending.delete(visitorId);
    store.setLocation(visitorId, { state: "waiting", since: nowIso() });
    clearFlags(visitorId);
    kick();
    return true;
  }

  function markComplete(visitorId: string, station: Station): boolean {
    const v = store.get(visitorId);
    if (!v) return false;
    const field =
      station === "intake" ? "intakeAt" : station === "bodyscan" ? "poseAt" : "sessionEndAt";
    store.stampMilestone(visitorId, field);
    pending.delete(visitorId);
    store.setLocation(visitorId, { state: "waiting", since: nowIso() });
    clearFlags(visitorId);
    kick();
    return true;
  }

  function remove(visitorId: string): boolean {
    pending.delete(visitorId);
    flags.delete(visitorId);
    const ok = store.remove(visitorId);
    if (ok) kick();
    return ok;
  }

  // station.hello → connId↦station; drives the online LED and detector 3 (socket-drop reap).
  function handleCommand(cmd: WsClientMsg, connId: string): void {
    if (cmd.kind !== "station.hello") return;
    stationConns.set(connId, cmd.station);
    const t = offlineTimers.get(cmd.station);
    if (t) { clearTimeout(t); offlineTimers.delete(cmd.station); }
    broadcastState();
  }
  function handleDisconnect(connId: string): void {
    const station = stationConns.get(connId);
    if (!station) return;
    stationConns.delete(connId);
    if (stationOnline(station)) { broadcastState(); return; } // another screen still up
    const timer = setTimeout(() => {
      offlineTimers.delete(station);
      if (stationOnline(station)) return; // came back within grace
      for (const v of store.list()) {
        if (v.location.state === "in_progress" && v.location.station === station) {
          store.setLocation(v.id, { state: "waiting", since: nowIso() });
          addFlag(v.id, { type: "auto-reaped", reason: "station-offline", since: nowIso() });
        }
      }
      kick();
    }, knobs.graceMs);
    offlineTimers.set(station, timer);
    broadcastState();
  }
```

- [ ] **Step 5: Wire the new hooks + swap the stubs.** In `dispatcher.ts`, register the command + disconnect hooks right after the existing `bus.onConnect(...)` line:

```ts
  bus.onConnect((reply) => reply({ kind: "dispatch.state", state: snapshot() }));
  bus.onCommand((cmd, _reply, connId) => handleCommand(cmd, connId));
  bus.onDisconnect((connId) => handleDisconnect(connId));
```

Then replace the `return { ... }` block — drop `notImplemented` and return the real methods:

```ts
  return {
    checkin,
    confirm,
    assign,
    recall,
    repool,
    markComplete,
    remove,
    clearFlags,
    snapshot,
    kick,
    stop,
  };
```

Delete the now-unused `notImplemented` function.

- [ ] **Step 6: Run the full dispatcher suite + typecheck.**

```bash
pnpm --filter @channelers/brain test test/dispatcher.test.ts && pnpm -r typecheck
```

Expected: all dispatcher tests (Task 3.3 + 3.4) PASS; typecheck PASSES.

- [ ] **Step 7: Commit.**

```bash
git add apps/brain/src/dispatcher.ts apps/brain/test/dispatcher.test.ts
git commit -m "feat(brain): dispatcher recovery — check-in, no-show, stale, supersede, station identity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.5: Bus multiplex + wire dispatcher into the app + HTTP endpoints

**Files:**
- Modify: `apps/brain/src/bus.ts`
- Modify: `apps/brain/src/divination.ts`
- Modify: `apps/brain/src/app.ts`
- Modify: `apps/brain/test/endpoints.test.ts`

**Interfaces:**
- Produces:
  - `Bus` multiplexes hooks: `onConnect`/`onDisconnect`/`onCommand` append (multiple subscribers); `setCommandHandler` is removed in favour of `onCommand`.
  - HTTP: `POST /api/checkin { number, station }` → `{ record, superseded }`; `GET /api/dispatch` → `DispatchState`; `POST /api/dispatch/{confirm,recall,repool}` `{ visitorId }`; `POST /api/dispatch/assign` `{ visitorId, station }`; `POST /api/dispatch/complete` `{ visitorId, station }`; `POST /api/dispatch/remove` `{ visitorId }`.
  - `register`/`intake`/`pose` handlers call `dispatcher.kick()`; `app` closes the dispatcher tick on shutdown.

- [ ] **Step 1: Write the failing test.** Append to `apps/brain/test/endpoints.test.ts`:

```ts
import WebSocket from "ws";

describe("dispatch endpoints", () => {
  it("check-in puts a visitor in_progress and appears in GET /api/dispatch", async () => {
    const ci = await app.inject({ method: "POST", url: "/api/checkin", payload: { number: 4001, station: "bodyscan" } });
    expect(ci.statusCode).toBe(200);
    expect(ci.json().record.location).toMatchObject({ state: "in_progress", station: "bodyscan" });

    const state = await app.inject({ method: "GET", url: "/api/dispatch" });
    expect(state.statusCode).toBe(200);
    const occ = state.json().slots.bodyscan.occupants;
    expect(occ.some((o: any) => o.number === 4001)).toBe(true);
  });

  it("400s a check-in with a bad station", async () => {
    const res = await app.inject({ method: "POST", url: "/api/checkin", payload: { number: 4002, station: "lobby" } });
    expect(res.statusCode).toBe(400);
  });

  it("repool returns a checked-in visitor to waiting", async () => {
    const ci = await app.inject({ method: "POST", url: "/api/checkin", payload: { number: 4003, station: "intake" } });
    const id = ci.json().record.id;
    const rp = await app.inject({ method: "POST", url: "/api/dispatch/repool", payload: { visitorId: id } });
    expect(rp.statusCode).toBe(200);
    const lookup = await app.inject({ method: "GET", url: "/api/visitors/by-number/4003" });
    expect(lookup.json().location.state).toBe("waiting");
  });
});

describe("WS broadcasts coexist (bus multiplex)", () => {
  it("a new socket receives BOTH a roster and a dispatch.state on connect", async () => {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const kinds = await new Promise<string[]>((resolve, reject) => {
      const seen: string[] = [];
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        seen.push(m.kind);
        if (seen.includes("roster") && seen.includes("dispatch.state")) resolve(seen);
      });
      ws.on("error", reject);
      setTimeout(() => resolve(seen), 1000);
    });
    ws.close();
    expect(kinds).toContain("roster");
    expect(kinds).toContain("dispatch.state");
  });
});
```

> The WS test calls `app.listen` on port 0; `afterAll`'s `app.close()` already tears it down. `ws` is already a brain dependency.

- [ ] **Step 2: Run it, verify it fails.**

```bash
pnpm --filter @channelers/brain test test/endpoints.test.ts
```

Expected: FAIL — `/api/checkin` and `/api/dispatch*` are 404; no `dispatch.state` arrives.

- [ ] **Step 3: Multiplex the bus hooks in `apps/brain/src/bus.ts`.** Replace the three single-slot fields + their registration/usage. Change the field declarations:

```ts
  private onCmdHooks: Array<(cmd: WsClientMsg, reply: ReplyFn, connId: string) => void> = [];
  private onConnectHooks: Array<(reply: ReplyFn, connId: string) => void> = [];
  private onDisconnectHooks: Array<(connId: string) => void> = [];
```

Update the connection handler body inside the constructor to fan out to all hooks:

```ts
    this.wss.on("connection", (ws) => {
      const connId = randomUUID();
      const reply: ReplyFn = (msg) => this.sendTo(ws, msg);
      this.sendTo(ws, { kind: "hello" });
      for (const hook of this.onConnectHooks) hook(reply, connId);
      ws.on("message", (raw) => {
        const parsed = WsClientMsg.safeParse(safeJson(raw.toString()));
        if (parsed.success) for (const hook of this.onCmdHooks) hook(parsed.data, reply, connId);
      });
      ws.on("close", () => {
        for (const hook of this.onDisconnectHooks) hook(connId);
      });
    });
```

Replace `setCommandHandler` with `onCommand`, and make `onConnect`/`onDisconnect` append:

```ts
  /** Register a command handler. Multiple subsystems may register; each sees every command. */
  onCommand(fn: (cmd: WsClientMsg, reply: ReplyFn, connId: string) => void): void {
    this.onCmdHooks.push(fn);
  }

  /** Called once per new connection; push current state (roster, dispatch.state) to the joiner. */
  onConnect(fn: (reply: ReplyFn, connId: string) => void): void {
    this.onConnectHooks.push(fn);
  }

  /** Called when a socket closes; reap state owned by that connection. */
  onDisconnect(fn: (connId: string) => void): void {
    this.onDisconnectHooks.push(fn);
  }
```

- [ ] **Step 4: Update `apps/brain/src/divination.ts`** — the one call site. Change:

```ts
  bus.setCommandHandler((cmd, reply, connId) => void handle(cmd, reply, connId));
```

to:

```ts
  bus.onCommand((cmd, reply, connId) => void handle(cmd, reply, connId));
```

(The `handle` function already early-returns for commands it doesn't recognise, so it harmlessly ignores `station.hello`.)

- [ ] **Step 5: Wire the dispatcher + endpoints in `apps/brain/src/app.ts`.** Add imports:

```ts
import { Station } from "@channelers/shared";
import { createDispatcher } from "./dispatcher";
```

Construct the dispatcher right after `registerDivination(bus)`:

```ts
  const bus = new Bus(app.server);
  registerDivination(bus);
  const dispatcher = createDispatcher(bus);
  app.addHook("onClose", async () => dispatcher.stop());
```

Add `dispatcher.kick()` after the register write (inside the existing `/api/register` handler, before the return):

```ts
  app.post("/api/register", async (req, reply) => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const v = store.register(parsed.data.number);
    dispatcher.kick();
    return v;
  });
```

Add `dispatcher.kick();` just before the `return v;` in the `/api/visitors/:id/intake` handler (after the `void transform(...)` block) and in the `/api/visitors/:id/pose` handler (after `setPoseTemplate`), so completions free slots promptly.

Add the new endpoints (place them after the `/verify` route, before the legacy `/scan` route):

```ts
  // ── dispatcher: check-in (permissive) + operator queue controls (spec §9–§10) ──
  const CheckinBody = z.object({ number: z.number().int(), station: Station });
  app.post("/api/checkin", async (req, reply) => {
    const parsed = CheckinBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return dispatcher.checkin(parsed.data.number, parsed.data.station);
  });

  app.get("/api/dispatch", async () => dispatcher.snapshot());

  const VisitorIdBody = z.object({ visitorId: z.string() });
  const StationActionBody = z.object({ visitorId: z.string(), station: Station });

  app.post("/api/dispatch/confirm", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.confirm(parsed.data.visitorId) };
  });
  app.post("/api/dispatch/assign", async (req, reply) => {
    const parsed = StationActionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.assign(parsed.data.visitorId, parsed.data.station) };
  });
  app.post("/api/dispatch/recall", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.recall(parsed.data.visitorId) };
  });
  app.post("/api/dispatch/repool", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.repool(parsed.data.visitorId) };
  });
  app.post("/api/dispatch/complete", async (req, reply) => {
    const parsed = StationActionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.markComplete(parsed.data.visitorId, parsed.data.station) };
  });
  app.post("/api/dispatch/remove", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.remove(parsed.data.visitorId) };
  });
```

- [ ] **Step 6: Run the full brain suite + typecheck.**

```bash
pnpm --filter @channelers/brain test && pnpm -r typecheck
```

Expected: ALL brain tests PASS (schema, store, dispatcher, endpoints incl. the WS multiplex test); typecheck PASSES. The pre-existing divination tests must still pass — proof the bus multiplex didn't regress Tier 1.

- [ ] **Step 7: Commit.**

```bash
git add apps/brain/src/bus.ts apps/brain/src/divination.ts apps/brain/src/app.ts apps/brain/test/endpoints.test.ts
git commit -m "feat(brain): multiplex bus hooks; wire dispatcher + checkin/dispatch endpoints

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.6: Stage — API client, `useStationPresence`, `NumberGate` check-in

**Files:**
- Modify: `apps/stage/src/lib/api.ts`
- Create: `apps/stage/src/lib/useStationPresence.ts`
- Modify: `apps/stage/src/components/NumberGate.tsx`

**Interfaces:**
- Consumes: `api.register` (existing), `useBrainSocket` (existing).
- Produces:
  - `api.checkin(number, station)` → `Promise<{ record: VisitorProfile; superseded: number[] }>`.
  - `api.dispatch.{state,confirm,assign,recall,repool,complete,remove}` helpers.
  - `useStationPresence(station)` — sends `station.hello` on every (re)connect; returns `connected`.
  - `<NumberGate title station? onResolved />` — with `station`, resolves via check-in; without, via register.

- [ ] **Step 1: Extend `apps/stage/src/lib/api.ts`.** Add the import + new methods:

```ts
import type { SurveyResponse, VisitorProfile, PoseVector, Station, DispatchState } from "@channelers/shared";
```

Add to the `api` object (after `verifyPose`):

```ts
  checkin: (number: number, station: Station) =>
    post<{ record: VisitorProfile; superseded: number[] }>("/api/checkin", { number, station }),
  dispatch: {
    state: () => fetch("/api/dispatch").then((r) => json<DispatchState>(r)),
    confirm: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/confirm", { visitorId }),
    assign: (visitorId: string, station: Station) =>
      post<{ ok: boolean }>("/api/dispatch/assign", { visitorId, station }),
    recall: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/recall", { visitorId }),
    repool: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/repool", { visitorId }),
    complete: (visitorId: string, station: Station) =>
      post<{ ok: boolean }>("/api/dispatch/complete", { visitorId, station }),
    remove: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/remove", { visitorId }),
  },
```

- [ ] **Step 2: Create `apps/stage/src/lib/useStationPresence.ts`:**

```ts
import { useEffect } from "react";
import type { Station } from "@channelers/shared";
import { useBrainSocket } from "./useBrainSocket";

/**
 * Announce this screen's station role to the brain so the dispatcher can show an online LED
 * and bind socket-drop recovery to it (spec §10–§11). Re-announces on every (re)connect.
 */
export function useStationPresence(station: Station): { connected: boolean } {
  const { connected, send } = useBrainSocket();
  useEffect(() => {
    if (connected) send({ kind: "station.hello", station });
  }, [connected, send, station]);
  return { connected };
}
```

- [ ] **Step 3: Add the `station` prop to `apps/stage/src/components/NumberGate.tsx`.** Update the signature + the `go()` resolver:

```tsx
import { useState } from "react";
import type { VisitorProfile, Station } from "@channelers/shared";
import { api } from "../lib/api";

/** The shared "enter your number" gate. Without `station` it registers (create-or-fetch);
 *  with `station` it checks in (permissive — moves the visitor in_progress at that station). */
export function NumberGate({
  title,
  station,
  onResolved,
}: {
  title: string;
  station?: Station;
  onResolved: (visitor: VisitorProfile) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Enter the number on your ticket.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const visitor = station ? (await api.checkin(n, station)).record : await api.register(n);
      onResolved(visitor);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  // ...the rest of the component (JSX) is unchanged...
```

(Leave the returned JSX exactly as it is.)

- [ ] **Step 4: Verify typecheck + build.**

```bash
cd /Users/jared/Documents/Projects/CHANNELERS/app && pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS (additive — existing `NumberGate` callers omit `station`, which is optional).

- [ ] **Step 5: Commit.**

```bash
git add apps/stage/src/lib/api.ts apps/stage/src/lib/useStationPresence.ts apps/stage/src/components/NumberGate.tsx
git commit -m "feat(stage): dispatch API client, station presence hook, NumberGate check-in

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.7: Stage — `/board` public call display

**Files:**
- Create: `apps/stage/src/routes/Board.tsx`
- Modify: `apps/stage/src/App.tsx`

**Interfaces:**
- Consumes: `useBrainSocket`, `DispatchState` (via the `dispatch.state` broadcast + `api.dispatch.state` for the initial load).
- Produces: a `/board` route showing `#N → Station` for every `called` visitor.

- [ ] **Step 1: Create `apps/stage/src/routes/Board.tsx`:**

```tsx
import { useEffect, useState } from "react";
import type { DispatchState, WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

const STATION_LABEL: Record<string, string> = {
  intake: "INTAKE",
  bodyscan: "BODY SCAN",
  altar: "ALTAR",
};

/** Public lobby display — the called visitors, big. Updates live off dispatch.state. */
export function Board() {
  const [state, setState] = useState<DispatchState | null>(null);

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setState(m.state);
  });

  useEffect(() => {
    void api.dispatch.state().then(setState).catch(() => {});
  }, []);

  const board = state?.board ?? [];

  return (
    <main className="void board">
      <header>
        <h1>NOW SERVING</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
      </header>
      {board.length === 0 && <p className="dim">Please wait to be called.</p>}
      <ul className="board-calls">
        {board.map((c) => (
          <li key={c.id} className="board-call">
            <span className="board-number">#{c.number}</span>
            <span className="board-arrow">→</span>
            <span className="board-station">{STATION_LABEL[c.station] ?? c.station}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Register the route in `apps/stage/src/App.tsx`.** Add the import and the route + Home link. Add import after the `Channel` import:

```tsx
import { Board } from "./routes/Board";
```

Add to `SCREENS`:

```tsx
const SCREENS = ["intake", "bodyscan", "altar", "channel", "console", "board", "souvenir"] as const;
```

Add the route inside `<Routes>` (after `/console`):

```tsx
        <Route path="/board" element={<Board />} />
```

- [ ] **Step 3: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS.

- [ ] **Step 4: Manual browser smoke.** `pnpm dev`; open `http://localhost:5173/board` in one tab and `http://localhost:5173/dispatch`… (not built yet) — instead drive it via the API:
  1. In a terminal: `curl -X POST localhost:8787/api/register -H 'content-type: application/json' -d '{"number":7}'` (note the returned `id`), then `curl -X POST localhost:8787/api/dispatch/assign -H 'content-type: application/json' -d '{"visitorId":"<id>","station":"intake"}'` then `curl -X POST localhost:8787/api/dispatch/confirm -H 'content-type: application/json' -d '{"visitorId":"<id>"}'`.
  2. `/board` shows **#7 → INTAKE** within a second (live, no refresh). ✔
  3. The connection LED is lit. ✔

- [ ] **Step 5: Commit.**

```bash
git add apps/stage/src/routes/Board.tsx apps/stage/src/App.tsx
git commit -m "feat(stage): /board public call display

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.8: Stage — `/dispatch` lobby-operator interface

**Files:**
- Create: `apps/stage/src/routes/Dispatch.tsx`
- Modify: `apps/stage/src/App.tsx`

**Interfaces:**
- Consumes: `useBrainSocket`, `api.register`, `api.dispatch.*`, `DispatchState`.
- Produces: a `/dispatch` route — arrivals entry, pending-confirm list, live queue, slot occupancy, flags with re-call/re-pool/remove.

- [ ] **Step 1: Create `apps/stage/src/routes/Dispatch.tsx`:**

```tsx
import { useEffect, useState } from "react";
import type { DispatchState, Station, WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

const STATIONS: Station[] = ["intake", "bodyscan", "altar"];
const dwell = (since: string) => `${Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000))}s`;

/** Lobby-operator console: register arrivals, confirm calls, watch the queue + slots (spec §9). */
export function Dispatch() {
  const [state, setState] = useState<DispatchState | null>(null);
  const [arrival, setArrival] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setState(m.state);
  });

  useEffect(() => {
    void api.dispatch.state().then(setState).catch(() => {});
    const t = setInterval(() => forceTick((n) => n + 1), 1000); // refresh dwell timers
    return () => clearInterval(t);
  }, []);

  async function registerArrival() {
    const n = Number(arrival);
    if (!Number.isInteger(n) || n <= 0) { setError("Enter a ticket number."); return; }
    setError(null);
    try { await api.register(n); setArrival(""); }
    catch (e) { setError(String(e)); }
  }

  if (!state) {
    return (
      <main className="void console">
        <header><h1>Dispatch</h1><span className={connected ? "led on" : "led"} /></header>
        <p className="dim">Connecting…</p>
      </main>
    );
  }

  return (
    <main className="void console dispatch">
      <header>
        <h1>Dispatch</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
        {!state.warmedUp && <span className="dim">warming up…</span>}
      </header>

      <section className="field arrivals">
        <label>Register arrival (ticket #)</label>
        <input
          inputMode="numeric"
          value={arrival}
          placeholder="000"
          onChange={(e) => setArrival(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") void registerArrival(); }}
        />
        <button className="submit" onClick={() => void registerArrival()} disabled={!arrival}>Add</button>
      </section>
      {error && <p className="error">{error}</p>}

      <h3>Pending — confirm to call ({state.pending.length})</h3>
      {state.pending.length === 0 && <p className="dim">Nothing to confirm.</p>}
      <ul className="visitors">
        {state.pending.map((p) => (
          <li key={p.id}>
            <div className="row">
              <strong>#{p.number}</strong>
              <span className="dim">→ {p.station}</span>
              <button className="submit" onClick={() => void api.dispatch.confirm(p.id)}>Confirm call</button>
              <button className="end" onClick={() => void api.dispatch.repool(p.id)}>Skip</button>
            </div>
          </li>
        ))}
      </ul>

      <h3>Called — on the board ({state.board.length})</h3>
      <ul className="visitors">
        {state.board.map((c) => (
          <li key={c.id}>
            <div className="row">
              <strong>#{c.number}</strong>
              <span className="dim">→ {c.station} · {dwell(c.since)}</span>
              {c.flags?.some((f) => f.type === "no-show") && <span className="error">NO-SHOW</span>}
              <button className="submit" onClick={() => void api.dispatch.recall(c.id)}>Re-call</button>
              <button className="end" onClick={() => void api.dispatch.repool(c.id)}>Re-pool</button>
            </div>
          </li>
        ))}
      </ul>

      <h3>Slots</h3>
      <ul className="visitors">
        {STATIONS.map((s) => {
          const slot = state.slots[s];
          return (
            <li key={s}>
              <div className="row">
                <strong>{s}</strong>
                <span className="dim">{slot.occupants.length}/{slot.capacity}</span>
                <span className={state.stations[s] ? "led on" : "led"} title={state.stations[s] ? "screen online" : "screen offline"} />
                <span className="dim">{slot.occupants.map((o) => `#${o.number}(${o.state})`).join("  ")}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <h3>Queue ({state.queue.length})</h3>
      {state.queue.length === 0 && <p className="dim">Pool empty.</p>}
      <ul className="visitors">
        {state.queue.map((v) => (
          <li key={v.id}>
            <div className="row">
              <strong>#{v.number}</strong>
              <span className="dim">{v.name || "(no name)"}</span>
              <span className="dim">eligible: {v.eligible.join(", ") || "—"} · {dwell(v.waitingSince)}</span>
              {v.flags.map((f, i) => (
                <span key={i} className="dim">[{f.type}{f.reason ? `:${f.reason}` : ""}]</span>
              ))}
              {v.eligible.map((s) => (
                <button key={s} className="choice" onClick={() => void api.dispatch.assign(v.id, s)}>
                  assign {s}
                </button>
              ))}
              <button className="end" onClick={() => void api.dispatch.remove(v.id)}>remove</button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Register the route in `apps/stage/src/App.tsx`.** Add import:

```tsx
import { Dispatch } from "./routes/Dispatch";
```

Add to `SCREENS` (after `board`):

```tsx
const SCREENS = ["intake", "bodyscan", "altar", "channel", "console", "board", "dispatch", "souvenir"] as const;
```

Add the route (after `/board`):

```tsx
        <Route path="/dispatch" element={<Dispatch />} />
```

- [ ] **Step 3: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS.

- [ ] **Step 4: Manual browser smoke.** `pnpm dev`; open `/dispatch` and `/board` side by side:
  1. Type `11` → Add, `12` → Add, `13` → Add. The **Queue** lists #11/#12/#13 (each `eligible: intake, bodyscan`). With K=3 the pool is warmed → **Pending** shows assignments (intake×2, bodyscan×1).
  2. Click **Confirm call** on a pending row → it moves to **Called**, and `/board` shows `#N → STATION` live.
  3. Click **Re-pool** on a called row → it returns to the Queue; `/board` drops it.
  4. The **Slots** row shows occupancy `n/capacity`; the station LEDs are off (no station screen open yet). ✔

- [ ] **Step 5: Commit.**

```bash
git add apps/stage/src/routes/Dispatch.tsx apps/stage/src/App.tsx
git commit -m "feat(stage): /dispatch lobby-operator interface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.9: Stage — `/console` master overhaul (3 panels)

**Files:**
- Modify: `apps/stage/src/routes/Console.tsx`

**Interfaces:**
- Consumes: `useBrainSocket`, `api.listVisitors`, `api.dispatch.*`, `api.setPersona`/`api.verifyPose`, `ARCHETYPES`, `DispatchState`, `SessionSummary`, `VisitorProfile`, `ShowEvent`.
- Produces: `/console` overhauled into 3 panels — (1) Visitors + controls, (2) Flow/stations, (3) Sessions + event feed.

- [ ] **Step 1: Rewrite `apps/stage/src/routes/Console.tsx`:**

```tsx
import { useEffect, useRef, useState } from "react";
import {
  ARCHETYPES,
  type DispatchState,
  type SessionSummary,
  type ShowEvent,
  type VisitorProfile,
  type WsServerMsg,
} from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

const dwell = (since?: string) =>
  since ? `${Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000))}s` : "—";

/** Master overseer: visitor table + controls, flow funnel + station LEDs, sessions + event log (spec §11). */
export function Console() {
  const [visitors, setVisitors] = useState<VisitorProfile[]>([]);
  const [roster, setRoster] = useState<SessionSummary[]>([]);
  const [dispatch, setDispatch] = useState<DispatchState | null>(null);
  const [events, setEvents] = useState<{ at: string; event: ShowEvent }[]>([]);
  const [, forceTick] = useState(0);

  async function refresh() {
    setVisitors(await api.listVisitors());
  }

  const { connected, send } = useBrainSocket((m: WsServerMsg) => {
    switch (m.kind) {
      case "roster":
        setRoster(m.sessions);
        break;
      case "dispatch.state":
        setDispatch(m.state);
        break;
      case "event":
        setEvents((e) => [{ at: new Date().toLocaleTimeString(), event: m.event }, ...e].slice(0, 50));
        if (m.event.type === "visitor.submitted" || m.event.type === "seeds.ready" || m.event.type === "oracle.selected") {
          void refresh();
        }
        break;
    }
  });

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { forceTick((n) => n + 1); void refresh(); }, 2000);
    return () => clearInterval(t);
  }, []);

  const archLabel = (id?: string) => (id ? ARCHETYPES.find((a) => a.id === id)?.label ?? id : "—");
  const milestone = (v: VisitorProfile) =>
    [
      v.intakeAt && "intake",
      v.poseAt && "pose",
      v.personaAt && "persona",
      v.poseVerifiedAt && "verified",
      v.sessionStartAt && !v.sessionEndAt && "channelling",
      v.sessionEndAt && "done",
    ].filter(Boolean).join(" · ") || "registered";

  // Panel 2 — flow funnel counts
  const counts = {
    registered: visitors.length,
    intake: visitors.filter((v) => v.intakeAt).length,
    pose: visitors.filter((v) => v.poseAt).length,
    oracleReady: visitors.filter((v) => v.personaAt && v.poseVerifiedAt && !v.sessionEndAt).length,
    channelling: roster.length,
    done: visitors.filter((v) => v.sessionEndAt).length,
  };

  return (
    <main className="void console master">
      <header>
        <h1>Console</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
      </header>

      {/* ── Panel 2: flow + stations ── */}
      <h3>Flow</h3>
      <ul className="funnel">
        {Object.entries(counts).map(([k, n]) => (
          <li key={k}><strong>{n}</strong> <span className="dim">{k}</span></li>
        ))}
      </ul>
      {dispatch && (
        <ul className="visitors">
          {(["intake", "bodyscan", "altar"] as const).map((s) => (
            <li key={s}>
              <div className="row">
                <strong>{s}</strong>
                <span className={dispatch.stations[s] ? "led on" : "led"} title={dispatch.stations[s] ? "online" : "offline"} />
                <span className="dim">{dispatch.slots[s].occupants.length}/{dispatch.slots[s].capacity}</span>
                <span className="dim">{dispatch.slots[s].occupants.map((o) => `#${o.number}(${o.state} ${dwell(o.since)})`).join("  ")}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Panel 1: visitors + controls ── */}
      <h3>Visitors ({visitors.length})</h3>
      <ul className="visitors">
        {visitors.map((v) => (
          <li key={v.id}>
            <div className="row">
              <strong>#{v.number}</strong>
              <span className="dim">{v.survey?.name || "(no name)"}</span>
              <span className="dim">{archLabel(v.archetype)}</span>
              <span className="dim">{milestone(v)}</span>
              <span className="dim">{v.location.state}{v.location.station ? `@${v.location.station}` : ""} · {dwell(v.location.since)}</span>
              {!v.poseVerifiedAt && <button className="choice" onClick={() => void api.verifyPose(v.id).then(refresh)}>unlock</button>}
              <select
                className="choice"
                value={v.archetype ?? ""}
                onChange={(e) => void api.setPersona(v.id, e.target.value).then(refresh)}
              >
                <option value="" disabled>set persona…</option>
                {ARCHETYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <button className="choice" onClick={() => void api.dispatch.repool(v.id).then(refresh)}>re-pool</button>
              <button className="end" onClick={() => void api.dispatch.remove(v.id).then(refresh)}>remove</button>
            </div>
          </li>
        ))}
      </ul>

      {/* ── Panel 3: sessions + events ── */}
      <h3>Active sessions ({roster.length})</h3>
      {roster.length === 0 && <p className="dim">None.</p>}
      <ul className="visitors">
        {roster.map((s) => (
          <li key={s.sessionId}>
            <div className="row">
              <strong>{s.visitorName || "(no name)"}</strong>
              <span className="dim">{archLabel(s.archetype)}</span>
              <span className="dim">{s.turns} {s.turns === 1 ? "turn" : "turns"}</span>
              <button className="choice" onClick={() => send({ kind: "session.rejoin", sessionId: s.sessionId })}>reclaim</button>
              <button className="end" onClick={() => send({ kind: "session.end", sessionId: s.sessionId })}>end</button>
            </div>
          </li>
        ))}
      </ul>

      <h3>Events</h3>
      <ul className="eventlog">
        {events.map((e, i) => (
          <li key={i} className="dim"><code>{e.at}</code> {e.event.type}</li>
        ))}
      </ul>
    </main>
  );
}
```

> Note: `reclaim`/`end` reuse the existing `session.rejoin`/`session.end` WS commands the brain already handles; no new protocol.

- [ ] **Step 2: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS.

- [ ] **Step 3: Manual browser smoke.** `pnpm dev`; open `/console`:
  1. Register a few arrivals via `/dispatch`; `/console` **Flow** counts and **Visitors** table populate live.
  2. Complete an intake at `/intake` (number gate → submit) → that visitor's milestone shows `intake`, `intakeAt` count increments.
  3. Use the **set persona** dropdown + **unlock** on a row → `personaAt`/`poseVerifiedAt` get set (visible in milestone), and oracleReady count rises.
  4. The **Events** log streams `visitor.submitted` / `oracle.selected` etc. Station LEDs light when `/intake`/`/bodyscan`/`/altar` are open (after Task 3.10). ✔

- [ ] **Step 4: Commit.**

```bash
git add apps/stage/src/routes/Console.tsx
git commit -m "feat(stage): /console master overhaul — visitors, flow, sessions, events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.10: Wire station check-in + presence into `/intake`, `/bodyscan`, `/altar`

**Files:**
- Modify: `apps/stage/src/routes/Intake.tsx`
- Modify: `apps/stage/src/routes/BodyScan.tsx`
- Modify: `apps/stage/src/routes/Altar.tsx`

**Interfaces:**
- Consumes: `NumberGate` (now with `station`), `useStationPresence` (Task 3.6).
- Produces: each station screen checks the visitor **in** (not just register) and announces its station role for the online LED + socket-drop recovery.

- [ ] **Step 1: Update `apps/stage/src/routes/Intake.tsx`.** Add the import and mount the presence hook; pass `station` to `NumberGate`. Add import near the top:

```tsx
import { useStationPresence } from "../lib/useStationPresence";
```

Inside `export function Intake() {`, add as the first line of the body:

```tsx
  useStationPresence("intake");
```

Change the gate render:

```tsx
  if (!visitor) return <NumberGate title="Intake" station="intake" onResolved={setVisitor} />;
```

- [ ] **Step 2: Update `apps/stage/src/routes/BodyScan.tsx`.** Add the import:

```tsx
import { useStationPresence } from "../lib/useStationPresence";
```

Inside `export function BodyScan() {`, add as the first line of the body:

```tsx
  useStationPresence("bodyscan");
```

Change the gate render:

```tsx
  if (!visitor) return <NumberGate title="Body Scan" station="bodyscan" onResolved={setVisitor} />;
```

- [ ] **Step 3: Update `apps/stage/src/routes/Altar.tsx`.** Add the import:

```tsx
import { useStationPresence } from "../lib/useStationPresence";
```

Inside `export function Altar() {`, add as the first line of the body:

```tsx
  useStationPresence("altar");
```

Change the gate render:

```tsx
  if (!visitor) return <NumberGate title="Altar" station="altar" onResolved={setVisitor} />;
```

- [ ] **Step 4: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS.

- [ ] **Step 5: Manual end-to-end smoke (the Tier 3 payoff).** `pnpm dev`; open `/dispatch`, `/board`, `/console`, and `/bodyscan` in separate tabs:
  1. `/console` + `/dispatch` show the **bodyscan** station LED **on** (the `/bodyscan` tab sent `station.hello`).
  2. On `/dispatch`, register `21`; with the pool below K, wait ~60s (T_warmup) or register up to K — an assignment appears. Confirm it for **bodyscan** → `/board` shows `#21 → BODY SCAN`.
  3. On `/bodyscan`, type `21` → the visitor is **checked in** (the dispatch `bodyscan` slot now shows `#21(in_progress)`, the board entry clears). Enroll a pose → on lock (`poseAt` set), the dispatcher reconciles `#21` back to the pool, freeing the slot.
  4. Close the `/bodyscan` tab → after ~20s (grace) the station LED goes **off** and any `in_progress` occupant there is re-pooled (flagged `station-offline` on `/console`). ✔
  5. Permissive check-in: with `/intake` open, type a brand-new number `99` (never registered) → it registers-and-checks-in, flagged `walk-up` on `/console`. ✔

- [ ] **Step 6: Commit.**

```bash
git add apps/stage/src/routes/Intake.tsx apps/stage/src/routes/BodyScan.tsx apps/stage/src/routes/Altar.tsx
git commit -m "feat(stage): stations check in + announce presence to the dispatcher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.11: Docs reconciliation (CHANGELOG + ARCHITECTURE + app/CLAUDE.md)

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `app/CLAUDE.md`

> **Why a dedicated task:** per-task commits update `CHANGELOG.md` piecemeal, but the route table in `ARCHITECTURE.md` §3, the data-flow narrative, the WS protocol (§8), the open-questions (§11/§12), and `app/CLAUDE.md`'s route list all describe Tier 3 as "designed, not built." This task flips them to "implemented." (This reconciliation step was a real miss last time — see the memory note.)

- [ ] **Step 1: Add a CHANGELOG entry** (newest on top) to `docs/CHANGELOG.md` summarising Tier 3: the dispatcher engine (slots/warm-up/anti-starvation/recovery), `/board`, `/dispatch`, the `/console` overhaul, the `dispatch.state` WS channel, `station.hello` identity, permissive check-in, and the knob set. Format: *what / why / files-areas / docs-touched*.

- [ ] **Step 2: Reconcile `docs/ARCHITECTURE.md`:**
  - Update the **status banner** (top): Tier 3 (dispatcher/board/console) is now **implemented**; only Tier 2 (choreography) remains.
  - **§3 route list:** move `/dispatch` and `/board` out of "designed, not built" into the live route table; update `/console` from "read-only monitor" to "master overseer (visitors + controls, flow/stations, sessions + events)". (`/waiting` stays deferred.)
  - **§8 WS protocol:** document the new `station.hello` client command and the `dispatch.state` server broadcast (screens-only, not OSC); note that dispatcher logistics deliberately stay **off** the `ShowEvent`/OSC contract.
  - Add a short **dispatcher section** (or extend §5) describing slots (2/1/1, altar held through the reading), the `waiting → pending → called → in_progress` flow, the recovery detectors (auto-supersede, `T_stale`, socket-drop grace), and the knob set with defaults.
  - **§12 open questions:** mark "Presence capture", "Dispatcher knob values", and "No-show automation" as **resolved for MVP** (operator-keyed arrivals; rehearsal-fast defaults, env-overridable; flagged + `noShowAutoRepool` knob). Add the new open question: **scannable check-in** to remove the wrong-number risk of permissive check-in (post-rehearsal).

- [ ] **Step 3: Reconcile `app/CLAUDE.md`:** update the `apps/stage` route list — `/dispatch` and `/board` are built; `/console` is the master overseer (no longer read-only). Note the dispatcher lives in `apps/brain/src/dispatcher.ts` and that dispatch state rides the `dispatch.state` WS channel (never OSC). `/waiting` remains the only deferred Tier 3 screen.

- [ ] **Step 4: Final green check (whole tier).**

```bash
cd /Users/jared/Documents/Projects/CHANNELERS/app && pnpm -r typecheck && pnpm --filter @channelers/brain test && pnpm --filter @channelers/stage build
```

Expected: typecheck 0 errors; all brain tests PASS; stage build succeeds.

- [ ] **Step 5: Commit.**

```bash
git add docs/CHANGELOG.md docs/ARCHITECTURE.md app/CLAUDE.md
git commit -m "docs: reconcile architecture docs to implemented Tier 3 dispatcher/board/console

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (against the spec)

**Spec coverage (§9 dispatcher / §10 recovery / §11 console):**
- §9 slots 2/1/1, altar held through reading → `config.dispatcher.slots`; altar completion = `sessionEndAt` (Task 3.3 `completionMilestoneSet`). ✔
- §9 eligibility predicates → `eligibleStations` (Task 3.3). ✔
- §9 warm-up (K / T_warmup) + anti-starvation (T_max) → `warmedUp` / `select` (Task 3.3). ✔
- §9 assign-then-confirm, operator-in-the-loop → ephemeral `pending` + `confirm`; `dispatcherAutoConfirm` knob (Tasks 3.3–3.4). ✔
- §9 presence = operator-keyed arrivals → `/dispatch` arrivals via `POST /api/register` (Task 3.8). ✔
- §10 detector 1 auto-supersede → `checkin` (Task 3.4). ✔
- §10 detector 2 T_stale reap → `reconcile` (Task 3.4). ✔
- §10 detector 3 socket-drop grace reap → `station.hello` + `handleDisconnect` (Task 3.4). ✔
- §10 no-show operator-flagged + `noShowAutoRepool` knob → `reconcile` (Task 3.4). ✔
- §10 manual backstop (re-pool / mark-complete / remove) → `repool`/`markComplete`/`remove` + `/console` controls (Tasks 3.4, 3.9). ✔
- §11 Panel 1 visitors + controls → `/console` (Task 3.9). ✔
- §11 Panel 2 flow funnel + who's-where + station-online LEDs → `/console` + `dispatch.state.stations` (Tasks 3.4, 3.9). ✔
- §11 Panel 3 sessions + event feed → `/console` (Task 3.9). ✔
- §4 `/board` public display → Task 3.7. ✔
- Transport screens-only (no OSC) → `bus.broadcast` of `dispatch.state`; `ShowEvent` untouched (Tasks 3.1, 3.5). ✔

**Type consistency:** `Station` (shared, Task 3.1) used uniformly in `VisitorLocation`, `WsClientMsg.station.hello`, `DispatchState`, the dispatcher, the endpoints, the API client, `NumberGate`, `useStationPresence`. `Dispatcher` method names (`checkin`/`confirm`/`assign`/`recall`/`repool`/`markComplete`/`remove`/`clearFlags`/`snapshot`/`kick`/`stop`) match across `dispatcher.ts`, the `notImplemented` stub list (3.3) and the real return (3.4), the endpoints (3.5), and the API client (3.6). `DispatchState` shape matches between `snapshot()` and every consumer.

**Placeholder scan:** no TBD/TODO; every code step shows full code; the `notImplemented` stub in Task 3.3 is an intentional, explicit interim that Task 3.4 replaces (and its tests in 3.3 never call the stubbed methods).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-tier3-dispatcher-board-console.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration, then a final whole-branch OPUS review.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
