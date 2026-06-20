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
