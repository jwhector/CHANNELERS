# CHANNELERS — Multi-Station Architecture (design spec)

> Status: **design, approved for spec** · Date: **2026-06-19** · Owner: Jared
> Supersedes the single-path flow in `docs/ARCHITECTURE.md` §1–§6 (to be reconciled there during Tier 0 implementation).
> This spec is the durable hand-off for follow-up implementation sessions. It carries the full decision log (§12) and the findings/gotchas (§13) from the design discussion so future agents inherit the reasoning, not just the conclusions.

---

## 1. Why this exists

A team meeting clarified the performance into a **multi-station ritual** with an analog-number identity, two body/scan checkpoints, a gated altar, a deliberately low-tech persona pick, an app-managed visitor queue, and a **new AI-choreography layer**. The current build assumes a single linear path where the visitor picks their oracle *during* intake and a server UUID is the only identity. This spec replaces that.

The original ask was narrow ("remove the Physical Challenge and oracle-selection portions from the intake form"). Grilling the real flow expanded it into an architecture revision. The narrow ask is now **Tier 1**, sitting on a new identity/state spine (**Tier 0**), with a creative layer (**Tier 2**) and a logistics layer (**Tier 3**) on top.

## 2. The physical flow

```
WAITING ROOM ──▶ INTAKE (2 kiosks) ──┐
  analog ticket   number-gate → form  │  (intake & body-scan
  operator                            ├─  in EITHER order)
  registers       BODY-SCAN (1) ──────┘
  presence        number-gate → self-enroll pose → persist template
       │                          │
       │                          ▼
       └──────────────────▶  ALTAR (1, gate)
   dispatcher calls         pose-VERIFY + set persona
   #N → station             → oracleReady
   (operator confirms)           │
   shown on /board               ▼
                            CHANNEL (performer)
                            oracle reading + live choreography
```

One visitor at a time reaches the altar; it is the culmination. Intake and body-scan are order-independent. A brain-side **dispatcher** decides who is called where; an operator confirms each call; `/board` displays it.

## 3. Identity & state model (Tier 0 — the spine)

### 3.1 Identity
- **Number** = human-facing lookup key. Globally-unique plain integers (no day/session namespace). Risk dependency: the analog dispenser must not issue the same number to two present people within one running show session.
- **Internal UUID** stays the primary key. The store gains a `number → id` index. The string key leaves room to add a `{date}-{number}` namespace later if hardware forces number reuse.
- The in-memory store wipes on brain restart, so number reuse *across nights* is free if the brain is restarted between sessions.
- **Record is born at operator arrival-registration** in the waiting room (revised from the earlier "born on first touch" — the dispatcher must know who is present before it can call them to their first station). Every station thereafter **upserts by number**; re-entering a number loads the existing record.

### 3.2 State — two independent layers
A flat set of booleans conflates "what have they finished" with "where are they now." Keep them separate.

**(1) Durable milestones — timestamps (present = done; also drive dwell clocks):**
```
registeredAt · intakeAt · poseAt · personaAt · poseVerifiedAt · sessionStartAt · sessionEndAt
```

**(2) Transient dispatch location — a visitor is in exactly one place at a time:**
```
location = { state: 'waiting' | 'called' | 'in_progress',
             station?: 'intake' | 'bodyscan' | 'altar',
             since: <timestamp> }
```
- `waiting` — in the pool, callable
- `called` — assigned + operator-called to a station, not yet arrived
- `in_progress` — checked in at a station, performing the action
- on completion → write the milestone timestamp, return to `waiting` (or `done`)

### 3.3 Everything else is derived (not stored)
- **eligible to call** = `waiting` AND station predicate (intake: `!intakeAt`; bodyscan: `!poseAt`; altar: `intakeAt && poseAt && !sessionEndAt`)
- **station occupancy** = group by `location.station` where state ∈ {called, in_progress}
- **dwell** = `now − location.since`
- **oracleReady** = `personaAt && poseVerifiedAt && not in an active session`
- **no-show** = `called` past `T_noshow`; **stalled** = `in_progress` past `T_stale`

