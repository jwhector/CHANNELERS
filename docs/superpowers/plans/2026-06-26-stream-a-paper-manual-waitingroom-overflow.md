# Stream A — Paper manual-checkout (#17) + Waiting room → overflow bucket (#24)

**Goal:** Make the `paper` station exit only on a manual "Done", and retire `waitingroom` as a station so it becomes a board-derived holding label.

**Approach:** Decouple the dispatcher's two conflated concepts — "kiosk-less always-online group station" vs. "dwell-completing" — by adding a `groupStations` config flag; keep the generic dwell machinery for a hypothetical future timed station but configure no station to use it. Delete `waitingroom` from the shared contract and derive a `WAITING ROOM` board bucket from the existing `queue` + `altarReadyList`.

**Tech stack:** TypeScript monorepo (pnpm). Brain: Fastify dispatcher + zod shared contract. Stage: Vite/React routes. Vitest for both suites. No new dependencies.

---

## Why / design

### Problem
From the 2026-06-26 rehearsal:
- **#17** — the `paper` station auto-completes a visitor on a 5-minute dwell timer. Operators want a person to stay at paper until a performer taps **Done**; the auto-dwell evicts them prematurely.
- **#24** — `waitingroom` is modelled as a full timed station (10 slots, a 5-min "hourglass", a `/station/waitingroom` arrival screen, a `waitingRoomAt` milestone). It should instead be an **overflow holding space** — not a station — surfaced on the public board for anyone who is waiting and not currently at a station.

