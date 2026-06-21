# CHANNELERS — Station Presence Lifetime Fix + Waiting-Pool Cards

> Status: **design, approved for spec** · Date: **2026-06-21** · Owner: Jared
> Two stage-only polish items on the dispatch redesign (`docs/superpowers/specs/2026-06-20-dispatch-confirm-and-addressable-slots-design.md`).
> The brain / dispatcher engine and the `dispatch.state` protocol are **untouched**.

---

## 1. Why this exists

Two issues surfaced after the dispatch redesign landed:

1. **Station presence dies on arrival (a real bug, not just cosmetic).** The kiosk's WebSocket lives in `useStationPresence`, which is called *inside* `CalledGate`. `CalledGate` unmounts the instant a visitor confirms arrival (the route swaps to the station work UI), so the socket closes. The dispatcher then runs its per-slot socket-drop path: after `graceMs` (~20 s) the slot goes **offline**, **unbinds**, and **re-pools the in-progress occupant back to `waiting`** (`auto-reaped: kiosk-offline`). So a visitor mid-survey/pose/altar is yanked back into the pool, the slot frees (and may be re-dispatched to someone else), and `/dispatch` shows the kiosk offline — even though the screen is open and in use.

2. **Waiting pool hides identity behind hover.** The `/dispatch` left zone shows each waiting visitor as `#N` + elapsed, with name / eligibility / flags only in a hover `title` tooltip — not usable at a glance or on a touch display. The operator wants the **name and eligible stations listed inline** with the number.

## 2. Scope

Stage-only. No changes to `apps/brain`, `packages/shared`, the dispatcher engine, `DispatchState`, or any HTTP/WS contract. `dispatch.state.queue` already carries everything Part 2 needs.

## 3. Part 1 — Station presence spans the screen's lifetime

### 3.1 The change
Lift `useStationPresence(station)` from inside `CalledGate` up to each station **route** (`Intake`, `BodyScan`, `Altar`). The route calls the hook once and holds the single kiosk socket for the screen's **entire** lifetime — gate → work → done → reset — regardless of which child is rendered. The slot therefore stays `online` and bound to its `kioskId` throughout the visitor's work, so the dispatcher never grace-reaps an in-progress occupant and `/dispatch` never shows a false offline.

### 3.2 `CalledGate` becomes presentational
`CalledGate` no longer calls `useStationPresence`. Its props become:

```
CalledGate = {
  station: Station          // used only for the "no slot bound / wait for a free <station> slot" copy
  title: string
  connected: boolean        // from the route's useStationPresence
  slot: Slot | undefined    // from the route's useStationPresence
  onArrived: (visitor: VisitorProfile) => void
}
```

It keeps its existing responsibility — render the idle / called states off `slot.occupant`, drive **Confirm arrival** (`api.arrive`), and run the `onArrived` effect when this slot's occupant reaches `in_progress` (loads the record by number, hands it up). The effect now reads the `slot` **prop** instead of a locally-owned hook.

### 3.3 Each station route
Pattern (all three routes):

```
const { connected, slot } = useStationPresence(station);
if (!visitor) return <CalledGate station=… title=… connected={connected} slot={slot} onArrived={setVisitor} />;
return <Work … connected={connected} />;   // socket stays alive because the route (and its hook) stay mounted
```

This also resolves the current dangling `useStationPresence` import in `Intake.tsx` (imported, not yet called) by giving it its proper home, and guarantees **exactly one socket per kiosk** (never the route *and* `CalledGate` both calling the hook — which would double-bind the same `kioskId`).

### 3.4 Work-screen "live" LED (small, included)
The station work UIs (intake form, body-scan `Enroll`, altar `Gate`) currently render their own header with no connection indicator. Pass `connected` down and add the same small LED (`<span className={connected ? "led on" : "led"} />`) the gate already uses, so the kiosk visibly reflects its live connection during the work, not only on the gate. Minor and self-contained; the LED markup/CSS already exists.

