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
    expect(s.stationsOnline).toEqual({ intake: false, bodyscan: false, altar: false, paper: false, offering: false });
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

  it("attaches reported cameras (and the active id) to the kiosk's slot", () => {
    f.hello("bodyscan", "kioskCam", "connCam");
    d.setCameras("kioskCam", [{ id: "cam-a", label: "Front" }, { id: "cam-b", label: "Overhead" }], "cam-a");
    const slot = d.snapshot().slots.find((x) => x.kioskId === "kioskCam");
    expect(slot?.cameras).toEqual([{ id: "cam-a", label: "Front" }, { id: "cam-b", label: "Overhead" }]);
    expect(slot?.activeCameraId).toBe("cam-a");
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

describe("offline-slot takeover: new device after closing the original tab (single-slot bodyscan)", () => {
  // A closed tab clears its per-tab kioskId, so a new device/tab arrives with a FRESH id and
  // cannot reclaim by id. With one slot held bound-but-offline through the grace window, the new
  // screen used to be parked as surplus; it should take over the offline slot instead (newest wins).
  const ONE_BODYSCAN = { ...KNOBS, slots: { intake: 3, bodyscan: 1, altar: 1 } };

  it("a fresh kiosk reclaims the offline lone slot instead of being parked as surplus", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, { knobs: ONE_BODYSCAN, autoStart: false });
    f2.hello("bodyscan", "kioskOld", "connOld");        // original screen claims bodyscan-0
    f2.fireDisconnect("connOld");                       // tab closes → slot offline, still bound
    vi.advanceTimersByTime(5);                          // still within the grace window
    f2.hello("bodyscan", "kioskNew", "connNew");        // a different device opens /bodyscan
    const s = d2.snapshot();
    expect(s.surplus.some((x) => x.kioskId === "kioskNew")).toBe(false);
    const slot = s.slots.find((x) => x.station === "bodyscan")!;
    expect(slot.kioskId).toBe("kioskNew");
    expect(slot.online).toBe(true);
    d2.stop();
  });

  it("the superseded slot's grace timer no longer unbinds the new kiosk", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, { knobs: ONE_BODYSCAN, autoStart: false });
    f2.hello("bodyscan", "kioskOld", "connOld");
    f2.fireDisconnect("connOld");
    f2.hello("bodyscan", "kioskNew", "connNew");        // takeover within grace
    vi.advanceTimersByTime(KNOBS.graceMs + 10);         // the OLD grace timer would fire here
    const slot = d2.snapshot().slots.find((x) => x.station === "bodyscan");
    expect(slot?.kioskId).toBe("kioskNew");
    expect(slot?.online).toBe(true);
    d2.stop();
  });
});

const NUM = () => 500000 + Math.floor(Math.random() * 400000);

describe("fill priority: scarce gate first", () => {
  it("pins a single waiting visitor to bodyscan, not intake", () => {
    f.hello("intake", "ki", "ci");    // intake-0 online
    f.hello("bodyscan", "kb", "cb");  // bodyscan-0 online
    const v = store.register(NUM());
    d.kick();
    const slot = d.snapshot().slots.find((s) => s.occupant?.visitorId === v.id);
    expect(slot?.station).toBe("bodyscan");
  });

  it("with two waiting, bodyscan and intake each take one", () => {
    f.hello("intake", "ki", "ci");
    f.hello("bodyscan", "kb", "cb");
    store.register(NUM());
    store.register(NUM());
    d.kick();
    const stations = d.snapshot().slots
      .filter((s) => s.occupant).map((s) => s.station).sort();
    expect(stations).toEqual(["bodyscan", "intake"]);
  });
});

describe("altar gate", () => {
  it("does not dispatch to a closed altar; setAltarOpen opens it", () => {
    f.hello("altar", "ka", "ca"); // altar-0 online
    const v = store.register(NUM());
    store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] }); // intakeAt
    store.setPoseTemplate(v.id, { angles: [0], weights: [1] });          // poseAt
    store.stampMilestone(v.id, "paperAt");                               // + paper
    store.stampMilestone(v.id, "offeringAt");                            // + offering → altar-eligible
    store.setLocation(v.id, { state: "waiting", since: new Date().toISOString() });

    d.kick();
    expect(d.snapshot().altarOpen).toBe(false);
    expect(d.snapshot().slots.find((s) => s.station === "altar")?.occupant).toBeUndefined();

    d.setAltarOpen(true);
    expect(d.snapshot().altarOpen).toBe(true);
    expect(d.snapshot().slots.find((s) => s.station === "altar")?.occupant?.visitorId).toBe(v.id);
  });

  it("requires every pre-altar station, not just intake+pose, before dispatching to the altar", () => {
    f.hello("altar", "ka", "ca"); // altar-0 online
    d.setAltarOpen(true);
    const v = store.register(NUM());
    store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] }); // intakeAt
    store.setPoseTemplate(v.id, { angles: [0], weights: [1] });          // poseAt
    store.setLocation(v.id, { state: "waiting", since: new Date().toISOString() });

    d.kick();
    // intake + pose alone is no longer enough — paper + offering still pending
    expect(d.snapshot().slots.find((s) => s.station === "altar")?.occupant).toBeUndefined();

    store.stampMilestone(v.id, "paperAt");
    store.stampMilestone(v.id, "offeringAt");
    d.kick();
    expect(d.snapshot().slots.find((s) => s.station === "altar")?.occupant?.visitorId).toBe(v.id);
  });
});

