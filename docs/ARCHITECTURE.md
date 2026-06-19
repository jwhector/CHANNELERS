# CHANNELERS — System Architecture (v0.1 draft)

> Status: proposal for the **June 22–28, 2026** development workshop. Owner: Jared.
> This is a draft to react to and edit, not a final spec. Scope is a **workshop MVP** — it must run live for a week of development, not survive a tour.
> **2026-06-19:** A multi-station redesign supersedes parts of §1–§6 (number-based identity, body-scan as identity token, altar gate, persona seam, AI choreography, dispatcher) — see `docs/superpowers/specs/2026-06-19-multi-station-architecture-design.md`. Reconcile this document into that design during Tier 0 implementation.

## 1. The shape of the thing

One local service — the **Show Brain** — owns visitor data and all AI calls, and speaks the standard live-performance protocols (**OSC / MIDI / WebSocket**) so Anna's music rig and Jeff's visual rig plug in without depending on its internals.

```
       INTAKE                        SHOW BRAIN (the hub)               PERFORMERS / OUTPUT
 ┌──────────────────┐         ┌────────────────────────────┐       ┌─────────────────────┐
 │ Intake app       │  submit │ • visitor profiles (DB)    │ seeds │ Oracle performer     │
 │ (tablets/kiosks) │────────▶│ • transform (Claude):      │──────▶│  earpiece (TTS) /    │
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
- **Offline-resilient.** Venue wifi is unreliable. The Brain runs locally; only Claude/STT/TTS calls leave the machine, and each degrades gracefully (cached fallback lines, manual override) if an API call fails mid-show.
- **MVP for the workshop.** Favor the smallest thing that's performable live over the complete thing.

## 3. Repo layout (pnpm workspace)

```
channelers/
  apps/
    brain/      Fastify + ws + node-osc + @anthropic-ai/sdk   — the hub
    stage/      Vite + React + TypeScript                     — all screens, role-based routes:
                  /intake    visitor kiosk (survey + vibe-phrase pickers + oracle chooser)
                  /scan      CV scan station (pose + fiducial)
                  /station   performer page: lobby → claim visitor → teleprompter (unified)
                  /console   stage-manager monitor (read-only: active sessions + waiting queue)
                  /souvenir  QR takeaway
  packages/
    shared/     zod schemas + TS types + the OSC/event contract
    oracles/    persona prompt templates (child / AI-on-drugs / tree / …)
```

> Alternative: Next.js for `stage`. Recommendation is the Vite + standalone Fastify split — the WebSocket/OSC server has a cleaner lifecycle as its own long-lived process, and the kiosk screens are a plain SPA.

## 4. Data model (zod-first, sketch)

```ts
// packages/shared
type VibePhrase = { axis: "vulnerability" | "tension" | "hopefulness"; choice: string }

type SurveyResponse = {
  name: string
  freeText: Record<string, string>     // "something you recently lost", "are you tender?", …
  phrases: VibePhrase[]                 // the three close-relationship phrase pickers
  archetype?: string                    // oracle the visitor chose at end of intake
}

type ScanResult =
  | { kind: "pose";     archetypeGuess: string; keypoints: number[][]; confidence: number }
  | { kind: "fiducial"; cards: { id: number; slot: number }[] }

type VisitorProfile = { id: string; survey: SurveyResponse; scans: ScanResult[]; createdAt: string }

type MusicSeed   = { mood: string; tempoBpm: number; key: string; lyricThemes: string[]; synthPalette: string[] }
type DanceScore  = { qualities: string[]; spatial: string; spiritAnimalShape: string; cues: string[] }
type OraclePersona = { archetype: string; systemPrompt: string; openingLine: string }

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
Custom kiosk app, themed as the DMV-void. Renders the existing intake questions (`intake.md`): name, free-text absurdist prompts, and the three "State of vulnerability / tension / hopefulness" phrase pickers. On submit it writes a `VisitorProfile` and emits `visitor.submitted`. The two "Physical Challenge" stations feed in as `ScanResult`s (§6).

### 5.2 Transform (intake → seeds)
A Claude call per visitor turns the profile into the three seeds, using **structured outputs** (`output_config.format` with a json_schema) so the result is guaranteed-parseable `Seeds` — no fragile prompt parsing.

- Model: **Opus 4.8** (`claude-opus-4-8`), adaptive thinking, `effort: "high"`. Latency doesn't matter here (it's pre-divination prep), and quality does.
- The music seed → Anna; the dance score → Jane/the dancers; the persona → the live loop.

### 5.3 Live divination (the earpiece loop)
The visitor speaks → STT → the Oracle persona LLM → text/TTS to the performer, who channels it. Two performer modes, selectable per Oracle:
- **Whisper** — performer hears TTS in-ear and repeats/interprets.
- **Teleprompter** — performer reads the streamed text off a hidden screen and improvises.

**Session model:** the brain holds **multiple concurrent sessions**, one per visitor, keyed by `sessionId`. A `roster` broadcast keeps every connected screen up to date. Performers use `/station`: lobby lists available visitors (with their pre-chosen oracle); one tap claims a visitor and drops directly into the teleprompter. Session messages carry `sessionId` so parallel streams don't bleed across screens.

**Session liveness & recovery:** a session's lifetime is bound to its owning performer's connection, not just to an explicit `session.end`. The client persists its `{sessionId, visitorId}` handle (localStorage) and on every (re)connect sends `session.rejoin`; the brain replies `session.resumed` with the full history + teleprompter so a page refresh or transient socket blip transparently re-attaches. When a performer's socket drops, the brain starts a grace timer (`SESSION_GRACE_MS`, ~90s) and reaps the orphan if no one re-attaches — so an abandoned tab frees the visitor instead of stranding it "being channelled" forever. The lobby's active-session rows also expose manual **Reclaim** / **End** controls as a backstop. (`/console` stays read-only.)

