# Altered-State Console — spec + implementation plan

**Date:** 2026-06-21 · **Status:** approved, implementing · **Branch:** intake-crt-redesign (or a new branch)

A backend-only control surface (operator-facing, on `/channel`) that exposes every LLM
generation lever derived from the PHARMAICY "Ayahuasca" module, so the team can experiment
live with how the oracle's voice loosens/degrades during a divination. No audience sees this.

## Locked decisions

- **Copy preset values verbatim** from `app/Ayahuasca_v1.3.js` — no re-derived curve.
- **Expose the underlying preset params as editable** (full slider range) so we can push them
  and judge the result ourselves.
- **Clamp only to OpenAI hard-valid ranges** (temp ≤ 2.0, top_p ≤ 1.0, penalties −2..2). The
  API rejects out-of-range values; this is correctness, not taste. A non-blocking "speakable
  zone" marker (~1.3 temp) is UI-only.
- **Global** tuning (one live config, all sessions) — not per-session. Mixing-desk model.
- **Output-mangle buffers** (collects the full reply, mangles, emits) — trades token streaming
  for that one toggle. Acceptable on an operator screen.
- **Single combined spec+plan** (this doc), then implement directly with TDD on the pure core.
- The module's **multi-variant Explore/Curate/Converge pipeline is NOT ported** — there's no
  place for 6 deduped variants in a single live oracle turn. We port the *sampling map*, the
  *effects→sampling nudge*, and the *text-styling utilities* only.

## Control surface — `OracleTuning` (packages/shared/src/tuning.ts)

Single source of truth, zod-validated, shared by brain + stage.

```ts
Intensity         = "baseline" | "light" | "moderate" | "deep" | "beyond" | "surreal" | "custom"
OracleSampling    = { temperature 0..2, top_p 0..1, presence_penalty -2..2,
                      frequency_penalty -2..2, max_completion_tokens 16..2000 }
OracleEffects     = { creativityBoost, cognitionFlexibility, memoryBlend, driftIntensity,
                      hallucinationFactor 0..1, egoDissolution: bool, decenteringScore }
OraclePipeline    = { promptDrift: bool, outputMangle: bool, tone: "none"|"explorer_dreamy",
                      semanticDrift 0..1, hallucinationBudget 0..1, microDrift: bool }
OracleScope       = { applyToOracle: bool, applyToTransform: bool }
OracleTuning      = { intensity, sampling, effects, effectsDriveSampling: bool, pipeline, scope }
```

`intensity` is a label: picking a preset loads its concrete numbers into the editable
`sampling`/`effects`/pipeline fields; editing any field flips `intensity → "custom"`. The brain
never re-derives from the label — it reads the concrete numbers.

### PRESETS (verbatim from Ayahuasca_v1.3.js)

| preset   | temp | top_p | pres | freq | creativityBoost | cogFlex | memBlend | driftInt | halluc | egoDiss | decenter | semDrift |
|----------|------|-------|------|------|-----------------|---------|----------|----------|--------|---------|----------|----------|
| light    | 0.80 | 0.90  | 0.0  | 0.0  | 1.2             | 1.15    | 1.10     | 1.05     | 0.0    | false   | 0.8      | 0.50     |
| moderate | 0.95 | 0.95  | -0.1 | 0.0  | 1.5             | 1.35    | 1.20     | 1.15     | 0.2    | true    | 0.9      | 0.50     |
| deep     | 1.15 | 0.98  | -0.2 | -0.05| 1.8             | 1.60    | 1.35     | 1.25     | 0.4    | true    | 1.0      | 0.60     |
| beyond   | 1.35 | 1.00  | -0.35| -0.10| 2.0             | 1.80    | 1.50     | 1.35     | 0.6    | true    | 1.1      | 0.65     |
| surreal  | 1.55 | 1.00  | -0.45| -0.15| 2.2             | 2.00    | 1.70     | 1.45     | 0.75   | true    | 1.2      | 0.65     |