describe("flow-health snapshot fields", () => {
  it("counts altar-ready waiting visitors and reports bodyscan empty when no one needs a scan", () => {
    f.hello("bodyscan", "kb", "cb"); // online + idle
    let s = d.snapshot();
    expect(s.bodyscanIdle).toBe(true);
    expect(s.bodyscanBlocked).toBe("empty");
    expect(s.altarReady).toBe(0);

    const v = store.register(NUM());
    store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] });
    store.setPoseTemplate(v.id, { angles: [0], weights: [1] });
    store.stampMilestone(v.id, "paperAt");      // all four stations now done →
    store.stampMilestone(v.id, "offeringAt");   // genuinely altar-ready
    store.setLocation(v.id, { state: "waiting", since: new Date().toISOString() });
    s = d.snapshot();
    expect(s.altarReady).toBe(1);
    expect(s.altarReadyList.map((r) => r.number)).toContain(v.number);
    expect(s.altarReadyList.find((r) => r.number === v.number)?.name).toBe("Jo");
    expect(s.bodyscanBlocked).toBe("empty"); // posed person is not a bodyscan candidate
  });

  it("reports 'soaking' when the only unposed person is in a group station while bodyscan is idle", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, {
      knobs: { slots: { intake: 0, bodyscan: 1, altar: 0, paper: 1 },
               groupStations: ["paper"], introHoldMs: 0 } as any,
      autoStart: false,
    });
    f2.hello("bodyscan", "kb", "cb");        // bodyscan idle
    const v = store.register(NUM());
    d2.checkin(v.number, "paper");           // unposed v forced in_progress @ paper
    const s = d2.snapshot();
    expect(s.bodyscanIdle).toBe(true);
    expect(s.bodyscanBlocked).toBe("soaking");
    d2.stop();
  });

  it("reports 'held' when the only unposed candidate is on an intro hold", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, {
      knobs: { slots: { intake: 0, bodyscan: 1, altar: 0, paper: 0 },
               introHoldMs: 600_000 } as any,
      autoStart: false,
    });
    f2.hello("bodyscan", "kb", "cb");
    store.register(NUM()); // fresh, unposed, held by the 10-min intro hold
    const s = d2.snapshot();
    expect(s.bodyscanIdle).toBe(true);
    expect(s.bodyscanBlocked).toBe("held");
    d2.stop();
  });
});

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
    store.setPoseTemplate(v.id, { angles: [0], weights: [1] });
    store.stampMilestone(v.id, "paperAt");
    store.stampMilestone(v.id, "offeringAt"); // now altar-eligible
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

