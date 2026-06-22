# CHANNELERS — System Architecture (v0.1 draft)

> Status: **current architecture** as of 2026-06-20. Owner: Jared. Scope: **workshop MVP** (June 22–28, 2026).
> **2026-06-20:** The multi-station redesign IS the current architecture. **Tier 0 (identity/state foundation) + Tier 1 (single-visitor path: register → intake → bodyscan → altar → channel) + Tier 3 (dispatcher/board/console logistics) are implemented.** Only **Tier 2 (AI choreography feed)** remains designed but not built. Full design rationale and decision log: `docs/superpowers/specs/2026-06-19-multi-station-architecture-design.md`. §3–§6 and §8 of this document are reconciled to the implemented reality.

## 1. The shape of the thing

One local service — the **Show Brain** — owns visitor data and all AI calls, and speaks the standard live-performance protocols (**OSC / MIDI / WebSocket**) so Anna's music rig and Jeff's visual rig plug in without depending on its internals.

```
       INTAKE                        SHOW BRAIN (the hub)               PERFORMERS / OUTPUT
 ┌──────────────────┐         ┌────────────────────────────┐       ┌─────────────────────┐
 │ Intake app       │  submit │ • visitor profiles (DB)    │ seeds │ Oracle performer     │
 │ (tablets/kiosks) │────────▶│ • transform (OpenAI):      │──────▶│  earpiece (TTS) /    │
 │  + vibe-phrase Qs│         │     intake → music seed    │       │  hidden teleprompter │
 │                  │         │     intake → dance score   │       ├─────────────────────┤
 │ Scan stations:   │  events │     intake → oracle persona│ OSC/  │ Anna  (music rig)    │
 │  • pose CV       │────────▶│ • live divination loop:    │ MIDI  │   ← lyrics / params  │
 │  • fiducial cards│         │     STT → LLM → TTS         │──────▶├─────────────────────┤
 └──────────────────┘         │ • operator console (web)   │ events│ Jeff  (visuals / TD) │
                              │ • OSC / WebSocket event bus │──────▶│   ← show state       │
                               └────────────────────────────┘       └─────────────────────┘
```

Three flows pass through it:

1. **Intake capture** → a structured visitor *profile*.
2. **Transform** → three *seeds*: a music seed, a dance/movement score, and a customized Oracle persona.
3. **Live divination** → STT → Oracle LLM → TTS into the performer's earpiece (or a hidden teleprompter).

## 2. Principles

- **TypeScript end-to-end.** CV runs in-browser (no Python sidecar).
- **Loose coupling via OSC/WebSocket.** Anna and Jeff subscribe to show events; they never call into the Brain's internals.
- **Human-in-the-loop.** AI proposes; the operator and performers dispose. Nothing the AI emits goes straight to the audience unmediated.
- **Offline-resilient.** Venue wifi is unreliable. The Brain runs locally; only OpenAI/STT/TTS calls leave the machine, and each degrades gracefully (cached fallback lines, manual override) if an API call fails mid-show.
- **MVP for the workshop.** Favor the smallest thing that's performable live over the complete thing.

## 3. Repo layout (pnpm workspace)

```
channelers/
  apps/
    brain/      Fastify + ws + node-osc + openai               — the hub
    stage/      Vite + React + TypeScript                     — all screens, role-based routes:
                  /intake    visitor kiosk: confirm-at-station gate → data-only survey → handoff to Physical Challenge
                  /bodyscan  pose identity token enrollment (enroll self-invented pose → poseTemplate)
                  /altar     pose verify + persona pick → oracle-ready
                  /channel   performer page: lobby of oracle-ready visitors → teleprompter (renamed from /station)
                  /console   master overseer: visitors+controls / flow funnel+station LEDs / sessions+event log
                  /board     public call display: #N → STATION (live dispatch.state broadcast)
                  /dispatch  lobby-operator interface: register arrivals, confirm/skip calls, manage queue
                  /souvenir  QR takeaway
                  -- Tier 3 deferred: /waiting (waiting-room self-serve kiosk, not yet built)
  packages/
    shared/     zod schemas + TS types + the OSC/event contract
    oracles/    persona prompt templates (child / AI-on-drugs / tree / …)
```

> Alternative: Next.js for `stage`. Recommendation is the Vite + standalone Fastify split — the WebSocket/OSC server has a cleaner lifecycle as its own long-lived process, and the kiosk screens are a plain SPA.

## 4. Data model (zod-first)

Source of truth: `packages/shared/src/schemas.ts`.

