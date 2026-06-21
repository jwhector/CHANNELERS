# CHANNELERS — One-Device Kiosk Identity + Kiosk-Reset-on-Release

> Status: **design, approved for spec** · Date: **2026-06-21** · Owner: Jared
> Two stage-only bug fixes on the dispatch redesign. The brain / dispatcher engine and the `dispatch.state` protocol are **untouched**.
> Builds on `docs/superpowers/specs/2026-06-21-station-presence-lifetime-and-waiting-pool-cards.md` (station presence now lives at the route, which both fixes rely on).

---

## 1. Why this exists

Two bugs found while testing the kiosk flow on a single machine:

1. **Same-browser tabs collide onto one slot/number (testing blocker).** The kiosk's auto-generated identity is stored in `localStorage`, which is shared across every tab of one browser. So an `/intake` tab and a `/bodyscan` tab carry the **same `kioskId`**. The dispatcher binds them to *different* slots correctly (`intake-0`, `bodyscan-0`), but the client resolves "my slot" with `slots.find(s => s.kioskId === id)` — matched on `kioskId` only — which returns the **first** slot with that id (`intake-0`) for *both* tabs. Result: both tabs display the same visitor number. This is irrelevant for real multi-device kiosks (separate browsers → separate `localStorage`), but it blocks single-device testing.

2. **Re-pool during an in-progress session doesn't reset the kiosk UI.** After a visitor confirms arrival, the station route holds them in local `visitor` state and renders the work UI. Nothing watches the slot afterward, so if the operator **re-pools** (or removes) that visitor from `/dispatch`, the dispatcher frees the slot but the kiosk stays stranded on the work screen for a visitor who is no longer assigned there.

## 2. Scope

Stage-only. No changes to `apps/brain`, `packages/shared`, the dispatcher engine, `DispatchState`, or any HTTP/WS contract.

## 3. Part 1 — Per-tab kiosk identity

### 3.1 The two changes (both in `apps/stage/src/lib/useStationPresence.ts`)

**Auto-id from `sessionStorage`, not `localStorage`.** The `?kiosk=<label>` override is checked first and is unchanged (deterministic for fixed installs). The fallback auto-id moves to `sessionStorage`:

```
function kioskId(): string {
  const url = new URLSearchParams(location.search).get("kiosk");
  if (url) return url;
  const KEY = "channelers.kioskId";          // per-tab via sessionStorage (a tab renders one station)
  let id = sessionStorage.getItem(KEY);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(KEY, id); }
  return id;
}
```

`sessionStorage` is scoped to a single tab/browsing context: two tabs on one browser get **distinct** ids → each is its own kiosk. A reload keeps the same tab's `sessionStorage`, so the spec's "a refresh reclaims the same slot" property still holds. Only a full tab-close drops the id — fixed installs use `?kiosk=` for durable identity, so this is acceptable.

**Station-scope the slot lookup:**

```
const slot = slots.find((s) => s.kioskId === id && s.station === station);
```

With per-tab ids this is already unambiguous, but the `&& s.station === station` guard is defensive correctness: a `kioskId` must only ever resolve to *this station's* slot (it also covers a hand-set `?kiosk=` label reused across stations).

### 3.2 Why this is enough
The dispatcher already binds per-station correctly (`bind()` reclaim/auto-claim is scoped by station; `handleDisconnect` keys off `connId`, not `kioskId`). The only defect was the client-side lookup; no brain change is needed.

## 4. Part 2 — Reset the kiosk when its slot is released

### 4.1 The mechanism
Each station route already owns its `slot` (from the route-level `useStationPresence`) and its `visitor`. Add a small shared hook:

```
// apps/stage/src/lib/useReleaseToGate.ts
// Fire onRelease() when we hold a visitor but the slot's occupant is no longer
// that visitor in_progress — i.e. the dispatcher released/re-pooled/reassigned
// the slot — UNLESS `suppress` is set (the work UI is showing its own done screen).
useReleaseToGate(
  visitor: VisitorProfile | null,
  slot: Slot | undefined,
  suppress: boolean,
  onRelease: () => void,
): void
```

