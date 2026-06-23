# CHANNELERS — Group/Timed Stations + Station #1 (Scan / Shred / Feed)

> Status: **design, approved for spec** · Date: **2026-06-22** · Owner: Jared
> Extends the **Tier 3** dispatcher (`docs/superpowers/specs/2026-06-20-dispatch-confirm-and-addressable-slots-design.md` + the presence/identity follow-ups of 2026-06-21). This is an additive evolution, not a rebuild: the queue engine, the `waiting → pending → called → in_progress → done` state machine, the knob set, the recovery concepts, and the `ShowEvent`/OSC bus all carry over. It introduces a **second station *kind*** — a kiosk-less, multi-person, timer-completed station — and delivers the first instance of it (`paper`).
> Resumed from `2026-06-22-group-stations-brainstorm-handoff.md` after re-grounding on current code (see §14). Carries the full decision log (§13) and findings/gotchas (§14) so future agents inherit the reasoning, not just the conclusions.

---

## 1. Why this exists

The ritual today is built entirely from **point stations**: one kiosk = one addressable slot = one number on a screen = one visitor, who *arrives* by a Confirm-arrival tap and *completes* by finishing a task that stamps a milestone (intake submit, pose enroll, altar verify). A team direction calls for stations with a different shape:

- **Multiple people at once** (group, not the one-at-a-time altar/channel).
- **No kiosk of their own** (no per-visitor data-entry tablet at the station).
- **Dispatcher-driven**, including people who have never visited that station before.
- **Fixed-timer dwell** — time at the station is governed by a countdown, not by completing a task.

None of these fit the kiosk-bound slot model. This spec defines the smallest backbone that does, and builds the first station on it: **Scan / Shred / Feed** (`paper`).

## 2. Scope (locked)

- **Design now:** (a) the shared **timed-group station backbone** and (b) **Station #1: `paper`** (Scan / Shred / Feed).
- **Station #2 is undefined** — the backbone hosts it later as a slot; do not invent it (YAGNI).
- The upstream **typewriter** that produces the page is a **separate physical prop**, *not* one of the dispatcher-managed stations being designed (§10).
- The feed is **identity-agnostic** for the workshop (the fed text is not tagged to a visitor — §6).

## 3. The new primitive: a *timed group station*

A second station **kind** alongside the existing kiosk point stations. Three properties differ from every existing station, and each maps to a specific engine extension:

| Property | Today (point station) | Timed group station |
|---|---|---|
| **Occupancy** | one occupant per addressable, kiosk-bound slot; capacity = free *online* slots | a **group**: up to `capacity` concurrent occupants; capacity is a plain number, no kiosk needed |
| **Presence / arrival** | kiosk displays `#N`, someone taps **Confirm arrival** (`called → in_progress`) | **none** — the countdown starts at operator **Confirm call**; *"called with a running countdown" is the presence model* |
| **Completion** | a task stamps the milestone; `reconcile()` then frees the slot | the **timer expires** → stamp the milestone, free capacity, re-pool (a new completion mode) |

`paper` is the first instance. The backbone is generic so an undefined Station #2 can be added later by config + one eligibility line, with no engine change.

## 4. Data-model & dispatcher changes

- **`Station` enum** gains `paper` (`apps/shared/src/schemas.ts:45`). The order array the dispatcher iterates (`STATION_ORDER`) includes it.
- **New milestone `paperAt`** (optional ISO string) on `VisitorProfile` (`apps/shared/src/schemas.ts:57-79`), alongside `intakeAt`/`poseAt`/…
- **Eligibility** gains one line in `eligibleStations()` (`apps/brain/src/dispatcher.ts:81-89`): `if (!v.paperAt) out.push("paper")`. The station is **non-gating** — no other predicate depends on `paperAt`, and `paper` has no prerequisite milestone (ungated for MVP; see §10 and §15 for the typewriter-sequencing question).
- **Config:**
  - `config.dispatcher.slots` (`apps/brain/src/config.ts:52`) gains `paper: 4`. For a **timed** station the number means **group capacity**, not addressable kiosk-slot count.
  - A new descriptor marks which stations are timed and carries their dwell, e.g.
    ```ts
    config.dispatcher.timed: { paper: { dwellMs: 300_000 } }   // 5 min
    ```
    The dispatcher branches on `station in config.dispatcher.timed`: timed stations skip kiosk-slot derivation and use the group/timer path below.
