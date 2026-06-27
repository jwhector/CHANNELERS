# Design — Dispatch priority queue + flow controls

- **Date:** 2026-06-25
- **Status:** approved design, ready for plan
- **Suggested branch:** `dispatch-priority-flow`
- **Predecessors:** `…/plans/2026-06-24-dispatch-holds.md`, `…/plans/2026-06-24-performer-confirmed-arrivals.md`

## 1. Context

The dispatcher (`apps/brain/src/dispatcher.ts`) flows visitors across five stations:
`intake` (2 kiosk slots), `bodyscan` (1 kiosk slot), `altar` (1 kiosk slot), `paper`
(4, timed group), `waitingroom` (10, timed group). Each `kick()` runs `reconcile()`
then `fill()` then broadcasts `dispatch.state`.

**The room model (clarified with Jared):** the **altar is a deferred/batch event**, not a
continuous consumer. It opens at a set time *or* once everyone has cleared the prerequisite
stations, whichever the operator decides. So during the main run the whole room is flowing
through the gating stations and the soaks, and the operational goal is to get the room to
**"altar-ready" as fast as possible** (or as-many-as-possible-ready by the set time).

**"Altar-ready" = `intakeAt` && `poseAt`** (matches current altar eligibility). `paper` and
`waitingroom` are **optional soaks**, not prerequisites for the altar.

Because the altar doesn't drain continuously, there is no risk of over-producing altar-ready
people — the objective really is **keep the scarce gate (bodyscan, capacity 1) saturated**.

### Three concrete problems in the current code

1. **Fill order can starve bodyscan.** `fill()` iterates slots in `STATION_ORDER`
   (`intake, bodyscan, altar, paper, waitingroom`) and `select()` excludes already-claimed
   visitors *within the same pass*. So intake's 2 slots get first pick of the waiting pool;
   with only 1–2 people waiting, intake claims them and **bodyscan idles though an unposed
   person was available.** The scarce single gate is filled *after* the 2-wide station.

2. **No real altar gate.** Altar dispatches whenever a visitor is eligible and an `/altar`
   kiosk is online; the only way to "hold" it today is to not connect the kiosk.

3. **Waiting-room dead-time.** The physical hourglass is 2–5 min but the slot is held for a
   fixed `dwellMs` (`WAITINGROOM_DWELL_MS`, default 5 min). Someone who finishes early keeps
   1 of 10 slots until the timer expires. `markComplete` + `POST /api/dispatch/complete`
   already exist on the brain and `api.dispatch.complete` exists in the stage client, but
   `/station`'s only button is **Release** (`repool`), which marks the visitor *incomplete*
   so they get re-dispatched to the waiting room — there is no early-complete path wired up.

## 2. Goals / non-goals

**Goals**
- Bodyscan, the scarce single gate, gets first pick of the eligible pool every dispatch pass.
- A clean operator **Altar: CLOSED → OPEN** toggle, default closed.
- A performer **Done / end hourglass** action that completes a timed-station occupant early
  and frees the slot immediately.
- Operator visibility on `/dispatch`: altar-ready count + bodyscan idle/blocked status.

**Non-goals (YAGNI)**
- Weighted/scoring selection (a follow-up "Approach B" if ever wanted) — under batch-altar,
  *which* eligible person bodyscan takes does not change when the room finishes, so smart
  selection is not worth the surface area. `select()` keeps random + anti-starvation.
- Automatic altar-open at time-T / all-ready — manual toggle only this round.
- Modeling a true per-visitor variable hourglass length — the manual **Done** handles the
  2–5 min variance.
- Hard soak reservation — Jared chose **soak-open-to-all**; the fill priority biases toward
  the gates without forbidding the soak from absorbing overflow.

## 3. Design

### 3.1 Fill-order priority (the core fix) — brain

- Add `fillPriority: Station[]` to `config.dispatcher`, default
  **`["bodyscan", "intake", "altar", "paper", "waitingroom"]`**.
- In `fill()`, iterate online, unoccupied slots **sorted by their station's index in
  `fillPriority`** (stable within a station) instead of raw insertion order.
- Rationale: bodyscan (cap 1) before intake (cap 2) so the single gate never loses its only
  candidate to the 2-wide station; gating stations before soaks so unposed people are only
  pulled into a 5-min `paper`/`waitingroom` dwell *after* the gates have had their pick.
  No hard soak reservation needed.
- `select()` is **unchanged** (held-filter → anti-starvation → random).
- Altar sits ahead of the soaks so that, when open, an `intake✓+pose✓` person (who is still
  eligible for `paper`/`waitingroom`) is claimed by the altar rather than a soak.

### 3.2 Altar gate — brain + `/dispatch`

- Dispatcher holds an `altarOpen` boolean, **default `false`**, plus `setAltarOpen(open)`.
- `eligibleStations()` pushes `altar` **only when `altarOpen`** is true (keeps `queue`
  eligibility and the flow counters accurate while closed).
- New endpoint `POST /api/dispatch/altar { open: boolean }` → `setAltarOpen` → `kick()`.
- New stage client method `api.dispatch.altar(open)`.
- `/dispatch` renders an **"Altar: CLOSED → OPEN"** toggle bound to it.
- Closing only stops *new* altar dispatch; an in-progress reading is untouched because
  eligibility only affects `waiting` visitors. While closed, ready people stay eligible for
  the soaks and wait there until the altar opens.

### 3.3 Waiting-room early-complete (dead-time fix) — `/station`