describe("paper: manual-checkout group station", () => {
  const P_KNOBS = {
    slots: { intake: 0, bodyscan: 0, altar: 0, paper: 2 },
    // Kiosk-less group station with NO dwell: exits only via manual Done (markComplete). (#17)
    // noShowAutoRepool ON so a called-but-never-arrived paper occupant is repooled
    // at noShowMs(90s) rather than left hanging.
    groupStations: ["paper"],
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

  it("confirm → arrive moves a paper occupant to in_progress", () => {
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

  it("does NOT auto-complete an in-progress paper occupant on a timer (manual only)", () => {
    const v = store.register(772001);
    pd.kick();
    pd.confirm(v.id);
    pd.arrive(v.id);
    vi.advanceTimersByTime(600_000); // 10 min — well past any old dwell
    pd.kick(); // reconcile
    expect(store.get(v.id)?.paperAt).toBeUndefined();
    expect(pd.snapshot().slots.find((x) => x.occupant?.visitorId === v.id)?.occupant?.phase).toBe("in_progress");
  });

  it("markComplete (Done) stamps paperAt and frees the slot", () => {
    const v = store.register(772004);
    pd.kick();
    pd.confirm(v.id);
    pd.arrive(v.id);
    expect(pd.markComplete(v.id)).toBe(true);
    expect(store.get(v.id)?.paperAt).toBeTruthy();
    expect(pd.snapshot().slots.some((x) => x.occupant?.visitorId === v.id)).toBe(false);
  });

  it("still applies the no-show timer to a called-but-never-arrived paper occupant", () => {
    const v = store.register(772003);
    pd.kick();
    pd.confirm(v.id); // called, NOT arrived
    vi.advanceTimersByTime(90_000 + 1_000); // > noShowMs
    pd.kick();
    expect(store.get(v.id)?.paperAt).toBeUndefined(); // no false completion
    expect(store.get(v.id)?.location.state).toBe("waiting"); // repooled by no-show (noShowAutoRepool)
    const occ = pd.snapshot().slots.find((x) => x.occupant?.visitorId === v.id)?.occupant;
    expect(occ?.phase).not.toBe("in_progress");
    expect(occ?.phase).not.toBe("called");
  });

  it("does not list paper in timedDwellMs (it is a manual group station)", () => {
    expect(pd.snapshot().timedDwellMs?.paper).toBeUndefined();
  });
});

describe("offering: timed 'time offering' room (dwell + manual early release)", () => {
  const O_KNOBS = {
    slots: { intake: 0, bodyscan: 0, altar: 0, paper: 0, offering: 2 },
    timed: { offering: { dwellMs: 300_000 } },
    // No-show still applies while called; auto-repool so a never-arrived occupant frees the slot.
    introHoldMs: 0, tickMs: 5_000, noShowAutoRepool: true,
  };
  let of: ReturnType<typeof fakeBus>;
  let od: ReturnType<typeof createDispatcher>;
  beforeEach(() => { of = fakeBus(); od = createDispatcher(of.bus, { knobs: O_KNOBS as any, autoStart: false }); });
  afterEach(() => od.stop());

  it("derives offering slots that are always online without any kiosk", () => {
    const s = od.snapshot();
    const room = s.slots.filter((x) => x.station === "offering");
    expect(room.map((x) => x.id).sort()).toEqual(["offering-0", "offering-1"]);
    expect(room.every((x) => x.online === true && !x.kioskId)).toBe(true);
    expect(s.stationsOnline.offering).toBe(true);
  });

  it("a fresh waiting visitor is eligible for offering", () => {
    store.register(990001);
    expect(od.snapshot().queue.find((e) => e.number === 990001)?.eligible).toContain("offering");
  });

  it("TIMED RELEASE: auto-completes dwellMs after arrival — stamps offeringAt, frees, repools", () => {
    const v = store.register(990002);
    od.kick(); od.confirm(v.id); od.arrive(v.id); // dwell starts at arrival
    vi.advanceTimersByTime(300_000 + 1_000);
    od.kick(); // reconcile
    expect(store.get(v.id)?.offeringAt).toBeTruthy();
    expect(store.get(v.id)?.location.state).toBe("waiting");
    expect(od.snapshot().slots.some((x) => x.occupant?.visitorId === v.id)).toBe(false);
  });

  it("does not complete before the dwell elapses", () => {
    const v = store.register(990003);
    od.kick(); od.confirm(v.id); od.arrive(v.id);
    vi.advanceTimersByTime(120_000); // < dwell
    od.kick();
    expect(store.get(v.id)?.offeringAt).toBeUndefined();
    expect(od.snapshot().slots.find((x) => x.occupant?.visitorId === v.id)?.occupant?.phase).toBe("in_progress");
  });

  it("MANUAL EARLY RELEASE: markComplete (Done) stamps offeringAt and frees before the dwell", () => {
    const v = store.register(990004);
    od.kick(); od.confirm(v.id); od.arrive(v.id);
    vi.advanceTimersByTime(60_000); // well before dwell
    expect(od.markComplete(v.id)).toBe(true);
    expect(store.get(v.id)?.offeringAt).toBeTruthy();
    expect(od.snapshot().slots.some((x) => x.occupant?.visitorId === v.id)).toBe(false);
  });

  it("still applies the no-show timer to a called-but-never-arrived offering occupant", () => {
    const v = store.register(990005);
    od.kick(); od.confirm(v.id); // called, NOT arrived
    vi.advanceTimersByTime(90_000 + 1_000); // > noShowMs
    od.kick();
    expect(store.get(v.id)?.offeringAt).toBeUndefined();
    expect(store.get(v.id)?.location.state).toBe("waiting");
  });

  it("exposes the offering dwell in timedDwellMs for the operator countdown", () => {
    expect(od.snapshot().timedDwellMs?.offering).toBe(300_000);
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

  it("clears the no-show hold once a late visitor's arrival is confirmed, so completing the station does not strand them", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, {
      knobs: { ...KNOBS, introHoldMs: 0, noShowMs: 90_000, noShowHoldMs: 120_000, noShowAutoRepool: false } as any,
      autoStart: false,
    });
    f2.hello("bodyscan", "kA", "cA");
    f2.hello("intake", "kB", "cB"); // an onward station the completed visitor is eligible for
    const v = store.register(NUM());
    d2.kick(); d2.confirm(v.id); // pending → called@bodyscan
    vi.setSystemTime(new Date("2026-06-21T00:01:31.000Z")); // > noShowMs → no-show hold armed (flagged, not repooled)
    d2.kick();
    const flagged = d2.snapshot().slots.find((s) => s.occupant?.visitorId === v.id)?.occupant;
    expect(flagged?.flags?.some((fl) => fl.type === "no-show")).toBe(true); // sanity: no-show armed while still called

    // The priestess admits the late visitor, who then completes the station.
    expect(d2.arrive(v.id)).toBe(true); // called → in_progress
    expect(d2.markComplete(v.id)).toBe(true); // poseAt stamped, slot freed, back to waiting

    // They showed up, so the no-show hold must be gone — not parked in the pool.
    const entry = d2.snapshot().queue.find((e) => e.id === v.id);
    expect(entry?.holdReason).toBeUndefined();
    expect(entry?.heldUntil).toBeFalsy();
    // …and the next pass dispatches them onward instead of stranding them.
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