Implementation: an effect that computes `occupantIsUs = slot?.occupant?.visitorId === visitor?.id && slot?.occupant?.phase === "in_progress"`, and calls `onRelease()` when `visitor && !suppress && !occupantIsUs`. `onRelease` clears the route's `visitor` (and any local form/phase state), returning the route to `CalledGate`.

### 4.2 The `suppress` flag distinguishes "I finished" from "I was pulled"
Completion frees the slot too (the brain `dispatcher.kick()`s on `POST /api/visitors/:id/intake` and `/pose`), so "slot occupant cleared" is ambiguous on its own. `suppress` resolves it per station:

- **Intake** (`Intake.tsx`): `suppress = done`. `done` already exists at route level and gates the "Processed." screen + its existing 5 s reset timer. On re-pool (`!done`, occupant gone) → reset immediately; on completion (`done`) → the confirmation shows, then the timer idles.
- **BodyScan** (`BodyScan.tsx`): `suppress = enrolled`. The terminal state lives inside the `Enroll` sub-component today; surface it to the route via a small `onEnrolled` callback prop so the route can hold a `done` flag (mirrors Intake). The route keeps rendering `Enroll`; the callback only feeds `suppress`. (Optionally add the same brief reset timer Intake has, for parity — but not required.)
- **Altar** (`Altar.tsx`): `suppress = false`. The altar slot is **held through the entire divination reading** and frees externally when `sessionEndAt` is stamped (or on re-pool). So the altar work never self-frees its slot; resetting whenever the slot clears is exactly right — a re-pool *or* a finished reading both correctly return the altar kiosk to the gate. No done-gating.

### 4.3 What `onRelease` resets
Clear the route's `visitor` back to `null` and any per-visitor local state so `CalledGate` renders cleanly for the next call: Intake also resets `name`/`freeText`/`phrases`/`done`/`error`; BodyScan also clears its lifted `done` flag; Altar has no extra route state. The work sub-components (`Enroll`/`Gate`) hold their own state but unmount while `CalledGate` shows, so they remount fresh for the next visitor.

## 5. Decision log
- **Per-tab identity via `sessionStorage`** (over per-station `localStorage` keys or lookup-only fix). *Why:* lets any mix of station tabs — including two of the same station — act as distinct kiosks on one machine; preserves refresh-reclaim; explicit `?kiosk=` still wins for fixed installs.
- **Station-scoped slot lookup** kept as defensive correctness even with unique ids.
- **Reset gated by a per-station `suppress` flag.** *Why:* completion and re-pool both clear the slot; only the kiosk knows whether *it* completed. Keeps the "Processed."/"enrolled" confirmations.
- **Altar reset is ungated.** *Why:* the altar slot is held through the reading and frees externally; returning to the gate when it frees is the desired behavior.
- **No brain/protocol change.** *Why:* both defects are entirely client-side; `dispatch.state` already carries the slot occupant the kiosk needs.

## 6. Testing
Stage-only; per the project constraint (no React test harness):
- `pnpm -r typecheck` (0 errors) + `pnpm --filter @channelers/stage build`.
- **Manual smoke:**
  1. **Per-tab identity:** one browser, open `/intake` and `/bodyscan` (no `?kiosk=`) → they bind `intake-0` and `bodyscan-0` and show different numbers when called. Open a second `/intake` tab → it binds `intake-1` (distinct kiosk). Reload a tab → it reclaims its slot.
  2. **Re-pool reset:** call + arrive a visitor at `/intake`; mid-survey, click that slot's **re-pool** on `/dispatch` → the `/intake` kiosk returns to the gate immediately.
  3. **Completion preserved:** call + arrive, submit the survey → "Processed." shows for its window, then the kiosk idles (no abrupt cut).
  4. **Altar:** arrive a visitor at `/altar`; re-pool from `/dispatch` → the altar kiosk resets to the gate.

## 7. Out of scope / unchanged
- The dispatcher engine, recovery detectors, `DispatchState`, and all HTTP/WS contracts.
- The `?kiosk=` / `?slot=` override semantics.
- The deferred items in ARCHITECTURE §12 (surplus-kiosk UX, stylized per-kiosk displays, reclaim-during-grace).
