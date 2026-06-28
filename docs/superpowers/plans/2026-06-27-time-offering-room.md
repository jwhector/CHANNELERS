# Time Offering room — re-add the waiting room as a timed `offering` station

**Goal:** Re-add a held "time offering" room as a real dispatched station with a timed auto-release **and** a manual early release, built on the kept generic dwell machinery.

**Approach:** Add a new `offering` station to the contract and list it in `config.dispatcher.timed` — that one move makes it always-online (`isOnline` already ORs `isTimed`) and dwell-completing (`reconcile`'s timed branch), while manual `Done` → `markComplete` releases early. No new dispatcher logic. Rename the `/board` lobby-overflow label from `WAITING ROOM` → `WAITING` so it doesn't collide with the new `TIME OFFERING` station.

**Tech stack:** TypeScript monorepo (pnpm). Brain: Fastify dispatcher + zod shared contract. Stage: Vite/React routes. Vitest. No new dependencies.

---

## Why / design

### Problem
#24 retired `waitingroom` as a station and made it a board-derived overflow label, on the read that it was "an overflow holding space, not a station." Direction has changed: we want it back as the **"time offering" room** — a place a visitor is held for a fixed duration (offers their time), with a **timed release** when the duration elapses and a **manual early release** if a performer needs to let them out sooner.

### The fit (why this is small)
The architecture from #17/#24 already provides everything:
- A station listed in `config.dispatcher.timed` is **always-online** — `isOnline = isGroup(s) || isTimed(s) || !!connId` ([dispatcher.ts:88](../../../app/apps/brain/src/dispatcher.ts#L88)).
- It **dwell-completes** — `reconcile()`'s timed branch stamps the milestone and frees the slot once `dwellMs` elapses from arrival ([dispatcher.ts:346-360](../../../app/apps/brain/src/dispatcher.ts#L346)).
- It **releases early** — `markComplete()` (the `/station` **Done** button → `POST /api/dispatch/complete`) stamps the milestone and frees the slot immediately, independent of the timer.
- The `/station` Done affordance already shows for any timed station (`onComplete` is wired when `timedDwellMs[station]` is set), and `/dispatch` already renders the dwell countdown.

So "timed + manual-early" needs **no new logic** — `offering` just joins `timed`. `groupStations` stays `["paper"]` (paper = manual-only; offering = timed + manual-early).

### Scope
- **In scope:** a new `offering` station (contract, config, dispatcher, `/station` admit + Done), and the `/board` overflow label rename.
- **Out of scope:** `protocol.ts` (the `Station` widening flows through `Record<Station, …>`); `groupStations` (untouched); any change to `paper`; an `offering` own-screen (it's performer-confirmed at `/station/offering`, no spectacle screen — like the old waiting room); the physical hourglass (a stage prop).

### Decisions (from the direction-change conversation)
- **New id `offering`** + milestone `offeringAt` + label `"STATION A - TIME OFFERING"` (reclaims the old A wayfinding slot; sibling-consistent with `STATION B - TYPEWRITER`). Not a reuse of `waitingroom`.
- **Distinct dispatched station** with real slots (capacity **5**), non-gating, do-it-once (`!offeringAt`), placed **last** in `fillPriority` (a soak; tunable in rehearsal).
- **Timed release** default **5 min** (`OFFERING_DWELL_MS`, default `300_000`); **manual early release** via Done = `markComplete` (stamps `offeringAt`, frees — counts as completing the offering, not a re-queue).
- **Board:** rename the lobby-overflow fallback `WAITING ROOM` → `WAITING`. An `offering` occupant is in a slot, so it shows as `STATION A - TIME OFFERING` via the slot path; `WAITING`/`ON HOLD`/`ALTAR READY` remain the no-slot labels.

### Decision log
- Re-add as a **new `offering` id**, not the retired `waitingroom` id — clean semantics matching the new name (user choice).
- **`timed`-only, not `groupStations`** — being timed already yields always-online + auto-complete; adding to `groupStations` would be redundant (the group branch is "manual-only, no auto", but the timed branch runs first anyway).
- **Capacity 5 / dwell 5 min** baked as defaults (user), dwell env-overridable.
- **Rename overflow → `WAITING`** so the board's lobby-overflow label doesn't read the same as the real room (user choice).

---

## Global constraints
- **Verification (run from `app/`):** `pnpm -r typecheck`, `pnpm --filter @channelers/brain test`, `pnpm --filter @channelers/stage test`. All green at the end of each task.
- **Commit per task.**
- **Label copy:** station label exactly `STATION A - TIME OFFERING`; board overflow label exactly `WAITING` (uppercase, matching `ON HOLD`/`ALTAR READY`/`DONE` tone styling).
- **Station set after this work:** `Station = ["intake","bodyscan","altar","paper","offering"]`.
- **No OpenAI/OSC paths touched.**
- Per the punchlist handoff checklist: `docs/CHANGELOG.md` entry; flip the relevant punchlist line + Session log + Next up; reconcile `app/CLAUDE.md` (`/station` + `/feed` notes) and `docs/ARCHITECTURE.md` (§3 route map, §5 selection/fillPriority/knobs table, §5.7 — the `waitingroom`-retired note becomes the `offering` timed-station description).

---

## File structure

### Task 1 — Add the `offering` timed station
| File | Change |
|------|--------|
| `app/packages/shared/src/schemas.ts` | `Station` += `"offering"`; `STATION_LABEL.offering`; `VisitorProfile.offeringAt`. |
| `app/apps/brain/src/store.ts` | `stampMilestone` field union += `"offeringAt"`. |
| `app/apps/brain/src/config.ts` | `slots.offering = 5`; `fillPriority` += `"offering"`; `timed.offering = { dwellMs }`. |
| `app/apps/brain/src/dispatcher.ts` | Add `offering` to `STATION_ORDER`, `eligibleStations`, `milestoneField` (+ return type), `completionMilestoneSet`, `stationsOnline` literal. |
| `app/apps/stage/src/routes/Station.tsx` | `PERFORMER_STATIONS` += `"offering"`. |
| `app/.env.example` | Add `OFFERING_DWELL_MS`; re-document the dwell knob. |
| `app/apps/brain/test/dispatcher.test.ts` | Add the `offering` describe block; add `offering: false` to the `stationsOnline` expectation. |
| `app/apps/brain/test/schema.test.ts` | Enum test asserts `offering` valid; add an `offeringAt`/`offering`-location parse test. |
| `app/apps/brain/test/store.test.ts` | Add an `offering station milestone` describe. |
| `app/apps/stage/src/routes/Station.test.tsx` | Add an `offering` Done-button test. |

### Task 2 — Board overflow label rename
| File | Change |
|------|--------|
| `app/apps/stage/src/routes/Board.tsx` | `boardRows` overflow fallback `"WAITING ROOM"` → `"WAITING"`. |
| `app/apps/stage/src/routes/Board.test.tsx` | Update the one case asserting `"WAITING ROOM"` → `"WAITING"`. |

---

## Tasks

> Each step is one action; code steps show exact code, command steps show the command + expected result. Run all commands from `app/`.

### Task 1 — Add the `offering` timed station

**Files:** the Task 1 table above.
**Interfaces — Produces:** `Station` += `"offering"`; `VisitorProfile.offeringAt`; `config.dispatcher.timed.offering.dwellMs`; `STATION_LABEL.offering = "STATION A - TIME OFFERING"`.
**Interfaces — Consumes:** existing `isTimed`/`dwellMs`/`reconcile` timed branch, `markComplete`, `timedDwellMs` snapshot loop.

- [ ] **Dispatcher red:** in `app/apps/brain/test/dispatcher.test.ts`, add a new describe block (after the `paper` block) covering timed release + manual early release. (`offering` isn't in the `Station` enum yet, so this fails to typecheck/run until the contract is added.)
  ```ts
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
  ```
  Also add `offering: false` to the `stationsOnline` expectation in the "slot derivation" test (line 52):
  ```ts
  expect(s.stationsOnline).toEqual({ intake: false, bodyscan: false, altar: false, paper: false, offering: false });
  ```
- [ ] **Run, expect FAIL:** `pnpm --filter @channelers/brain test dispatcher` → fails (`"offering"` not in `Station`; `stationsOnline.offering` missing).
- [ ] **Contract:** in `app/packages/shared/src/schemas.ts`:
  ```ts
  /** The dispatchable stations (spec §4). `paper` is a kiosk-less manual group station;
   *  `offering` is the timed "time offering" room (dwell release + manual early release). */
  export const Station = z.enum(["intake", "bodyscan", "altar", "paper", "offering"]);
  ```
  ```ts
  export const STATION_LABEL: Record<Station, string> = {
    intake: "STATION D - INTAKE",
    bodyscan: "STATION C - BODY SCAN",
    altar: "ALTAR",
    paper: "STATION B - TYPEWRITER",
    offering: "STATION A - TIME OFFERING",
  };
  ```
  In `VisitorProfile`, after the `paperAt` field:
  ```ts
    /** Timed "time offering" room: stamped on dwell expiry OR manual early Done at /station/offering. */
    offeringAt: z.string().optional(),
  ```
- [ ] **Store union:** in `app/apps/brain/src/store.ts`, add `"offeringAt"` to the `stampMilestone` field union:
  ```ts
      field:
        | "intakeAt" | "poseAt" | "personaAt" | "paperAt" | "offeringAt"
        | "poseVerifiedAt" | "sessionStartAt" | "sessionEndAt",
  ```
- [ ] **Config:** in `app/apps/brain/src/config.ts`:
  ```ts
    slots: { intake: 2, bodyscan: 1, altar: 1, paper: 3, offering: 5 } as Record<Station, number>,
  ```
  ```ts
    fillPriority: ["bodyscan", "intake", "altar", "paper", "offering"] as Station[],
  ```
  ```ts
    /** Optional per-station dwell auto-complete. `offering` (the timed "time offering" room) uses it
     *  for its timed release; a performer can still Done it early via markComplete. */
    timed: {
      offering: { dwellMs: Number(process.env.OFFERING_DWELL_MS ?? 300_000) },
    } as Partial<Record<Station, { dwellMs: number }>>,
  ```
  (`groupStations: ["paper"]` is unchanged.)
- [ ] **Dispatcher:** in `app/apps/brain/src/dispatcher.ts`:
  - `STATION_ORDER` (line 9):
    ```ts
    const STATION_ORDER: Station[] = ["intake", "bodyscan", "altar", "paper", "offering"];
    ```
  - `eligibleStations` — add after the `paper` push (line 101):
    ```ts
    if (!v.offeringAt) out.push("offering"); // non-gating timed room (do-it-once)
    ```
  - `milestoneField` (lines 302-307) — add the branch and widen the return type:
    ```ts
    function milestoneField(station: Station): "intakeAt" | "poseAt" | "paperAt" | "offeringAt" | "sessionEndAt" {
      if (station === "intake") return "intakeAt";
      if (station === "bodyscan") return "poseAt";
      if (station === "paper") return "paperAt";
      if (station === "offering") return "offeringAt";
      return "sessionEndAt"; // altar held through the reading
    }
    ```
  - `completionMilestoneSet` (lines 309-314) — add the branch (defensive parity; the timed branch completes offering before this is consulted):
    ```ts
      if (station === "paper") return !!v.paperAt;
      if (station === "offering") return !!v.offeringAt;
      return !!v.sessionEndAt; // altar held through the reading
    ```
  - `stationsOnline` snapshot literal (lines 454-459) — add the key:
    ```ts
        paper: slotsOf("paper").some(isOnline),
        offering: slotsOf("offering").some(isOnline),
      };
    ```
- [ ] **Run, expect PASS:** `pnpm --filter @channelers/brain test dispatcher` → the offering block + the stationsOnline test are green.
- [ ] **Schema test:** in `app/apps/brain/test/schema.test.ts`, extend the enum test (after the `waitingroom` line) and add a parse test:
  ```ts
    expect(Station.safeParse("offering").success).toBe(true);
  ```
  ```ts
    it("retains offeringAt + an offering location (timed time-offering room)", () => {
      const ts = "2026-06-27T00:00:00.000Z";
      const r = VisitorProfile.parse({
        id: "u1", number: 42, scans: [],
        location: { state: "in_progress", station: "offering", since: ts },
        createdAt: ts, offeringAt: ts,
      });
      expect(r.offeringAt).toBe(ts);
      expect(r.location.station).toBe("offering");
    });
  ```
- [ ] **Store test:** in `app/apps/brain/test/store.test.ts`, add after the `paper station milestone` block:
  ```ts
  describe("offering station milestone", () => {
    it("stamps offeringAt via stampMilestone", () => {
      store.clear();
      const v = store.register(790001);
      expect(v.offeringAt).toBeUndefined();
      store.stampMilestone(v.id, "offeringAt");
      expect(store.get(v.id)?.offeringAt).toBeTruthy();
    });
  });
  ```
- [ ] **Stage red:** in `app/apps/stage/src/routes/Station.test.tsx`, add a test that the offering room shows Done (manual early release through the UI):
  ```tsx
  test("an offering in-progress occupant shows Done (manual early release)", () => {
    const onComplete = vi.fn();
    const slot: Slot = {
      id: "offering-0", station: "offering", online: true,
      occupant: { visitorId: "v7", number: 7, phase: "in_progress", since: "" },
    };
    render(
      <StationOpsView
        station="offering" connected called={[]} inProgress={[slot]}
        dwellMs={300_000} busyId={null}
        onArrive={() => {}} onRelease={() => {}} onComplete={onComplete} />,
    );
    screen.getByRole("button", { name: /done/i }).click();
    expect(onComplete).toHaveBeenCalledWith("v7");
  });
  ```
- [ ] **Run, expect FAIL:** `pnpm --filter @channelers/stage test Station` → the new test fails (`station="offering"` isn't an accepted value yet — it compiles only once `Station` includes `offering`, which it now does from the brain build; if the stage picks up the shared types it passes the type check but the component already supports it, so the failure is the missing `offering` in `PERFORMER_STATIONS` only matters for routing, not this presentational test). Expected failure mode: the test fails to find the Done button **only if** the gate regressed — here it should already pass once types resolve. If it passes immediately, that's acceptable (the presentational view is station-agnostic); proceed.
- [ ] **Stage green:** in `app/apps/stage/src/routes/Station.tsx`, add `offering` to the performer picker so arrival-confirm + Done are reachable at `/station/offering`:
  ```tsx
  const PERFORMER_STATIONS: StationName[] = ["bodyscan", "paper", "offering"];
  ```
- [ ] **Run, expect PASS:** `pnpm --filter @channelers/stage test Station` → green.
- [ ] **Env doc:** in `app/.env.example`, replace the paper/dwell comment block with:
  ```
  # Paper (Scan/Shred/Feed) is a kiosk-less group station with MANUAL checkout — a performer taps Done
  # at /station/paper; no dwell timer (rehearsal #17). The "time offering" room (offering) is a timed
  # station: it auto-releases after OFFERING_DWELL_MS, and a performer can release early via Done at
  # /station/offering. Group capacities: config.dispatcher.slots.{paper:3, offering:5}.
  OFFERING_DWELL_MS=300000
  ```
- [ ] **Full verify:** `pnpm -r typecheck && pnpm --filter @channelers/brain test && pnpm --filter @channelers/stage test` → all green.
- [ ] **Commit:** `git add -A && git commit -m "feat(dispatch): add the time-offering room (offering) — timed release + manual early release"`

### Task 2 — Board overflow label rename (`WAITING ROOM` → `WAITING`)

**Files:** `app/apps/stage/src/routes/Board.tsx`, `app/apps/stage/src/routes/Board.test.tsx`.
**Interfaces — Consumes:** `boardRows(state)`.

- [ ] **Board red:** in `app/apps/stage/src/routes/Board.test.tsx`, update the plain-waiting case (rename + new expectation):
  ```tsx
    it("labels a plain waiting visitor WAITING (lobby overflow)", () => {
      const rows = boardRows({ ...base, queue: [{ id: "a", number: 12, eligible: ["intake"], waitingSince: "", flags: [] }] });
      expect(rows.find((r) => r.id === "a")?.loc).toBe("WAITING");
    });
  ```
- [ ] **Run, expect FAIL:** `pnpm --filter @channelers/stage test Board` → fails (still returns `"WAITING ROOM"`).
- [ ] **Board green:** in `app/apps/stage/src/routes/Board.tsx`, change the `fromQueue` fallback label and refresh the doc-comment:
  ```tsx
  /** Pure roster derivation — every visitor and where they are. A waiting visitor not at a station is
   *  lobby overflow ("WAITING", or "ON HOLD" while held); one who has cleared the pre-altar stations is
   *  "ALTAR READY" (#18), except held → "ON HOLD" wins. (The real held room shows STATION A - TIME OFFERING
   *  via its slot.) */
  export function boardRows(state: DispatchState | null): Row[] {
  ```
  ```tsx
    const fromQueue: Row[] = (state?.queue ?? []).map((q) => ({
      id: q.id,
      number: q.number,
      loc: (q.heldUntil ?? q.holdReason) ? "ON HOLD" : altarReadyIds.has(q.id) ? "ALTAR READY" : "WAITING",
      tone: "wait",
    }));
  ```
- [ ] **Run, expect PASS:** `pnpm --filter @channelers/stage test Board` → green (the other #18 cases — `ALTAR READY`, `ON HOLD`, dedup — are unaffected).
- [ ] **Full verify:** `pnpm -r typecheck && pnpm --filter @channelers/stage test` → green.
- [ ] **Docs:** `docs/CHANGELOG.md` (new top entry); `docs/rehearsal-punchlist.md` (add the time-offering line under Stream A + a Session log entry + Next up); `app/CLAUDE.md` (`/station` picker now `bodyscan/paper/offering`; `/feed` note: `offering` is the timed room, `/station/offering`, no own screen); `docs/ARCHITECTURE.md` (§3 route map — add `offering`/`/station/offering`, replace the "waitingroom retired" line with the offering description; §5 selection eligibility `+ offering ← !offeringAt`; `fillPriority` default + knobs table; §5.7 — re-add a "timed station — `offering`" bullet describing dwell release + manual early release, superseding the #24 retirement note). Note that the `/board` overflow label is now `WAITING` (the real room shows `STATION A - TIME OFFERING`).
- [ ] **Commit:** `git add -A && git commit -m "feat(board): rename lobby-overflow label to WAITING; docs for the time-offering room"`

---

## Self-review notes
- **No placeholders:** every step shows real code or a real command + expectation.
- **Type-flow checked:** `stationsOnline: Record<Station, boolean>` and `timedDwellMs?: Partial<Record<Station, number>>` widen automatically with the enum; only the explicit `stationsOnline` object literal in `snapshot()` needs the new key. `slots: Record<Station, number>` **forces** an `offering` entry — covered. `milestoneField`'s return type is widened in lockstep with `store.stampMilestone`'s union so the `stampMilestone(id, milestoneField(station))` call site stays well-typed.
- **`timed`-only, not `groupStations`:** offering is online via `isTimed` and auto-completes via the timed branch; `markComplete` gives the early release. `groupStations` stays `["paper"]`.
- **Board distinguishes the two:** an `offering` occupant is in a slot → `STATION A - TIME OFFERING` (slot path); only truly-unplaced waiting visitors get `WAITING`/`ON HOLD`/`ALTAR READY`.
- **Do-it-once:** eligibility `!offeringAt`; after a timed or manual completion `offeringAt` is set, so they aren't re-dispatched to the room.
- **fillPriority last:** offering is the lowest-priority fill (a soak), so it never steals a candidate from a real gate; capacity 5, dwell 5 min, both tunable.
- **Stage "red" caveat:** the new `Station.test.tsx` case may pass as soon as the shared `Station` type includes `offering` (the presentational view is station-agnostic); that's acceptable — the meaningful change is adding `offering` to `PERFORMER_STATIONS` for routing. The hard red→green anchors are the dispatcher's timed/manual tests and the board label test.