## 4. Routes (the `stage` app)

| Route | Role | Status |
|---|---|---|
| `/intake` | Two independent kiosks. number-gate → form (data only) → placeholder "where next" message | **modify** — drop the `scan` + `oracle` fields |
| `/bodyscan` | Body-QR station: number-gate → self-invent + hold a pose → **persist the template**. Renamed from `/scan` for clarity | **modify + rename** |
| `/altar` | Operator gate: number → pose-**verify** (load template, match) + **set persona** → mark oracleReady | **new** |
| `/channel` | Performer teleprompter; lobby lists **oracleReady visitors only**. Renamed from `/station` | **rename + modify** |
| `/console` | Master overseer: visitor table + flags + dwell, **all station controls mirrored**, flow/station status, sessions + event feed | **overhaul** |
| `/dispatch` | Lobby-operator interface: arrivals entry, pending assignments, confirm-call buttons, live queue | **new** |
| `/board` | Public lobby call display (`#N → Station`) | **new** |
| `/souvenir` | End-of-show QR takeaway | **unchanged** |

## 5. The body-scan: pose as a self-invented identity token

A reinterpretation of `docs/ARCHITECTURE.md` §6. The pose is now a **biometric identity token (a body-password)**, *not* an archetype classifier.

- Visitor **invents their own shape** and holds it; the angle-vector template is **persisted to their record** keyed by number. (This promotes the existing `/scan` iteration-1 self-recorded round-trip to a real feature and **cancels the iteration-2 pre-authored-archetype-pose plan**.)
- At the altar, the enrolled template is **loaded and re-matched** ("validate your QR code with your body") to unlock. Body-scan and altar are **different machines**, so the template **must round-trip through the brain** — the current `/scan` keeps it only in browser state, so persistence + a load path are new work.
- The shape is **semantically opaque** — no creative meaning is derived from it (left to the interpretation of creator and viewers). Nothing downstream reads it except the verifier.
- "QR code" is **metaphorical** — the body shape *is* the code. The only literal QR is the separate `/souvenir`.
- **Verify failure** (lighting, forgotten shape) → **manual operator unlock**, always available. The CV never strands a visitor.

## 6. Persona selection — the swappable low-tech seam

The physical input mechanism is intentionally **undecided** (write-it-down-then-scan, a button box, etc.) and must avoid a visitor-facing screen/iPad. Engineer for that by decoupling **mechanism** from **effect**.

- **Effect** = one operation: `setPersona(visitor, archetypeId)` → `POST /api/visitors/:id/persona` + emit `oracle.selected`. It only writes the chosen archetype onto the record.
- **Any mechanism** drives that one call — a button box, a scanned card, or an operator tap are interchangeable; nothing downstream knows which.
- **MVP input** = three persona buttons on the operator-run `/altar` screen (the visitor chooses via whatever analog method; the usher reads it and taps). This keeps the *visitor* screen-free; the operator screen is not visitor-facing.
- Menu = the existing **three archetypes** (Child / Tree / AI-on-Drugs). Small fixed set suits a low-tech button/card input.
- `archetype` is **empty on the record until the altar sets it** — it is no longer collected at intake.
- **Persona resolution is a single seam** at session-start that can choose **prompt + few-shot + model** per archetype. This is also the hook for the §5.5 phase-2 fine-tuned-per-persona path (an archetype could route to a different model, not just different prompt context).

## 7. Generation pipeline — split by input-readiness

Today `transform()` makes all three seeds at intake-submit. Because the archetype now arrives late (altar) and choreography depends on it, generation splits by *when its inputs are known*:

| When | Trigger | Generates | Inputs |
|---|---|---|---|
| Intake submit | `POST /api/visitors` (upsert by number) | **Music seed** | intake only |
| Body-scan | enroll pose | *(persist template — no AI)* | — |
| Altar: persona set | `POST …/persona` | **Choreography first-pass** | intake **+ archetype** |
| Channel: session start | `session.start` | **Oracle persona** + **live choreo agent init** | intake + archetype (+ first-pass) |
| Per turn | visitor utterance | oracle reply + choreography cue | conversation |

