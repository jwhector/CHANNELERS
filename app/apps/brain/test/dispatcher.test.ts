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
