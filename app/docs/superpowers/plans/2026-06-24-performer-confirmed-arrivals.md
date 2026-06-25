# Performer-confirmed arrivals + timed-station arrival lifecycle

**Goal:** Make every non-intake station require a performer to manually confirm each participant's arrival, and gate timed-station dwell timers on that confirmed arrival.

**Approach:** The dispatcher's phase machine (`pending → called → in_progress`) and its `arrive()` function already model arrival; this change (a) extends the *timed*-station branch of `reconcile()` to flow through `arrive()` — dwell now starts at arrival, with no-show on `called` — (b) adds a passive, parameterized performer view (`/station/:station`) that calls the existing `arrive()`/`repool()` endpoints, and (c) flips bodyscan/altar kiosks to a performer-driven standby. Intake (visitor self-confirms) is untouched.

**Tech stack:** TypeScript monorepo (pnpm). Brain = Fastify + `ws` (`apps/brain`); Stage = Vite/React + react-router (`apps/stage`); contracts in `packages/shared`. Tests = vitest (+ Testing Library/jsdom for stage).

---

## Why / design

### Problem
Today arrival is confirmed by the **visitor** at the kiosk (`CalledGate` → `POST /api/dispatch/arrive`) for intake, bodyscan, and altar. Timed group stations (`paper`/`/feed`) have **no arrival step at all**: `reconcile()` starts the dwell timer at `called` and completes purely on elapsed time. That carries a latent bug — a participant called to `/feed` who never physically shows up still runs their dwell from the call moment and gets stamped `paperAt` (a **false completion**).

The new performance design requires a **performer manning each station** to confirm arrivals, so that:
- arrival is a deliberate human act, not a self-serve tap or a silent timer;
- the timed dwell only runs for people actually present;
- called-but-absent participants are caught (no-show), not falsely completed.

Intake stays the exception: it is a fully digital station where the participant self-confirms (already implemented via the CRT `CalledGate`).

### Scope
**In:** timed-station lifecycle rewrite (no-show on `called`, dwell from arrival, stale backstop); `autoArrive` knob; surface occupant flags + `noShowMs` in the snapshot; a unified per-station performer view (`/station/:station`); bodyscan/altar kiosk standby.
**Out (YAGNI):** bespoke per-station performer screens; any change to `/feed` itself; new WS message kinds; a manual "complete" button (kiosk completion stays milestone-driven, altar stays `sessionEndAt` via `/channel`); live dwell countdown on the performer view (shows a static "dwell running" — a countdown can be added later).

### Approaches considered
1. **Unified parameterized performer view (chosen).** One `/station/:station` component every performer opens, scoped to their station, reusing `arrive()`/`repool()`. Least surface; "confirm arrival" is one call, so it can later be grafted into a bespoke screen (e.g. `/channel`) without rework.
2. **Fold into `/dispatch`.** One central operator confirms all arrivals. Rejected — contradicts "the performer manning that station"; centralizes a deliberately distributed act.
3. **Bespoke per-station screens.** Tailored confirm UI per station. Rejected for the MVP — 3× the surface, pays off only with station-specific tooling beyond admitting people.

