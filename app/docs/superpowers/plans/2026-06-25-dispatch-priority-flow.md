# Dispatch Priority Queue + Flow Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the scarce single bodyscan gate saturated, give the operator an altar open/close toggle, let a performer end a timed-station hourglass early, and surface bodyscan/altar-ready flow health on `/dispatch`.

**Architecture:** Approach A from the spec — a config-driven station **fill priority** so `fill()` serves bodyscan before the 2-wide intake and before the soaks; an in-memory `altarOpen` gate (default closed) with one endpoint + toggle; wire `/station`'s **Done** button to the existing `markComplete`/`POST /api/dispatch/complete`; and two derived `DispatchState` fields read by `/dispatch`. `select()` (random + anti-starvation) is unchanged.

**Tech Stack:** TypeScript monorepo (pnpm). Brain = Fastify + `ws`; Stage = Vite + React; shared zod/types in `packages/shared`. Tests = vitest (+ @testing-library/react for stage).

**Spec:** `app/docs/superpowers/specs/2026-06-25-dispatch-priority-and-flow-controls-design.md`

## Global Constraints

- **Altar-ready** ≡ `intakeAt && poseAt && !sessionEndAt`. `paper`/`waitingroom` are optional soaks, never altar prerequisites.
- **Batch-altar model:** the altar opens as a deferred event; the scheduler optimizes "keep bodyscan saturated," not a continuous altar drain.
- `dispatch.state` is **screens-only** — never add any of these fields to the OSC / `ShowEvent` contract.
- All runtime cwd is the monorepo root `app/`. Run `pnpm -r typecheck` before claiming a task done.
- Append the repo's standard `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer to every commit.
- YAGNI: no weighted scoring, no automatic time/all-ready altar open, no per-visitor variable dwell, no hard soak reservation.

## File Structure

- `apps/brain/src/config.ts` — add `fillPriority` knob (Task 1).
- `apps/brain/src/dispatcher.ts` — fill-order sort (T1); `altarOpen` + `setAltarOpen` + altar eligibility gate + interface (T2); flow-field derivation in `snapshot()` (T3).
- `packages/shared/src/protocol.ts` — `DispatchState.altarOpen` (T2); `altarReady`/`bodyscanIdle`/`bodyscanBlocked` (T3).
- `apps/brain/src/app.ts` — `POST /api/dispatch/altar` (T2).
- `apps/stage/src/lib/api.ts` — `dispatch.altar(open)` (T2).
- `apps/stage/src/routes/Dispatch.tsx` — exported `FlowStrip` component + render it (T4).
- `apps/stage/src/routes/Station.tsx` — `onComplete` prop + **Done**/**Release** on timed in-progress rows (T5).
- Tests: `apps/brain/test/dispatcher.test.ts` (T1–T3), `apps/stage/src/routes/Dispatch.test.tsx` (new, T4), `apps/stage/src/routes/Station.test.tsx` (T5).
- Docs: `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `app/CLAUDE.md` (T6).

---

### Task 1: Bodyscan-first fill priority

**Files:**
- Modify: `apps/brain/src/config.ts` (the `dispatcher` block)
- Modify: `apps/brain/src/dispatcher.ts:181-189` (`fill()`)
- Test: `apps/brain/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: existing `select(station)`, `isOnline(slot)`, `slots` map, `STATION_ORDER`, `knobs`.
- Produces: `knobs.fillPriority: Station[]`; `fill()` now assigns slots in `fillPriority` order. No new exported symbols.

- [ ] **Step 1: Write the failing tests**

Add to `apps/brain/test/dispatcher.test.ts` (uses the existing top-level `f`, `d`, `NUM`, `store`):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @channelers/brain test dispatcher`
Expected: FAIL — the single-visitor case pins to `intake` (intake is iterated before bodyscan today).

- [ ] **Step 3: Add the `fillPriority` knob**

In `apps/brain/src/config.ts`, add the import at the top (near the other imports):

```ts
import type { Station } from "@channelers/shared";
```

Inside the `dispatcher: { ... }` block, add (right after the `slots` field):

```ts
    /** Order fill() serves free slots in — scarce single gate (bodyscan) first, soaks last.
     *  Keeps the one bodyscan station from losing its only candidate to the 2-wide intake. */
    fillPriority: ["bodyscan", "intake", "altar", "paper", "waitingroom"] as Station[],