- **Occupancy representation.** A timed station does **not** derive addressable `${station}-${i}` kiosk slots (`dispatcher.ts:48-56`). It tracks a **group**: up to `capacity` occupants whose `location = { state, station: "paper", since }`. On operator surfaces it renders as a **group panel** — `Paper (3/4)` listing each occupant's `#N` + remaining time — rather than kiosk boxes.
  - *Implementation note (settle in the plan):* reusing the `Slot[]` array with `capacity` virtual `paper-i` slots (no `kioskId`, always "online") is an acceptable shortcut that lets the board/`DispatchState` (`apps/brain/src/protocol.ts:84-97`) and the existing per-slot rendering be reused with minimal new shape. The group panel is the truer conceptual model; the spec mandates the *behavior*, not the storage shape.

## 5. Presence & completion model (timer-from-call)

The lifecycle for a `paper` occupant, mapped onto the existing state machine:

1. **Assign.** The dispatcher selects an eligible `waiting` visitor for free `paper` capacity → occupant `pending` (same warm-up / anti-starvation selection as today).
2. **Confirm call.** The lobby operator confirms on `/dispatch` (or `dispatcherAutoConfirm`). This:
   - shows `#N → Paper` on `/board`,
   - places the occupant into the paper group as **`in_progress`** (auto-arrive — there is no kiosk arrival to wait for), with `since = call time`,
   - **starts the 5-minute clock** implicitly (`deadline = since + dwellMs`).
3. **Dwell.** The visitor walks over, queues at the single feed slot, and feeds or shreds (§6/§7). The system imposes nothing here; the clock runs regardless of what they do.
4. **Complete.** `reconcile()` (`apps/brain/src/dispatcher.ts:282-307`) sees a timed-station occupant with `age(since) > dwellMs` and takes a **new completion branch**: stamp `paperAt`, remove the occupant from the group, set `location → waiting`. Capacity frees; the next eligible visitor becomes callable.

**Why this dissolves the kiosk-less presence problem:** there is no arrival event to capture and no screen to bind, so the §2-handoff "central new design problem" disappears — the operator's existing Confirm-call *is* the presence signal, and the timer drives completion. Trade-off accepted: a **called-but-absent visitor still auto-completes** (gets `paperAt` without acting). That is fine precisely because `paper` is non-gating spectacle — see §13 Q-Presence.

## 6. The feed pipeline (identity-agnostic spectacle)

`button → capture → OCR → animate + emit paper.fed`

- **Trigger — a physical button.** A `/feed` stage route holds a **webcam** aimed at the slot. The visitor drops the page and presses **one physical button** — a USB arcade button / footswitch that registers as a keypress, *not* a data-entry kiosk. The press grabs a frame. (Tactile, theatrical — "commit the act" — zero staff, within the existing in-browser-CV stack.)
- **Capture → OCR.** The captured frame POSTs to a new Brain endpoint (e.g. `POST /api/paper/feed`, image body). The Brain runs a **`gpt-4o` vision** OCR call (the Brain already owns all AI calls; `gpt-4o` is the configured multimodal model — `apps/brain/src/config.ts:21-36`). **Confirm the vision call shape against the current OpenAI reference at build time** (per `docs/CLAUDE.md`).
- **Offline / degraded fallback** (project convention): if the OCR call fails, animate raw/placeholder text (or the page silhouette) — never block the spectacle.
- **Event.** The Brain emits a **new `ShowEvent` variant** `paper.fed = { text: string, fedAt: string }` — **no `visitorId`** (identity-agnostic). It is added to the `ShowEvent` discriminated union (`apps/shared/src/events.ts:8-18`) with a 1:1 OSC mapping `/channelers/paper/fed` (`events.ts:21-31`). This is an **outward-facing spectacle event** and so *correctly rides the bus + OSC*, unlike dispatch logistics which stay off it.
- **Animation.** A Brain-driven `/feed` display (the same route, or split via `?role=capture` / `?role=display`) renders the visitor's text dissolving "into the matrix" off `paper.fed`. We control the effect fully — **no dependency on Jeff for the MVP**. Jeff's visual rig *can* subscribe to the same `paper.fed` OSC event later (additive).