### Decision log
- **`arrive()` is unchanged.** It already does `called → in_progress` and resets `occupant.since`; the timed dwell naturally measures from arrival once timed occupants flow through it.
- **No-show now applies to every station, timed included.** The single `called` branch in `reconcile()` handles no-show uniformly; the timed special-case that bypassed it is removed.
- **Stale-for-timed is a misconfiguration backstop only.** A finite dwell always completes `in_progress` first and is never preempted. Stale reaps a timed occupant **only when the station has no finite dwell** (`!Number.isFinite(dwell)`), i.e. a `timed` entry missing `dwellMs`. This faithfully delivers "include no-show/stale for timed" without a foot-gun. (Refines the design sketch's `max(staleMs, dwellMs)`, which could not actually catch an `Infinity` dwell.)
- **Performer view is passive.** It does **not** send `station.hello`, so it never claims a slot or disturbs kiosk binding; it only reads `dispatch.state` and POSTs `arrive`/`repool`.
- **Participant identity stays number-based on the performer view** (matches `/board` and `CalledGate`), so no `name` field is added to `SlotOccupant`.
- **`autoArrive` knob** (default off) mirrors `autoConfirm` so `pnpm dev`/stub runs flow hands-free.

---

## Global constraints

Copy these verbatim into every task; they are implicit in all of them.

- **TypeScript throughout.** No new runtime deps.
- **Loose coupling.** Screen-only streams (dispatch state) stay off the OSC contract — this change touches only `dispatch.state` over WS and the existing HTTP dispatch endpoints. No OSC.
- **Brain tests run offline by design.** `apps/brain/test/setup.ts` forces `OPENAI_API_KEY=""`; do not add keyed paths.
- **Verification commands** (run before claiming a task done):
  - `pnpm --filter @channelers/brain test`
  - `pnpm --filter @channelers/stage test`
  - `pnpm -r typecheck`
- **Commit per task** with a `feat(dispatch):`/`feat(stage):`/`test:`/`docs:` style message, ending with the repo's `Co-Authored-By` trailer.
- **Existing knob defaults** (do not change): `noShowMs` 90_000, `staleMs` 300_000, `paper` `dwellMs` 300_000, `noShowAutoRepool` false, `autoConfirm` false.

---

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/shared/src/protocol.ts` | Modify | Add `SlotOccupant.flags?: DispatchFlag[]` and `DispatchState.noShowMs?: number`. |
| `apps/brain/src/config.ts` | Modify | Add the `autoArrive` dispatcher knob. |
| `apps/brain/src/dispatcher.ts` | Modify | Rewrite the `reconcile()` per-slot loop (no-show on every `called`; dwell-from-arrival for timed; stale backstop); add the `autoArrive` block; surface occupant `flags` in `toSlot()`; add `noShowMs` to `snapshot()`. |
| `apps/brain/test/dispatcher.test.ts` | Modify | Update the timed-station ("paper") suite to the arrival lifecycle; add no-show/false-completion/arrive/`autoArrive`/flags-surfacing tests. |
| `apps/stage/src/components/CalledGate.tsx` | Modify | Add a `confirmedBy: "visitor" \| "performer"` prop; performer mode renders a wait-for-staff standby (no confirm button) and still auto-advances on phase flip. |
| `apps/stage/src/components/CalledGate.test.tsx` | Modify | Add a performer-mode test. |
| `apps/stage/src/routes/BodyScan.tsx`, `apps/stage/src/routes/Altar.tsx` | Modify | Pass `confirmedBy="performer"`. |
| `apps/stage/src/routes/Station.tsx` | Create | The unified performer confirm view: a passive container (`Station`) + a presentational `StationOpsView`. |
| `apps/stage/src/routes/Station.test.tsx` | Create | Test `StationOpsView` with props (matches the Feed.test.tsx convention). |
| `apps/stage/src/App.tsx` | Modify | Register `/station` and `/station/:station`; add `station` to the Home nav. |
| `apps/stage/src/styles.css` | Modify | Minimal styles for `.stationops` / `.ops-row` / `.ghost`. |
| `docs/CHANGELOG.md`, `app/CLAUDE.md`, `docs/ARCHITECTURE.md` | Modify | Changelog entry; `/station` in the route lists; timed-lifecycle note. |

---

## Tasks

> Each task is its own TDD cycle and commit. Brain tasks (1–3) are independent of stage tasks (4–5) except that Task 5's no-show highlight relies on Task 3's `flags` field. Do them in order.

### Task 1 — Brain: timed-station arrival lifecycle

Rewrite `reconcile()` so timed occupants flow `called → (arrive) → in_progress → (dwell) → done`, with no-show on `called`. The existing "paper" tests assert the *old* timer-from-call behavior and must be updated.

**Files:** modify `apps/brain/src/dispatcher.ts`, `apps/brain/test/dispatcher.test.ts`.

**Interfaces:**
- Consumes: `arrive(visitorId: string): boolean`, `confirm(visitorId): boolean`, `dwellMs(s): number`, `ageMs(iso): number`, `reapOccupant(slot, reason)`, `addFlag(id, flag)`, `milestoneField(station)` — all already in `dispatcher.ts`.
- Produces: no signature changes (the exported `Dispatcher` interface is unchanged).

**Steps:**

- [ ] **Update the "paper" suite to the arrival lifecycle.** In `apps/brain/test/dispatcher.test.ts`, replace the `P_KNOBS` comment and the four behavior tests (`"...confirm starts the dwell"`, `"completes a paper occupant after dwellMs..."`, `"does not complete before dwellMs"`, `"never applies the no-show timer to a timed station"`) with:

```ts
  const P_KNOBS = {
    slots: { intake: 0, bodyscan: 0, altar: 0, paper: 2 },
    timed: { paper: { dwellMs: 300_000 } },
    // Timed stations now share the kiosk lifecycle: called → arrive → dwell.
    // noShowAutoRepool ON so a called-but-never-arrived paper occupant is repooled
    // at noShowMs(90s) rather than left hanging.
    K: 1, warmupMs: 0, tickMs: 5_000, noShowAutoRepool: true,
  };
```

```ts
  it("confirm calls a paper occupant; arrival starts the dwell", () => {
    const v = store.register(771002);
    pd.kick(); // warmup K=1 met → fill
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
    pd.kick();
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
    expect(store.get(v.id)?.location.state).toBe("waiting"); // repooled (noShowAutoRepool)
    expect(pd.snapshot().slots.some((x) => x.occupant?.visitorId === v.id)).toBe(false);
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
```

- [ ] **Run the suite — expect FAIL** (old `reconcile()` starts the dwell at `called`, so the arrival-based and no-show tests fail):

```
pnpm --filter @channelers/brain test -- dispatcher
```
Expect: failures in the "paper: timed group station" suite (e.g. "applies the no-show timer…", "completes … after ARRIVAL").

- [ ] **Rewrite the `reconcile()` per-slot loop** in `apps/brain/src/dispatcher.ts`. Replace the body from `for (const slot of slots.values()) {` through the end of the `if (knobs.autoConfirm) { … }` block (the autoArrive block is added in Task 2) with:

```ts
  function reconcile(): void {
    for (const slot of slots.values()) {
      const occ = slot.occupant;
      if (!occ) continue;
      const v = store.get(occ.visitorId);
      if (!v) { slot.occupant = undefined; continue; }

      // ── called: awaiting arrival. No-show now applies to EVERY station, timed
      //    included — a person called but never confirmed-arrived must not complete. ──
      if (occ.phase === "called") {
        if (ageMs(occ.since) > knobs.noShowMs) {
          if (knobs.noShowAutoRepool) reapOccupant(slot, "no-show");
          else addFlag(v.id, { type: "no-show", since: nowIso() });
        }
        continue;
      }

      // ── in_progress ──
      if (isTimed(slot.station)) {
        // Dwell measured from ARRIVAL (occ.since was reset by arrive()); it completes the visit.
        const dwell = dwellMs(slot.station);
        if (ageMs(occ.since) > dwell) {
          store.stampMilestone(occ.visitorId, milestoneField(slot.station));
          slot.occupant = undefined;
          store.setLocation(occ.visitorId, { state: "waiting", since: nowIso() });
          clearFlags(occ.visitorId);
        } else if (!Number.isFinite(dwell) && ageMs(occ.since) > knobs.staleMs) {
          // Backstop only when a timed station has NO finite dwell to complete it
          // (misconfiguration). A finite dwell always completes first and is never preempted.
          reapOccupant(slot, "stale");
        }
        continue;
      }

      // ── kiosk in_progress: external milestone completes; stale reaps a hung occupant. ──
      if (completionMilestoneSet(v, slot.station)) {
        slot.occupant = undefined;
        store.setLocation(v.id, { state: "waiting", since: nowIso() });
      } else if (ageMs(occ.since) > knobs.staleMs) {
        reapOccupant(slot, "stale");
      }
    }

    if (knobs.autoConfirm) {
      for (const slot of slots.values()) {
        if (slot.occupant?.phase === "pending") confirm(slot.occupant.visitorId);
      }
    }
  }
```

- [ ] **Run the suite — expect PASS** (all dispatcher tests, including the existing kiosk no-show/stale tests which are unaffected):

```
pnpm --filter @channelers/brain test -- dispatcher
```
Expect: the "paper: timed group station" suite green; no regressions elsewhere.

- [ ] **Commit:**

```
git commit -am "feat(dispatch): timed stations gate dwell on confirmed arrival, add no-show"
```

---

### Task 2 — Brain: `autoArrive` knob

Add a dev/stub knob that auto-advances `called → in_progress`, mirroring `autoConfirm`.

**Files:** modify `apps/brain/src/config.ts`, `apps/brain/src/dispatcher.ts`, `apps/brain/test/dispatcher.test.ts`.

**Interfaces:**
- Consumes: `arrive(visitorId)` (already defined).
- Produces: `config.dispatcher.autoArrive: boolean` → flows into `Knobs = typeof config.dispatcher` automatically (no separate type edit).

**Steps:**

- [ ] **Write the failing test.** Add to `apps/brain/test/dispatcher.test.ts` (e.g. in the "recovery" describe):

```ts
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
```

- [ ] **Run it — expect FAIL** (`autoArrive` unknown; occupant stays `called`):

```
pnpm --filter @channelers/brain test -- dispatcher
```
Expect: this test fails asserting `"called"` !== `"in_progress"`.

- [ ] **Add the knob** to `apps/brain/src/config.ts`, immediately after the `autoConfirm` line in the `dispatcher` block:

```ts
    /** Flip ON to skip the performer arrival step (called auto-promotes to in_progress) — dev/stub flow. */
    autoArrive: process.env.DISPATCH_AUTO_ARRIVE === "true",
```

- [ ] **Add the autoArrive block** in `apps/brain/src/dispatcher.ts`, directly after the `if (knobs.autoConfirm) { … }` block at the end of `reconcile()`:

```ts
    if (knobs.autoArrive) {
      for (const slot of slots.values()) {
        if (slot.occupant?.phase === "called") arrive(slot.occupant.visitorId);
      }
    }
```

- [ ] **Run it — expect PASS:**

```
pnpm --filter @channelers/brain test -- dispatcher
```
Expect: the `autoArrive` test green.

- [ ] **Commit:**

```
git commit -am "feat(dispatch): add autoArrive knob for hands-free dev/stub flow"
```

---

### Task 3 — Brain: surface occupant flags + `noShowMs` in the snapshot

A no-show flag on a *called occupant* is stored but never appears in `dispatch.state` today (only flags on *waiting queue* entries surface). Surface them so the performer view can show a warning, and expose `noShowMs` symmetrically with `timedDwellMs`.

**Files:** modify `packages/shared/src/protocol.ts`, `apps/brain/src/dispatcher.ts`, `apps/brain/test/dispatcher.test.ts`.

**Interfaces:**
- Produces: `SlotOccupant.flags?: DispatchFlag[]`; `DispatchState.noShowMs?: number`. Consumed by Task 5's `StationOpsView`.

**Steps:**

- [ ] **Write the failing test.** Add to `apps/brain/test/dispatcher.test.ts`:

```ts
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
```

- [ ] **Run it — expect FAIL** (`occupant.flags` is `undefined`; `noShowMs` not on the snapshot):

```
pnpm --filter @channelers/brain test -- dispatcher
```

- [ ] **Add the fields** to `packages/shared/src/protocol.ts`. In `SlotOccupant`, add `flags`:

```ts
export type SlotOccupant = {
  visitorId: string;
  number: number;
  phase: "pending" | "called" | "in_progress";
  since: string;
  /** Review flags carried by this occupant (e.g. a no-show on a called participant). */
  flags?: DispatchFlag[];
};
```

In `DispatchState`, add `noShowMs` next to `timedDwellMs`:

```ts
  /** Dwell (ms) per timed group station, so the operator board can show a remaining-time countdown. */
  timedDwellMs?: Partial<Record<Station, number>>;
  /** Called-but-not-arrived threshold (ms), so a station view can flag a likely no-show. */
  noShowMs?: number;
```

- [ ] **Populate them in `apps/brain/src/dispatcher.ts`.** In `toSlot()`, attach the occupant's flags:

```ts
  function toSlot(s: SlotState): Slot {
    const occupant = s.occupant
      ? { ...s.occupant, flags: flags.get(s.occupant.visitorId) }
      : undefined;
    return { id: s.id, station: s.station, kioskId: s.kioskId, online: isOnline(s), occupant };
  }
```

In `snapshot()`, add `noShowMs` to the returned object (next to `timedDwellMs`):

```ts
      timedDwellMs,
      noShowMs: knobs.noShowMs,
      warmedUp: warmedUp(),
```

- [ ] **Run it — expect PASS:**

```
pnpm --filter @channelers/brain test -- dispatcher
```

- [ ] **Typecheck the shared change** (consumers see the new optional fields):

```
pnpm -r typecheck
```
Expect: clean.

- [ ] **Commit:**

```
git commit -am "feat(dispatch): surface occupant flags and noShowMs in dispatch.state"
```

---

### Task 4 — Stage: CalledGate performer mode (bodyscan/altar standby)

Add a `confirmedBy` prop. In `"performer"` mode the kiosk shows a wait-for-staff standby with **no** confirm button and auto-advances to the work UI when the performer confirms (the existing `phase === "in_progress"` effect already handles this). Intake keeps `"visitor"` (default), unchanged.

**Files:** modify `apps/stage/src/components/CalledGate.tsx`, `apps/stage/src/components/CalledGate.test.tsx`, `apps/stage/src/routes/BodyScan.tsx`, `apps/stage/src/routes/Altar.tsx`.

**Interfaces:**
- Produces: `CalledGate` gains `confirmedBy?: "visitor" | "performer"` (default `"visitor"`).
- Consumes: existing `api.arrive`, `api.getByNumber`.

**Steps:**

- [ ] **Write the failing test.** Add to `apps/stage/src/components/CalledGate.test.tsx`:

```ts
test("performer mode: called shows a wait-for-staff standby, no confirm button", () => {
  render(
    <CalledGate
      station="bodyscan" title="Body Scan" connected confirmedBy="performer"
      slot={slot(called(12))} onArrived={() => {}}
    />,
  );
  expect(screen.getByText("#12")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /confirm arrival/i })).toBeNull();
  expect(screen.getByText(/wait for staff/i)).toBeInTheDocument();
});
```

- [ ] **Run it — expect FAIL** (`confirmedBy` is not a prop; the confirm button still renders):

```
pnpm --filter @channelers/stage test -- CalledGate
```

- [ ] **Add the prop and branch** in `apps/stage/src/components/CalledGate.tsx`. Extend the props (signature + type):

```ts
export function CalledGate({
  station,
  title,
  connected,
  slot,
  onArrived,
  skin = "default",
  confirmedBy = "visitor",
}: {
  station: Station;
  title: string;
  connected: boolean;
  slot: Slot | undefined;
  onArrived: (visitor: VisitorProfile) => void;
  /** "crt" renders shell-less CRT content meant to live inside Intake's <CrtShell>. */
  skin?: "crt" | "default";
  /** "performer" hides the self-confirm button; a station guide admits the visitor. */
  confirmedBy?: "visitor" | "performer";
}) {
```

Then replace the default-skin called `<section>` (the block guarded by `occ && occ.phase !== "in_progress" && occ.phase !== "pending"`) with:

```tsx
      {occ && occ.phase !== "in_progress" && occ.phase !== "pending" && (
        <section className="called">
          <p className="dim">{confirmedBy === "performer" ? "You've been called" : "Now calling"}</p>
          <div className="called-number">#{occ.number}</div>
          {confirmedBy === "performer" ? (
            <p className="dim">Please proceed to the station — wait for staff to admit you.</p>
          ) : (
            <button className="submit" disabled={busy} onClick={() => void confirmArrival()}>
              {busy ? "…" : "Confirm arrival"}
            </button>
          )}
        </section>
      )}
```

- [ ] **Run it — expect PASS** (and the existing "default skin still shows … Confirm arrival" test stays green because it uses the default `confirmedBy="visitor"`):

```
pnpm --filter @channelers/stage test -- CalledGate
```

- [ ] **Wire the routes.** In `apps/stage/src/routes/BodyScan.tsx` line 26, add `confirmedBy="performer"`:

```tsx
  if (!visitor) return <CalledGate station="bodyscan" title="Body Scan" connected={connected} slot={slot} confirmedBy="performer" onArrived={setVisitor} />;
```

In `apps/stage/src/routes/Altar.tsx` line 20, add `confirmedBy="performer"`:

```tsx
  if (!visitor) return <CalledGate station="altar" title="Altar" connected={connected} slot={slot} confirmedBy="performer" onArrived={setVisitor} />;
```

- [ ] **Typecheck:**

```
pnpm -r typecheck
```
Expect: clean.

- [ ] **Commit:**

```
git commit -am "feat(stage): performer-driven arrival standby on bodyscan/altar kiosks"
```

---

### Task 5 — Stage: unified performer view (`/station/:station`)

A passive, parameterized confirm view. Split into a presentational `StationOpsView` (tested with props, per the Feed.test.tsx convention) and a `Station` container that wires the socket + routing.

**Files:** create `apps/stage/src/routes/Station.tsx`, `apps/stage/src/routes/Station.test.tsx`; modify `apps/stage/src/App.tsx`, `apps/stage/src/styles.css`.

**Interfaces:**
- Consumes: `DispatchState`/`Slot` (incl. `occupant.flags` from Task 3, `timedDwellMs`), `useBrainSocket`, `api.arrive`, `api.dispatch.repool`, react-router `useParams`/`Link`.
- Produces: exports `Station` (route component) and `StationOpsView` (presentational).

**Steps:**

- [ ] **Write the failing test.** Create `apps/stage/src/routes/Station.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { StationOpsView } from "./Station";
import type { Slot, DispatchFlag } from "@channelers/shared";

const calledSlot = (n: number, flags?: DispatchFlag[]): Slot => ({
  id: "bodyscan-0",
  station: "bodyscan",
  online: true,
  occupant: { visitorId: `v${n}`, number: n, phase: "called", since: "", flags },
});

test("lists called participants and fires onArrive with the visitor id", () => {
  const onArrive = vi.fn();
  render(
    <StationOpsView
      station="bodyscan" connected called={[calledSlot(42)]} inProgress={[]}
      busyId={null} onArrive={onArrive} onRelease={() => {}}
    />,
  );
  expect(screen.getByText("#42")).toBeInTheDocument();
  screen.getByRole("button", { name: /confirm arrival/i }).click();
  expect(onArrive).toHaveBeenCalledWith("v42");
});

test("shows a no-show warning when the occupant is flagged", () => {
  render(
    <StationOpsView
      station="bodyscan" connected
      called={[calledSlot(7, [{ type: "no-show", since: "" }])]} inProgress={[]}
      busyId={null} onArrive={() => {}} onRelease={() => {}}
    />,
  );
  expect(screen.getByText(/no-show/i)).toBeInTheDocument();
});
```

- [ ] **Run it — expect FAIL** (`./Station` does not exist yet):

```
pnpm --filter @channelers/stage test -- Station
```

- [ ] **Create `apps/stage/src/routes/Station.tsx`:**

```tsx
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DispatchState, Slot, Station as StationName, WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

/** Stations a performer admits arrivals for. Intake self-confirms; it is not here. */
const PERFORMER_STATIONS: StationName[] = ["bodyscan", "altar", "paper"];

/** Route entry: bare /station shows a picker; /station/:station opens that station's view. */
export function Station() {
  const { station } = useParams<{ station?: string }>();
  if (!station || !PERFORMER_STATIONS.includes(station as StationName)) return <StationPicker />;
  return <StationContainer station={station as StationName} />;
}

function StationPicker() {
  return (
    <main className="void">
      <h1>Station confirm</h1>
      <p className="dim">Open the station you are manning.</p>
      <nav className="stations">
        {PERFORMER_STATIONS.map((s) => (
          <Link key={s} to={`/station/${s}`} className="station">{s}</Link>
        ))}
      </nav>
    </main>
  );
}

/** Passive container: reads dispatch.state, POSTs arrive/repool. Sends NO station.hello. */
function StationContainer({ station }: { station: StationName }) {
  const [state, setState] = useState<DispatchState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { connected } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setState(m.state);
  });

  async function run(visitorId: string, fn: () => Promise<unknown>) {
    setBusyId(visitorId);
    try { await fn(); } finally { setBusyId(null); }
  }

  const slots = (state?.slots ?? []).filter((s) => s.station === station);
  return (
    <StationOpsView
      station={station}
      connected={connected}
      called={slots.filter((s) => s.occupant?.phase === "called")}
      inProgress={slots.filter((s) => s.occupant?.phase === "in_progress")}
      dwellMs={state?.timedDwellMs?.[station]}
      busyId={busyId}
      onArrive={(id) => void run(id, () => api.arrive(id))}
      onRelease={(id) => void run(id, () => api.dispatch.repool(id))}
    />
  );
}

/** Presentational — admit list + in-progress status. */
export function StationOpsView({
  station, connected, called, inProgress, dwellMs, busyId, onArrive, onRelease,
}: {
  station: StationName;
  connected: boolean;
  called: Slot[];
  inProgress: Slot[];
  dwellMs?: number;
  busyId: string | null;
  onArrive: (visitorId: string) => void;
  onRelease: (visitorId: string) => void;
}) {
  return (
    <main className="void stationops">
      <header>
        <h1>Station · {station}</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
      </header>

      <section className="ops-group">
        <h2>Called — awaiting arrival</h2>
        {called.length === 0 && <p className="dim">No one is called to {station}.</p>}
        {called.map((s) => {
          const o = s.occupant!;
          const noShow = o.flags?.some((fl) => fl.type === "no-show");
          return (
            <div key={s.id} className={`ops-row${noShow ? " warn" : ""}`}>
              <span className="ops-num">#{o.number}</span>
              {noShow && <span className="ops-flag">no-show?</span>}
              <button className="submit" disabled={busyId === o.visitorId} onClick={() => onArrive(o.visitorId)}>
                Confirm arrival
              </button>
              <button className="ghost" disabled={busyId === o.visitorId} onClick={() => onRelease(o.visitorId)}>
                Release
              </button>
            </div>
          );
        })}
      </section>

      <section className="ops-group">
        <h2>In progress</h2>
        {inProgress.length === 0 && <p className="dim">No one in progress.</p>}
        {inProgress.map((s) => {
          const o = s.occupant!;
          return (
            <div key={s.id} className="ops-row">
              <span className="ops-num">#{o.number}</span>
              <span className="dim">{dwellMs ? "dwell running" : "in progress"}</span>
            </div>
          );
        })}
      </section>
    </main>
  );
}
```

- [ ] **Run it — expect PASS:**

```
pnpm --filter @channelers/stage test -- Station
```

- [ ] **Register the routes** in `apps/stage/src/App.tsx`. Add the import and routes, and add `station` to `SCREENS`:

```tsx
import { Station } from "./routes/Station";
```
```tsx
const SCREENS = ["intake", "bodyscan", "altar", "channel", "choreo", "console", "board", "dispatch", "station", "souvenir", "feed"] as const;
```
```tsx
        <Route path="/station" element={<Station />} />
        <Route path="/station/:station" element={<Station />} />
```
(Place the two `<Route>`s before the `<Route path="*" … />` catch-all.)

- [ ] **Add minimal styles** to `apps/stage/src/styles.css`:

```css
.stationops .ops-group { margin: 1.5rem 0; }
.stationops .ops-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0; }
.stationops .ops-row.warn { color: #f5a; }
.stationops .ops-num { font-variant-numeric: tabular-nums; font-size: 1.25rem; min-width: 4ch; }
.stationops .ops-flag { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; }
.stationops .ghost { background: transparent; border: 1px solid currentColor; opacity: 0.7; }
```

- [ ] **Typecheck + full stage suite:**

```
pnpm -r typecheck && pnpm --filter @channelers/stage test
```
Expect: clean typecheck; all stage tests green.

- [ ] **Commit:**

```
git commit -am "feat(stage): unified /station performer arrival-confirm view"
```

---

### Task 6 — Docs + reconciliation

Capture the change and reconcile the route lists / architecture (not just the changelog).

**Files:** modify `docs/CHANGELOG.md`, `app/CLAUDE.md`, `docs/ARCHITECTURE.md`.

**Steps:**

- [ ] **`docs/CHANGELOG.md`** — add a newest-on-top entry: what (performer-confirmed arrivals; timed stations gate dwell on arrival + no-show; `/station` view; `autoArrive` knob; occupant flags/`noShowMs` surfaced), why (deliberate human arrival; fixes false-completion of absent `/feed` participants), files/areas (`dispatcher.ts`, `config.ts`, `protocol.ts`, `CalledGate.tsx`, `routes/Station.tsx`, `App.tsx`), docs-touched (this entry, `app/CLAUDE.md`, `ARCHITECTURE.md`).
- [ ] **`app/CLAUDE.md`** — in the `apps/stage` route list, add `/station` (e.g. under the operator screens): *"`/station` — per-station performer arrival-confirm view (bodyscan/altar/paper); passive, calls `arrive`/`repool`."* Note that bodyscan/altar now gate on **performer**-confirmed arrival (intake still self-confirms via `CalledGate`).
- [ ] **`docs/ARCHITECTURE.md`** — add `/station` to the §3 route map; in the dispatcher §5 subsection, update the timed-station description: dwell now starts at **confirmed arrival** (not the call), and no-show applies to `called` timed occupants. If any open question in §12 referenced the timed timer-from-call behavior, resolve/strike it.
- [ ] **Verify the whole build once:**

```
pnpm -r typecheck && pnpm --filter @channelers/brain test && pnpm --filter @channelers/stage test
```
Expect: all green.

- [ ] **Commit:**

```
git commit -am "docs: record performer-confirmed arrivals + /station view"
```

---

## Done criteria
- Timed (`paper`/`/feed`) occupants flow `called → arrive → in_progress → dwell → done`; a called-but-absent participant is never stamped `paperAt` (no-show instead).
- Every non-intake station has a working performer arrival-confirm surface at `/station/:station`; intake unchanged.
- bodyscan/altar kiosks show a wait-for-staff standby and auto-advance on performer confirm.
- `DISPATCH_AUTO_ARRIVE=true` (with `DISPATCH_AUTO_CONFIRM=true`) runs the flow hands-free in dev.
- `pnpm -r typecheck` and both vitest suites pass.