```

- [ ] **Step 4: Sort `fill()` by `fillPriority`**

Replace `fill()` in `apps/brain/src/dispatcher.ts` (currently lines 181-189) with:

```ts
  function fill(): void {
    const order = knobs.fillPriority ?? STATION_ORDER;
    const rank = (st: Station) => {
      const i = order.indexOf(st);
      return i === -1 ? order.length : i;
    };
    const ordered = [...slots.values()].sort((a, b) => rank(a.station) - rank(b.station));
    for (const slot of ordered) {
      if (!isOnline(slot) || slot.occupant) continue;
      const pick = select(slot.station);
      if (!pick) continue;
      slot.occupant = { visitorId: pick.id, number: pick.number, phase: "pending", since: nowIso() };
      if (knobs.autoConfirm) confirm(pick.id);
    }
  }
```

(Array `.sort()` is stable in Node, so slots within a station keep their original order.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @channelers/brain test dispatcher`
Expected: PASS (new describe green; all prior dispatcher tests still green).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm -r typecheck
git add apps/brain/src/config.ts apps/brain/src/dispatcher.ts apps/brain/test/dispatcher.test.ts
git commit -m "feat(dispatch): bodyscan-first fill priority"
```

---

### Task 2: Altar open/close gate

**Files:**
- Modify: `packages/shared/src/protocol.ts:109-124` (`DispatchState`)
- Modify: `apps/brain/src/dispatcher.ts` (interface ~28-40; eligibility ~88-97; new `setAltarOpen`; `snapshot()` return ~410-418; returned object ~437)
- Modify: `apps/brain/src/app.ts` (dispatch endpoints block ~180-214)
- Modify: `apps/stage/src/lib/api.ts` (the `dispatch` object ~36-44)
- Test: `apps/brain/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `eligibleStations(v)`, `snapshot()`, `kick()`, the `Dispatcher` interface, `broadcastState()`.
- Produces:
  - `DispatchState.altarOpen: boolean`
  - `Dispatcher.setAltarOpen(open: boolean): void`
  - `POST /api/dispatch/altar { open: boolean }` → `{ ok: true; altarOpen: boolean }`
  - `api.dispatch.altar(open: boolean): Promise<{ ok: boolean; altarOpen: boolean }>`

- [ ] **Step 1: Write the failing test**

Add to `apps/brain/test/dispatcher.test.ts`:

```ts
describe("altar gate", () => {
  it("does not dispatch to a closed altar; setAltarOpen opens it", () => {
    f.hello("altar", "ka", "ca"); // altar-0 online
    const v = store.register(NUM());
    store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] }); // intakeAt
    store.setPoseTemplate(v.id, { angles: [0], weights: [1] });          // poseAt
    store.setLocation(v.id, { state: "waiting", since: new Date().toISOString() });

    d.kick();
    expect(d.snapshot().altarOpen).toBe(false);
    expect(d.snapshot().slots.find((s) => s.station === "altar")?.occupant).toBeUndefined();

    d.setAltarOpen(true);
    expect(d.snapshot().altarOpen).toBe(true);
    expect(d.snapshot().slots.find((s) => s.station === "altar")?.occupant?.visitorId).toBe(v.id);
  });
});
```