```ts
// packages/shared/src/schemas.ts (authoritative — this is a summary)
type VibePhrase = { axis: "vulnerability" | "tension" | "hopefulness"; choice: string }

/** No `archetype` field — oracle is chosen at the altar, not during intake. */
type SurveyResponse = {
  name: string
  freeText: Record<string, string>     // "something you recently lost", "are you tender?", …
  phrases: VibePhrase[]                 // the three close-relationship phrase pickers
}

/** Self-invented biometric identity token enrolled at /bodyscan. */
type PoseVector = { angles: number[]; weights: number[] }

/** Transient dispatch location — the per-visitor truth. The dispatcher's addressable
 *  slot registry (kiosk-bound `Slot`/`SlotOccupant`, see §5.x) is an addressing layer on
 *  top of this; eligibility, /channel, and /console keep reading `location`. */
type VisitorLocation = {
  state: "waiting" | "called" | "in_progress"
  station?: "intake" | "bodyscan" | "altar"
  since: string
}

type VisitorProfile = {
  id: string
  /** Human ticket number — the cross-station lookup key. */
  number: number
  /** Optional: absent for a just-registered visitor; present once intake is completed. */
  survey?: SurveyResponse
  /** Oracle archetype — chosen at the altar (POST /api/visitors/:id/persona), NOT during intake. */
  archetype?: string
  /** Enrolled pose identity token (body-scan station). */
  poseTemplate?: PoseVector
  /** Legacy scan results (retained for back-compat; not used by the new station flow). */
  scans: ScanResult[]
  location: VisitorLocation
  createdAt: string       // = registeredAt
  intakeAt?: string
  poseAt?: string
  personaAt?: string
  poseVerifiedAt?: string
  sessionStartAt?: string
  sessionEndAt?: string
}

/** Legacy CV scan result — retained for /scan back-compat, not used by new station flow. */
type ScanResult =
  | { kind: "pose";     archetypeGuess: string; keypoints: number[][]; confidence: number }
  | { kind: "fiducial"; cards: { id: number; slot: number }[] }

type MusicSeed   = { mood: string; tempoBpm: number; key: string; lyricThemes: string[]; synthPalette: string[] }
type DanceScore  = { qualities: string[]; spatial: string; spiritAnimalShape: string; cues: string[] }
type OraclePersona = { archetype: string; systemPrompt: string; openingLine: string }

/** Seeds.persona is deprecated in the new flow — persona is built fresh in divination.start
 *  from the visitor's top-level `archetype` field (set at the altar). Music seed still applies. */
type Seeds = { music: MusicSeed; dance: DanceScore; persona: OraclePersona }

// the bus envelope every subscriber sees
type ShowEvent =
  | { type: "visitor.submitted"; profileId: string }
  | { type: "seeds.ready";       profileId: string }
  | { type: "scan.pose";         archetypeGuess: string; confidence: number }
  | { type: "scan.fiducial";     cards: number[] }
  | { type: "oracle.selected";   profileId: string; archetype: string }
  | { type: "divination.started" | "divination.ended"; profileId: string }
  | { type: "souvenir.minted";   profileId: string; url: string }
```

## 5. The pipeline

