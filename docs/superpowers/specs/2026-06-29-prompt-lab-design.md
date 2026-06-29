# Prompt Lab — design

**Date:** 2026-06-29
**Status:** approved, ready for planning
**Route:** `/prompt-lab` (new, in `apps/stage`)

## Purpose

Give the team a fast, show-day-safe way to iterate on the AI Oracle: vary a
visitor's intake survey and/or the oracle prompt wording, then immediately see
how the generated reading changes. The whole compose → preview → submit →
generate loop lives on **one frontend page**, with a **single-shot
"tweak-and-regenerate" cadence**.

This is a workshop/iteration tool, not a show surface. It is built to be **low
risk on show day**: an additive frontend route that reuses existing endpoints
and the existing divination WebSocket protocol — **no backend changes, no
changes to existing routes**.

## Scope decisions (locked during brainstorming)

- **Prompt axis = preview only.** The Lab can *preview* the exact assembled
  system prompt for any intake/persona, but generation always uses the brain's
  own prompt source. To test edited *prompt text*, you edit the source files
  (the running brain auto-reloads — see "Iteration mechanics"); the Lab does not
  send an overridden prompt to the server. No `systemPrompt` override hook is
  added to the backend.
- **Compare style = tweak-and-regenerate.** Single-shot: change something, hit
  Regenerate, read the new output. No A/B side-by-side and no batch matrix in
  this iteration (YAGNI — can be layered on later if wanted).
- **Frontend-only.** Reuses `POST /api/visitors/:id/intake`, the visitor-list
  source `/channel` already uses for its lobby, and the divination WS protocol.

## Architecture

One new route `/prompt-lab` in `apps/stage` (Vite/React SPA), composed of five
parts on a single page. Each part has a single clear purpose and a narrow
interface to the others; the only shared state is the currently-selected visitor
and the currently-composed `SurveyResponse`.

### 1. Visitor selector

A dropdown of oracle-ready visitors, populated from the **same source
`/channel`'s lobby uses** (to confirm during implementation — likely a roster WS
message or a GET). The operator seeds a small pool up front
(`pnpm seed:no-intake --count 5`, archetype as desired); the Lab consumes it.

Selecting a visitor drives the composer's mode:
- **Blank compose** — start from an empty/randomized survey.
- **Override** — pre-fill the composer from the selected visitor's *current*
  `survey` (the "intake override view").

### 2. Intake composer / override view

Renders the 19 survey fields from `packages/shared/src/survey.ts` using the
real field types (`text` / `longtext` / `single` / `multi` / `scale`), so inputs
match what `/intake` produces. Helpers:
- **Randomize** — fill plausible values across all fields.
- **Presets** — a couple of canned intake profiles.
- **Raw-JSON toggle** — edit the `SurveyResponse` directly for power-edits.

Output is a valid `SurveyResponse`
(`{ name, freeText: Record<string,string>, phrases: [] }`,
`packages/shared/src/schemas.ts`). The form ↔ `SurveyResponse` mapping is a
pure function (testable in isolation).

### 3. Live system-prompt preview

Imports `buildSystemPrompt(persona, survey)` from `packages/oracles` and renders
the **exact** system prompt the oracle would receive for the current intake +
persona pick. Includes a persona picker (`child` / `tree` / `drugged_ai`).
Updates live as the composer changes, and updates via **Vite HMR** when the
prompt source (`personas.ts` / `buildPrompt.ts`) is edited — this is the
prompt-authoring lever (preview-only).

### 4. Submit ("Apply intake")

`POST /api/visitors/:id/intake` with the composed survey. `upsertSurvey`
(`apps/brain/src/store.ts:44`) overwrites `v.survey` and re-stamps `intakeAt`
with **no guard** — so the same visitor can be re-tweaked and re-applied
endlessly. No fresh visitor needed per variant.

### 5. Inline divination (the tweak-and-regenerate loop)

A WebSocket client copied from the existing `Channel.tsx` pattern. "Regenerate"
is:

```
session.end (if a session is live)  →  session.start  →  show opening
→ user types an utterance → session.say → stream oracle.delta inline
```

The `session.end`-before-`session.start` step is required because `start()`
(`apps/brain/src/divination.ts:133`) rejects a start when the visitor is
"already in a divination." Because the brain rebuilds the prompt from the
*current* survey at each `session.start` (`divination.ts:142`), re-applying
intake and then regenerating reflects the change immediately.

## Data flow

```
seed pool (terminal, once) ──► visitor selector
                                     │
              ┌──────────────────────┴───────────┐
              ▼                                   ▼
   compose / override survey            (load current survey on select)
              │
              ├──► live preview  =  buildSystemPrompt(persona, survey)   [frontend]
              │
              └──► Apply intake  =  POST /api/visitors/:id/intake        [existing endpoint]
                                          │
                                          ▼
                       Regenerate  =  WS: session.end → session.start    [existing protocol]
                                          │
                                          ▼
                       type utterance  =  WS: session.say → oracle.delta stream
```

No new backend surface. The Lab touches only:
`POST /api/visitors/:id/intake`, the visitor-list source, and the divination WS
messages (`session.start` / `session.say` / `session.end`,
`packages/shared/src/protocol.ts`).

## Iteration mechanics (why this is restart-free)

`pnpm dev` runs the brain as **`tsx watch src/index.ts`**, and `packages/oracles`
exports raw TypeScript source (`"exports": { ".": "./src/index.ts" }`, no
`dist`), imported directly by the brain. So:

| You change…                         | To see it in generated output                  | Manual restart? |
|-------------------------------------|------------------------------------------------|-----------------|
| Intake data (the survey)            | Apply intake → Regenerate (two WS messages)    | No              |
| Sampling / drift (tuning dials)     | Next turn, live                                | No              |
| Prompt text (`personas.ts`, `buildPrompt.ts`) | Save → `tsx watch` auto-reloads brain → Regenerate | No (automatic) |

The inner loop (vary intake → regenerate) is pure WebSocket, zero restart. The
prompt-text loop is restart-free from the operator's hands thanks to the watcher.

**Nuance:** `tsx watch` does a full process restart on a prompt-text save. The
visitor store is in-memory, but this branch (`persistence`) adds visitor-store
snapshot persistence, so the seeded pool should rehydrate from its snapshot on
reboot. *To verify during implementation:* snapshot-restore actually fires on
boot, so the seeded pool survives an auto-restart.

## Boundaries / non-goals

- No backend changes; no `systemPrompt` override sent to the server.
- No A/B side-by-side view, no batch matrix (single-shot only this iteration).
- Not a show surface — a workshop tool; styling can be utilitarian.
- The Lab does not seed visitors itself; seeding stays a terminal command.

## Testing

- **Pure pieces (vitest, `apps/stage`):**
  - form state ↔ `SurveyResponse` round-trip mapping.
  - preview output equals `buildSystemPrompt(persona, survey)` for sample
    intakes (guards against the Lab drifting from the real builder).
- **WS wiring:** a thin copy of the already-working `Channel.tsx` client; covered
  by manual smoke against `pnpm dev` rather than new integration tests.

## Open items to confirm during implementation (all read-only / low-risk)

1. Exact source `/channel`'s lobby uses for the ready-visitor list (roster WS
   message vs GET endpoint) — reuse it verbatim.
2. Snapshot-restore fires on brain boot so the seeded pool survives a
   `tsx watch` restart.
3. Whether `buildSystemPrompt` is exported from `packages/oracles`' index (it is
   used internally by `buildPersona`); if not directly exported, add it to the
   package's public exports (frontend-only change to a shared package, additive).