(The default test dispatcher `d` has no paper/waitingroom slots, so a closed altar leaves this visitor undispatched.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @channelers/brain test dispatcher`
Expected: FAIL — `d.setAltarOpen` is not a function / `snapshot().altarOpen` is undefined.

- [ ] **Step 3: Add `altarOpen` to the protocol**

In `packages/shared/src/protocol.ts`, inside `DispatchState` (after the `noShowMs?` field, before the closing `}`):

```ts
  /** Operator gate: when false, no new visitor is dispatched to the altar (in-progress readings continue). */
  altarOpen: boolean;
```

- [ ] **Step 4: Implement the gate in the dispatcher**

In `apps/brain/src/dispatcher.ts`:

1. Add to the `Dispatcher` interface (near the other methods, ~line 33):

```ts
  setAltarOpen(open: boolean): void;
```

2. Add gate state near the other `let`/`const` engine state (e.g. just after `const noShowHoldUntil = ...`, ~line 59):

```ts
  let altarOpen = false; // operator gate; altar stays closed until /dispatch opens it
```

3. In `eligibleStations()`, replace the altar line (currently line 93):

```ts
    if (altarOpen && v.intakeAt && v.poseAt && !v.sessionEndAt) out.push("altar");
```

4. Add the setter (place it near `confirm`/`arrive`, ~line 200). `kick` is hoisted, so calling it here is fine:

```ts
  function setAltarOpen(open: boolean): void {
    altarOpen = open;
    kick(); // re-fill so a ready visitor is dispatched the moment the altar opens
  }
```

5. In `snapshot()`'s returned object (~line 410), add the field:

```ts
      altarOpen,
```

6. Add `setAltarOpen` to the returned object (the final `return { ... }`, ~line 437):

```ts
  return { confirm, arrive, assign, repool, markComplete, remove, checkin, clearFlags, setAltarOpen, snapshot, kick, stop };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @channelers/brain test dispatcher`
Expected: PASS.

- [ ] **Step 6: Add the HTTP endpoint**

In `apps/brain/src/app.ts`, after the `/api/dispatch/remove` handler (~line 213):

```ts
  const AltarBody = z.object({ open: z.boolean() });
  app.post("/api/dispatch/altar", async (req, reply) => {
    const parsed = AltarBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    dispatcher.setAltarOpen(parsed.data.open);
    return { ok: true, altarOpen: parsed.data.open };
  });
```

- [ ] **Step 7: Add the stage client method**

In `apps/stage/src/lib/api.ts`, inside the `dispatch: { ... }` object (after the `complete` line):

```ts
    altar: (open: boolean) =>
      post<{ ok: boolean; altarOpen: boolean }>("/api/dispatch/altar", { open }),
```

- [ ] **Step 8: Typecheck, run full suites, commit**

Run: `pnpm -r typecheck` (expected: 0 errors). Then `pnpm --filter @channelers/brain test` (expected: all green).

```bash
git add packages/shared/src/protocol.ts apps/brain/src/dispatcher.ts apps/brain/src/app.ts apps/stage/src/lib/api.ts apps/brain/test/dispatcher.test.ts
git commit -m "feat(dispatch): operator altar open/close gate"
```

---

### Task 3: Flow-health fields (altar-ready count + bodyscan idle/blocked)

**Files:**
- Modify: `packages/shared/src/protocol.ts` (`DispatchState`)
- Modify: `apps/brain/src/dispatcher.ts` (`snapshot()` ~399-419)
- Test: `apps/brain/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `store.list()`, `slotsOf("bodyscan")`, `isOnline`, `occupiedVisitorIds()`, `isHeld(v)`.
- Produces on `DispatchState`:
  - `altarReady: number`
  - `bodyscanIdle: boolean`
  - `bodyscanBlocked: "none" | "soaking" | "held" | "empty"`

- [ ] **Step 1: Write the failing tests**

Add to `apps/brain/test/dispatcher.test.ts`:

```ts
describe("flow-health snapshot fields", () => {
  it("counts altar-ready waiting visitors and reports bodyscan empty when no one needs a scan", () => {
    f.hello("bodyscan", "kb", "cb"); // online + idle
    let s = d.snapshot();
    expect(s.bodyscanIdle).toBe(true);
    expect(s.bodyscanBlocked).toBe("empty");
    expect(s.altarReady).toBe(0);

    const v = store.register(NUM());
    store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] });
    store.setPoseTemplate(v.id, { angles: [0], weights: [1] }); // posed → altar-ready
    store.setLocation(v.id, { state: "waiting", since: new Date().toISOString() });
    s = d.snapshot();
    expect(s.altarReady).toBe(1);
    expect(s.bodyscanBlocked).toBe("empty"); // posed person is not a bodyscan candidate
  });

  it("reports 'soaking' when the only unposed person is in a timed station while bodyscan is idle", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, {
      knobs: { slots: { intake: 0, bodyscan: 1, altar: 0, paper: 0, waitingroom: 1 },
               timed: { waitingroom: { dwellMs: 300_000 } }, introHoldMs: 0 } as any,
      autoStart: false,
    });
    f2.hello("bodyscan", "kb", "cb");        // bodyscan idle
    const v = store.register(NUM());
    d2.checkin(v.number, "waitingroom");     // unposed v forced in_progress @ waitingroom
    const s = d2.snapshot();
    expect(s.bodyscanIdle).toBe(true);
    expect(s.bodyscanBlocked).toBe("soaking");
    d2.stop();
  });

  it("reports 'held' when the only unposed candidate is on an intro hold", () => {
    const f2 = fakeBus();
    const d2 = createDispatcher(f2.bus, {
      knobs: { slots: { intake: 0, bodyscan: 1, altar: 0, paper: 0, waitingroom: 0 },
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @channelers/brain test dispatcher`
Expected: FAIL — `bodyscanIdle`/`bodyscanBlocked`/`altarReady` are undefined.

- [ ] **Step 3: Add the fields to the protocol**

In `packages/shared/src/protocol.ts`, inside `DispatchState` (after `altarOpen`):

```ts
  /** Waiting visitors who are altar-ready (intakeAt && poseAt && !sessionEndAt) — the operator's buffer gauge. */
  altarReady: number;
  /** True when ≥1 bodyscan slot is online with no occupant. */
  bodyscanIdle: boolean;
  /** When bodyscan is idle, why nothing is filling it (actionable when "soaking"/"held"). */
  bodyscanBlocked: "none" | "soaking" | "held" | "empty";
```

- [ ] **Step 4: Derive the fields in `snapshot()`**

In `apps/brain/src/dispatcher.ts`, add this helper just above `function snapshot()` (~line 399):

```ts
  function flowHealth(): { altarReady: number; bodyscanIdle: boolean; bodyscanBlocked: DispatchState["bodyscanBlocked"] } {
    const list = store.list();
    const altarReady = list.filter(
      (v) => v.location.state === "waiting" && v.intakeAt && v.poseAt && !v.sessionEndAt,
    ).length;
    const bodyscanIdle = slotsOf("bodyscan").some((s) => isOnline(s) && !s.occupant);
    let bodyscanBlocked: DispatchState["bodyscanBlocked"] = "none";
    if (bodyscanIdle) {
      const occupied = occupiedVisitorIds();
      const unposed = list.filter((v) => !v.poseAt);
      const available = unposed.some((v) => v.location.state === "waiting" && !isHeld(v) && !occupied.has(v.id));
      const soaking = unposed.some((v) => v.location.state === "in_progress");
      const held = unposed.some((v) => v.location.state === "waiting" && isHeld(v));
      bodyscanBlocked = available ? "none" : soaking ? "soaking" : held ? "held" : "empty";
    }
    return { altarReady, bodyscanIdle, bodyscanBlocked };
  }
```

Then in the `snapshot()` return object (~line 410-418), spread it in:

```ts
      ...flowHealth(),
```