### Root cause (shared)
`isTimed(s)` in [dispatcher.ts:73](../../../app/apps/brain/src/dispatcher.ts#L73) does double duty: it marks a station **kiosk-less / always-online** *and* **dwell-completing**. `paper` and `waitingroom` are the only two timed stations. To make paper manual we must split those concepts; to retire waitingroom we delete it outright.

### Scope
- **In scope:** the dispatcher station model, the shared `Station`/`VisitorProfile` contract, the `/board` holding label, the `/station` Done affordance, and the affected brain + stage tests.
- **Out of scope:** `/feed` (the paper visitor screen — button-driven, no dwell, unaffected); `/dispatch` (its dwell countdown reads `timedDwellMs`, which stays and is simply empty now — no edit); **#18** (a future `ALTAR READY` board label that will later refine the altar-ready subset of the `WAITING ROOM` bucket); the physical hourglass prop (a stage-direction change, not code).

### Approaches considered
1. **Rip out the dwell machinery entirely** — after these changes nothing is timed, so `isTimed`/`dwellMs`/`timedDwellMs`/the two countdowns are dead. Cleanest end-state, but deletes a generic capability.
2. **Keep the dwell machinery, decouple always-online from dwell (chosen).** Add `groupStations` for the always-online concept; leave `timed` generic but empty. Slightly more code than a pure deletion, but preserves a future timed station with zero rework. **Chosen at the user's request.**
3. **Minimal patch** — special-case `paper` inline in `reconcile()` without a config concept. Rejected: re-buries the conflation we're trying to fix.

### Decision log
- **Keep `timed`/`dwellMs`/`timedDwellMs`** as a generic, currently-unconfigured capability (user decision). `timed: {}` after the change; the `/station` + `/dispatch` countdowns stay and render nothing until a station opts in.
- **`paper` = a `groupStation` with no dwell** → always-online, manual Done only. No dwell auto-complete, no stale-reap of an in-progress paper occupant. The `called`-phase no-show timer still applies (a called-but-never-arrived occupant is still flagged/repooled).
- **`waitingroom` fully retired** — removed from the `Station` enum, `STATION_LABEL`, `VisitorProfile.waitingRoomAt`, config, dispatcher, and `/station`'s performer picker.
- **Board `WAITING ROOM` bucket = `queue` ∪ `altarReadyList`** (deduped against slots/queue), labelled `WAITING ROOM`, or `ON HOLD` when held. The `altarReadyList` union ensures altar-ready-but-altar-closed visitors don't vanish from `/board`.
- **Task order: #24 first, then #17.** Retiring waitingroom is a clean isolated removal while paper stays timed; the paper→manual decoupling lands second. Each task ends green and is independently shippable.

---

## Global constraints
- **Verification (run from `app/`):** `pnpm -r typecheck`, `pnpm --filter @channelers/brain test`, `pnpm --filter @channelers/stage test`. All must pass at the end of each task.
- **Commit per task** with a `feat`/`refactor` message scoped to the dispatcher; do not squash the two tasks.
- **Board label copy:** exactly `WAITING ROOM` and `ON HOLD` (uppercase, matching existing `DONE`/`WAITING` tone styling in `board.css`).
- **No new station ids.** After this work `Station = ["intake","bodyscan","altar","paper"]`.
- **Offline-resilient / human-in-the-loop unchanged** — these edits do not touch any OpenAI/OSC path.
- Per the punchlist handoff checklist: update `docs/CHANGELOG.md`, flip #17/#24 status in `docs/rehearsal-punchlist.md`, reconcile the `/station` + `/board` route notes in `app/CLAUDE.md` (the `/station` line still lists `waitingroom` and "early-completes a timed station"; the `/feed` line still calls waitingroom "a second timed group station"), and update the "Next up" pointer.

---

## File structure

### Task 1 — Retire `waitingroom` (#24)
| File | Change |
|------|--------|
| `app/packages/shared/src/schemas.ts` | Remove `waitingroom` from `Station` enum, `STATION_LABEL`, and `VisitorProfile.waitingRoomAt`. |
| `app/apps/brain/src/store.ts` | Remove `"waitingRoomAt"` from the `stampMilestone` field union. |
| `app/apps/brain/src/config.ts` | Remove `waitingroom` from `slots`, `fillPriority`, `timed`; retype the literals to `Record<Station, …>`. |
| `app/apps/brain/src/dispatcher.ts` | Remove `waitingroom` from `STATION_ORDER`, `eligibleStations`, `milestoneField`, `completionMilestoneSet`, and the `stationsOnline` snapshot literal. |
| `app/apps/stage/src/routes/Station.tsx` | Remove `waitingroom` from `PERFORMER_STATIONS`. |
| `app/apps/stage/src/routes/Board.tsx` | Extract a pure `boardRows(state)`; relabel `WAITING`→`WAITING ROOM`; add the `altarReadyList` union. |
| `app/apps/stage/src/routes/Board.test.tsx` | **New.** Unit-test `boardRows` (WAITING ROOM / ON HOLD / altar-ready). |
| `app/apps/brain/test/dispatcher.test.ts` | Fix `stationsOnline` expectation; repoint the "soaking" test to `paper`; delete the `waitingroom` describe block. |
| `app/apps/brain/test/store.test.ts` | Delete the `waitingroom station milestone` describe block. |
| `app/apps/brain/test/schema.test.ts` | Delete the `waitingRoomAt` test; flip the enum assertion to reject `waitingroom`. |
| `app/apps/stage/src/routes/Station.test.tsx` | Repoint the "timed in-progress shows Done" fixture from `waitingroom` to `paper`. |

### Task 2 — Paper → manual checkout (#17)
| File | Change |
|------|--------|
| `app/apps/brain/src/config.ts` | Remove `paper` from `timed` (→ `timed: {}`); add `groupStations: ["paper"]`. |
| `app/apps/brain/src/dispatcher.ts` | Add `isGroup`; extend `isOnline`; add the manual-group `in_progress` branch in `reconcile`. |
| `app/apps/stage/src/routes/Station.tsx` | Gate the in-progress Done/Release block on `onComplete`; container passes `onComplete` only for paper or a timed station. |
| `app/apps/brain/test/dispatcher.test.ts` | Rewrite the `paper` describe block: replace dwell-completion tests with a "does not auto-complete" test; keep `markComplete` + no-show; assert `timedDwellMs` no longer lists paper. Update the "soaking" test KNOBS to `groupStations`. |
| `app/apps/stage/src/routes/Station.test.tsx` | Update the two Done tests for the `onComplete`-based gate. |

---

## Tasks

> Each step is one action. Code steps show the exact code; command steps show the command + expected result. Run all commands from `app/`.

### Task 1 — Retire `waitingroom` (#24)

**Files:** all rows in the Task 1 table above.
**Interfaces — Produces:** `Station = ["intake","bodyscan","altar","paper"]`; `boardRows(state: DispatchState | null): Row[]` exported from `Board.tsx`.
**Interfaces — Consumes:** existing `DispatchState` (`queue`, `altarReadyList`, `slots`).

- [ ] **Board red:** create `app/apps/stage/src/routes/Board.test.tsx` asserting the new bucket. This fails to compile/import until `boardRows` is exported.
  ```tsx
  import { describe, it, expect } from "vitest";
  import type { DispatchState } from "@channelers/shared";
  import { boardRows } from "./Board";

  const base: DispatchState = {
    slots: [], queue: [], completed: [], surplus: [],
    stationsOnline: { intake: false, bodyscan: false, altar: false, paper: false },
    altarReady: 0, altarReadyList: [], altarOpen: false,
    bodyscanIdle: false, bodyscanBlocked: "none",
  };

  describe("boardRows", () => {
    it("labels a plain waiting visitor WAITING ROOM", () => {
      const rows = boardRows({ ...base, queue: [{ id: "a", number: 12, eligible: ["intake"], waitingSince: "", flags: [] }] });
      expect(rows.find((r) => r.id === "a")?.loc).toBe("WAITING ROOM");
    });
    it("labels a held visitor ON HOLD", () => {
      const rows = boardRows({ ...base, queue: [{ id: "b", number: 13, eligible: ["intake"], waitingSince: "", flags: [], holdReason: "intro" }] });
      expect(rows.find((r) => r.id === "b")?.loc).toBe("ON HOLD");
    });
    it("shows an altar-ready-but-unplaced visitor as WAITING ROOM", () => {
      const rows = boardRows({ ...base, altarReadyList: [{ id: "c", number: 14 }] });
      expect(rows.find((r) => r.id === "c")?.loc).toBe("WAITING ROOM");
    });
    it("does not double-list an altar-ready visitor already in the queue", () => {
      const rows = boardRows({
        ...base,
        queue: [{ id: "c", number: 14, eligible: ["altar"], waitingSince: "", flags: [] }],
        altarReadyList: [{ id: "c", number: 14 }],
      });
      expect(rows.filter((r) => r.id === "c")).toHaveLength(1);
    });
  });
  ```
- [ ] **Run, expect FAIL:** `pnpm --filter @channelers/stage test Board` → fails (`boardRows` not exported / not found).
- [ ] **Board green:** refactor `app/apps/stage/src/routes/Board.tsx` — export `Row` + a pure `boardRows`, and call it from the component. Replace the body from the `Row` type (line 11) through the `rows` const (line 50):
  ```tsx
  /** One roster line: a visitor number and where they are. */
  export type Row = { id: string; number: number; loc: string; tone: Tone };

  const pad3 = (n: number) => String(n).padStart(3, "0");

  /** Pure roster derivation — every visitor and where they are. A visitor who is waiting and
   *  not at a station is in the holding area (#24): "WAITING ROOM", or "ON HOLD" while held. */
  export function boardRows(state: DispatchState | null): Row[] {
    const fromSlots: Row[] = (state?.slots ?? [])
      .filter((s) => s.occupant)
      .map((s) => {
        const o = s.occupant!;
        return { id: o.visitorId, number: o.number, loc: STATION_LABEL[s.station], tone: (o.phase === "called" ? "now" : "at") as Tone };
      });

    const inSlot = new Set(fromSlots.map((r) => r.id));
    const inQueue = new Set((state?.queue ?? []).map((q) => q.id));

    const fromQueue: Row[] = (state?.queue ?? []).map((q) => ({
      id: q.id,
      number: q.number,
      loc: (q.heldUntil ?? q.holdReason) ? "ON HOLD" : "WAITING ROOM",
      tone: "wait",
    }));

    // Altar-ready visitors who aren't otherwise placed (e.g. the altar is closed, so they're not
    // eligible for any open station) are still parked in the holding area. (#24; #18 refines later.)
    const fromReady: Row[] = (state?.altarReadyList ?? [])
      .filter((v) => !inSlot.has(v.id) && !inQueue.has(v.id))
      .map((v) => ({ id: v.id, number: v.number, loc: "WAITING ROOM", tone: "wait" as Tone }));

    const fromDone: Row[] = (state?.completed ?? []).map((c) => ({
      id: c.id, number: c.number, loc: "DONE", tone: "done",
    }));

    return [...fromSlots, ...fromQueue, ...fromReady, ...fromDone].sort((a, b) => a.number - b.number);
  }
  ```
  Then in the component replace the inline derivations (old lines 28–50) with a single call:
  ```tsx
    const rows = boardRows(state);
  ```
- [ ] **Run, expect PASS:** `pnpm --filter @channelers/stage test Board` → 4 passing.
- [ ] **Shared contract:** in `app/packages/shared/src/schemas.ts` remove `waitingroom` from the enum (line 45), the `STATION_LABEL` entry (line 56), and the `waitingRoomAt` field (lines 87–90):
  ```ts
  export const Station = z.enum(["intake", "bodyscan", "altar", "paper"]);
  ```
  ```ts
  export const STATION_LABEL: Record<Station, string> = {
    intake: "STATION D - INTAKE",
    bodyscan: "STATION C - BODY SCAN",
    altar: "ALTAR",
    paper: "STATION B - TYPEWRITER",
  };
  ```
  Delete the two `waitingRoomAt` lines (the doc-comment + field); keep `paperAt`.
- [ ] **Store union:** in `app/apps/brain/src/store.ts:109` remove `"waitingRoomAt"` from the `stampMilestone` field union, leaving `"intakeAt" | "poseAt" | "paperAt" | ... | "sessionEndAt"` (drop only the waitingroom member).
- [ ] **Config:** in `app/apps/brain/src/config.ts` retype `slots`/`fillPriority`/`timed` (lines 59–72):
  ```ts
    slots: { intake: 2, bodyscan: 1, altar: 1, paper: 3 } as Record<Station, number>,
    fillPriority: ["bodyscan", "intake", "altar", "paper"] as Station[],
    timed: {
      paper: { dwellMs: Number(process.env.PAPER_DWELL_MS ?? 300_000) },
    } as Partial<Record<Station, { dwellMs: number }>>,
  ```
  (Paper stays timed in Task 1; the `groupStations`/de-timing happens in Task 2. Drop the `WAITINGROOM_DWELL_MS` line.)
- [ ] **Dispatcher:** in `app/apps/brain/src/dispatcher.ts` remove every `waitingroom` reference:
  - `STATION_ORDER` (line 9): `["intake", "bodyscan", "altar", "paper"]`.
  - `eligibleStations` (line 100): delete `if (!v.waitingRoomAt) out.push("waitingroom");`.
  - `milestoneField` (lines 301–307): delete the `if (station === "waitingroom") return "waitingRoomAt";` branch **and** drop `"waitingRoomAt"` from the function's return-type annotation (→ `"intakeAt" | "poseAt" | "paperAt" | "sessionEndAt"`), so it stays in sync with the narrowed `store.stampMilestone` union.
  - `completionMilestoneSet` (line 313): delete the `if (station === "waitingroom") return !!v.waitingRoomAt;` line.
  - `snapshot().stationsOnline` (line 456): delete the `waitingroom: slotsOf("waitingroom").some(isOnline),` line.
- [ ] **Station picker:** in `app/apps/stage/src/routes/Station.tsx:10`:
  ```tsx
  const PERFORMER_STATIONS: StationName[] = ["bodyscan", "altar", "paper"];
  ```
- [ ] **Fix brain tests** in `app/apps/brain/test/dispatcher.test.ts`:
  - Line 52 — drop the waitingroom key:
    ```ts
    expect(s.stationsOnline).toEqual({ intake: false, bodyscan: false, altar: false, paper: false });
    ```
  - Lines 176–190 (the "soaking" test) — repoint to `paper` (still timed here):
    ```ts
      knobs: { slots: { intake: 0, bodyscan: 1, altar: 0, paper: 1 },
               timed: { paper: { dwellMs: 300_000 } }, introHoldMs: 0 } as any,
    ```
    and `d2.checkin(v.number, "paper");`.
  - Delete the entire `describe("waitingroom: timed group station …")` block (lines 462–516).
- [ ] **Fix store test:** in `app/apps/brain/test/store.test.ts` delete the `describe("waitingroom station milestone", …)` block (lines 83–91).
- [ ] **Fix schema test:** in `app/apps/brain/test/schema.test.ts` delete the `it("retains waitingRoomAt …")` test (lines 42–51); change the enum assertion (line 82) to:
  ```ts
  expect(Station.safeParse("waitingroom").success).toBe(false);
  ```
- [ ] **Fix stage Station test:** in `app/apps/stage/src/routes/Station.test.tsx` repoint the "timed in-progress shows Done" fixture (lines 37–51) from `waitingroom` to `paper` (still timed here — keep `dwellMs={300_000}`):
  ```tsx
  const slot: Slot = {
    id: "paper-0", station: "paper", online: true,
    occupant: { visitorId: "v9", number: 9, phase: "in_progress", since: "" },
  };
  // …render with station="paper" dwellMs={300_000} onComplete={onComplete}…
  ```
- [ ] **Run, expect PASS:** `pnpm -r typecheck && pnpm --filter @channelers/brain test && pnpm --filter @channelers/stage test` → all green.
- [ ] **Commit:** `git add -A && git commit -m "feat(dispatch): retire waitingroom as a station; /board shows WAITING ROOM holding bucket (rehearsal #24)"`

### Task 2 — Paper → manual checkout (#17)

**Files:** all rows in the Task 2 table above.
**Interfaces — Consumes:** `Station` (4-member) and `boardRows` from Task 1.
**Interfaces — Produces:** `config.dispatcher.groupStations: Station[]`; a dispatcher where a `groupStation` not in `timed` never auto-completes.

- [ ] **Dispatcher red:** in `app/apps/brain/test/dispatcher.test.ts`, rewrite the `paper` describe block (lines 351–460). Set the KNOBS to a group station and replace the dwell-completion tests with a no-auto-complete test:
  ```ts
  describe("paper: manual-checkout group station", () => {
    const P_KNOBS = {
      slots: { intake: 0, bodyscan: 0, altar: 0, paper: 2 },
      groupStations: ["paper"],
      introHoldMs: 0, tickMs: 5_000, noShowAutoRepool: true,
    };
    let pf: ReturnType<typeof fakeBus>;
    let pd: ReturnType<typeof createDispatcher>;
    beforeEach(() => { pf = fakeBus(); pd = createDispatcher(pf.bus, { knobs: P_KNOBS as any, autoStart: false }); });
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
      expect(pd.snapshot().queue.find((e) => e.number === 771001)?.eligible).toContain("paper");
    });

    it("does NOT auto-complete an in-progress paper occupant on a timer (manual only)", () => {
      const v = store.register(772001);
      pd.kick(); pd.confirm(v.id); pd.arrive(v.id);
      vi.advanceTimersByTime(600_000); // 10 min — well past any old dwell
      pd.kick();
      expect(store.get(v.id)?.paperAt).toBeUndefined();
      expect(pd.snapshot().slots.find((x) => x.occupant?.visitorId === v.id)?.occupant?.phase).toBe("in_progress");
    });

    it("markComplete (Done) stamps paperAt and frees the slot", () => {
      const v = store.register(772004);
      pd.kick(); pd.confirm(v.id); pd.arrive(v.id);
      expect(pd.markComplete(v.id)).toBe(true);
      expect(store.get(v.id)?.paperAt).toBeTruthy();
      expect(pd.snapshot().slots.some((x) => x.occupant?.visitorId === v.id)).toBe(false);
    });

    it("still applies the no-show timer to a called-but-never-arrived paper occupant", () => {
      const v = store.register(772003);
      pd.kick(); pd.confirm(v.id); // called, NOT arrived
      vi.advanceTimersByTime(90_000 + 1_000); // > noShowMs
      pd.kick();
      expect(store.get(v.id)?.paperAt).toBeUndefined();
      expect(store.get(v.id)?.location.state).toBe("waiting");
    });

    it("does not list paper in timedDwellMs (it is a manual group station)", () => {
      expect(pd.snapshot().timedDwellMs?.paper).toBeUndefined();
    });
  });
  ```
  Also update the "soaking" test KNOBS (from Task 1) to use the group flag:
  ```ts
    knobs: { slots: { intake: 0, bodyscan: 1, altar: 0, paper: 1 },
             groupStations: ["paper"], introHoldMs: 0 } as any,
  ```
- [ ] **Run, expect FAIL:** `pnpm --filter @channelers/brain test dispatcher` → the "does NOT auto-complete" test fails (paper still dwell-completes) and `groupStations` is not yet honored, so paper slots read offline.
- [ ] **Config green:** in `app/apps/brain/src/config.ts` empty `timed` and add `groupStations` (replace the Task 1 `timed` block):
  ```ts
    /** Kiosk-less group stations: always-online slots with no hardware binding. A member also
     *  listed in `timed` auto-completes on its dwell; otherwise it exits only by manual Done. */
    groupStations: ["paper"] as Station[],
    /** Optional per-station dwell auto-complete — kept generic for a future timed station; none now.
     *  Shape: { paper: { dwellMs: 300_000 } }. */
    timed: {} as Partial<Record<Station, { dwellMs: number }>>,
  ```
  Drop the now-unused `PAPER_DWELL_MS` env read.
- [ ] **Dispatcher green:** in `app/apps/brain/src/dispatcher.ts`:
  - After `dwellMs` (line 74) add:
    ```ts
    // A kiosk-less group station (e.g. `paper`): always-online slots with no hardware binding.
    // A group station also listed in `timed` auto-completes on its dwell; otherwise it exits
    // only by manual Done (markComplete). (rehearsal #17)
    const isGroup = (s: Station): boolean => (knobs.groupStations ?? []).includes(s);
    ```
  - Extend `isOnline` (line 86):
    ```ts
    const isOnline = (s: SlotState) => isGroup(s.station) || isTimed(s.station) || !!s.connId;
    ```
  - In `reconcile()`, immediately after the `if (isTimed(slot.station)) { … continue; }` block (ends line 361) and before the kiosk in-progress branch, add:
    ```ts
      // ── in_progress: kiosk-less group station with no dwell (paper) ──
      // Manual checkout only — exits via markComplete (Done). No auto-complete, no stale reap. (#17)
      if (isGroup(slot.station)) continue;
    ```
- [ ] **Run, expect PASS:** `pnpm --filter @channelers/brain test dispatcher` → the paper block is green.
- [ ] **Stage red:** in `app/apps/stage/src/routes/Station.test.tsx` update the two Done tests for the `onComplete`-based gate:
  ```tsx
  test("a paper in-progress occupant shows Done and fires onComplete", () => {
    const onComplete = vi.fn();
    const slot: Slot = {
      id: "paper-0", station: "paper", online: true,
      occupant: { visitorId: "v9", number: 9, phase: "in_progress", since: "" },
    };
    render(
      <StationOpsView
        station="paper" connected called={[]} inProgress={[slot]}
        busyId={null} onArrive={() => {}} onRelease={() => {}} onComplete={onComplete} />,
    );
    screen.getByRole("button", { name: /done/i }).click();
    expect(onComplete).toHaveBeenCalledWith("v9");
  });

  test("an in-progress occupant with no onComplete shows no Done button", () => {
    const slot: Slot = {
      id: "bodyscan-0", station: "bodyscan", online: true,
      occupant: { visitorId: "v1", number: 1, phase: "in_progress", since: "" },
    };
    render(
      <StationOpsView
        station="bodyscan" connected called={[]} inProgress={[slot]}
        busyId={null} onArrive={() => {}} onRelease={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /done/i })).toBeNull();
  });
  ```
- [ ] **Run, expect FAIL:** `pnpm --filter @channelers/stage test Station` → the paper Done test fails (Done is still gated on `dwellMs !== undefined`, and the fixture passes no `dwellMs`).
- [ ] **Stage green:** in `app/apps/stage/src/routes/Station.tsx`:
  - In `StationContainer`, make `onComplete` conditional (replace line 60), keeping `dwellMs` for the countdown label:
    ```tsx
        onComplete={
          station === "paper" || state?.timedDwellMs?.[station] !== undefined
            ? (id) => void run(id, () => api.dispatch.complete(id))
            : undefined
        }
    ```
  - In `StationOpsView`, change the in-progress Done/Release gate (line 137) from `dwellMs !== undefined` to `onComplete`:
    ```tsx
              {onComplete && (
                <>
                  <button className="submit" disabled={busyId === o.visitorId}
                    onClick={() => onComplete(o.visitorId)}>
                    Done
                  </button>
                  <button className="ghost" disabled={busyId === o.visitorId}
                    onClick={() => onRelease(o.visitorId)}>
                    Release
                  </button>
                </>
              )}
    ```
    (Leave the status label `{dwellMs ? "dwell running" : "in progress"}` as-is — paper now reads "in progress"; a future timed station still reads "dwell running".)
- [ ] **Run, expect PASS:** `pnpm --filter @channelers/stage test Station` → green.
- [ ] **Full verify:** `pnpm -r typecheck && pnpm --filter @channelers/brain test && pnpm --filter @channelers/stage test` → all green.
- [ ] **Docs:** update `docs/CHANGELOG.md` (new top entry: what/why/files/docs), flip #17 + #24 to 🟢 in `docs/rehearsal-punchlist.md` with a one-line resolution each, update the "Next up" pointer, and reconcile the `/station` + `/feed` route notes in `app/CLAUDE.md` (drop `waitingroom`; describe paper as a manual-checkout group station).
- [ ] **Commit:** `git add -A && git commit -m "feat(dispatch): paper is manual-checkout only; decouple group-station from dwell (rehearsal #17)"`

---

## Self-review notes
- **No placeholders:** every code step shows real code; every command step shows the command + expected pass/fail.
- **Type-flow checked:** `stationsOnline` and `timedDwellMs` are `Record<Station, …>`, so narrowing the enum updates them automatically — only the explicit `stationsOnline` object literal in `snapshot()` needs the dropped key. `surplus`'s `station: Station` narrows automatically.
- **`timed` kept generic:** `isTimed`/`dwellMs`/`timedDwellMs` and the `/dispatch` + `/station` countdowns all survive; `timed: {}` means they render nothing until a station opts in. No protocol change.
- **`completionMilestoneSet("paper")` is now dead** (paper takes the `isGroup` branch) but left in place — it's correct and harmless; `milestoneField("paper")` is still used by `markComplete`.
- **Board union is deduped** against both slots and queue, so an altar-ready visitor pinned as `pending` (still `location.state==="waiting"`) or queued for an open altar is listed once.
- **#18 boundary:** the `altarReadyList` visitors show as `WAITING ROOM` for now; #18 will later relabel that subset `ALTAR READY`. No conflict — same source list.
- **Scope honesty:** `/feed` (paper visitor screen) is button-driven with no dwell, so it needs no code change — only the CLAUDE.md prose that mislabels it.