**Later-ingestion seam (architected, not built):** adding an optional `visitorId?` to `paper.fed` (and optionally persisting `{ text, fedAt }` on the visitor record) is a non-breaking additive change — the project extends events this way freely. Nothing downstream consumes `paper.fed` text today; a future flip can thread it into the music seed / oracle / a collective wall without re-plumbing.

## 7. Shred — physical-only

A real shredder sits at the station. Shredding is **unmodeled** — the software never observes it; the visitor either feeds (captured) or shreds (just gone). Zero build. System-registered shred (a `paper.shredded` event + a "destruction" spectacle, thematically *"even destroying your confession is logged"*) is a clean additive later (one more button + one event on the same bus).

## 8. Recovery & operator backstops

Recovery is **simpler** than a kiosk station, because the two failure surfaces it removes don't exist here:
- **No kiosk** → no socket-drop grace-reap (`graceMs`) for `paper`.
- **No arrival** → no no-show flag/auto-repool (`noShowMs`) for `paper`.
- The dwell timer is the only clock, and it **completes** (stamps `paperAt`) rather than **reaps** (returns to `waiting` with no milestone, flagged).

**Operator backstops** on `/console`, mirroring the existing per-row controls: **re-pool** (cancel a paper occupant without stamping — e.g. they wandered off and should be re-called later), **mark-complete** (stamp `paperAt` early), **remove**.

## 9. Knobs & defaults

| Knob | Default | Meaning |
|---|---|---|
| `config.dispatcher.slots.paper` | **4** | group capacity (concurrent occupants) |
| `config.dispatcher.timed.paper.dwellMs` | **300_000** (5 min) | the fixed dwell countdown; starts at Confirm call |
| countdown visibility | **operator-only** | shown on `/dispatch` + `/console` per occupant; **no visitor-facing clock** |

All tunable in rehearsal. Operator-only visibility keeps the ritual unhurried and the timer thematically *hidden* (surveillance), not a game-show countdown. (Note: `dwellMs` 300s coincides with the existing `staleMs` default at `config.ts:63`, but is a distinct knob.)

## 10. The upstream typewriter (a prop, not a station)

The page the visitor carries to `paper` comes from a **typewriter station** earlier in the journey (analog, surveillance-confession — thematically apt). **Locked:** the typewriter is a **separate physical prop that produces the page**, *not* one of the two dispatcher-managed stations being designed. Whether it is dispatcher-managed at all — and whether `paper` should gate on a "produced a page" notion (a future `typedAt` milestone) — is deferred (§15). For MVP, `paper` is **ungated**; sequencing visitors through the typewriter first is a physical/operational concern, not modeled.

## 11. What changes vs. stays

**New (brain):**
- `apps/shared/src/schemas.ts`: `Station` enum `+ "paper"`; `VisitorProfile` `+ paperAt`.
- `apps/shared/src/events.ts`: `ShowEvent` `+ paper.fed` variant + its OSC address.
- `apps/brain/src/config.ts`: `slots.paper`; new `dispatcher.timed` descriptor.
- `apps/brain/src/dispatcher.ts`: timed-station branch — skip kiosk-slot derivation; group occupancy; auto-arrive on confirm-call; **timer-completion branch in `reconcile()`**; eligibility line.
- `apps/brain/src/app.ts` (or equiv): `POST /api/paper/feed` (image → `gpt-4o` OCR → emit `paper.fed`); offline fallback.

**New (stage):**
- `/feed` route: webcam capture + physical-button trigger + the "into the matrix" animation (off `paper.fed`).
- `/dispatch` + `/console`: a **group panel** for `paper` (occupant `#N` + remaining time, `n/capacity`).

