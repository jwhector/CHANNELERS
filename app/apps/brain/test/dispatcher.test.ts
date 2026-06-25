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
const KNOBS = { slots: SLOTS, introHoldMs: 0, graceMs: 20_000, tickMs: 5_000 };

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
    expect(s.stationsOnline).toEqual({ intake: false, bodyscan: false, altar: false, paper: false });
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

  it("autoArrive advances a called occupant to in_progress", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, {
      knobs: { ...KNOBS, autoConfirm: true, autoArrive: true } as any,
      autoStart: false,
    });
    f2.hello("intake", "kA", "cA");
    const v = store.register(NUM());
    d2.kick(); // fill → pending → (autoConfirm in fill) → called
    d2.kick(); // reconcile → autoArrive → in_progress
    expect(store.get(v.id)?.location.state).toBe("in_progress");
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

describe("snapshot surfaces occupant flags + noShowMs", () => {
  it("exposes a no-show flag on a called occupant and the noShowMs threshold", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, {
      knobs: { ...KNOBS, noShowMs: 90_000, noShowAutoRepool: false } as any,
      autoStart: false,
    });
    f2.hello("intake", "kA", "cA");
    const v = store.register(NUM());
    d2.kick(); d2.confirm(v.id); // called
    vi.setSystemTime(new Date("2026-06-21T00:02:00.000Z")); // > noShowMs
    d2.kick();
    const occ = d2.snapshot().slots.find((s) => s.occupant?.visitorId === v.id)?.occupant;
    expect(occ?.flags?.some((fl) => fl.type === "no-show")).toBe(true);
    expect(d2.snapshot().noShowMs).toBe(90_000);
    d2.stop();
  });
});

describe("paper: timed group station", () => {
  const P_KNOBS = {
    slots: { intake: 0, bodyscan: 0, altar: 0, paper: 2 },
    timed: { paper: { dwellMs: 300_000 } },
    // Timed stations now share the kiosk lifecycle: called → arrive → dwell.
    // noShowAutoRepool ON so a called-but-never-arrived paper occupant is repooled
    // at noShowMs(90s) rather than left hanging.
    introHoldMs: 0, tickMs: 5_000, noShowAutoRepool: true,
  };
  let pf: ReturnType<typeof fakeBus>;
  let pd: ReturnType<typeof createDispatcher>;
  beforeEach(() => {
    pf = fakeBus();
    pd = createDispatcher(pf.bus, { knobs: P_KNOBS as any, autoStart: false });
  });
  afterEach(() => pd.stop());

  it("derives paper slots that are always online without any kiosk", () => {
    const s = pd.snapshot();
    const paper = s.slots.filter((x) => x.station === "paper");
    expect(paper.map((x) => x.id).sort()).toEqual(["paper-0", "paper-1"]);
    expect(paper.every((x) => x.online === true && !x.kioskId)).toBe(true);
    expect(s.stationsOnline.paper).toBe(true);
  });

  it("a fresh waiting visitor is eligible for paper", () => {
    store.register(771001);
    const q = pd.snapshot().queue.find((e) => e.number === 771001);
    expect(q?.eligible).toContain("paper");
  });

  it("confirm calls a paper occupant; arrival starts the dwell", () => {
    const v = store.register(771002);
    pd.kick(); // intro hold 0 → fill
    const pending = pd.snapshot().slots.find((x) => x.station === "paper" && x.occupant);
    expect(pending?.occupant?.phase).toBe("pending");
    expect(pd.confirm(v.id)).toBe(true);
    expect(store.get(v.id)?.location).toMatchObject({ state: "called", station: "paper" });
    expect(pd.arrive(v.id)).toBe(true);
    expect(store.get(v.id)?.location).toMatchObject({ state: "in_progress", station: "paper" });
    expect(pd.snapshot().slots.find((x) => x.occupant?.visitorId === v.id)?.occupant?.phase).toBe("in_progress");
  });

  it("completes a paper occupant dwellMs after ARRIVAL: stamps paperAt, frees, repools", () => {
    const v = store.register(772001);
    pd.kick();
    pd.confirm(v.id);
    pd.arrive(v.id); // dwell starts at arrival
    vi.advanceTimersByTime(300_000 + 1_000);
    pd.kick(); // reconcile
    expect(store.get(v.id)?.paperAt).toBeTruthy();
    expect(store.get(v.id)?.location.state).toBe("waiting");
    expect(pd.snapshot().slots.some((x) => x.occupant?.visitorId === v.id)).toBe(false);
  });

  it("does not complete before dwellMs after arrival", () => {
    const v = store.register(772002);
    pd.kick();
    pd.confirm(v.id);
    pd.arrive(v.id);
    vi.advanceTimersByTime(120_000); // < dwell
    pd.kick();
    expect(store.get(v.id)?.paperAt).toBeUndefined();
    expect(pd.snapshot().slots.find((x) => x.occupant?.visitorId === v.id)?.occupant?.phase).toBe("in_progress");
  });

  it("applies the no-show timer to a called timed occupant that never arrives", () => {
    const v = store.register(772003);
    pd.kick();
    pd.confirm(v.id); // called, NOT arrived
    vi.advanceTimersByTime(90_000 + 1_000); // > noShowMs, dwell never started
    pd.kick();
    expect(store.get(v.id)?.paperAt).toBeUndefined(); // no false completion
    expect(store.get(v.id)?.location.state).toBe("waiting"); // repooled by no-show (noShowAutoRepool)
    // the original called occupant was reaped; re-dispatch may re-pin it as a fresh pending,
    // but it must never have progressed past called.
    const occ = pd.snapshot().slots.find((x) => x.occupant?.visitorId === v.id)?.occupant;
    expect(occ?.phase).not.toBe("in_progress");
    expect(occ?.phase).not.toBe("called");
  });

  it("a called timed occupant past the dwell is NOT completed if it never arrived (no false paperAt)", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, {
      knobs: { ...P_KNOBS, noShowAutoRepool: false, noShowMs: 600_000 } as any,
      autoStart: false,
    });
    const v = store.register(772010);
    d2.kick();
    d2.confirm(v.id); // called, never arrived
    vi.advanceTimersByTime(300_000 + 1_000); // past dwell, but < noShowMs
    d2.kick();
    expect(store.get(v.id)?.paperAt).toBeUndefined(); // dwell does NOT run for an absent occupant
    expect(d2.snapshot().slots.find((x) => x.occupant?.visitorId === v.id)?.occupant?.phase).toBe("called");
    d2.stop();
  });

  it("markComplete stamps paperAt for a paper occupant", () => {
    const v = store.register(772004);
    pd.kick();
    pd.confirm(v.id);
    expect(pd.markComplete(v.id)).toBe(true);
    expect(store.get(v.id)?.paperAt).toBeTruthy();
  });

  it("exposes the paper dwell in the snapshot for the operator countdown", () => {
    expect(pd.snapshot().timedDwellMs?.paper).toBe(300_000);
    expect(pd.snapshot().timedDwellMs?.intake).toBeUndefined();
  });
});