**Archetype assignment:** the visitor chooses their own oracle at the end of intake. The performer just channels whoever they claim — no archetype selection on their end.

Engineering notes (grounded against the Claude API reference):
- **Stream** the response (`messages.stream`) so the performer hears words as they generate — TTFT is everything in a live loop.
- **Prompt-cache the stable prefix** (persona system prompt + the visitor's intake profile); keep only the latest utterance after the last cache breakpoint. **Pre-warm** the cache (`max_tokens: 0`) the moment an Oracle is selected, so the first reply has low latency.
- **Model is a latency/quality decision** — flagged for Jared, not silently chosen. Opus 4.8 is the default brain; **Sonnet 4.6** or **Haiku 4.5** are materially faster/cheaper for the real-time loop. Recommendation: prototype the Oracle on Sonnet 4.6 (fast, 1M context, characterful enough), keep Opus 4.8 for the transforms.
- For lowest TTFT in the loop, disable thinking on the Oracle turn (or keep it minimal) — the persona doesn't need to deliberate, it needs to speak.

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

## 6. The human QR code

The bridge between the body and the system — and the two intake "scanning stations." All in-browser TypeScript:

- **Pose scan** (Station 1, "take the shape of your spirit animal") — **MediaPipe Tasks for Web** (`@mediapipe/tasks-vision`, Pose Landmarker) on a webcam. This is **pose *matching*, not *classification*** — no model training. Each frame's 33 landmarks reduce to an **angle vector** (one interior angle per joint, weighted by landmark visibility), which is translation/scale/identity-invariant by construction. Matching = weighted angular distance between the live vector and a saved template; "holding still" = low frame-to-frame angular motion. Record and detect are one "hold a qualifying state for N seconds" state machine (record = still; detect = still AND similar). Emits `scan.pose` with the best-matching template as `archetypeGuess` + similarity as `confidence`. This is the live trigger.
  - **Iteration 1 (built, `/scan`):** self-recorded round-trip — the visitor invents a pose, holds it to lock a template, then is recognized re-doing it. Functional debug view (skeleton overlay, motion/similarity/hold telemetry, live-tunable thresholds). In-browser only, not yet wired to the brain.
  - **Iteration 2 (next):** replace the self-recorded template with a small library of **pre-authored archetype poses** (the real "match your spirit animal" flow); then POST `scan` and emit `scan.pose`.
  - *Robustness note:* single-camera 2.5D — the `z`/depth axis is noisy, so we match on the 2D silhouette. The real risk is venue **lighting + full-body framing**, not the model.
- **Fiducial cards** (Station 2, "place the images in their correct place") — printed **ArUco/AprilTag** cards read via `js-aruco2` / OpenCV.js. The arrangement → `scan.fiducial`. Robust, theatrical, trivial to detect.
- **Souvenir QR** (the takeaway) — at the end, mint a stylized QR fused with the visitor's silhouette, linking to *their* generated artifact (song/transcript). The silhouette is decorative; the QR encodes a real URL. Thematic payoff: *you've been reduced to a scannable code.*

## 7. STT / TTS

Both behind a thin interface so we can swap providers:
- **STT:** start with the browser Web Speech API (free, what they already have); move to a streaming provider (e.g. Deepgram) if the room is too noisy. A close mic on the visitor matters more than the model.
- **TTS:** ElevenLabs for characterful Oracle voices, or a neutral fast voice when it's only feeding the performer's earpiece (intelligibility > character in whisper mode).

## 8. WebSocket divination protocol + External integration contract (OSC / WebSocket)

### Divination WS protocol (`/ws`)

Client → brain commands (zod-validated):
```
session.start  { visitorId }                         performer claims a visitor
session.say    { sessionId, text }                   visitor utterance
session.end    { sessionId }                         end this session
```

Brain → client messages:
```
hello                                                on connect
roster          { sessions: [{sessionId, visitorId, visitorName, archetype, turns}] }
session.started { sessionId, visitorId, visitorName, archetype, opening }
session.transcript { sessionId, role, text }
oracle.delta    { sessionId, text }                  streaming chunk
oracle.done     { sessionId, text }                  full reply
session.ended   { sessionId }
session.error   { sessionId?, visitorId?, message }  targeted to the caller's socket
event           { event: ShowEvent }                 OSC mirror
```

The `roster` message is broadcast on every session change **and** sent to each socket on connect — the lobby (and monitor) are always correct immediately on load or reconnect.

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
- Who watches the `/console` monitor during the show?

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
- **Presence capture** — does waiting-room registration stay operator-keyed, or do we add a `/waiting` self-serve kiosk / integrate the dispenser?
- **Choreography feed routing** — dancers' in-ears, a public loudspeaker, or both? (The channel is built either way; this is output routing.)
- **Dispatcher knob values** — warm-up pool size `K`, `T_warmup`, `T_max` (anti-starvation), `T_noshow`, `T_stale` (per station), check-in grace window — set defaults, tune in rehearsal.
- **Choreography agent model** — confirm Sonnet 4.6 vs. another tier for the second live loop.
- **No-show automation** — keep `T_noshow` operator-flagged, or auto-re-pool like `T_stale`?

## 13. Risks
- **Latency** in the voice loop (STT + LLM + TTS stacked). Mitigate with streaming + prompt-cache pre-warm + a faster model on the Oracle turn.
- **Live API failure.** Pre-generate fallback Oracle lines and allow the operator to inject a manual line.
- **Noisy room** wrecking STT. Close mic + push-to-talk on the performer side.
- **Scope creep** vs the 2-week window — keep one persona and one full path working before breadth.