**Untouched:** the `waiting → pending → called → in_progress → done` machine; warm-up + anti-starvation selection; kiosk binding / addressable slots for the point stations; the point-station recovery detectors; `dispatcherAutoConfirm` / `noShowAutoRepool`; the bus multiplex + OSC-isolation rule for dispatch logistics; divination, `/channel`, Tier 0/1/2, `/souvenir`.

## 12. Testing

- **vitest (brain):** timed-station config branch (skips kiosk slots; group of `capacity`); assign → confirm-call → auto-arrive `in_progress` with `since`; **timer-completion** — fake-timer past `dwellMs` stamps `paperAt`, frees capacity, re-pools (vs. the point-station reap path, which must remain unchanged); capacity gating (no 5th concurrent occupant at `capacity = 4`); eligibility (`!paperAt` only; non-gating); operator backstops (re-pool without stamp, mark-complete stamps). Engine stays bus-injectable + fake-timer driven.
- **Brain `paper.fed` / OCR:** the endpoint emits `paper.fed { text, fedAt }` over WS + OSC; offline fallback path on a forced OCR failure animates placeholder text and still emits (or degrades) without throwing.
- **Stage:** `pnpm -r typecheck` + `pnpm --filter @channelers/stage build`; manual browser smokes — `/feed` button press grabs a frame → animation plays off `paper.fed`; `/dispatch` paper group panel shows occupants + counting-down remaining time; confirm-call on a paper visitor starts the clock and auto-completes ~`dwellMs` later (use a short `dwellMs` for the smoke).

## 13. Decision log (the why, for future agents)

- **Q-Kind — a second station kind (timed group), not a tweak to slots.** *Why:* group occupancy + kiosk-less presence + timer-completion each break a core slot assumption; a clean kind keeps the point-station path untouched and lets Station #2 reuse the backbone.
- **Q-Occupancy — group capacity (Option A), not N kiosk-slots (B) or an off-engine subsystem (C).** *Why:* B re-introduces a per-visitor kiosk and the "N labeled boxes" feel the ask rejects; C diverges from the spine and loses the shared recovery/console machinery. A is the smallest *conceptual* extension on the existing Tier 0/3 spine.
- **Q-Presence — timer starts at Confirm call; no attendant, no arrival confirm.** *Why:* it dissolves the kiosk-less presence problem entirely — the operator's existing Confirm-call is the presence signal and the timer drives completion. Accepted trade-off: a called-but-absent visitor auto-completes; fine because `paper` is **non-gating spectacle** (nothing requires `paperAt`).
- **Q-Identity — the feed is identity-agnostic; `paper.fed` carries no `visitorId`.** *Why:* the milestone is already handled per-visitor by the timer; tagging the fed *text* to a person was deemed not worth the friction/ambiguity for the workshop. This also erases the N>1 disambiguation problem. Later ingestion is a non-breaking additive upgrade.
- **Q-Trigger — a physical button (A), not webcam auto-capture (B) or an attendant (C).** *Why:* tactile/theatrical, reliable, zero staff, no kiosk; avoids B's framing/false-trigger tuning and C's re-added staff.
- **Q-OCR — `gpt-4o` vision in the Brain, with an offline fallback.** *Why:* the Brain owns AI calls; `gpt-4o` is the configured multimodal model; the fallback honors the offline-resilience convention. Verify the vision call against the current OpenAI reference at build time.
- **Q-Animation — Brain-driven `/feed` route for MVP; `paper.fed` also on OSC.** *Why:* full control of the dissolve effect with no dependency on Jeff; the OSC event still lets Jeff's rig react later (additive).
- **Q-Shred — physical-only (A).** *Why:* zero build, keeps focus on the one payoff (the feed animation); system-registered shred is a clean additive later.
- **Q-Timer — capacity 4, dwell 5 min, operator-only countdown.** *Why:* generous dwell absorbs walk + queue-at-slot + feed/shred without rushing; hidden clock fits the surveillance tone better than a visitor-facing countdown; all are config knobs to tune in rehearsal.
- **Q-Scope — backbone + `paper` now; Station #2 deferred; typewriter is an upstream prop.** *Why:* YAGNI; the backbone hosts #2 later with config + one eligibility line.