describe("per-visitor holds (intro wait + no-show cooldown)", () => {
  it("holds a fresh visitor out of dispatch until introHoldMs elapses, surfaced in the queue", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, { knobs: { ...KNOBS, introHoldMs: 60_000 } as any, autoStart: false });
    f2.hello("intake", "kA", "cA");
    const v = store.register(NUM());
    d2.kick(); // within the intro hold → no dispatch
    expect(d2.snapshot().slots.every((s) => !s.occupant)).toBe(true);
    const held = d2.snapshot().queue.find((e) => e.id === v.id);
    expect(held?.holdReason).toBe("intro");
    expect(held?.heldUntil).toBeTruthy();
    vi.setSystemTime(new Date("2026-06-21T00:01:01.000Z")); // > 60s after createdAt
    d2.kick();
    expect(d2.snapshot().slots.some((s) => s.occupant?.visitorId === v.id)).toBe(true);
    d2.stop();
  });

  it("holds a no-show number for noShowHoldMs, then frees it", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, {
      knobs: { ...KNOBS, introHoldMs: 0, noShowMs: 90_000, noShowHoldMs: 120_000, noShowAutoRepool: true } as any,
      autoStart: false,
    });
    f2.hello("intake", "kA", "cA");
    const v = store.register(NUM());
    d2.kick(); d2.confirm(v.id); // called
    vi.setSystemTime(new Date("2026-06-21T00:01:31.000Z")); // > noShowMs → no-show repool + hold
    d2.kick();
    expect(store.get(v.id)?.location.state).toBe("waiting");
    expect(d2.snapshot().slots.some((s) => s.occupant?.visitorId === v.id)).toBe(false); // held, not re-dispatched
    expect(d2.snapshot().queue.find((e) => e.id === v.id)?.holdReason).toBe("no-show");
    vi.setSystemTime(new Date("2026-06-21T00:03:40.000Z")); // > 00:01:31 + 120s
    d2.kick();
    expect(d2.snapshot().slots.some((s) => s.occupant?.visitorId === v.id)).toBe(true);
    d2.stop();
  });

  it("does not let anti-starvation rescue a held visitor", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, { knobs: { ...KNOBS, introHoldMs: 600_000, maxWaitMs: 1_000 } as any, autoStart: false });
    f2.hello("intake", "kA", "cA");
    const v = store.register(NUM());
    vi.setSystemTime(new Date("2026-06-21T00:00:05.000Z")); // waited 5s > maxWaitMs 1s
    d2.kick();
    expect(d2.snapshot().slots.every((s) => !s.occupant)).toBe(true); // still intro-held
    d2.stop();
  });
});