- **Music** stays archetype-agnostic and is generated early (cheap to have it ready; Anna consumes it when the visitor reaches the altar).
- **Choreography first-pass** = `f(intake, archetype)`, generated at persona-set so it is ready as the reading begins.
- The transform's old **`persona` seed is deleted** — it is dead code today (`divination.start()` builds the persona fresh via `buildPersona()` and never reads `seeds.persona`), and there is no archetype at submit-time anyway.

## 8. The two AI loops (per divination turn)

```
visitor utterance ─┬─▶ oracle agent       → text → channeler earpiece   (exists)
 (+ intake +        │
    transcript)     └─▶ choreography agent → cues → dancer / loudspeaker (new)
```

- **Fan-out**: one visitor utterance drives two consumers off shared context, same `sessionId`.
- **Choreography agent**: initialized at session-start from intake + archetype + first-pass score; reacts **per-turn** to the latest visitor utterance **and** the oracle's reply; streams on a **`choreo.delta`** channel — a **separate feed** from the oracle (dancers' in-ears or a public loudspeaker; routing deferred).
- **Cue format**: **natural language**, with **minimal ambiguity, followable by all performers** — a hard constraint on the choreographer agent's system prompt (the clarity mirror of the oracle's anti-slop deny-list). Not structured params.
- **Model**: same fast streaming model as the oracle (Sonnet 4.6), intake+score prefix prompt-cached. Verify model/caching specifics against the current Claude API reference at build time (per `docs/CLAUDE.md`).
- **Hybrid is the build target**: first pass from intake+archetype, then continuous per-turn generation reacting to the channeling conversation. (A free-running cadence independent of turns is a later option, not MVP.)

## 9. The dispatcher (Tier 3)

The single largest new subsystem: an app-managed visitor queue that calls people to stations.

- **Slots (configurable):** intake **2**, body-scan **1**, altar **1**. The **altar slot is held through the entire altar-gate + oracle reading**, freeing only when the session ends.
- **Eligibility for a free slot:** the `waiting` + station predicate from §3.3. Intake-vs-body-scan order is free.
- **Selection ("randomized to a degree"):** random among eligible `waiting` visitors, except:
  - **Warm-up:** do not dispatch until the pool has **≥ K** waiting *or* **`T_warmup`** elapsed (both configurable) — a deliberate, thematically "unfair" early randomization so the first arrivals don't get FIFO priority.
  - **Anti-starvation:** anyone waiting **> `T_max`** jumps to priority over the random pick.
- **Operator-in-the-loop:** the app marks a visitor **assigned** and surfaces "call **#N → Station**"; the **operator confirms** the call (→ `/board`); the visitor walks over and **checks in** (types the number at the station = arrival confirmation). Calls are not fully automatic — a human confirms each.
- **Presence capture (MVP):** operator keys arrivals into the console; a self-serve `/waiting` kiosk or dispenser integration is deferred until the hardware is known.

### 9.1 Knobs
`K` (warm-up pool size) · `T_warmup` · `T_max` (starvation) · `T_noshow` · `T_stale` (per station) · check-in grace window.

## 10. Failure handling & recovery

Reuses the proven divination session-reaper pattern (`docs/CLAUDE.md` convention: *stateful resources need recovery + liveness-bound cleanup*). A station check-in is just another stateful resource.

**Enabling property — station actions are atomic.** A milestone timestamp is written only on *successful completion* (intake submit, pose lock, verify pass). Partial work is never persisted (a half-filled form lives in browser state only). So "recover" always means **return to `waiting` and re-call** — there is no half-state to repair; re-doing the station via upsert-by-number retries cleanly.

