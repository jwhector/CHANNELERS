# CHANNELERS — Dispatch Redesign: Confirm-at-Station + Addressable Kiosk Slots + 3-Zone Board

> Status: **design, approved for spec** · Date: **2026-06-20** · Owner: Jared
> Revises the **Tier 3** dispatcher built in `docs/superpowers/plans/2026-06-20-tier3-dispatcher-board-console.md`.
> This is an evolution, not a rebuild: the queue engine, state machine, knobs, and recovery concepts carry over. It reshapes how a visitor *arrives* at a station (explicit confirm, not typing), how slots are *modeled* (addressable + kiosk-bound + scalable), and how `/dispatch` *reads* (a 3-zone board).

---

## 1. Why this exists

Three changes to the just-built Tier 3 dispatcher, driven by rehearsal-readiness and immersion:

1. **Arrival by confirmation, not typing.** Today a visitor checks in by typing their number at a station (permissive check-in). That is drift-prone (typos, wrong number, walk-ups needing reconciliation). Instead: the dispatcher calls **#N** to a station, the station screen **displays that number**, and a **Confirm** press transitions `called → in_progress`. No free-text entry.
2. **Per-kiosk identity (addressable, scalable slots).** Each physical kiosk should *own* one bound number. That enables future stylized per-kiosk displays (e.g. a CRT showing an animated glitch of the visitor's number) and a clean "this box = this kiosk = its number" board. The model must be **uniform and scalable**: any number of kiosks per station, set by config (e.g. 3 intake, 2 bodyscan, 1 altar), with graceful handling of fewer/more screens than slots.
3. **A readable board.** `/dispatch` becomes a no-scroll 3-zone layout: waiting pool (left), the slots as rectangles (center), completed visitors (right).

This resolves the deferred ARCHITECTURE §12 open question "scannable/displayed check-in to remove the wrong-number risk of permissive check-in."

## 2. Scope honesty

The **engine's slot model is the real work**. Tier 3 modeled slots as *counts* per station (occupancy = how many called/in_progress/pending at a station). This spec makes slots **addressable and kiosk-bound**, which refactors the engine's core accounting (`occupancy` / `select` / `fill` / `reconcile` become per-slot) and the `dispatch.state` shape. It is contained, not a rewrite — the `waiting → pending → called → in_progress → done` state machine, the knob set, the warm-up + anti-starvation *visitor* selection, the no-show / `T_stale` / socket-drop recovery concepts, the bus multiplex, the OSC-isolation rule, and all of Tier 0/1 + divination are reused unchanged.

## 3. The addressable-slot model (the core change)

### 3.1 Slots are named, uniform, and config-driven
Every station is an **array of named slots**, derived from a configurable per-station count:

```
config.dispatcher.slots: Record<Station, number>   // e.g. { intake: 3, bodyscan: 2, altar: 1 }
→ slot ids: `${station}-${i}` for i in 0..count-1   // intake-0, intake-1, intake-2, bodyscan-0, bodyscan-1, altar-0
```

Singletons (bodyscan, altar at count 1) are just one-slot stations — **no special-casing**. Raising any count adds slots everywhere automatically (engine capacity, board boxes, binding). Nothing hardcodes a slot count.

### 3.2 Slot shape
A slot is the unit of occupancy. Conceptually:

```
Slot = {
  id: string                 // "intake-0"
  station: Station
  kioskId?: string           // the bound screen's stable id (present ⇒ a screen claimed this slot)
  online: boolean            // kioskId is bound AND its socket is currently connected
  occupant?: {
    visitorId: string
    number: number
    state: "pending" | "called" | "in_progress"
    since: string            // ISO; drives the slot's dwell clock
  }
}
```

`pending` / `called` / `in_progress` are now **pinned to a specific slot**, not counted per station. A station's occupancy = its slots that hold an occupant.

### 3.3 Capacity follows online slots
**Effective capacity of a station = its number of free, online slots.** A slot with no connected kiosk cannot display or confirm a number, so **the dispatcher never targets a dark slot**. This single rule produces all the kiosk-count edge cases (§3.5).

## 4. Kiosk binding lifecycle

### 4.1 Identity (hybrid: explicit, else auto-claim)
`station.hello` gains identity fields:

```
WsClientMsg "station.hello" = { station: Station, kioskId: string, slotHint?: string }
```

- **`kioskId`** — a stable per-screen id. From `?kiosk=<label>` if present (deterministic for a fixed install), else a UUID minted once and persisted in the kiosk's `localStorage` (zero-config; a refresh reclaims the same id).
- **`slotHint`** — optional explicit slot target (e.g. `?kiosk=intake-left` mapping to a slot, or `?slot=1`). If given, the kiosk binds that specific slot.

**Binding on connect:**
1. If this `kioskId` is already bound to a slot of this station → **rebind** that slot to the new connection (a refresh/replacement resumes the same slot).
2. Else if `slotHint` names a free slot → bind it.
3. Else **auto-claim** the next free (unbound) slot of that station; remember `kioskId → slotId`.
4. Else (no free slot) → the screen is **surplus**: unbound, flagged, and shown a "no free `<station>` slot" idle state.

### 4.2 Online / offline + drop recovery (reuses detector 3, per-slot)
- A slot is **online** while its bound kiosk's socket is connected.
- On socket close, start the existing `graceMs` timer (default 20s) for that slot. If the same `kioskId` reconnects within grace → resume (slot stays bound, stays online on reconnect). If not → the slot goes **offline**, unbinds, and **if it held a `called`/`in_progress` occupant, that occupant is re-pooled to `waiting`** (flagged `auto-reaped: kiosk-offline`). This is the Tier 3 socket-drop reaper, now scoped to a slot instead of a whole station.

### 4.3 Collisions & surplus
- **Collision** (a different `kioskId` claims a slot that's already live-bound): the newest connection takes the slot (forgiving for a swapped/replaced screen), flagged so the operator notices a possible misconfiguration.
- **Surplus** (more screens than slots): extra screens are unbound, flagged (`surplus <station> screen`), and idle. They auto-bind if a slot frees.

### 4.4 Kiosk-count edge cases (fall out of "capacity = online slots")
For a station configured with N slots:
- **0 kiosks online** → 0 online slots → nothing dispatched there; all its boxes show offline.
- **k < N kiosks** → k online slots → effective capacity k; the other N−k boxes show offline.
- **k = N** → full capacity.
- **k > N** → N online slots; the surplus k−N screens are flagged and idle.

## 5. The two confirms + station flow

Two confirmations by two actors — coherent and distinctly labeled:

| Confirm | Actor | Screen | Transition | Notes |
|---|---|---|---|---|
| **Confirm call** | lobby operator | `/dispatch` | `pending → called` (pinned to slot) | skipped when `dispatcherAutoConfirm` is on |
| **Confirm arrival** | station (visitor/usher) | the kiosk screen | `called → in_progress` | replaces typing the number |

**Station screen flow (`/intake`, `/bodyscan`, `/altar`):**
1. On mount, announce presence (`station.hello` with identity) and **bind a slot** (§4).
2. Read `dispatch.state`; find **this slot**. Idle ("waiting for assignment") until a visitor is `called` to it.
3. When `called` → show **the number + Confirm arrival**.
4. On confirm → `POST /api/dispatch/arrive` (`called → in_progress`), then **load that visitor's record** (by number) and run the **existing** station work — survey / pose-enroll / altar verify+persona — unchanged.
5. On completion (milestone stamp) → the dispatcher reconciles the slot free (occupant → `waiting`/done), exactly as today.

The old type-a-number path survives **only** as a hidden `/console` operator override (`POST /api/checkin` retained for that).

## 6. `dispatch.state` + the 3-zone `/dispatch` board

### 6.1 Snapshot reshape
`DispatchState` changes:
- `slots`: now an **array of `Slot`** (§3.2) — dynamic length = sum of configured counts.
- `completed`: **new** — visitors with `sessionEndAt` set (finished the whole ritual). A mid-reading visitor is *not* here; they remain the `in_progress` occupant of their altar slot until the reading ends.
- `queue`: unchanged in spirit — waiting + eligible visitors, with `number`, `name`, `eligible[]`, `waitingSince` (for the elapsed clock + hover tooltip).
- `pending`: folded into each slot's `occupant` (state `pending`); a top-level list may remain for convenience.
- `stations` online LED: derived from slots (`online` per slot); a station is "up" if ≥1 of its slots is online.
- `flags` / surplus / collisions surfaced for the operator.

### 6.2 The board (no-scroll, 3 zones)
- **Left column — waiting pool.** Every waiting number with **elapsed time**; **name / eligibility / flags on hover (desktop) or tap (mobile)** via a tooltip. Compact, scannable.
- **Center — the slots.** One **rectangle per slot**, laid out in a **responsive grid that scales to the configured slot count** (grouped/labeled by station). Each rectangle shows: **online LED**, the **bound number** (if any) and its **status**. A **`pending` assignment pulses beside its rectangle** with an arrow + **"Confirm call"**; once `called`, the number sits **inside** the rectangle (and that slot's kiosk shows it with its own "Confirm arrival"). An `in_progress@altar` visitor stays in the altar box for the whole reading.
- **Right column — completed.** Visitors with `sessionEndAt` (finished the experience).

`/console` (master overseer) adapts to read the `slots` array and keeps the manual type-a-number override; otherwise its panels are unchanged.

> **No-scroll caveat:** the center grid scales box size to the slot count. At a handful of slots it fits comfortably; at large N the grid densifies (revisit sizing only if a show ever runs many kiosks).

## 7. What changes vs. stays

**Refactored (brain):**
- `dispatcher.ts`: slot model count → addressable; `occupancy`/`select`/`fill`/`reconcile` operate per-slot; kiosk-binding lifecycle (§4); pinned `pending`/`called`; per-slot drop reaper.
- `protocol.ts` / `DispatchState`: `slots` array of `Slot`; add `completed`; `station.hello` gains `kioskId` + `slotHint`.
- `app.ts`: add `POST /api/dispatch/arrive` (`called → in_progress` by slot/visitor); `POST /api/checkin` demoted to the `/console` override.
- `config.ts`: `slots` stays `Record<Station, number>` (now the source of truth for slot ids) — already config-driven.

**Rewritten (stage):**
- `/dispatch`: the 3-zone board + new CSS (columns, slot grid, tooltips, pulse).
- Station gate: `NumberGate`'s `station` prop → a new **`CalledGate`** component (watch this slot → show called number → Confirm arrival → run station work). `useStationPresence` sends slot identity and exposes the bound slot.
- `/console`: adapt to the `slots` array; retain the manual override.

**Untouched:** the `waiting → pending → called → in_progress → done` state machine; knobs; warm-up + anti-starvation visitor selection; no-show flag/auto-repool; `T_stale`; `dispatcherAutoConfirm` / `noShowAutoRepool`; the bus multiplex; OSC-isolation (dispatch stays off `ShowEvent`/OSC); divination + Tier 0/1.

## 8. Testing

Same split as Tier 3:
- **vitest (brain)** — the slot-model refactor gets real coverage: slot derivation from config counts; binding (explicit `slotHint`, auto-claim, `kioskId` reclaim on reconnect); the 0/1/k/N/>N kiosk-count cases; capacity = online-slots; pinned dispatch + per-slot `pending → called → in_progress` → completion-frees-slot; per-slot socket-drop grace reap; collision + surplus flagging. Engine remains bus-injectable + fake-timer driven.
- **Stage** — `pnpm -r typecheck` + `pnpm --filter @channelers/stage build` + written manual browser smokes (multi-kiosk: open two `/intake` tabs, confirm they bind distinct slots; call → confirm-arrival flow; kiosk drop → slot offline + re-pool; surplus screen).

## 9. Decision log (forks settled in this brainstorm)

- **Arrival = confirm-at-station**, not type-your-number. *Why:* removes drift/typo risk; matches the `called` state's intent; answers the deferred scannable-check-in question.
- **Slot model = addressable + kiosk-bound (Approach B)**, uniform across stations. *Why:* each kiosk owns one bound number → enables future stylized per-kiosk displays + a clean board; chosen over count/positional (Approach A) for that identity.
- **Scalable, config-driven slot counts** per station; nothing hardcodes a count. *Why:* allow >2 intake / >1 bodyscan without code change; altar stays 1 but is treated identically.
- **Kiosk identity = hybrid:** explicit `?kiosk=` label, else auto-claim via a stable `localStorage` id. *Why:* deterministic for a fixed install, zero-config otherwise; refresh reclaims.
- **Capacity = free online slots; never dispatch to a dark slot.** *Why:* one rule yields all kiosk-count edge cases; a number must have a screen to land on.
- **Completed column = `sessionEndAt`**; mid-reading stays in the altar box. *Why:* "completed the experience" = the whole ritual incl. the reading; the altar slot is held through the reading by design.
- **Keep type-a-number as a hidden `/console` override.** *Why:* operator safety net if a screen misbehaves.
- **Kiosk drop = per-slot grace-then-repool** (reuse detector 3). *Why:* consistent with the proven Tier 3 recovery pattern.

## 10. Open questions / deferred

- **Stylized per-kiosk display** (e.g. CRT glitch-number) — the data model supports it (one bound number per kiosk); the immersive skin is deferred.
- **No-scroll board at large kiosk counts** — the grid scales; sizing only needs revisiting if a show runs many kiosks.
- **Surplus-kiosk UX** — flagged + idle for now; a richer "standby" treatment is deferred.
- **Per-kiosk slot labels** (`?kiosk=intake-left`) vs auto-claim in the real install — settled in rehearsal once the physical layout is known.

## 11. Out of scope / unchanged
- Tier 2 (AI choreography) — independent; untouched.
- The brain's OSC/`ShowEvent` integration contract — dispatch logistics stay off it.
- Divination session loop, `/channel`, `/souvenir` — untouched.