### 5.1 Intake capture
Custom kiosk app, themed as the DMV-void. Gates on a **number entry** (the visitor's ticket number, which creates-or-fetches a `VisitorProfile`). Renders the data-only intake questions (`intake.md`): name, free-text absurdist prompts, and the three "State of vulnerability / tension / hopefulness" phrase pickers. **No scan placeholders, no oracle picker** — those steps are separate stations. On submit, `POST …/intake` attaches the `SurveyResponse`, emits `visitor.submitted`, and fires the music-seed transform (fire-and-forget). The screen then directs the visitor to **proceed to the Physical Challenge** (the body-scan station). The body-scan is its own station (`/bodyscan`), not a form field.

### 5.2 Transform (intake → seeds)
An OpenAI call per visitor turns the profile into the **music seed** (Tier 2 §7 narrowed `Seeds` to `{ music }` — the old archetype-agnostic `dance` seed and the dead `persona` seed were deleted; choreography moved to persona-set, see §5.6).

- Model: **gpt-4o** (`config.transformModel`, default `gpt-4o`; configurable via `TRANSFORM_MODEL`). Structured outputs (`response_format` json_schema) are available but not yet wired — the transform currently prompts for JSON and validates with zod, falling back to a deterministic stub on any miss or when no `OPENAI_API_KEY` is set.
- The music seed → Anna. It is archetype-agnostic, so it generates early at intake-submit (cheap to have ready by the time the visitor reaches the altar). The persona is built fresh at session-start via `buildPersona()`; choreography is generated at persona-set (§5.6).

### 5.3 Live divination (the earpiece loop)
The visitor speaks → STT → the Oracle persona LLM → text/TTS to the performer, who channels it. Two performer modes, selectable per Oracle:
- **Whisper** — performer hears TTS in-ear and repeats/interprets.
- **Teleprompter** — performer reads the streamed text off a hidden screen and improvises.

**Session model:** the brain holds **multiple concurrent sessions**, one per visitor, keyed by `sessionId`. A `roster` broadcast keeps every connected screen up to date. Performers use `/channel`: the lobby lists **oracle-ready visitors** only (those who have completed intake + bodyscan + altar: `personaAt` set + `poseVerifiedAt` set + no active `sessionEndAt`); one tap claims a visitor and drops directly into the teleprompter. Session messages carry `sessionId` so parallel streams don't bleed across screens.

**Session liveness & recovery:** a session's lifetime is bound to its owning performer's connection, not just to an explicit `session.end`. The client persists its `{sessionId, visitorId}` handle (localStorage) and on every (re)connect sends `session.rejoin`; the brain replies `session.resumed` with the full history + teleprompter so a page refresh or transient socket blip transparently re-attaches. When a performer's socket drops, the brain starts a grace timer (`SESSION_GRACE_MS`, ~90s) and reaps the orphan if no one re-attaches — so an abandoned tab frees the visitor instead of stranding it "being channelled" forever. The lobby's active-session rows also expose manual **Reclaim** / **End** controls as a backstop — now mirrored on the `/console` master overseer (§11).

**Archetype assignment (persona seam):** the oracle persona is chosen at the **altar** (`POST /api/visitors/:id/persona`), after the visitor has verified their pose. The performer's `/channel` lobby shows the archetype already set; there is no oracle selection on the performer's end. `divination.start` reads the record's top-level `archetype` field and guards on missing `survey` or missing `archetype` before starting a session.

Engineering notes (grounded against the OpenAI API reference):
- **Stream** the response (`chat.completions.create({stream:true})`) iterated with `for await ... chunk.choices[0].delta.content` so the performer hears words as they generate — TTFT is everything in a live loop.
- **OpenAI caches identical prompt prefixes automatically** — no manual cache step or pre-warm needed.
- **Both default to gpt-4o** (configurable); for a lower-latency live loop, a smaller model like **gpt-4o-mini** can be set via `ORACLE_MODEL`.
- gpt-4o has no separate thinking parameter — no special flag needed to keep the Oracle turn fast.

**Altered-State tuning (operator dials).** Generation is no longer hardcoded. A single global `OracleTuning` (`packages/shared/src/tuning.ts`) is the live control surface, edited from the `/channel` console (`AlteredStateConsole`, operator-only) and held in the brain (`apps/brain/src/tuning.ts`, `getTuning()`). It rides its own `tuning.set`/`tuning.state` WS messages — **kept off the `ShowEvent`/OSC contract**, like dispatcher logistics. It carries: **sampling** (temperature/top_p/penalties/max_tokens), the PHARMAICY-module **effects** vocabulary + an `effectsDriveSampling` toggle that ports the module's `getApiSettings()` nudge, a **preset** label (light→surreal, values copied verbatim from `app/Ayahuasca_v1.3.js` — selecting one loads editable numbers), the opt-in **text pipeline** (`promptDrift` injects an `[ALTERED PERCEPTION]` system-prompt block; `outputMangle` runs the finished reply through ported regex stylists and therefore **buffers** instead of streaming), and **scope** (oracle / transform / both). `resolveSampling(tuning)` clamps to OpenAI-valid ranges. `DEFAULT_TUNING` reproduces the prior behavior exactly (temp 1, pipeline off). The text pipeline also runs on the offline fallback so it's testable with no key. Origin/rationale: §5.5 + spec `docs/superpowers/specs/2026-06-21-altered-state-console.md`. **Per-control operator reference: `docs/altered-state-console.md`.**

### 5.x Visitor dispatcher (confirm-at-station + addressable kiosk slots)

The dispatcher (`apps/brain/src/dispatcher.ts`, `createDispatcher(bus)`) is an in-memory engine that manages visitor flow across the three stations. It runs alongside divination — the Bus multiplexes hooks so both subsystems coexist. (Spec: `docs/superpowers/specs/2026-06-20-dispatch-confirm-and-addressable-slots-design.md`.)

**Addressable slots (the model):** every station is an array of named slots derived from config counts — `config.dispatcher.slots: Record<Station, number>` (default intake 2 / bodyscan 1 / altar 1) → slot ids `${station}-${i}` (e.g. `intake-0`). Nothing hardcodes a count; raising a count adds slots everywhere (engine capacity, board boxes, binding). Each slot is **bound to a kiosk screen** and is **online** only while that screen's socket is connected. **Effective capacity of a station = its number of free, online slots** — the dispatcher never targets a dark (offline) slot, which yields all the 0/k/N/>N kiosk-count cases for free. The altar slot is held through the whole divination reading and freed when `sessionEndAt` is stamped.

**Kiosk binding (spec §4):** a screen announces `station.hello { station, kioskId, slotHint? }` (`kioskId` from `?kiosk=` else a stable `localStorage` UUID; `slotHint` from `?slot=`). Binding: reclaim the slot this `kioskId` already owns (a refresh/reconnect within grace resumes it) → else bind an explicit free `slotHint` → else auto-claim the next free slot → else the screen is **surplus** (flagged, idle, auto-binds when a slot frees). Collisions on a live slot are forgiving (newest wins, flagged).

**State machine:** `waiting → pending → called → in_progress`, now **pinned to a specific slot** (occupancy is per-slot, not a per-station count). `pending`/`called`/`in_progress` live as the slot's `occupant`; `visitor.location` stays the per-visitor truth (`waiting | called | in_progress` + station), synced to the occupant for `called`/`in_progress`. Completion stamps the station's milestone and frees the slot.

**Two confirms (spec §5):** arrival is an explicit press, not a typed number. (1) **Confirm call** — lobby operator on `/dispatch` (`pending → called`, pinned to the slot; skipped when `autoConfirm`). (2) **Confirm arrival** — station kiosk via `CalledGate` (`called → in_progress`, `POST /api/dispatch/arrive`), which then loads the visitor record and runs the existing station work. `CalledGate` takes `skin?: "crt" | "default"`: `/intake` opts into the **CRT skin** (amber segmented-LED number + the existential **I AM** confirm, rendered inside `CrtShell`); `/bodyscan` and `/altar` keep the default gate. The whole `/intake` flow (standby · called · survey · processed) is skinned as a DMV-purgatory CRT terminal — see the Intake CRT redesign in `CHANGELOG.md`.

**Selection:** anti-starvation over random among eligible `waiting` visitors not already occupying a slot (eligibility: intake ← missing `intakeAt`; bodyscan ← missing `poseAt`; altar ← `intakeAt` + `poseAt` set, no `sessionEndAt`), `fill()`ing only **free online** slots, gated by:
- **Warm-up:** pool size ≥ K OR T_warmup elapsed since first registration — avoids dispatching a single lonely visitor.
- **Anti-starvation:** a visitor who has waited longer than T_max is priority-picked over the random selection.

**Recovery detectors:**
1. **Per-slot socket-drop grace reap:** on a kiosk socket close, that slot's `graceMs` timer starts (slot goes offline immediately; binding held for reclaim). If the same `kioskId` reconnects within grace → resume; else the slot unbinds and any `called`/`in_progress` occupant is re-pooled to `waiting` (flagged `auto-reaped: kiosk-offline`).
2. **T_stale auto-reap:** `reconcile()` (periodic tick) reaps any `in_progress` slot occupant whose `since` age exceeds `staleMs` — back to `waiting`.
3. **Manual override:** `POST /api/checkin { number, station }` survives as the hidden `/console` operator safety net (for a misbehaving screen) — forces the visitor `in_progress@station`, best-effort pinning a free online slot. The old auto-supersede/`walk-up` behavior is gone.

**No-show:** a visitor called but not arrived after `noShowMs` is flagged `no-show`. Operator can re-pool manually; the `noShowAutoRepool` knob auto-re-pools instead.

**Knobs** (all in `config.dispatcher`, env-overridable):

| Knob | Env var | Default | Meaning |
|------|---------|---------|---------|
| `K` | `DISPATCH_K` | 3 | Warm-up pool size |
| `warmupMs` | `DISPATCH_T_WARMUP_MS` | 60 000 | Warm-up elapsed fallback |
| `maxWaitMs` | `DISPATCH_T_MAX_MS` | 240 000 | Anti-starvation threshold |
| `noShowMs` | `DISPATCH_T_NOSHOW_MS` | 90 000 | No-show flag threshold |
| `staleMs` | `DISPATCH_T_STALE_MS` | 300 000 | Stale-occupant reap threshold |
| `graceMs` | `DISPATCH_GRACE_MS` | 20 000 | Socket-drop grace window |
| `tickMs` | `DISPATCH_TICK_MS` | 5 000 | Reconcile cadence |
| `autoConfirm` | `DISPATCH_AUTO_CONFIRM` | false | Skip operator confirm step |
| `noShowAutoRepool` | `DISPATCH_NOSHOW_AUTOREPOOL` | false | Auto-re-pool no-shows |

Defaults are rehearsal-fast (small K, short timers). Tune for a full-audience show via env.

**Transport:** a `dispatch.state` WS broadcast carries the full `DispatchState` — now `{ slots: Slot[], queue, completed, surplus, stationsOnline, warmedUp }` (the slots array replaces the old per-station count map + call board; `completed` = visitors with `sessionEndAt`; `surplus` = connected screens with no free slot; `stationsOnline` = derived per-station LED). It is pushed on every state change **and** sent to each screen on connect. This channel is **screens-only — never OSC** — dispatcher logistics are deliberately kept off the `ShowEvent`/OSC contract (§9-ext). `/dispatch` renders this as a no-scroll 3-zone board (waiting pool · slot grid · completed); `/board` derives the public call list from slots in the `called` phase; `/console` reads the slots array and keeps the manual override.

**HTTP endpoints:** `POST /api/checkin` (`/console` override) · `GET /api/dispatch` · `POST /api/dispatch/arrive` · `POST /api/dispatch/assign { visitorId, slotId }` · `POST /api/dispatch/{confirm,repool,complete,remove}` (all `{ visitorId }`; `complete` infers the station from the slot). `recall` removed.

### 5.4 Output integration
- **Anna (music):** the Brain hands her the `MusicSeed` (lyrics + tempo/key/palette) over WebSocket — rendered on a simple "now generating for visitor N" panel she reads from, and/or pushed as OSC for her rig.
- **Jeff (visuals):** the Brain emits `ShowEvent`s over OSC; his system (likely TouchDesigner/Resolume) reacts (e.g. `scan.pose` → trigger a light-cone cue; `divination.started` → shift the projection).
- **Dancers:** the `DanceScore` shows on the `/oracle` or a dedicated screen.

### 5.5 Persona voice — avoiding the generic-AI register
The enemy isn't "AI" — the show is *about* transactional AI — it's the **helpful-assistant register**: hedging, balance, bullet lists, "as an AI I can't…," safety-theater, and the tell-tale vocabulary. Killing that is mostly prompting + sampling, and for a workshop that gets us 80–90% of the way with no training at all:

- **Few-shot with real source material.** The piece already wants voices "trained on the language of young children, elders, and mystics." Curate a small corpus per archetype (transcripts, found text, the collaborators' own writing) and inject 3–8 examples as the voice anchor — far stronger than piling adjectives into a system prompt.
- **Prefill the Oracle's turn.** Start the assistant message mid-voice so it can't open with preamble and locks into register immediately.
- **Anti-slop constraints.** Explicit bans: no hedging, no "it's important to note," no balanced summaries, no lists unless asked, never break character. A shared deny-list lives in `packages/oracles`.
- **Sampling.** Raise temperature for idiosyncrasy — the Oracles should be strange, not safe.
- **A concrete style spec per archetype.** Sentence length, vocabulary, what they fixate on, what they refuse to understand (the tree doesn't know what a "job" is).

**Phase-2 exploration (not for this workshop):** fine-tune a small **open** model (Llama/Mistral/Qwen + LoRA via Unsloth) for a voice baked into the weights that needs no giant prompt and won't drift. The cheap way to a dataset is **distillation** — use well-prompted Claude now, harvest the best outputs (plus the curated corpus) as training data, fine-tune later. This matches the show's "bespoke-trained personae" framing and the director's prior fine-tuning work. Note: Anthropic offers no self-serve fine-tuning of flagship Claude (only Haiku via Bedrock, or enterprise custom-model engagements), so the bespoke path means open weights — which also buys offline operation and no per-query cost. Questions for the director in §11.

### 5.6 Choreography — the second live loop (Tier 2)

A choreographer agent runs **alongside** the oracle, turning the divination into natural-language movement cues for dancers (spec `docs/superpowers/specs/2026-06-19-multi-station-architecture-design.md` §7–§8; plan `docs/superpowers/plans/2026-06-21-tier2-choreography-layer.md`).

- **First-pass (`f(intake, archetype)`)** — generated at **persona-set** (`POST /api/visitors/:id/persona`), the moment the archetype exists. `generateFirstPass()` (`apps/brain/src/choreo.ts`) produces an NL movement **`ChoreoScore`** (`{ score }`), stored on the record (`store.setChoreoFirstPass`), ready as the reading begins. Fire-and-forget, mirroring the intake→seeds transform.
- **Per-turn fan-out** — `divination.say()` fans each visitor utterance out to a `runChoreo` consumer off the **same session** (shared context, same `sessionId`). It streams `choreo.delta` → `choreo.done` and is **fire-and-forget + try/catch, so a choreography failure never disturbs the oracle turn.**
- **Configurable timing** — a live, in-memory `reactToOracle` flag (`config.choreo.reactToOracle`, env `CHOREO_REACT_TO_ORACLE`, default true; flip live via `GET`/`POST /api/choreo/config`). ON → the cue runs after `oracle.done`, reacting to the utterance **and** the oracle reply (spec §8). OFF → it runs in parallel from the utterance alone, independent of the oracle.
- **Clarity prompt** — `packages/oracles/src/choreographer.ts` builds the prompts; `CHOREO_CLARITY_INSTRUCTION` is the §8 "clarity mirror" of the oracle's anti-slop deny-list (one concrete, present-tense, immediately-performable cue). The choreographer's voice is functional (an instructor to bodies), not a character.
- **Model** — `config.choreoModel` (env `CHOREO_MODEL`, default **gpt-4o**), streaming, same pattern as the oracle. Offline (no key) → deterministic fallback cue, so the loop runs with no API key.
- **Feed** — `choreo.delta`/`choreo.done` ride their own screens-only WS channel (§8), **deliberately off the `ShowEvent`/OSC contract**, like dispatcher logistics + tuning. The `/choreo` screen renders the live cue + the timing toggle. **Open / deferred:** in-ear vs loudspeaker routing (§12), and de-multiplexing concurrent sessions' cues (the MVP shares one cue line — fine while the altar is one-at-a-time).

## 6. The human QR code

The bridge between the body and the system. All in-browser TypeScript:

- **Pose identity token** (`/bodyscan` + `/altar`) — **MediaPipe Tasks for Web** (`@mediapipe/tasks-vision`, Pose Landmarker) on a webcam. The pose is a **self-invented biometric identity token**, not an archetype classification. Each frame's 33 landmarks reduce to an **angle vector** (`PoseVector = { angles, weights }`) — one interior angle per joint, weighted by landmark visibility — which is translation/scale/identity-invariant by construction. Matching = weighted angular distance; "holding still" = low frame-to-frame angular motion.
  - **Enroll at `/bodyscan`:** the visitor invents a pose and holds it to lock a `PoseVector` template. The template is persisted as `poseTemplate` on the `VisitorProfile` via `POST /api/visitors/:id/pose`. Functional debug view: skeleton overlay, motion/hold telemetry bars. The hold only counts while the **whole body is in frame** — measured by `bodyCoverage` (mean per-joint visibility); when it falls short the camera view turns red with a "step into frame" prompt so the visitor self-corrects (the gate uses hysteresis — `isBodyFramed`, enter/exit thresholds — so the warning can't strobe at the boundary). Previously a partial framing silently failed to register and the visitor had no idea why.
  - **Verify at `/altar`:** the visitor returns to their pose; the altar matches the live vector against the stored `poseTemplate`. On a successful sustained hold (still AND similar), `POST /api/visitors/:id/verify` stamps `poseVerifiedAt`. The operator also picks the oracle persona at the altar (`POST /api/visitors/:id/persona`). Both steps complete → visitor is oracle-ready.
  - **Iteration 2 (pre-authored archetype poses) is cancelled.** The token is semantically opaque — it proves identity ("you are who you enrolled as"), not archetype ("your pose looks like X"). The pose has no `archetypeGuess`; archetype is chosen by the operator at the altar.
  - *Robustness note:* single-camera 2.5D — the `z`/depth axis is noisy; we match on the 2D silhouette. The real risk is venue **lighting + full-body framing**, not the model. Framing is now surfaced to the visitor at `/bodyscan` (red "step into frame" overlay); lighting is still on the operator.
- **Fiducial cards** (Station 2, "place the images in their correct place") — printed **ArUco/AprilTag** cards read via `js-aruco2` / OpenCV.js. The arrangement → `scan.fiducial`. Robust, theatrical, trivial to detect.
- **Souvenir QR** (the takeaway) — at the end, mint a stylized QR fused with the visitor's silhouette, linking to *their* generated artifact (song/transcript). The silhouette is decorative; the QR encodes a real URL. Thematic payoff: *you've been reduced to a scannable code.*

## 7. STT / TTS

Both behind a thin interface so we can swap providers, each with an offline fallback (no key / API failure degrades gracefully — see §3):
- **STT:** the stage records the visitor's mic (`MediaRecorder` → 16 kHz mono WAV) and POSTs to the brain's `/api/stt`. The brain uses the **OpenAI Whisper API** (`STT_MODEL`, default `whisper-1`) when `OPENAI_API_KEY` is set, falling back to a **local Xenova `whisper-tiny.en`** model when unkeyed or on an API error. A close mic on the visitor still matters more than the model; move to a streaming provider (e.g. Deepgram) if the room is too noisy.
- **TTS:** the oracle's line is spoken via **ElevenLabs** (`ELEVENLABS_MODEL`, default `eleven_flash_v2_5` — low-latency, intelligibility > character in earpiece/whisper mode), proxied through the brain's `/api/tts` so the key stays server-side. **Voices are per-archetype**, mapped as `voiceId` on each persona in `packages/oracles` (stock premade voices for now — retune freely). When `ELEVENLABS_API_KEY` is unset the performer's browser falls back to `speechSynthesis`.

## 8. WebSocket divination protocol + External integration contract (OSC / WebSocket)

### Divination WS protocol (`/ws`)

Client → brain commands (zod-validated):
```
session.start   { visitorId }                        performer claims a visitor
session.say     { sessionId, text }                  visitor utterance
session.end     { sessionId }                        end this session
station.hello   { station, kioskId, slotHint? }      station kiosk identity + slot binding (dispatcher use only)
tuning.set      { tuning: OracleTuning }             operator edits the global Altered-State tuning (§5.3)
```

Brain → client messages:
```
hello                                                on connect
roster          { sessions: [{sessionId, visitorId, visitorName, archetype, turns}] }
session.started { sessionId, visitorId, visitorName, archetype, opening }
session.transcript { sessionId, role, text }
oracle.delta    { sessionId, text }                  streaming chunk
oracle.done     { sessionId, text }                  full reply
choreo.delta    { sessionId, text }                  streaming movement-cue chunk (Tier 2, §5.6)
choreo.done     { sessionId, text }                  full movement cue for the turn (Tier 2, §5.6)
session.ended   { sessionId }
session.error   { sessionId?, visitorId?, message }  targeted to the caller's socket
event           { event: ShowEvent }                 OSC mirror
dispatch.state  { slots: Slot[], queue, completed, surplus, stationsOnline, warmedUp }   dispatcher snapshot (screens only)
tuning.state    { tuning: OracleTuning }             global Altered-State tuning; broadcast on change + on connect (screens only)
```

The `roster` message is broadcast on every session change **and** sent to each socket on connect — the lobby (and monitor) are always correct immediately on load or reconnect.

The `dispatch.state` message is broadcast on every dispatcher state change **and** sent on connect. It carries the full `DispatchState`: the **addressable slot array** (`slots: Slot[]`, each with `id`, `station`, `kioskId?`, `online`, and a pinned `occupant?` of phase `pending`/`called`/`in_progress`), the waiting `queue`, the `completed` list (`sessionEndAt` set), `surplus` screens (connected but unbound), the derived `stationsOnline` LEDs, and `warmedUp`. Arrival is an explicit **Confirm arrival** at the kiosk (`POST /api/dispatch/arrive`), not a typed check-in.

**Dispatcher logistics are deliberately kept off the `ShowEvent`/OSC contract.** `dispatch.state` is an internal screen-to-screen channel — Anna's and Jeff's tools subscribe to `ShowEvent`s over OSC/WebSocket (§9-ext); they never see dispatcher internals. The `station.hello` client message serves only the dispatcher's kiosk slot-binding + socket-drop detector and is ignored by all other subsystems.

The **`choreo.delta`/`choreo.done`** channel (Tier 2, §5.6) and the **`tuning.set`/`tuning.state`** channel are kept off the OSC contract for the same reason — they are live screen-to-screen streams, not discrete integration events. If a collaborator (loudspeaker/TouchDesigner) later needs the final cue over OSC, add a discrete `choreo.cue` `ShowEvent` additively rather than streaming deltas over OSC.

## 9-ext. External integration contract (OSC / WebSocket)

The Brain publishes every `ShowEvent` on (a) a WebSocket topic for the web screens and (b) OSC for Anna/Jeff. Draft OSC address space:

```
/channelers/visitor/submitted     <profileId>
/channelers/seeds/ready           <profileId>
/channelers/scan/pose             <archetype> <confidence>
/channelers/scan/fiducial         <card0> <card1> …
/channelers/oracle/selected       <profileId> <archetype>
/channelers/divination/started    <profileId>
/channelers/divination/ended      <profileId>
/channelers/souvenir/minted       <profileId> <url>
```

This contract is the integration boundary — once it's agreed, Anna and Jeff can build against it independently of my internals.

> **Cheap first step (before their tools are confirmed):** the Brain can ship a minimal **event-echo demo** — it broadcasts sample `ShowEvent`s on OSC + WebSocket that Anna or Jeff can point any receiver at to see exactly what's available to react to. That de-risks the integration and gives them something concrete to plug into without us committing to a design before §11 is answered.

## 10. Roadmap to the workshop (~2 weeks)

- **Week 1 — core pipeline MVP.** Monorepo scaffold; `shared` schemas; intake kiosk; Brain with the transform call (structured `Seeds`); operator console that lists visitors and fires transforms; basic event bus. *Exit:* a visitor can fill the survey and the operator sees generated seeds.
- **Week 2 — divination + body + integration.** Live STT→Oracle→TTS loop with one persona end-to-end; pose + fiducial scan stations; souvenir QR; OSC out so Anna/Jeff can subscribe. *Exit:* end-to-end run for one visitor and one Oracle.
- **Workshop (Jun 22–28).** Iterate live: more personae, tune prompts, refine the scan templates, harden the operator flow against real visitors.

## 11. Side-tasks for Anna's student
Each has a crisp interface and stays off the critical path:
- Intake front-end UI + DMV-void theming, against the `shared` API contract.
- The fiducial-card station (self-contained ArUco/OpenCV.js component that posts `scan.fiducial`).
- The `oracles/` persona prompt library + a test harness for the child / AI-on-drugs / tree voices.
- The souvenir QR generator.

## 12. Open questions for the team
Maintained here — **no separate questions file**. Add to this section as new questions surface. None of these block scaffolding, but they shape week 2, the TTS work, and the Anna/Jeff integration.

**Venue & hardware**
- How many tablets/kiosks for intake? Webcam(s) for the scan stations? A projector for Jeff?
- How many visitors / performers run concurrently? (The session map supports N; the real constraint is TTS earpiece feeds and performer count.)
- Who operates the `/console` master overseer (and the `/dispatch` lobby station) during the show?

**TTS & the earpiece** — *we're building this regardless of Anna/Jeff*
- What in-ear receiver system do the performers use (brand/model)? How does audio reach it — wireless IEM, IFB/Comtek, or phone + earbuds?
- How many performers need a simultaneous feed?
- Always channelled through a performer, or should some Oracles ever speak to the visitor in a direct AI voice?
- Is there a reference voice per Oracle (a child, a tree, an AI on drugs…) — samples or descriptions to match?
- What latency from visitor-speaks → performer-hears is tolerable?

**Anna (music) & Jeff (visuals) integration** — *needed to build their plug-in demo (§8)*
- What software does each of you run (Ableton / Max/MSP / modular-only · TouchDesigner / Resolume / QLab / …)?
- Can it receive **OSC** and/or **MIDI**? Is it on the same LAN as the show laptop?
- Which events/data from the §8 contract are actually useful to each of you (add/cut)?
- Bidirectional? Do you want to send anything *into* the Brain (e.g. a cue that advances the ritual)?
- Anna: do you want the `MusicSeed` as OSC/MIDI, or just an on-screen panel you read and perform from?

**Director — personalized model & voice** (see §5.5)
- Which models did you fine-tune previously, on what data, and with what tooling — and were you happy with the result?
- Continue the bespoke-model path, or is flagship + strong prompting acceptable for now?
- Do you have corpora we can use as few-shot / retrieval / future training data — transcripts of children, elders, mystics, or the collaborators' own writing?
- Is there per-Oracle reference text that defines how each one should sound?

**Multi-station revision (2026-06-19 spec)** — from `docs/superpowers/specs/2026-06-19-multi-station-architecture-design.md` §15
- **Numbering hardware** — what assigns the analog ticket number, and can it stay purely analog? Decides whether globally-unique integers hold or a day/session namespace is needed.
- ~~**Presence capture**~~ — ✅ **RESOLVED for MVP:** waiting-room registration stays operator-keyed (`/dispatch` arrivals panel calls `POST /api/register`). `/waiting` self-serve kiosk deferred.
- **Choreography feed routing** — dancers' in-ears, a public loudspeaker, or both? (The channel is built either way — `choreo.*` WS + the `/choreo` view, §5.6; this is output routing.) Related: the MVP `/choreo` view shares one cue line across concurrent sessions — de-multiplexing waits on this decision.
- ~~**Dispatcher knob values**~~ — ✅ **RESOLVED for MVP:** rehearsal-fast defaults set in `config.dispatcher` (K=3, T_warmup=60s, T_max=240s, T_noshow=90s, T_stale=300s, grace=20s, tick=5s). All env-overridable — tune in rehearsal without a code change.
- ~~**Choreography agent model**~~ — ✅ **RESOLVED for MVP:** **gpt-4o** (`config.choreoModel`, env `CHOREO_MODEL`), same as the oracle; switch to `gpt-4o-mini` via env for a lower-latency second loop. (Closes the spec's "Sonnet 4.6" drift — the project runs on OpenAI.)
- ~~**No-show automation**~~ — ✅ **RESOLVED for MVP:** no-show is flagged by default (operator decides to re-pool). `noShowAutoRepool` knob (`DISPATCH_NOSHOW_AUTOREPOOL=true`) enables automatic re-pool for a faster-paced run.
- ~~**Scannable/displayed check-in (remove wrong-number risk)**~~ — ✅ **RESOLVED:** replaced permissive type-a-number check-in with **confirm-at-station** — the dispatcher calls `#N` to a kiosk-bound slot, the kiosk displays the number, and a **Confirm arrival** press transitions `called → in_progress` (no free-text entry). Each kiosk owns one addressable, online-gated slot (`station.hello { kioskId, slotHint? }`). Type-a-number survives only as the hidden `/console` operator override.
- **Deferred from the confirm-at-station redesign** (spec §10):
  - **Stylized per-kiosk display** (e.g. a CRT glitch-number skin) — the data model supports one bound number per kiosk; the immersive skin is deferred.
  - **No-scroll board at large kiosk counts** — the center slot grid scales (`auto-fill`); revisit box sizing only if a show ever runs many kiosks.
  - **Surplus-kiosk UX** — extra screens beyond a station's slot count are flagged + idle; a richer "standby" treatment is deferred.
  - **Per-kiosk slot labels** (`?kiosk=intake-left`) vs auto-claim — settled in rehearsal once the physical layout is known.
  - **Reclaim/takeover of a slot mid-grace** — if a *different* `kioskId` binds an occupied slot via explicit `slotHint` during its ~20 s grace window, the prior `in_progress` occupant stays pinned until the 5-min `staleMs` reap (normal kiosk reboots use `kioskId`-reclaim, not `slotHint`, so they don't hit this). Low-probability + self-healing; revisit if it bites in rehearsal.

## 13. Risks
- **Latency** in the voice loop (STT + LLM + TTS stacked). Mitigate with streaming (OpenAI caches prompt prefixes automatically) + a faster model on the Oracle turn (e.g. gpt-4o-mini via `ORACLE_MODEL`).
- **Live API failure.** Pre-generate fallback Oracle lines and allow the operator to inject a manual line.
- **Noisy room** wrecking STT. Close mic + push-to-talk on the performer side.
- **Scope creep** vs the 2-week window — keep one persona and one full path working before breadth.