`max_completion_tokens` not in the module → seed every preset with 300 (today's oracle value).
`hallucinationBudget` seeds to 0.6 (module default) for all presets.

`DEFAULT_TUNING` reproduces today's behavior exactly: `intensity:"baseline"`, sampling
`{temp:1, top_p:1, pres:0, freq:0, max:300}`, neutral effects (all 1.0 / egoDiss false),
`effectsDriveSampling:false`, all pipeline off, scope `{oracle:true, transform:false}`.

### resolveSampling(tuning) → final API params (pure)

```
start from tuning.sampling
if effectsDriveSampling:                       // ported from module getApiSettings()
  temperature += (creativityBoost - 1) * 0.25
  top_p       += (creativityBoost - 1) * 0.1
  if egoDissolution: presence_penalty = min(presence_penalty, -0.25)
clamp all to OpenAI-valid ranges
```

### Text pipeline (ported utilities, gated)

- `buildDriftDirective(tuning)` → a `[ALTERED PERCEPTION]` block appended to the system prompt
  when `pipeline.promptDrift`. Scales language by `semanticDrift`/`decenteringScore`; adds a
  visionary-non-sequitur clause when `hallucinationFactor > 0`. (LLM-native, non-destructive.)
- `mangleOutput(text, tuning, seed)` → applied to the finished reply when `pipeline.outputMangle`.
  Ports `ToneStylist.explorerDreamy`, `wordMorph`, `metaphorize`, `sensoryPaint`,
  `insertOccasionally`, `mulberry32` near-verbatim; strengths wired to `semanticDrift`,
  insertion chance to `hallucinationBudget`/`microDrift`. Deterministic via `mulberry32(seed)`.

These fight the persona/anti-slop voice by design — both default OFF; the operator opts in.

## Transport (matches dispatcher/divination pattern)

- **Client→server** (add to `WsClientMsg` zod union in protocol.ts):
  `{ kind: "tuning.set", tuning: OracleTuning }`
- **Server→client** (add to `WsServerMsg` union):
  `{ kind: "tuning.state", tuning: OracleTuning }`
- **`apps/brain/src/tuning.ts`** — a module-level live-state holder (`getTuning()`) +
  `registerTuning(bus)`:
  - `bus.onConnect(reply => reply({kind:"tuning.state", tuning: current}))` — sync joiners.
  - `bus.onCommand` — on `tuning.set`, store (already zod-validated by the bus), broadcast
    `tuning.state` to all screens. Ignore other commands (fan-out convention).

## Brain application

- **divination.ts `streamReply`** — read `getTuning()`. When `scope.applyToOracle`:
  - sampling ← `resolveSampling(tuning)` (replaces hardcoded `temperature:1`, `max:300`).
  - system prompt ← persona prompt `+ buildDriftDirective` if `promptDrift`.
  - if `outputMangle`: buffer the stream (no deltas), then `mangleOutput(full, …)` and emit it as
    a single delta + done. Else stream as today. Seed = session turn count.
  - When `!applyToOracle`, behaves exactly as today (uses DEFAULT-equivalent path).
- **transform.ts** — when `scope.applyToTransform`, pass `resolveSampling(tuning)` temp/top_p/
  penalties into the call (keep `max_completion_tokens:1024` for seed room). Existing
  try/catch→`stubSeeds` already makes a high-temp JSON failure degrade safely.
- **Offline:** `fallbackStream` ignores sampling (no API) but still runs `mangleOutput` when
  `outputMangle` is on, so the text pipeline is testable with no key.

## UI — `apps/stage/src/components/AlteredStateConsole.tsx`

Collapsible **ALTERED STATE** panel on `/channel`, rendered in both lobby and in-session modes.
Seeds local state from the `tuning.state` broadcast; sends `tuning.set` (debounced ~150ms) on
change. Controls: preset buttons (load verbatim values) · a labeled slider+readout per sampling
param and per effect · `effectsDriveSampling` toggle · pipeline toggles + drift/hallucination
sliders + tone dropdown · scope toggles · reset-to-default. Speakable-zone marker on temperature.
Dense/utilitarian. `Channel.tsx` owns the tuning state + wiring; the panel is presentational.

## Testing

- **brain vitest** (`apps/brain/src/altered-state.test.ts`, imports from `@channelers/shared`):
  `resolveSampling` (preset numbers, override precedence, effect-nudge math, clamping to valid
  ranges), `OracleTuning` zod validation, `mangleOutput` determinism with a fixed seed,
  `buildDriftDirective` gating.
- **stage vitest**: a light render/interaction test for `AlteredStateConsole` (preset load flips
  to custom, change fires `tuning.set`).
- Gate: `pnpm -r typecheck` + `pnpm --filter @channelers/brain test` + `pnpm --filter @channelers/stage test`.

## Implementation plan (ordered → commit per phase)

1. **Shared core** — `packages/shared/src/tuning.ts` (schemas, PRESETS, DEFAULT_TUNING,
   resolveSampling, buildDriftDirective, mangleOutput) + export from index.ts. Brain unit tests.
2. **Transport** — protocol.ts union additions; `apps/brain/src/tuning.ts` (`registerTuning` +
   `getTuning`); wire in app.ts.
3. **Brain application** — divination.ts (sampling + drift + buffered mangle) and transform.ts
   (scoped sampling).
4. **UI** — `AlteredStateConsole.tsx` + Channel.tsx wiring + stage test + minimal styles.
5. **Docs** — CHANGELOG (every phase), ARCHITECTURE.md (§ data model + a new AI-tuning note),
   `.env`/docs as needed.

## Out of scope / future

- Per-session tuning, saving/recalling named operator presets, the variant Explore/Curate/
  Converge pipeline, exposing tuning on `/console`, OSC emission of tuning (kept off the bus
  contract like dispatcher logistics).