**Three detectors → all converge on auto-return-to-`waiting` (flagged for review):**
1. **Auto-supersede (instant):** a one-at-a-time station physically holds one person, so a **new check-in** there means the prior `in_progress` visitor walked off — auto-return them. Guarantees a 1-slot station can never be permanently wedged. (Intake, capacity 2, supersedes the oldest stale one.)
2. **`T_stale` auto-reap (slow):** an `in_progress` check-in past `T_stale` with no completion auto-returns to `waiting`. Catches the kiosk-alive-but-visitor-gone case where nothing triggers supersede.
3. **Socket-drop grace reap (fast):** bind an `in_progress` check-in to the station's WS `connId` (machinery already exists: `onConnect`/`onDisconnect`/`connId`); if the socket drops and does not reconnect within the grace window, reap to `waiting`. Catches a kiosk crash/reload.

**`called`-but-not-arrived (`T_noshow`) is operator-flagged, NOT auto** — a slowly-walking visitor should not be auto-yanked; the console flags it for the operator to re-call or re-pool. (Open: make this automatic too if rehearsals show it's tedious.)

**Manual backstop (always):** per stuck row on `/console` — **re-pool**, **mark-complete** (finished but the completion did not register), **remove**. Mirrors the existing session Reclaim/End.

## 11. The master console (Tier 3)

`/console` becomes the read-**and-control** overseer; all station controls are mirrored here for single-point access.

- **Panel 1 — Visitors:** every record; milestone flags; dwell timers (time-since-last-check-in, time-since-called); controls (pose-unlock, set/override persona, force-end & reclaim sessions, re-run music/choreography generation, remove/reset, re-pool).
- **Panel 2 — Flow / stations:** a stage funnel with **counts** (registered → intake → pose → oracleReady → channeling → done); for the one-at-a-time stations, **who's currently there** and for how long; a **queued-for-altar** list (oracleReady, oldest first); **station-online indicators** (which station screens are connected, from the WS connections) to spot a crashed kiosk.
- **Panel 3 — Sessions + events:** active sessions (exists) + live `ShowEvent` log.

## 12. Decision log (the why, for future agents)

- **Q1 Identity:** globally-unique integers; UUID stays primary; `number → id` index; born at registration. *Why:* the dispatcher needs presence before first station; in-memory store makes cross-night reuse free on restart.
- **Q2 Intake:** two independent kiosks (two browsers on `/intake`); number-gate → form; placeholder next-step message; routing TBD in rehearsals. *Why:* zero extra engineering, doubles throughput, "bank of terminals" *is* the DMV aesthetic.
- **Q3 Body-scan:** self-invented opaque biometric token; metaphorical QR; persist template; same upsert gate; manual unlock on fail. *Why:* matches "create your QR with your body / validate at the altar"; cancels pre-authored-archetype iteration-2.
- **Q4 Altar:** separate operator-run gate screen; manual session initiation; lobby filters to oracleReady. *Why:* the performer is busy channeling; verify+persona is an usher's job needing a camera the teleprompter lacks.
- **Q5 Persona:** `setPersona` seam; MVP = operator taps on `/altar`; three-archetype menu; empty until altar. *Why:* the physical input is undecided — decouple mechanism from effect so it can be swapped without downstream change.
- **Q6 Choreography:** own channel (dancers or loudspeaker); hybrid — first pass from intake, then live per-turn reacting to the conversation. *Why:* the team wants intake-seeded movement; the real question was during-vs-before, resolved as both.
- **Q7 Choreo runtime:** per-turn cadence; NL cues, minimal ambiguity, followable by all; **archetype feeds the first pass**, so it generates **after persona selection**. *Why:* the persona colors the movement.
- **Q8 Seeds split:** music early (agnostic); choreography at persona-set; persona built at session-start; delete the dead `persona` seed; pose template round-trips the brain. *Why:* generation split by input-readiness; the persona seed is already dead code.
- **Q9 Console:** master overseer, all controls mirrored, dwell timers + per-milestone timestamps. *Why:* single-point observability + control across stations.
- **Q10 Logistics scope:** the app actively **manages the queue and calls** at every juncture, not just tracks. *Why:* user wants balanced station utilization + intentional randomization.
- **Q11 Presence:** MVP = operator keys arrivals; app assigns, operator confirms call; `/board` displays; warm-up pool delay. *Why:* hardware unknown; keep human-in-the-loop; "intentionally unfair" pooling is thematic.
- **Q12 Dispatcher rules:** slots 2/1/1, altar held through reading; assign-then-confirm; warm-up + anti-starvation + no-show knobs.
- **Q13 Scope:** four tiers; this session delivers the spec + Tier 0/1 plan; Tiers 2–3 spec'd, planned in follow-ups. *Why:* avoid context rot degrading the most greenfield plans.
- **State refinement:** two layers (durable milestones + single transient location); generalizes "called to altar" to a uniform called-state.
- **Recovery refinement:** atomic stations; auto-supersede + `T_stale` auto-reap + socket-drop reap → auto-return; no-show stays operator-flagged.

## 13. Findings & gotchas (verified against the code)

- **The transform `persona` seed is dead code.** `divination.start()` ([divination.ts:118-125](../../../app/apps/brain/src/divination.ts)) builds the persona via `buildPersona(archetypeId, visitor)` and never reads `seeds.persona`. Deleting it removes dead code, not behavior.
- **Pose template never persists today.** `/scan` keeps it in React state only — persistence + a brain round-trip are genuinely new for cross-machine altar verification.
- **In-memory store wipes on restart** — cross-night number reuse is free if the brain is restarted between sessions.
- **Identity-birth moved** from "first touch" to "registration" the moment the app had to *call* people to their first station. This was a real contradiction caught mid-design.
- **Leftover debug instrumentation** in `Station.tsx` `toggleMic()` — a `fetch` to `http://127.0.0.1:7562/ingest/...` wrapped in `// #region agent log`. Remove during the `/station`→`/channel` work.
- **Altar slot is held through the entire reading**, not just the gate — the culmination is one-at-a-time end to end.
- **Music can generate early; archetype-dependent choreography cannot** — the split in §7 is forced by this.

## 14. Tier decomposition (build order)

- **Tier 0 — Identity & state core** *(blocks everything)*: number-as-key + `number→id` index, upsert-by-number, registration entry, durable-milestones + transient-location state, store + endpoint changes, timestamps.
- **Tier 1 — Single-visitor critical path**: intake rework (drop scan/oracle fields, number-gate, post-submit message); `/bodyscan` enroll + **persist template**; `/altar` verify + `setPersona`; `/station`→`/channel` (oracleReady lobby, remove debug fetch). One visitor, end-to-end, no logistics.
- **Tier 2 — Choreography layer**: first-pass at persona-set; live parallel agent fan-out; `choreo.delta` channel + separate feed; choreographer clarity-prompt.
- **Tier 3 — Logistics**: dispatcher (slots, eligibility, warm-up, anti-starvation, no-show); `/board`; `/dispatch`; master `/console` overhaul; recovery detectors; station-online indicators; the knob set.

**This session delivers:** this spec + a detailed **Tier 0 + Tier 1** implementation plan. Tiers 2 and 3 are specified here and planned in focused follow-up sessions (independent enough to parallelize).

## 15. Open questions for the team

(To be merged into `docs/ARCHITECTURE.md` §11.)
- **Numbering hardware** — what assigns the analog number, and can it stay purely analog? Confirms whether globally-unique integers hold or a namespace is needed.
- **Presence capture** — does waiting-room registration stay operator-keyed, or do we add a `/waiting` self-serve kiosk / integrate the dispenser?
- **Choreography feed routing** — dancers' in-ears, a public loudspeaker, or both? (Channel is built either way; this is an output-routing decision.)
- **Knob values** — `K`, `T_warmup`, `T_max`, `T_noshow`, `T_stale`, grace window — set defaults, tune in rehearsal.
- **Choreography agent model** — confirm Sonnet 4.6 (fast, characterful) vs. another tier for the second live loop.
- **No-show automation** — keep `T_noshow` operator-flagged, or auto-re-pool like `T_stale`?

## 16. Out of scope / unchanged
- `/souvenir` end-of-show QR generator — untouched by this work.
- Anna/Jeff OSC integration contract (§8/§9-ext) — unchanged; the new events (`oracle.selected` already exists; any `choreo`/dispatch events) extend it additively.
