# Dispatch holds — intro wait + no-show cooldown + remaining-time UI

**Goal:** Give the dispatcher one unified per-visitor "hold" (a window during which a number is ineligible for new station assignment), used for both a startup intro wait and a no-show cooldown, surfaced as live countdowns in the UI.

**Approach:** Add a single `holdOf(v)`/`isHeld(v)` in the dispatcher computed from two sources — `createdAt + introHoldMs` (intro) and a `noShowHoldUntil` map (no-show) — and gate `select()` on `!isHeld(v)`. This **replaces** the global `K`/`warmupMs`/`warmedUp` warm-up. Surface `heldUntil`/`holdReason` on queue entries and `noShowMs` (already present) so `/dispatch` shows an "on hold · reason m:ss" chip and `/station` shows "no-show in m:ss", driven by a shared 1 s ticker + pure timing helpers.

**Tech stack:** TypeScript monorepo (pnpm). Brain = Fastify + `ws` (`apps/brain`); Stage = Vite/React + react-router (`apps/stage`); contracts in `packages/shared`. Tests = vitest (+ Testing Library/jsdom for stage).

---

## Why / design

### Problem
Three gaps in dispatch timing:
1. The `/station` performer view shows no sense of urgency — a guide can't see how long a called participant has before they auto–no-show.
2. A no-show number is immediately re-eligible, so it can be re-called instantly into the same churn.
3. The only startup control is a **global** warm-up (`K` pool-size OR `warmupMs` elapsed since the first registration) that gates *everyone* at once — coarse, and it can't express "each person waits a beat after registering."

### Solution — one "hold" concept
A visitor is **held** (ineligible for a *new* slot assignment) until `holdOf(v).untilMs`, the later of:
- **intro hold** — `Date.parse(v.createdAt) + introHoldMs` (no new storage; every visitor has `createdAt`).
- **no-show hold** — `noShowHoldUntil.get(v.id)`, set to `now + noShowHoldMs` when the no-show timer fires.