- Add a **"Done"** (end-hourglass) button on `/station/:station` for **timed** stations
  (`paper`, `waitingroom`) on each `in_progress` occupant, wired to the existing
  `api.dispatch.complete(visitorId)` (→ `markComplete` → stamps the milestone, frees slot).
- Keep **"Release"** (`repool`) as the abort/incomplete path. So a timed `in_progress`
  occupant shows two actions: **Done** (finished early → reclaim slot now) and **Release**
  (sent away, not completed). Non-timed stations are unaffected.

### 3.4 Operator visibility — `/dispatch`

Derived in `snapshot()` (the client stays dumb; `dispatch.state` is already screens-only,
off the OSC/`ShowEvent` contract):

- **`altarReady: number`** — waiting visitors with `intakeAt && poseAt && !sessionEndAt`
  (the buffer; the operator's cue for *when* to open the altar). Needed as a derived field
  because `queue` entries don't expose milestones while the altar is closed.
- **bodyscan status** — idle vs occupied, and when idle *with no available candidate*, why.
  Proposed: `bodyscanIdle: boolean` + `bodyscanBlocked: "none" | "soaking" | "held" | "empty"`:
  - free bodyscan slot + an available unposed waiting person → `"none"` (auto-fills next tick),
  - unposed people exist but all `in_progress` (soaking) → `"soaking"`,
  - unposed people exist but all on hold (intro/no-show) → `"held"`,
  - no unposed waiting people at all → `"empty"`.

  The actionable alert is `"soaking"`/`"held"` — a free bodyscan with an available person
  fills within a tick anyway; the operator only needs to act when candidates are locked away.

`/dispatch` shows the altar-ready count, the altar toggle, and a bodyscan readout
(idle/occupied + blocked reason). Exact field grouping (flat vs a `flow` sub-object) is a
plan-level detail.

## 4. Data / protocol changes

`packages/shared/src/protocol.ts` — `DispatchState` gains:
- `altarOpen: boolean`
- `altarReady: number`
- `bodyscanIdle: boolean`, `bodyscanBlocked: "none" | "soaking" | "held" | "empty"`

All screens-only; nothing added to the OSC/`ShowEvent` contract.

## 5. Config knobs

`config.dispatcher`:
- `fillPriority: Station[]` (default `["bodyscan","intake","altar","paper","waitingroom"]`).
- Altar starts **closed** (no env knob needed; in-memory toggle).

## 6. Files

- `apps/brain/src/config.ts` — `fillPriority`.
- `apps/brain/src/dispatcher.ts` — sort `fill()` by `fillPriority`; `altarOpen` +
  `setAltarOpen`; gate altar in `eligibleStations()`; `snapshot()` derives the flow fields;
  export `setAltarOpen` on the `Dispatcher` interface.
- `apps/brain/src/app.ts` — `POST /api/dispatch/altar`.
- `packages/shared/src/protocol.ts` — `DispatchState` fields above.
- `apps/stage/src/lib/api.ts` — `dispatch.altar(open)`.
- `apps/stage/src/routes/Dispatch.tsx` — altar toggle + flow readouts.
- `apps/stage/src/routes/Station.tsx` — **Done** button for timed stations.

## 7. Test plan (TDD)

**Brain (`apps/brain/test/dispatcher.test.ts`):**
- 1 waiting unposed+unsurveyed person, intake & bodyscan free → assigned to **bodyscan**.
- 2 waiting → bodyscan gets one, intake gets one; 3 waiting → bodyscan + 2 intake.
- Altar closed → an `intake✓+pose✓` waiting person is **not** dispatched to altar and
  `altarReady` counts them; after `setAltarOpen(true)` → dispatched to altar.
- `markComplete` on a **timed** `in_progress` occupant *before* dwell stamps the milestone
  (`waitingRoomAt`/`paperAt`) and frees the slot.
- `snapshot()` carries `altarOpen` and the bodyscan/`altarReady` fields; `bodyscanBlocked`
  reflects soaking vs held vs empty.

**Stage:**
- `Station.test.tsx` — a timed `in_progress` occupant renders **Done** → `api.dispatch.complete`
  and **Release** → `api.dispatch.repool`; a non-timed occupant shows no **Done**.
- `Dispatch` — renders + posts the altar toggle; renders the altar-ready count and bodyscan
  readout from a given `dispatch.state`.

## 8. Risks / open questions

- **Fill priority vs anti-starvation:** anti-starvation still operates inside `select()` per
  station, so a long-waiting person is still rescued; the priority only changes *station*
  order, not the within-station pick. No conflict expected — covered by tests.
- **`altarReady` while a reading runs:** an `in_progress` altar occupant is excluded
  (`!sessionEndAt` but not `waiting`), so the counter reflects *waiting* ready people only —
  intended.
- **Aggregate bottleneck caveat:** bodyscan is the scarce *single-unit* gate, but if the
  intake survey is long, intake's aggregate throughput (2 ÷ survey-time) could bound
  "everyone ready" more than bodyscan does. Out of scope now (we optimize the single gate
  Jared called out); revisit with real service times if the room backs up at intake.

## 9. Rollout / reversibility

Each piece is independent and reversible: `fillPriority` is a config array (revert by
matching `STATION_ORDER`); the altar gate defaults closed but can be left open to mimic
today's behavior; **Done** is additive UI over an existing endpoint; the flow fields are
additive, screens-only snapshot data.