### 3.5 What does NOT change
The dispatcher's grace-then-reap behavior is correct and stays — it should fire when a kiosk *actually* disconnects (tab closed, network drop). We are only ensuring the socket isn't torn down spuriously while the screen is still open. No brain changes.

## 4. Part 2 — Waiting pool as stacked cards

### 4.1 Layout
Replace the single-line `.pool-item` (number + elapsed, identity in a hover `title`) with a **stacked card** in the left zone:

```
┌────────────────────────────┐
│ #412                   18s  │   ← number (prominent) + elapsed (top-right)
│ Jordan Avery                │   ← name (or "(no name)")
│ [intake] [bodyscan]   ⚑no-show │ ← eligible stations as chips · flag badge only when present
└────────────────────────────┘
```

- **Number** prominent; **elapsed** top-right (live, off `waitingSince`, refreshed by the existing 1 s tick).
- **Name** on its own line; `(no name)` when absent.
- **Eligible stations** rendered as small chips, one per `eligible[]` entry.
- **Flags** shown as a badge **only when `flags.length > 0`** (e.g. `no-show`); no badge otherwise.
- The redundant hover `title` tooltip is **removed** (everything is visible now).

### 4.2 Implementation
- `Dispatch.tsx`: rework only the left-zone `state.queue.map(...)` item markup (number/elapsed row, name row, chips + flag row). No data or socket changes.
- `styles.css`: restyle `.pool-item` to a stacked card (column flex, padding, the number/elapsed top row), add `.pool-chip` (small station pill) and `.pool-flag` (flag badge). Keep `.pool-list` and the `.zones` grid as-is.
- The right (completed) zone keeps its current compact item style — this change is scoped to the **waiting** pool only.

### 4.3 Density note
Cards are taller than the old one-liners; with many waiting visitors the left zone could exceed the viewport. For workshop scale (a handful waiting) this is fine; if it ever overflows, the left zone scrolls independently. Revisit only if a show runs large queues.

## 5. Decision log
- **Presence lives at the route, not the gate.** *Why:* the socket must outlive `CalledGate` (which unmounts on arrival); the route is mounted for the whole visit. Chosen over an app-level context (overkill for 3 routes) and a keep-alive wrapper (same effect, more indirection).
- **`CalledGate` takes `connected`/`slot` as props.** *Why:* one socket per kiosk; the gate stays a focused presentational unit with its arrival effect.
- **Work-screen LED included.** *Why:* the kiosk should reflect its live link during work, not only at the gate; trivial cost.
- **Waiting item = stacked card with chips.** *Why:* scannable in the narrow left column, touch-friendly, handles long names; identity is visible, not hover-gated.
- **No brain/protocol change.** *Why:* `dispatch.state.queue` already carries `number`/`name`/`eligible`/`waitingSince`/`flags`.

## 6. Testing
Both parts are stage-only; per the project constraint (no React test harness) verify with:
- `pnpm -r typecheck` (0 errors) + `pnpm --filter @channelers/stage build`.
- **Manual browser smoke (Part 1):** open `/dispatch` + `/intake?kiosk=intake-A`; call a visitor → Confirm call → Confirm arrival; with the survey on screen, confirm the `/dispatch` `intake-0` box **stays online and `in_progress` for >30 s** (no flip to offline / back-to-waiting). Bonus: close the `/intake` tab → confirm the slot *does* grace-reap (the recovery path still works).
- **Manual browser smoke (Part 2):** with several waiting visitors, confirm each left-zone card shows number, name, eligible-station chips, elapsed, and a flag badge when flagged — no hover needed.

## 7. Out of scope / unchanged
- The dispatcher engine, recovery detectors, `DispatchState`, and all HTTP/WS contracts.
- The completed (right) zone and the center slot grid styling.
- Surplus-kiosk UX, stylized per-kiosk displays, and the other deferred items in ARCHITECTURE §12.