`select()` skips held visitors (so anti-starvation can't rescue them either), but they **stay in the waiting queue** so the UI can show the countdown. Operator `assign()`/`checkin()` bypass holds (manual override) because they don't route through `select()`.

### Scope
**In:** unified hold mechanism; remove global warm-up (`K`/`warmupMs`/`warmedUp`); `introHoldMs`/`noShowHoldMs` knobs; `heldUntil`/`holdReason` on `DispatchQueueEntry`; `/station` no-show countdown; `/dispatch` hold chip; shared timing helpers + `useNow` ticker.
**Out (YAGNI):** `/console` hold denotation; per-station hold overrides; persisting holds across a brain restart; changing anti-starvation to measure from hold-release (kept measuring from `location.since` — see decision log).

### Approaches considered
1. **Unified hold from two sources, gated in `select()` (chosen).** One `isHeld(v)`; intro derived from `createdAt`, no-show in a small map. Minimal new state, one integration point, replaces warm-up.
2. **Per-station-kind hold flags on the slot/occupant.** Rejected — holds are a property of the *visitor* (carried between stations), not a slot.
3. **Keep warm-up, add holds alongside.** Rejected — the per-user intro hold subsumes the time-based warm-up; keeping both is redundant (user chose to drop `K` too).

### Decision log
- **Term is "hold"** (not "bar/cooldown") — neutral umbrella covering both the intro wait and the no-show penalty; consistent across code and UI.
- **Drop the global warm-up entirely** (`K` + `warmupMs` + `DispatchState.warmedUp`). A registrant becomes eligible once their own intro hold elapses, even if alone.
- **Separate knobs** `introHoldMs` / `noShowHoldMs` — independent durations.
- **No-show hold re-arms only when expired** (`cur <= now`), not every tick — avoids drift during a held `called` episode and correctly re-arms a *second* no-show. Cleared only on `remove()`.
- **Anti-starvation still measures from `location.since`** (unchanged). A long intro-held visitor may count as "starving" the instant the hold lifts and jump the random pick — acceptable (they did wait longest) and keeps the change tiny.
- **Held visitors stay in the queue**, annotated; they are excluded from `select()`, never from `queueEntries()`.

---

## Global constraints

Copy verbatim into every task; implicit in all of them.

- **TypeScript throughout.** No new runtime deps.
- **Screen-only streams stay off OSC** — this change touches only `dispatch.state` over WS + the existing HTTP dispatch endpoints.
- **Brain tests run offline by design** (`apps/brain/test/setup.ts` forces `OPENAI_API_KEY=""`).
- **Verification commands** (run before claiming a task done):
  - `pnpm --filter @channelers/brain test`
  - `pnpm --filter @channelers/stage test`
  - `pnpm -r typecheck`
- **Commit per task**, message ending with the repo's `Co-Authored-By` trailer.
- **Proposed knob defaults** (rehearsal-fast, env-overridable): `introHoldMs` 30_000, `noShowHoldMs` 120_000. Unchanged: `noShowMs` 90_000, `staleMs` 300_000, `maxWaitMs` 240_000.
- **Note:** `apps/brain/test/tts.test.ts` has 2 pre-existing failures (ElevenLabs voice IDs) unrelated to this work — ignore them; they are not a regression.

---

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `apps/brain/src/config.ts` | Modify | Remove `K`/`warmupMs`; add `introHoldMs`, `noShowHoldMs`. |
| `packages/shared/src/protocol.ts` | Modify | `DispatchQueueEntry` gains `heldUntil?`/`holdReason?`; `DispatchState` loses `warmedUp`. |
| `apps/brain/src/dispatcher.ts` | Modify | `noShowHoldUntil` map; `holdOf`/`isHeld`; `select()` gate; no-show hold set; `remove()` cleanup; `queueEntries()` surfaces hold; drop `warmedUp()`/`fill()` gate/`snapshot().warmedUp`. |
| `apps/brain/test/dispatcher.test.ts` | Modify | Swap `K`/`warmupMs` → `introHoldMs:0` in shared knobs; add intro-hold, no-show-hold, starvation, queue-surface tests. |
| `apps/stage/src/routes/Dispatch.tsx` | Modify (Task 1 + Task 4) | Task 1 removes the now-dangling `state.warmedUp` read (keeps the workspace typecheck green); Task 4 adds the hold chip + ticker refactor. |
| `apps/stage/src/lib/dispatchTiming.ts` | Create | Pure timing helpers: `remainingSec`, `fmtClock`, `noShowDeadline`. |
| `apps/stage/src/lib/dispatchTiming.test.ts` | Create | Unit tests for the helpers. |
| `apps/stage/src/lib/useNow.ts` | Create | 1 s ticker hook for live countdowns. |
| `apps/stage/src/routes/Station.tsx` | Modify | `StationOpsView` gains `now?`/`noShowMs?`; called rows show "no-show in m:ss"; container feeds `useNow()` + `state.noShowMs`. |
| `apps/stage/src/routes/Station.test.tsx` | Modify | Add a no-show-countdown test. |
| `apps/stage/src/routes/Dispatch.tsx` | Modify | Replace inline ticker with `useNow()`; drop "warming up…"; render the hold chip. |
| `apps/stage/src/styles.css` | Modify | `.pool-flag.hold` style. |
| `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md` | Modify | Changelog entry; §5.x knobs/holds + `dispatch.state` shape; §12 resolved-knobs note. |

---

## Tasks

### Task 1 — Brain: unified hold mechanism (replaces warm-up)

**Files:** modify `apps/brain/src/config.ts`, `packages/shared/src/protocol.ts`, `apps/brain/src/dispatcher.ts`, `apps/brain/test/dispatcher.test.ts`, `apps/stage/src/routes/Dispatch.tsx` (one-line `warmedUp` removal only).

**Interfaces:**
- Consumes: `store.list()`, `VisitorRecord` (has `id`, `createdAt`, `location`), existing `reapOccupant`, `addFlag`, `eligibleStations`, `ageMs`, `nowIso`.
- Produces: `config.dispatcher.introHoldMs:number` + `noShowHoldMs:number` (flow into `Knobs`); `DispatchQueueEntry.heldUntil?:string` + `holdReason?:"intro"|"no-show"`; `DispatchState` no longer has `warmedUp`.

**Steps:**

- [ ] **Swap the shared test knobs.** In `apps/brain/test/dispatcher.test.ts` replace the `KNOBS` line:

```ts
const KNOBS = { slots: SLOTS, introHoldMs: 0, graceMs: 20_000, tickMs: 5_000 };
```

and in the `P_KNOBS` object replace `K: 1, warmupMs: 0, tickMs: 5_000, noShowAutoRepool: true,` with:

```ts
    introHoldMs: 0, tickMs: 5_000, noShowAutoRepool: true,
```

and update the stale comment `pd.kick(); // warmup K=1 met → fill` to `pd.kick(); // intro hold 0 → fill`.

- [ ] **Write the failing tests.** Add to `apps/brain/test/dispatcher.test.ts`:

```ts
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
```

- [ ] **Run — expect FAIL** (`introHoldMs`/`noShowHoldMs`/`holdReason` don't exist; warm-up still gates):

```
pnpm --filter @channelers/brain test -- dispatcher
```

- [ ] **Config knobs.** In `apps/brain/src/config.ts`, replace these two lines (and their `/** Warm-up pool size … */` comment) —

```ts
    /** Warm-up pool size — don't dispatch until this many are waiting OR T_warmup elapses. */
    K: Number(process.env.DISPATCH_K ?? 3),
    warmupMs: Number(process.env.DISPATCH_T_WARMUP_MS ?? 60_000),
```

with:

```ts
    /** Per-visitor intro hold: a fresh registrant is ineligible for new assignment for this long
     *  after registration (replaces the old global K / warm-up). */
    introHoldMs: Number(process.env.DISPATCH_INTRO_HOLD_MS ?? 30_000),
```

and add, immediately after the `noShowMs` line:

```ts
    /** No-show cooldown: a no-show number is held out of new assignment for this long. */
    noShowHoldMs: Number(process.env.DISPATCH_NOSHOW_HOLD_MS ?? 120_000),
```

- [ ] **Contracts.** In `packages/shared/src/protocol.ts`, extend `DispatchQueueEntry`:

```ts
  waitingSince: string;
  flags: DispatchFlag[];
  /** Epoch-ISO until which this visitor is held out of new assignment (intro wait or no-show cooldown). */
  heldUntil?: string;
  holdReason?: "intro" | "no-show";
};
```

and remove `warmedUp` from `DispatchState` (delete the `/** False during the warm-up window … */` comment and the `warmedUp: boolean;` line).

- [ ] **Dispatcher — hold state + helpers.** In `apps/brain/src/dispatcher.ts`, add after the `flags` map declaration:

```ts
  const noShowHoldUntil = new Map<string, number>(); // visitorId → epoch ms a no-show is held until
```

Add the helpers just above `function select(`:

```ts
  // ── per-visitor hold: intro wait (createdAt) + no-show cooldown (map) ──
  function holdOf(v: VisitorRecord): { untilMs: number; reason: "intro" | "no-show" } | null {
    const intro = Date.parse(v.createdAt) + knobs.introHoldMs;
    const noShow = noShowHoldUntil.get(v.id) ?? 0;
    const untilMs = Math.max(intro, noShow);
    if (untilMs <= Date.now()) return null;
    return { untilMs, reason: noShow >= intro ? "no-show" : "intro" };
  }
  const isHeld = (v: VisitorRecord): boolean => holdOf(v) !== null;
```

- [ ] **Dispatcher — gate selection.** In `select()`, add `!isHeld(v)` to the eligible filter:

```ts
    const eligible = store.list().filter(
      (v) => !occupied.has(v.id) && !isHeld(v) && eligibleStations(v).includes(station),
    );
```

- [ ] **Dispatcher — set the no-show hold.** In `reconcile()`, replace the `called` branch with:

```ts
      if (occ.phase === "called") {
        if (ageMs(occ.since) > knobs.noShowMs) {
          const cur = noShowHoldUntil.get(v.id) ?? 0;
          if (cur <= Date.now()) noShowHoldUntil.set(v.id, Date.now() + knobs.noShowHoldMs);
          if (knobs.noShowAutoRepool) reapOccupant(slot, "no-show");
          else addFlag(v.id, { type: "no-show", since: nowIso() });
        }
        continue;
      }
```

- [ ] **Dispatcher — drop the warm-up gate.** Replace `fill()` with (removes the `if (!warmedUp()) return;` line):

```ts
  function fill(): void {
    for (const slot of slots.values()) {
      if (!isOnline(slot) || slot.occupant) continue;
      const pick = select(slot.station);
      if (!pick) continue;
      slot.occupant = { visitorId: pick.id, number: pick.number, phase: "pending", since: nowIso() };
      if (knobs.autoConfirm) confirm(pick.id);
    }
  }
```

- [ ] **Dispatcher — clean up on remove.** In `remove()`, add the map cleanup next to `flags.delete`:

```ts
      flags.delete(visitorId);
      noShowHoldUntil.delete(visitorId);
```

- [ ] **Dispatcher — surface the hold in the queue.** Replace `queueEntries()` with:

```ts
  function queueEntries(): DispatchQueueEntry[] {
    const occupied = occupiedVisitorIds();
    return store.list()
      .filter((v) => !occupied.has(v.id) && eligibleStations(v).length > 0)
      .map((v) => {
        const hold = holdOf(v);
        return {
          id: v.id, number: v.number, name: v.survey?.name,
          eligible: eligibleStations(v), waitingSince: v.location.since,
          flags: flags.get(v.id) ?? [],
          heldUntil: hold ? new Date(hold.untilMs).toISOString() : undefined,
          holdReason: hold?.reason,
        };
      });
  }
```

- [ ] **Dispatcher — drop `warmedUp`.** Remove the `warmedUp: warmedUp(),` line from the `snapshot()` return object, and delete the entire `warmedUp()` function (the `// warm-up (Task 3 uses this in fill; …)` comment + the function body).

- [ ] **Fix the one stage consumer of `warmedUp`.** In `apps/stage/src/routes/Dispatch.tsx`, delete the dangling header line (its hold-chip replacement comes in Task 4):

```tsx
        {!state.warmedUp && <span className="dim">warming up…</span>}
```

- [ ] **Run — expect PASS** (new hold tests green; existing tests unaffected by `introHoldMs:0`):

```
pnpm --filter @channelers/brain test -- dispatcher
```

- [ ] **Typecheck the whole workspace — expect clean** (the contract change and its only consumer landed together):

```
pnpm -r typecheck
```
Expect: all 5 projects clean.

- [ ] **Commit:**

```
git commit -am "feat(dispatch): unified per-visitor holds (intro + no-show), replacing warm-up"
```

---

### Task 2 — Stage: shared timing helpers + ticker

**Files:** create `apps/stage/src/lib/dispatchTiming.ts`, `apps/stage/src/lib/dispatchTiming.test.ts`, `apps/stage/src/lib/useNow.ts`.

**Interfaces:**
- Produces: `remainingSec(untilMs, now): number`, `fmtClock(sec): string`, `noShowDeadline(since, noShowMs): number`, `useNow(intervalMs?): number`.

**Steps:**

- [ ] **Write the failing test.** Create `apps/stage/src/lib/dispatchTiming.test.ts`:

```ts
import { expect, test } from "vitest";
import { remainingSec, fmtClock, noShowDeadline } from "./dispatchTiming";

test("remainingSec clamps at 0 and rounds up", () => {
  expect(remainingSec(10_000, 0)).toBe(10);
  expect(remainingSec(10_001, 0)).toBe(11);
  expect(remainingSec(0, 10_000)).toBe(0);
});

test("fmtClock: sub-minute as Ns, minute+ as m:ss", () => {
  expect(fmtClock(45)).toBe("45s");
  expect(fmtClock(60)).toBe("1:00");
  expect(fmtClock(90)).toBe("1:30");
});

test("noShowDeadline adds noShowMs to the since timestamp", () => {
  expect(noShowDeadline("1970-01-01T00:00:10.000Z", 5_000)).toBe(15_000);
});
```

- [ ] **Run — expect FAIL** (no `./dispatchTiming`):

```
pnpm --filter @channelers/stage test -- dispatchTiming
```

- [ ] **Implement `apps/stage/src/lib/dispatchTiming.ts`:**

```ts
/** Whole seconds remaining until `untilMs`, clamped at 0 (rounds up). */
export const remainingSec = (untilMs: number, now: number): number =>
  Math.max(0, Math.ceil((untilMs - now) / 1000));

/** Seconds → "m:ss" (≥60s) or "Ns" (<60s). */
export const fmtClock = (sec: number): string =>
  sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : `${sec}s`;

/** No-show deadline (epoch ms) for a called occupant. */
export const noShowDeadline = (since: string, noShowMs: number): number =>
  Date.parse(since) + noShowMs;
```

- [ ] **Implement `apps/stage/src/lib/useNow.ts`:**

```ts
import { useEffect, useState } from "react";

/** A clock that re-renders the caller every `intervalMs` so countdowns tick live. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
```

- [ ] **Run — expect PASS:**

```
pnpm --filter @channelers/stage test -- dispatchTiming
```

- [ ] **Commit:**

```
git commit -am "feat(stage): shared dispatch timing helpers + useNow ticker"
```

---

### Task 3 — Stage: `/station` no-show countdown

**Files:** modify `apps/stage/src/routes/Station.tsx`, `apps/stage/src/routes/Station.test.tsx`.

**Interfaces:**
- Consumes: `remainingSec`, `fmtClock`, `noShowDeadline` (Task 2), `useNow` (Task 2), `DispatchState.noShowMs`.
- Produces: `StationOpsView` gains optional `now?: number` and `noShowMs?: number`.

**Steps:**

- [ ] **Write the failing test.** Add to `apps/stage/src/routes/Station.test.tsx`:

```tsx
test("a called row shows the no-show countdown when noShowMs is provided", () => {
  const since = "2026-06-21T00:00:00.000Z";
  const slot: Slot = {
    id: "bodyscan-0", station: "bodyscan", online: true,
    occupant: { visitorId: "v1", number: 5, phase: "called", since },
  };
  render(
    <StationOpsView
      station="bodyscan" connected called={[slot]} inProgress={[]}
      noShowMs={90_000} now={Date.parse(since) + 30_000}
      busyId={null} onArrive={() => {}} onRelease={() => {}}
    />,
  );
  expect(screen.getByText(/no-show in 1:00/)).toBeInTheDocument();
});
```

- [ ] **Run — expect FAIL** (`now`/`noShowMs` not props; no countdown text):

```
pnpm --filter @channelers/stage test -- Station
```

- [ ] **Extend the imports + view.** In `apps/stage/src/routes/Station.tsx`, add to the existing imports:

```tsx
import { useNow } from "../lib/useNow";
import { remainingSec, fmtClock, noShowDeadline } from "../lib/dispatchTiming";
```

In `StationContainer`, add `const now = useNow();` and pass `now`/`noShowMs` to the view:

```tsx
  const now = useNow();
  const slots = (state?.slots ?? []).filter((s) => s.station === station);
  return (
    <StationOpsView
      station={station}
      connected={connected}
      called={slots.filter((s) => s.occupant?.phase === "called")}
      inProgress={slots.filter((s) => s.occupant?.phase === "in_progress")}
      dwellMs={state?.timedDwellMs?.[station]}
      noShowMs={state?.noShowMs}
      now={now}
      busyId={busyId}
      onArrive={(id) => void run(id, () => api.arrive(id))}
      onRelease={(id) => void run(id, () => api.dispatch.repool(id))}
    />
  );
```

Extend the `StationOpsView` signature with the two optional props:

```tsx
export function StationOpsView({
  station, connected, called, inProgress, dwellMs, noShowMs, now, busyId, onArrive, onRelease,
}: {
  station: StationName;
  connected: boolean;
  called: Slot[];
  inProgress: Slot[];
  dwellMs?: number;
  noShowMs?: number;
  now?: number;
  busyId: string | null;
  onArrive: (visitorId: string) => void;
  onRelease: (visitorId: string) => void;
}) {
  const nowMs = now ?? Date.now();
```

In the Called-row JSX, add the countdown after the `<span className="ops-num">` line (inside the `.ops-row`):

```tsx
              <span className="ops-num">#{o.number}</span>
              {noShow && <span className="ops-flag">no-show?</span>}
              {noShowMs !== undefined && (
                <span className="dim">no-show in {fmtClock(remainingSec(noShowDeadline(o.since, noShowMs), nowMs))}</span>
              )}
```

- [ ] **Run — expect PASS** (and the two existing `StationOpsView` tests stay green — they omit `now`/`noShowMs`, so no countdown renders):

```
pnpm --filter @channelers/stage test -- Station
```

- [ ] **Commit:**

```
git commit -am "feat(stage): show no-show countdown per called row on /station"
```

---

### Task 4 — Stage: `/dispatch` hold chip + drop warm-up indicator

**Files:** modify `apps/stage/src/routes/Dispatch.tsx`, `apps/stage/src/styles.css`.

**Interfaces:**
- Consumes: `useNow` (Task 2), `remainingSec`/`fmtClock` (Task 2), `DispatchQueueEntry.heldUntil`/`holdReason` (Task 1). `DispatchState.warmedUp` is gone (Task 1).

**Steps:**

- [ ] **Swap the ticker + imports.** In `apps/stage/src/routes/Dispatch.tsx`, add imports:

```tsx
import { useNow } from "../lib/useNow";
import { remainingSec, fmtClock } from "../lib/dispatchTiming";
```

Remove the `const [, tick] = useState(0);` line and add `const now = useNow();` among the hooks. Simplify the effect to drop the manual interval (keep the initial fetch):

```tsx
  useEffect(() => {
    void api.dispatch.state().then(setState).catch(() => {});
  }, []);
```

  (The `state.warmedUp` header line was already removed in Task 1.)

- [ ] **Render the hold chip.** In the waiting-pool item's `.pool-item-meta` div, add after the `flags` span:

```tsx
                  {v.flags.length > 0 && <span className="pool-flag">{v.flags.map((f) => f.type).join(" ")}</span>}
                  {v.heldUntil && (() => {
                    const sec = remainingSec(Date.parse(v.heldUntil), now);
                    return sec > 0 ? <span className="pool-flag hold">on hold · {v.holdReason} {fmtClock(sec)}</span> : null;
                  })()}
```

- [ ] **Style.** Append to `apps/stage/src/styles.css`:

```css
.pool-flag.hold { border-color: var(--dim); color: var(--dim); }
```

- [ ] **Run the full stage suite + typecheck** (the whole workspace now compiles — `warmedUp` is gone everywhere):

```
pnpm --filter @channelers/stage test && pnpm -r typecheck
```
Expect: stage suite green; typecheck clean across all projects.

- [ ] **Commit:**

```
git commit -am "feat(stage): /dispatch hold chip with countdown; drop warm-up indicator"
```

---

### Task 5 — Docs

**Files:** modify `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`.

**Steps:**

- [ ] **`docs/CHANGELOG.md`** — newest-on-top entry: what (unified per-visitor holds: intro wait + no-show cooldown, replacing the global `K`/warm-up; `/station` no-show countdown; `/dispatch` hold chip), why (deliberate startup stagger + no-show penalty + at-a-glance timing), files/areas (`dispatcher.ts`, `config.ts`, `protocol.ts`, `Station.tsx`, `Dispatch.tsx`, `lib/dispatchTiming.ts`, `lib/useNow.ts`), docs-touched (this entry, ARCHITECTURE §5.x + §12).
- [ ] **`docs/ARCHITECTURE.md` §5.x** — in the **Knobs** table, remove the `K`/`warmupMs` rows and add `introHoldMs` (`DISPATCH_INTRO_HOLD_MS`, 30 000, per-visitor intro hold) + `noShowHoldMs` (`DISPATCH_NOSHOW_HOLD_MS`, 120 000, no-show cooldown). Replace the **Warm-up** bullet with a **Holds** bullet: a visitor is ineligible for new assignment until `max(createdAt+introHoldMs, no-show cooldown)`; `select()` skips held visitors but they stay in the queue, denoted with a countdown on `/dispatch`; `/station` shows each called row's time-to-no-show. Update the **Transport** line: `dispatch.state` no longer carries `warmedUp`; queue entries carry `heldUntil?`/`holdReason?`.
- [ ] **`docs/ARCHITECTURE.md` §12** — update the resolved-knobs note (the `K=3, T_warmup=60s` line) to reflect the per-visitor hold model replacing the global warm-up.
- [ ] **Verify the whole build:**

```
pnpm -r typecheck && pnpm --filter @channelers/brain test && pnpm --filter @channelers/stage test
```
Expect: typecheck clean; brain green except the 2 pre-existing `tts.test.ts` failures; stage all green.

- [ ] **Commit:**

```
git commit -am "docs: record per-visitor dispatch holds + remaining-time UI"
```

---

## Done criteria
- A fresh registrant is not dispatched until `introHoldMs` after registration; a no-show is held `noShowHoldMs` before re-dispatch; neither is rescued by anti-starvation.
- `/station` called rows show "no-show in m:ss"; `/dispatch` queue items show "on hold · intro|no-show m:ss".
- Global `K`/`warmupMs`/`warmedUp` are gone; `pnpm -r typecheck` is clean and both vitest suites pass (modulo the pre-existing TTS failures).