(Place it alongside `altarOpen,` — order in an object literal doesn't matter.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @channelers/brain test dispatcher`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm -r typecheck
git add packages/shared/src/protocol.ts apps/brain/src/dispatcher.ts apps/brain/test/dispatcher.test.ts
git commit -m "feat(dispatch): altar-ready + bodyscan idle/blocked flow fields"
```

---

### Task 4: `/dispatch` flow strip (altar toggle + readouts)

**Files:**
- Modify: `apps/stage/src/routes/Dispatch.tsx` (add exported `FlowStrip`; render it)
- Modify: `apps/stage/src/styles.css` (minimal `.flow-strip` styling)
- Test: `apps/stage/src/routes/Dispatch.test.tsx` (new)

**Interfaces:**
- Consumes: `DispatchState.altarOpen/altarReady/bodyscanIdle/bodyscanBlocked`; `api.dispatch.altar`.
- Produces: `export function FlowStrip(props)` with props `{ altarOpen: boolean; altarReady: number; bodyscanIdle: boolean; bodyscanBlocked: "none"|"soaking"|"held"|"empty"; onToggleAltar: (open: boolean) => void }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/stage/src/routes/Dispatch.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FlowStrip } from "./Dispatch";

test("altar toggle shows CLOSED and fires onToggleAltar(true)", () => {
  const onToggle = vi.fn();
  render(
    <FlowStrip altarOpen={false} altarReady={3} bodyscanIdle={false}
      bodyscanBlocked="none" onToggleAltar={onToggle} />,
  );
  expect(screen.getByText(/altar-ready 3/i)).toBeInTheDocument();
  screen.getByRole("button", { name: /altar: closed/i }).click();
  expect(onToggle).toHaveBeenCalledWith(true);
});

