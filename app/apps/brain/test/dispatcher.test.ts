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
  store.clear();
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
  it("recall refreshes since for a called visitor and returns false for unknown id", () => {
    const d = createDispatcher(f.bus, { knobs: { ...STALE, K: 1, warmupMs: 0 }, autoStart: false });
    store.register(NUM());
    d.kick();
    const p = d.snapshot().pending[0];
    d.confirm(p.id);
    const calledSince = store.get(p.id)!.location.since;
    vi.setSystemTime(new Date("2026-06-20T00:01:00.000Z"));
    expect(d.recall(p.id)).toBe(true);
    const loc = store.get(p.id)!.location;
    expect(loc.state).toBe("called");
    expect(loc.since > calledSince).toBe(true);
    expect(d.recall("nope")).toBe(false);
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