## 14. Findings & gotchas (verified against current code)

Re-grounded against the actual code (the brainstorm handoff warned that `CHANGELOG`/`ARCHITECTURE v0.1` were stale). Confirmed:

- **All routes exist** (`/intake`, `/bodyscan`, `/altar`, `/channel`, `/dispatch`, `/board`, `/console`, `/souvenir`), plus a `/choreo` route (`Choreo.tsx`) not named in the handoff. `Station = z.enum(["intake","bodyscan","altar"])` at `apps/shared/src/schemas.ts:45`.
- **Type locations differ from the handoff's note:** `Slot`/`SlotOccupant`/`DispatchState` live in `apps/brain/src/protocol.ts:64-97` (not `packages/shared`); `Station`/`VisitorProfile`/`VisitorLocation` in `apps/shared/src/schemas.ts:45-79`; `ShowEvent` in `apps/shared/src/events.ts:8-18`. The repo uses `apps/shared`, not `packages/shared`.
- **Occupant phase** is `"pending" | "called" | "in_progress"` (`protocol.ts:64-70`) — some prose calls it `state`; the field is `phase`.
- **Completion is a milestone stamp, freed by `reconcile()`** (`dispatcher.ts:282-307`, via `completionMilestoneSet(v, station)`). Existing timers only *reap*: `graceMs` 20s socket-drop (`config.ts:65`), `noShowMs` 90s called-not-arrived (`config.ts:61`), `staleMs` 300s in_progress (`config.ts:63`). **No timer-completion and no group/multi-person notion exist anywhere** — both are genuinely new (verified by search).
- **`ShowEvent` has 8 variants, all 1:1 OSC-mapped to Anna/Jeff** (`events.ts:8-31`); dispatch logistics ride **internal-only** WS channels (`dispatch.state`, `roster`, `tuning.state`). So `paper.fed` as a new `ShowEvent` correctly rides OSC, consistent with the handoff's bus/OSC distinction.
- **Models:** `gpt-4o` for `TRANSFORM_MODEL`/`ORACLE_MODEL`/`CHOREO_MODEL` (`config.ts:21-36`), multimodal → viable for vision OCR; `whisper-1` STT; ElevenLabs + `gpt-4o-mini-tts` for voice.
- **Arrival today** = `confirm()` (`pending→called`, `dispatcher.ts:174-183`) then `arrive()` (`called→in_progress`, `dispatcher.ts:185-194`); both assume a kiosk screen. `paper` skips `arrive()` (auto-arrives at confirm-call).

## 15. Open questions for the team

(To be merged into `docs/ARCHITECTURE.md` §12.)
- **Typewriter sequencing** — must `paper` gate on having produced a page (a future `typedAt` milestone), or stay ungated as in MVP? Is the typewriter dispatcher-managed at all, or a purely physical corner?
- **Station #2** — still undefined; the timed-group backbone hosts it later.
- **Knob values** — `slots.paper` (capacity) and `paperDwellMs` — set in rehearsal; confirm 4 / 5 min feel right at scale.
- **Identity upgrade** — if/when feed text should be ingested per-visitor, add `visitorId?` to `paper.fed` (and decide the at-the-slot identity mechanism then).
- **Shred** — promote to system-registered (`paper.shredded` + destruction visual) later?
- **Physical** — webcam framing over the slot; button hardware (USB arcade button / footswitch as keypress); capture-screen vs. display-screen split.

## 16. Out of scope / unchanged

- Tier 2 (AI choreography), divination, `/channel`, `/souvenir`, Tier 0/1 — untouched.
- The point-station kiosk-binding, addressable slots, and their recovery detectors — untouched.
- The OSC-isolation rule for dispatch logistics — unchanged (only the outward-facing `paper.fed` spectacle rides OSC).
- Station #2 and the typewriter's internals — not designed here.