test("flags bodyscan idle with its blocked reason", () => {
  render(
    <FlowStrip altarOpen altarReady={0} bodyscanIdle
      bodyscanBlocked="soaking" onToggleAltar={() => {}} />,
  );
  expect(screen.getByText(/bodyscan idle/i)).toBeInTheDocument();
  expect(screen.getByText(/soaking/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @channelers/stage test Dispatch`
Expected: FAIL — `FlowStrip` is not exported.

- [ ] **Step 3: Add the `FlowStrip` component**

In `apps/stage/src/routes/Dispatch.tsx`, add this exported component (e.g. just below the `elapsed` helper, ~line 9):

```tsx
const BLOCKED_MSG: Record<"none" | "soaking" | "held" | "empty", string> = {
  none: "",
  soaking: "candidates soaking",
  held: "candidates on hold",
  empty: "no one needs a scan",
};

export function FlowStrip({
  altarOpen, altarReady, bodyscanIdle, bodyscanBlocked, onToggleAltar,
}: {
  altarOpen: boolean;
  altarReady: number;
  bodyscanIdle: boolean;
  bodyscanBlocked: "none" | "soaking" | "held" | "empty";
  onToggleAltar: (open: boolean) => void;
}) {
  const warn = bodyscanIdle && bodyscanBlocked !== "none";
  return (
    <div className="flow-strip">
      <button className={altarOpen ? "submit" : "ghost"} onClick={() => onToggleAltar(!altarOpen)}>
        Altar: {altarOpen ? "OPEN" : "CLOSED"}
      </button>
      <span className="flow-stat">altar-ready {altarReady}</span>
      <span className={`flow-stat${warn ? " warn" : ""}`}>
        bodyscan {bodyscanIdle ? "idle" : "busy"}
        {warn ? ` · ${BLOCKED_MSG[bodyscanBlocked]}` : ""}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Render it inside `Dispatch`**

In `Dispatch.tsx`, just after the surplus `<p className="error">` block and before `<div className="zones">` (~line 58):

```tsx
      <FlowStrip
        altarOpen={state.altarOpen}
        altarReady={state.altarReady}
        bodyscanIdle={state.bodyscanIdle}
        bodyscanBlocked={state.bodyscanBlocked}
        onToggleAltar={(open) => void api.dispatch.altar(open)}
      />
```

- [ ] **Step 5: Add minimal styling**

In `apps/stage/src/styles.css`, append:

```css
.flow-strip { display: flex; gap: 1rem; align-items: center; padding: 0.4rem 0; }
.flow-strip .flow-stat { font-size: 0.85rem; opacity: 0.8; }
.flow-strip .flow-stat.warn { color: #e8a33d; opacity: 1; font-weight: 600; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @channelers/stage test Dispatch`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm -r typecheck
git add apps/stage/src/routes/Dispatch.tsx apps/stage/src/routes/Dispatch.test.tsx apps/stage/src/styles.css
git commit -m "feat(stage): /dispatch flow strip — altar toggle + bodyscan/ready readouts"
```

---

### Task 5: `/station` early-complete (Done) for timed stations

**Files:**
- Modify: `apps/stage/src/routes/Station.tsx` (`StationContainer` ~48-62; `StationOpsView` props ~65-78 + in-progress rows ~114-122)
- Test: `apps/stage/src/routes/Station.test.tsx`

**Interfaces:**
- Consumes: `api.dispatch.complete(visitorId)` (already exists); the `dwellMs` prop (present only for timed stations).
- Produces: `StationOpsView` gains an optional `onComplete?: (visitorId: string) => void` prop; timed in-progress rows render **Done** (→ complete) and **Release** (→ repool).

- [ ] **Step 1: Write the failing tests**

Add to `apps/stage/src/routes/Station.test.tsx`:

```tsx
test("a timed in-progress occupant shows Done and fires onComplete", () => {
  const onComplete = vi.fn();
  const slot: Slot = {
    id: "waitingroom-0", station: "waitingroom", online: true,
    occupant: { visitorId: "v9", number: 9, phase: "in_progress", since: "" },
  };
  render(
    <StationOpsView
      station="waitingroom" connected called={[]} inProgress={[slot]}
      dwellMs={300_000} busyId={null}
      onArrive={() => {}} onRelease={() => {}} onComplete={onComplete} />,
  );
  screen.getByRole("button", { name: /done/i }).click();
  expect(onComplete).toHaveBeenCalledWith("v9");
});

test("a non-timed in-progress occupant shows no Done button", () => {
  const slot: Slot = {
    id: "bodyscan-0", station: "bodyscan", online: true,
    occupant: { visitorId: "v1", number: 1, phase: "in_progress", since: "" },
  };
  render(
    <StationOpsView
      station="bodyscan" connected called={[]} inProgress={[slot]}
      busyId={null} onArrive={() => {}} onRelease={() => {}} onComplete={() => {}} />,
  );
  expect(screen.queryByRole("button", { name: /done/i })).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @channelers/stage test Station`
Expected: FAIL — no **Done** button rendered; `onComplete` prop unknown.

- [ ] **Step 3: Add the `onComplete` prop and the Done/Release buttons**

In `apps/stage/src/routes/Station.tsx`, add `onComplete` to the `StationOpsView` prop list (the destructure ~line 66 and the type ~line 77):

```tsx
  station, connected, called, inProgress, dwellMs, noShowMs, now, busyId, onArrive, onRelease, onComplete,
```

```tsx
  onRelease: (visitorId: string) => void;
  onComplete?: (visitorId: string) => void;
```

Replace the in-progress row body (currently lines 116-121) with:

```tsx
          return (
            <div key={s.id} className="ops-row">
              <span className="ops-num">#{o.number}</span>
              <span className="dim">{dwellMs ? "dwell running" : "in progress"}</span>
              {dwellMs !== undefined && (
                <>
                  <button className="submit" disabled={busyId === o.visitorId}
                    onClick={() => onComplete?.(o.visitorId)}>
                    Done
                  </button>
                  <button className="ghost" disabled={busyId === o.visitorId}
                    onClick={() => onRelease(o.visitorId)}>
                    Release
                  </button>
                </>
              )}
            </div>
          );
```

- [ ] **Step 4: Wire the container to the existing endpoint**

In `StationContainer`'s `<StationOpsView ... />` (after the `onRelease` line ~59):

```tsx
      onComplete={(id) => void run(id, () => api.dispatch.complete(id))}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @channelers/stage test Station`
Expected: PASS (existing Station tests still green — `onComplete` is optional).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm -r typecheck
git add apps/stage/src/routes/Station.tsx apps/stage/src/routes/Station.test.tsx
git commit -m "feat(stage): /station Done button — early-complete timed stations"
```

---

### Task 6: Docs reconciliation

**Files:**
- Modify: `docs/CHANGELOG.md` (new entry on top)
- Modify: `docs/ARCHITECTURE.md` (§5.x dispatcher knobs + the `dispatch.state` transport shape in §5.x/§10)
- Modify: `app/CLAUDE.md` (only if a route/convention line actually changed)

- [ ] **Step 1: Add the CHANGELOG entry**

Prepend a `## 2026-06-25 — Dispatch priority queue + flow controls` entry to `docs/CHANGELOG.md` following the house format (What / Why / Files-areas / Docs-touched): bodyscan-first `fillPriority`; `altarOpen` gate + `/api/dispatch/altar` + `/dispatch` toggle; `/station` **Done** early-complete (waiting-room dead-time); `altarReady`/`bodyscanIdle`/`bodyscanBlocked` snapshot fields + `/dispatch` flow strip. Note the batch-altar model + altar-ready = intake+pose. Cite the spec and this plan.

- [ ] **Step 2: Update ARCHITECTURE.md**

Add `fillPriority` to the dispatcher knobs note (§5.x), and add `altarOpen`, `altarReady`, `bodyscanIdle`, `bodyscanBlocked` to the documented `dispatch.state` / `DispatchState` shape (the §5.x transport bullet and the §10 line). Keep it screens-only (state explicitly it stays off the OSC contract).

- [ ] **Step 3: Update app/CLAUDE.md if needed**

Only if a route/convention line is now inaccurate (e.g. note the `/station` Done early-complete and the `/dispatch` altar toggle). Skip otherwise.

- [ ] **Step 4: Commit**

```bash
git add docs/CHANGELOG.md docs/ARCHITECTURE.md app/CLAUDE.md
git commit -m "docs: record dispatch priority queue + flow controls"
```

---

## Final Verification

- [ ] `pnpm -r typecheck` — 0 errors.
- [ ] `pnpm --filter @channelers/brain test` — all green (new fill-priority, altar-gate, flow-field tests included).
- [ ] `pnpm --filter @channelers/stage test` — all green (new Dispatch + Station tests included).
- [ ] Manual smoke (not unit-testable): on `/dispatch`, toggle **Altar: CLOSED → OPEN** and confirm a ready visitor gets called to the altar only when open; on `/station/waitingroom`, **Done** frees the slot immediately (recovers the hourglass dead-time); with one waiting person and both intake+bodyscan free, the person is called to **bodyscan**.

## Self-Review (completed during planning)

- **Spec coverage:** §3.1 fill priority → T1; §3.2 altar gate → T2; §3.3 early-complete → T5; §3.4 visibility (altarReady + bodyscan idle/blocked) → T3 (data) + T4 (UI); §4 protocol → T2/T3; §5 knob → T1; §7 tests → embedded per task; docs → T6. No gaps.
- **Placeholder scan:** none — every code/step shows real content and exact commands.
- **Type consistency:** `setAltarOpen(open: boolean): void`, `bodyscanBlocked: "none"|"soaking"|"held"|"empty"`, and `FlowStrip`/`StationOpsView` prop names match across tasks and the protocol additions.
