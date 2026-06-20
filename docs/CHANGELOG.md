# CHANNELERS — Implementation Changelog

The running record of what was built/changed and **why**, so context transfers between work sessions. This is the first thing to read to get up to speed, and it must be updated after every change (see `CLAUDE.md` → Working agreements).

**Format:** newest entry on top. Each entry:
```
## YYYY-MM-DD — short title
- **What:** the change.
- **Why:** the reason / decision behind it.
- **Files/areas:** where it landed.
- **Docs touched:** which docs were updated alongside it.
```

---

## 2026-06-20 — Tier 3 Task 3.6: Stage API client, station presence hook, NumberGate check-in
- **What:** Extended `apps/stage/src/lib/api.ts` with `checkin(number, station)` (returns `{record, superseded}`) and a `dispatch` group (`state/confirm/assign/recall/repool/complete/remove`) that call the Task 3.5 endpoints. Added `Station` and `DispatchState` to the shared-type import. Created new hook `apps/stage/src/lib/useStationPresence.ts` — wraps `useBrainSocket`, sends `{kind:"station.hello", station}` on every (re)connect, returns `{connected}`. Added optional `station?: Station` prop to `NumberGate`: when present, resolves via `api.checkin(...).record`; without it, falls back to existing `api.register`. All existing `NumberGate` callers (which omit `station`) continue to compile unchanged. `pnpm -r typecheck` clean (0 errors, 4 packages); `pnpm --filter @channelers/stage build` succeeds (66 modules, 376 kB JS). Manual browser smoke pending human verification.
- **Why:** Task 3.6 of the Tier 3 dispatcher build — first stage-side task. Exposes the brain's check-in and dispatch API surface to stage screens, and lets station screens announce their role over WebSocket for the dispatcher's online LED.
- **Files/areas:** `apps/stage/src/lib/api.ts`, `apps/stage/src/lib/useStationPresence.ts` (new), `apps/stage/src/components/NumberGate.tsx`.
- **Docs touched:** this changelog.

---

## 2026-06-20 — Tier 3 Task 3.5: Bus multiplex; wire dispatcher + checkin/dispatch endpoints
- **What:** Multiplexed the `Bus` class: replaced three single-slot fields (`onCmd`, `onConnectHook`, `onDisconnectHook`) with arrays and removed `setCommandHandler`. All three now append hooks so multiple subsystems can subscribe without clobbering each other. Updated `divination.ts` (`setCommandHandler` → `onCommand`). Wired `createDispatcher(bus)` into `app.ts` right after `registerDivination(bus)` with an `onClose` lifecycle hook for cleanup. Added `dispatcher.kick()` to `/api/register`, `/api/visitors/:id/intake`, and `/api/visitors/:id/pose` so slot fills are triggered immediately on relevant writes. Added six new HTTP endpoints: `POST /api/checkin`, `GET /api/dispatch`, and `POST /api/dispatch/{confirm,assign,recall,repool,complete,remove}`. Appended TDD tests: `dispatch endpoints` (check-in 200, bad-station 400, repool → waiting) and `WS broadcasts coexist` (new socket gets both `roster` and `dispatch.state` — proves the bus multiplex). TDD: RED → GREEN; all 45 brain tests pass; `pnpm -r typecheck` clean (0 errors, 4 packages). Pre-existing divination tests (including the WS session guards) still pass — confirming Tier 1 regression-free.
- **Why:** Task 3.5 of the Tier 3 dispatcher build. Integration step: connects the dispatcher engine (Tasks 3.3–3.4) to the running brain and exposes the operator API.
- **Files/areas:** `apps/brain/src/bus.ts`, `apps/brain/src/divination.ts`, `apps/brain/src/app.ts`, `apps/brain/test/endpoints.test.ts`.
- **Docs touched:** this changelog.

---

## 2026-06-20 — Tier 3 Task 3.4: Dispatcher recovery — check-in, no-show, stale, supersede, station identity
- **What:** Filled all `notImplemented` stubs in `apps/brain/src/dispatcher.ts`. Replaced the placeholder `reconcile()` with the full version: T_stale auto-reap (detector 2), no-show flag/auto-repool, autoConfirm. Added real `checkin()` (permissive create-or-fetch + in_progress, auto-supersede over-capacity occupants, walk-up flag), `recall()` (refresh called.since + clear flags), `repool()` (→ waiting), `markComplete()` (stamp milestone + free slot), `remove()` (drop from store). Added `handleCommand` (station.hello → connId↦station mapping, online LED, clears grace timer) and `handleDisconnect` (detector 3: if last screen for a station drops, sets grace timer; on expiry reaps all in_progress occupants at that station). Wired both with `bus.onCommand`/`bus.onDisconnect`. Deleted `notImplemented` function entirely. Appended 9 new unit tests (TDD: RED → GREEN); all 16 dispatcher tests pass; `pnpm -r typecheck` clean (0 errors, 4 packages).
- **Why:** Task 3.4 of the Tier 3 dispatcher build. Completes the recovery layer: operator check-in, no-show handling, stale-occupant reaping, auto-supersede, and station socket-drop liveness.
- **Files/areas:** `apps/brain/src/dispatcher.ts`, `apps/brain/test/dispatcher.test.ts`.
- **Docs touched:** this changelog.

---

## 2026-06-20 — Tier 3 Task 3.3: Dispatcher engine — eligibility, warm-up, anti-starvation, confirm
- **What:** Created `apps/brain/src/dispatcher.ts` with `createDispatcher(bus, opts)` — the core dispatch engine. Implements: eligibility predicate (intake/bodyscan/altar gate by milestone), warm-up gate (pool ≥ K OR T_warmup elapsed), anti-starvation (visitors waiting > T_max are priority-picked), slot fill per-station, `confirm()` (pending → called), `assign()` (operator manual assign), `snapshot()`/`broadcastState()`, and bus lifecycle wiring (`onConnect` sends current state). Recovery methods (`checkin`/`recall`/`repool`/`markComplete`/`remove`) left as `notImplemented()` stubs per plan — Task 3.4 replaces them. Added `store.clear()` test-isolation helper to `apps/brain/src/store.ts`. Created `apps/brain/test/dispatcher.test.ts` with 7 unit tests against a fake bus (TDD: RED → GREEN). Full suite: 31/31 pass; `pnpm -r typecheck` clean.
- **Why:** Task 3.3 of the Tier 3 dispatcher build. Establishes the engine core needed by operator screens and the stage.
- **Files/areas:** `apps/brain/src/dispatcher.ts` (new), `apps/brain/test/dispatcher.test.ts` (new), `apps/brain/src/store.ts` (added `clear()`).
- **Docs touched:** this changelog.

---

## 2026-06-20 — Tier 3 Task 3.2: Dispatcher knob config + store stampMilestone/remove
- **What:** Added `config.dispatcher` block to `apps/brain/src/config.ts` — 9 env-overridable numeric knobs (`K`, `warmupMs`, `maxWaitMs`, `noShowMs`, `staleMs`, `graceMs`, `tickMs`) plus 2 boolean flags (`autoConfirm`, `noShowAutoRepool`) and a `slots` record for per-station capacity. All values read from `process.env` with rehearsal-fast defaults. Added `store.stampMilestone(id, field)` (operator mark-complete backstop, stamps any milestone field to `now()`) and `store.remove(id): boolean` (deletes record + frees number index) to `apps/brain/src/store.ts`. Tests appended to `apps/brain/test/store.test.ts` (TDD: 3 tests RED → GREEN); full typecheck passes clean.
- **Why:** Dispatcher engine (Task 3.3+) needs tuneable thresholds without code changes, and store manipulation primitives for no-show reaping and operator removes.
- **Files/areas:** `apps/brain/src/config.ts`, `apps/brain/src/store.ts`, `apps/brain/test/store.test.ts`.
- **Docs touched:** this changelog.

---

## 2026-06-20 — Tier 3 Task 3.1: Station enum, station.hello, DispatchState types
- **What:** Added shared `Station` zod enum (`["intake","bodyscan","altar"]`) to `packages/shared/src/schemas.ts`, replacing the inline `z.enum([...])` in `VisitorLocation`. Added `station.hello` variant to `WsClientMsg` discriminated union. Added `DispatchFlag`, `DispatchSlot`, `DispatchQueueEntry`, `DispatchCall`, `DispatchState` TypeScript types and `dispatch.state` variant to `WsServerMsg` in `packages/shared/src/protocol.ts`. New tests appended to `apps/brain/test/schema.test.ts` (TDD: RED then GREEN).
- **Why:** First additive step of the Tier 3 dispatcher build — establishes the shared vocabulary consumed by all Tier 3 tasks (dispatcher logic, operator screens). Purely additive; all existing consumers still compile.
- **Files/areas:** `packages/shared/src/schemas.ts`, `packages/shared/src/protocol.ts`, `apps/brain/test/schema.test.ts`.
- **Docs touched:** this changelog.

---

## 2026-06-19 — /bodyscan: warn when the body isn't fully in frame
- **What:** `/bodyscan` now gives user-facing feedback when the visitor isn't framed head-to-toe. Added `bodyCoverage(vec)` (mean per-joint visibility) and `isBodyFramed(coverage, wasFramed)` (hysteresis: enter `0.65` / exit `0.55`) to `apps/stage/src/lib/pose/angles.ts`. `BodyScan.tsx` tracks the framed flag per frame (incl. the no-body case) and uses it as the record-hold gate; when not framed the camera view gets a red highlight + a "Step back so your whole body — head to toe — is in frame." overlay (un-mirrored like `.poseflash`). The hysteresis band stops the warning strobing at the threshold.
- **Why:** The hold timer's old `bodyVisible` gate (`mean weight > 0.5`) silently refused to register a held pose whenever the legs were out of frame — the common webcam case — with **no on-screen explanation**. Visitors held a pose and nothing happened. The design (ARCHITECTURE §6) already flagged full-body framing as the real CV risk; it just had no feedback affordance.
- **Files/areas:** `apps/stage/src/lib/pose/angles.ts` (new predicates), `apps/stage/src/routes/BodyScan.tsx` (framing state + gate + overlay), `apps/stage/src/styles.css` (`.posestage.unframed`, `.framehint`).
- **Docs touched:** this changelog; ARCHITECTURE.md §6 (enroll bullet + robustness note).

---

## 2026-06-19 — Switch LLM provider: Anthropic Claude → OpenAI
- **What:** The brain's LLM provider is now OpenAI. `@anthropic-ai/sdk` → `openai`; `ANTHROPIC_API_KEY` → `OPENAI_API_KEY`; models default to `gpt-4o` for both the intake→seeds transform and the live oracle loop (configurable via `TRANSFORM_MODEL`/`ORACLE_MODEL`). `transform.ts` uses `chat.completions.create`; `divination.ts` streams via `chat.completions.create({stream:true})`. The offline fallback (no key → stub seeds / word-by-word oracle) is unchanged.
- **Why:** Project decision to use OpenAI GPT models instead of Claude.
- **Files/areas:** `apps/brain/{config,transform,divination}.ts`, `apps/brain/package.json`, `app/.env.example`; docs (ARCHITECTURE.md §1/§5, root+docs+app CLAUDE.md).
- **Docs touched:** this changelog; CLAUDE.md (×3); ARCHITECTURE.md.

---

## 2026-06-19 — Fix /altar verifyPose 400 (empty JSON body)

- **What:** In `apps/stage/src/lib/api.ts`, the `post` helper now omits the `content-type: application/json` header when called with no body (it already omitted the body itself). Previously it always set the JSON content-type, so the bodyless `verifyPose` POST sent `Content-Type: application/json` with an empty body.
- **Why:** Fastify's JSON content-type parser rejects an empty body when `content-type: application/json` is declared, throwing `FST_ERR_CTP_EMPTY_JSON_BODY` (HTTP 400). This broke pose verification on `/altar` — the `/api/visitors/:id/verify` endpoint reads only `req.params` and expects no body. `verifyPose` was the only bodyless POST, so it was the only call affected.
- **Files/areas:** `apps/stage/src/lib/api.ts` (`post` helper).
- **Docs touched:** this changelog.

---

## 2026-06-19 — Reconcile architecture/reference docs to implemented multi-station Tier 0+1

- **What:** Doc-only edits to reconcile three reference files to the implemented multi-station reality (no code touched). Updated `docs/ARCHITECTURE.md` §3–§6: status pointer now states Tier 0+1 are implemented / Tier 2+3 not built; §3 route list updated to `/intake /bodyscan /altar /channel /console /souvenir` (Tier 3 `/waiting /board /dispatch` noted as designed, not built); §4 data model updated to current `VisitorProfile` shape (number-keyed, optional survey, top-level archetype, poseTemplate, milestone timestamps), `SurveyResponse` with no archetype, added `PoseVector`/`VisitorLocation`, noted `Seeds.persona` deprecated; §5.1 rewritten as number-gate → data-only form → Physical Challenge handoff; §5.3 `/station` → `/channel`, lobby filters to oracle-ready visitors, archetype assignment paragraph updated to altar persona seam; §6 pose section rewritten as self-invented identity token (enroll at `/bodyscan`, verify at `/altar`, iteration-2 archetype-pose plan cancelled). Updated `app/CLAUDE.md` route list and descriptions. Updated `docs/CLAUDE.md` `/station` → `/channel` in the stateful-resource-recovery convention anecdote.
- **Why:** Tier 0+1 implementation diverged significantly from the pre-redesign docs; docs needed to reflect the built reality before the workshop.
- **Files/areas:** `docs/ARCHITECTURE.md` (§3–§6), `app/CLAUDE.md`, `docs/CLAUDE.md`.
- **Docs touched:** this changelog.

---

## 2026-06-19 — /channel lobby: refresh on oracle.selected + divination.ended (fix)

- **What:** In `apps/stage/src/routes/Channel.tsx`, extended the WS `event` handler to also call `refresh()` on `oracle.selected` and `divination.ended` events (previously only `visitor.submitted` and `seeds.ready` triggered a refresh). Also corrected a stale CHANGELOG description in the Task 0.5 entry (the divination guards test description now accurately reflects the real ws-based integration test).
- **Why:** A visitor becomes oracle-ready when `oracle.selected` fires (altar sets persona + verifies pose); the divination ends on `divination.ended`. Without refreshing on these events, the /channel lobby would not show a newly-ready visitor or drop a finished one — a manual page reload was required in the single-visitor path. `oracle.selected` and `divination.ended` are valid `ShowEvent` literals confirmed in `packages/shared/src/events.ts`.
- **Files/areas:** `apps/stage/src/routes/Channel.tsx` (event handler), `docs/CHANGELOG.md` (Task 0.5 description fix).
- **Docs touched:** this changelog.

---

## 2026-06-19 — /channel: oracle-ready lobby, archetype from record, drop debug fetch (Task 1.5)

- **What:** Created `apps/stage/src/routes/Channel.tsx` from `Station.tsx` with three changes: (a) renamed export to `Channel`; (b) lobby now filters to oracle-ready visitors only (`!!v.personaAt && !!v.poseVerifiedAt && !v.sessionEndAt`) and reads archetype from `v.archetype` (top-level record) instead of `v.survey.archetype`; (c) deleted the debug `fetch` block (`#region agent log`) from `toggleMic`. Deleted `Station.tsx` via `git rm`. Updated `App.tsx`: replaced `Station` import with `Channel`, updated `SCREENS` from `["intake","bodyscan","altar","station","console","souvenir"]` to `["intake","bodyscan","altar","channel","console","souvenir"]`, swapped `/station` route for `/channel`. Fixed `Console.tsx` minimally for the new `VisitorProfile` shape: `v.survey.name` → `v.survey?.name`, `v.survey.archetype` → `v.archetype`. All four packages typecheck clean (0 errors); stage build succeeds.
- **Why:** Capstone Tier 1 task — makes the whole stage green. `/channel` now shows only visitors who have completed all ritual steps (intake → bodyscan → altar). Archetype lives on the record since Task 1.4 moved it there. Debug fetch was leftover instrumentation from hypothesis testing.
- **Files/areas:** `apps/stage/src/routes/Channel.tsx` (new), `apps/stage/src/routes/Station.tsx` (deleted), `apps/stage/src/routes/Console.tsx` (minimal compile fix), `apps/stage/src/App.tsx` (route wiring).
- **Docs touched:** this changelog.

---

## 2026-06-19 — /altar: pose verify + persona select + poseUI de-dup (Task 1.4)

- **What:** Created `/altar` route (`apps/stage/src/routes/Altar.tsx`) — gates on `NumberGate`, validates the visitor's held pose against the enrolled template (sustained still+similar hold via `poseSimilarity`/`motionMetric`, with a Manual-unlock override), lets the operator pick an oracle persona from the three `ARCHETYPES`, and shows "ORACLE READY" when both steps are done. Each action POSTs to the brain (`api.verifyPose`, `api.setPersona`). Also extracted shared pose-drawing helpers into `apps/stage/src/components/poseUI.tsx` (exports `Bar` and `drawSkeleton`), and refactored `BodyScan.tsx` to import from `poseUI` instead of duplicating local `Bar`/`draw` implementations. Wired `/altar` in `App.tsx` (import, SCREENS, Route).
- **Why:** Tier 1 altar station — this is the visitor's final step before channelling: prove they are who they enrolled as (pose match), then pick the oracle persona the performer will embody. Extracting `poseUI` was a pre-flight de-duplication decision to avoid `Bar`/`drawSkeleton` existing in two places; BodyScan behavior is unchanged.
- **Files/areas:** `apps/stage/src/routes/Altar.tsx` (new), `apps/stage/src/components/poseUI.tsx` (new), `apps/stage/src/routes/BodyScan.tsx` (refactored — shared helpers), `apps/stage/src/App.tsx` (route wiring).
- **Docs touched:** this changelog.

---

## 2026-06-19 — /scan → /bodyscan: number gate, enroll-only, persist pose template (Task 1.3)

- **What:** Created `apps/stage/src/routes/BodyScan.tsx` — gates on `NumberGate`, runs the pose CV pipeline (camera + MediaPipe skeleton overlay), records the visitor's invented shape (hold-to-lock), and on lock POSTs the `PoseVector` via `api.enrollPose`. The verify/match loop from the old `Scan.tsx` is gone (verification happens at the altar in a later task). Deleted `apps/stage/src/routes/Scan.tsx` (`git rm`). Updated `App.tsx`: replaced `import { Scan }` with `import { BodyScan }`, updated `SCREENS` from `["intake","scan",...]` to `["intake","bodyscan",...]`, swapped `<Route path="/scan">` for `<Route path="/bodyscan">`.
- **Why:** Tier 1 station split — bodyscan is enroll-only; match/verify belongs to the altar route (Task 1.5+). Wrapping in `NumberGate` gives each station consistent visitor identity without re-implementing number capture.
- **Files/areas:** `apps/stage/src/routes/BodyScan.tsx` (new), `apps/stage/src/routes/Scan.tsx` (deleted), `apps/stage/src/App.tsx` (route wiring).
- **Docs touched:** this changelog.

---

## 2026-06-19 — Survey trim + Intake rework: number gate, data-only form, physical-challenge handoff (Task 1.2)

- **What:** Trimmed `packages/shared/src/survey.ts` — removed the two `scan` SurveyField kinds (pose/fiducial) and the `oracle` kind, plus their three corresponding entries from the `SURVEY` array. The eight content fields (name, tender, shoeSize, lost, ssn, three phrase pickers) are unchanged. Rewrote `apps/stage/src/routes/Intake.tsx`: now gates on `NumberGate` (enter visitor number → resolve `VisitorProfile`), renders only text/longtext/phrase fields (no scan placeholders, no oracle picker), submits via `api.submitIntake(visitor.id, survey)`, and shows "Number N — proceed to the Physical Challenge when called." on completion. `SurveyResponse` no longer includes `archetype` (removed in Tier 0); Intake does not set it.
- **Why:** Spec §3–§6 moved scan stations and oracle choice out of the intake form; the intake route should be purely a data-collection form with a physical-world handoff message. The number gate makes cross-station visitor identity consistent (same pattern as /bodyscan and /altar).
- **Files/areas:** `packages/shared/src/survey.ts` (trimmed), `apps/stage/src/routes/Intake.tsx` (rewritten).
- **Docs touched:** this changelog.

---

## 2026-06-19 — Stage API client + shared NumberGate (Task 1.1)

- **What:** Rewrote `apps/stage/src/lib/api.ts` to target the Tier 0 brain endpoints: removed old `submitSurvey`/`generateSeeds`, added `register`, `getByNumber`, `submitIntake`, `enrollPose`, `setPersona`, `verifyPose` (all returning `Promise<VisitorProfile>`), kept `listVisitors`. Added new `apps/stage/src/components/NumberGate.tsx`: a shared "enter your number" gate that calls `api.register` and hands the resolved `VisitorProfile` up via `onResolved` callback; used by `/intake`, `/bodyscan`, `/altar` in later tasks.
- **Why:** Tier 1 stage UI needs a correctly-typed API layer matching the brain's actual endpoint paths, and a reusable identity gate component so each station route doesn't re-implement number capture.
- **Files/areas:** `apps/stage/src/lib/api.ts` (rewritten), `apps/stage/src/components/NumberGate.tsx` (new).
- **Docs touched:** this changelog.

---

## 2026-06-19 — Divination: archetype from record, guard missing survey/persona, stamp session (Task 0.5)

- **What:** Made `packages/oracles/src/buildPrompt.ts` survey-safe: `buildSystemPrompt` now takes a concrete `SurveyResponse` (not a `VisitorProfile`), and `buildPersona` guards `if (!profile.survey) throw`. Updated `apps/brain/src/divination.ts` `start()` to read `visitor.archetype` (top-level field, was `visitor.survey.archetype`), guard missing `survey` and `archetype` with `session.error` replies, and call `store.markSessionStart(visitorId)` after the session map entry is written. Added `store.markSessionEnd(session.visitorId)` in `reap()` immediately after `sessions.delete`. Removed now-unused `ARCHETYPES` import from `divination.ts`. Added a guard test to `apps/brain/test/endpoints.test.ts` (describes "divination guards"): opens a real WebSocket client, sends `session.start`, and asserts the two `session.error` guard replies — "visitor has not completed intake" (bare visitor, no survey) and "no oracle selected yet" (visitor with survey but no archetype). Brain/oracles/shared all typecheck clean; stage is the only remaining residual (Tier 1).
- **Why:** `survey` is optional post-schema-rewrite and `archetype` moved to top-level on `VisitorProfile`; the old code would throw at runtime on any visitor who hadn't completed intake. Session stamping enables the console/dispatcher to show live session state.
- **Files/areas:** `packages/oracles/src/buildPrompt.ts`, `apps/brain/src/divination.ts`, `apps/brain/test/endpoints.test.ts`.
- **Docs touched:** this changelog.

---

## 2026-06-19 — Brain endpoints: register/intake/pose/persona/verify + injectable app factory (Task 0.4)

- **What:** Extracted `buildApp()` from `apps/brain/src/index.ts` into a new `apps/brain/src/app.ts` so tests can use Fastify `app.inject()` without binding a port. Slimmed `index.ts` to just `buildApp()` + `listen`. Added five new station endpoints: `POST /api/register` (create-or-fetch by number), `GET /api/visitors/by-number/:number`, `POST /api/visitors/:id/intake` (attach survey, fire music-seed transform fire-and-forget, emit `visitor.submitted` + async `seeds.ready`), `POST /api/visitors/:id/pose`, `POST /api/visitors/:id/persona` (emits `oracle.selected`), `POST /api/visitors/:id/verify`. Removed the legacy `POST /api/visitors` (full-survey create); preserved `/scan`, `/seeds`, `/demo/echo`, `/stt`, `/health`. Guarded `transform.ts` for the now-optional `survey` field (`stubSeeds` uses `?.`, transform short-circuits with stub when `!profile.survey`). Added `zod` as a direct dependency to `@channelers/brain`. Added `apps/brain/test/endpoints.test.ts` (5 tests, all green).
- **Why:** Multi-station flow requires identity established at the kiosk before intake; the station endpoints are the HTTP interface each station POSTs to. `buildApp()` extraction enables integration tests without a live server.
- **Files/areas:** `apps/brain/src/app.ts` (new), `apps/brain/src/index.ts` (slimmed), `apps/brain/src/transform.ts` (survey guard), `apps/brain/test/endpoints.test.ts` (new), `apps/brain/package.json` (added zod).
- **Docs touched:** this changelog.
- **Residual typecheck failures (pre-existing, not introduced here):** `apps/brain/src/divination.ts` (reads `visitor.survey.archetype`, old shape), `packages/oracles/src/buildPrompt.ts` (same pattern), `apps/stage/src/routes/*.tsx` — all fixed in Tasks 0.5 / Tier 1.

---

## 2026-06-19 — Number-indexed store with registration, upsert, and state stamps (Task 0.3)

- **What:** Rewrote `apps/brain/src/store.ts`. The old store had a single `create(survey)` entry point; the new store is built around `register(number)` — a create-or-fetch keyed on the human ticket number via a `byNumber: Map<number, string>` index. Added upsert helpers that stamp milestone timestamps: `upsertSurvey` (sets `intakeAt`), `setPoseTemplate` (sets `poseAt`), `setArchetype` (sets `personaAt`), `setPoseVerified` (sets `poseVerifiedAt`), `setLocation`, `markSessionStart`/`markSessionEnd`. Preserved the legacy `addScan` method (still called by the existing `/scan` route). Added `apps/brain/test/store.test.ts` with 6 tests covering registration idempotency, upserts, and unknown-id handling.
- **Why:** The multi-station flow (spec §3.1) requires visitors to be born on first touch by number, not after intake completes. State stamping enables the console/dispatcher to track which milestone each visitor has passed. The `byNumber` index is the cross-station lookup key.
- **Files/areas:** `apps/brain/src/store.ts` (rewrite), `apps/brain/test/store.test.ts` (new). Expected downstream typecheck failures (not new): `apps/brain/src/index.ts` (calls `store.create`), `apps/brain/src/divination.ts`, `apps/brain/src/transform.ts`, `apps/stage/src/routes/*.tsx`, `packages/oracles/src/buildPrompt.ts` — all fixed in Tasks 0.4–0.5.
- **Docs touched:** this changelog.

---

## 2026-06-19 — Shared schema: number-keyed VisitorProfile + PoseVector + location (Task 0.2)

- **What:** Reshaped the core data model in `packages/shared/src/schemas.ts`. `VisitorProfile` gains a human ticket `number` (the cross-station lookup key), `survey` becomes optional (a visitor is registered before intake), `archetype` moves from `SurveyResponse` to the top-level record, and the profile gains a persisted `poseTemplate` (a `PoseVector`), a transient `location` (`VisitorLocation`), and milestone timestamps (`intakeAt`, `poseAt`, `personaAt`, `poseVerifiedAt`, `sessionStartAt`, `sessionEndAt`). Added exports: `PoseVector`, `VisitorLocation`. Intentionally breaks downstream consumers that used the old shape — those are fixed in subsequent tasks.
- **Why:** The multi-station architecture (spec §3.1/3.2/5) requires identity across stations via ticket number, not UUID; pose is now an identity token enrolled at the body-scan station; archetype is an altar choice not an intake field. Schema is the foundation for all following Tier 1 tasks.
- **Files/areas:** `packages/shared/src/schemas.ts` (modified), `apps/brain/test/schema.test.ts` (new schema test via TDD). Downstream breakage (expected, to be fixed by later tasks): `apps/brain/src/{store,divination,transform}.ts`, `apps/stage/src/routes/{Console,Intake,Station}.tsx`, `packages/oracles/src/buildPrompt.ts`.
- **Docs touched:** this changelog.

---

## 2026-06-19 — Vitest harness for brain package (Task 0.1)

- **What:** Added vitest test runner to `apps/brain`. New scripts `test` (`vitest run`) and `test:watch` (`vitest`), `vitest ^2.1.8` devDependency, `vitest.config.ts` (node environment, `test/**/*.test.ts` glob), and a smoke test that confirms `1+1=2`. `pnpm --filter @channelers/brain test` now passes.
- **Why:** All Tier 0 brain tasks (identity store, divination, etc.) depend on a working test harness. This is the foundation step before any brain logic is written.
- **Files/areas:** `apps/brain/package.json`, `apps/brain/vitest.config.ts` (new), `apps/brain/test/smoke.test.ts` (new), `pnpm-lock.yaml`.
- **Docs touched:** this changelog.

---

## 2026-06-19 — Multi-station architecture design spec (planning)

- **What:** Design spec for the multi-station performance flow — number-based identity across waiting-room → intake → body-scan → altar → channel; pose promoted to a self-invented **identity token** (enroll → verify, no archetype classification); a low-tech swappable **persona seam** (chosen at the altar, not intake); a hybrid **AI-choreography** layer (intake+archetype first pass → live per-turn agent on its own feed); and an app-managed **dispatcher** (randomized + anti-starvation) with `/board` + `/dispatch` + a master `/console`. Removes the oracle pick and the Physical-Challenge placeholders from intake (the original ask) — now Tier 1 of a 4-tier build (0: identity/state · 1: single-visitor path · 2: choreography · 3: logistics).
- **Why:** A team meeting reframed the show into distinct stations with an analog ticket-number identity and added live-generated choreography. The single-path flow (oracle chosen during intake, UUID-only identity) no longer fits.
- **Files/areas:** `docs/superpowers/specs/2026-06-19-multi-station-architecture-design.md` (new). Planned changes span `apps/stage` routes, `apps/brain` (store/divination/transform/new dispatcher), `packages/shared` (schemas/protocol), `packages/oracles`.
- **Docs touched:** this changelog; `docs/ARCHITECTURE.md` (§12 open questions + status pointer).

---

## 2026-06-11 — Pose scan station, iteration 1 (self-recorded round-trip)

- **What:** Built the first working pose-capture prototype at `/scan` (was a TODO placeholder). MediaPipe Tasks-for-Web (`@mediapipe/tasks-vision`, Pose Landmarker `full`) on the webcam → 33 landmarks → an **angle-vector** pose representation → capture-then-match. UX: start camera → "strike a pose and hold it" (hold ~3.5s while still) → template locks in → "return to your shape" → hold ~1.5s while still AND similar → "✓ MATCH". Functional debug view: live skeleton overlay, motion/similarity/hold telemetry bars, a per-joint live-vs-template table, and live-tunable thresholds (stillness, match, hold durations).
- **Why:** De-risk the §6 "human QR code" body-scan with the smallest thing that proves the core tech. Key reframe: this is pose **matching**, not **classification** — no model training/dataset, just geometry on the landmarks. Joint angles are translation/scale/identity-invariant by construction, so "same shape" survives the visitor standing elsewhere or being a different size. Record and detect are the same "hold a qualifying state for N seconds" state machine; only the predicate differs (record = still; detect = still AND matches template). The angle-vector motion metric *is* the deviation detection (hold timer advances only while motion < threshold, resets on movement).
- **Files/areas:**
  - `apps/stage/src/lib/pose/landmarks.ts` (new) — BlazePose indices, the 8 measured joints, draw connections.
  - `apps/stage/src/lib/pose/angles.ts` (new) — `landmarksToAngles`, `angleDistance` (weighted by visibility), `poseSimilarity`, `motionMetric`. Pure/React-free.
  - `apps/stage/src/lib/pose/usePoseLandmarker.ts` (new) — wraps MediaPipe + webcam; WASM/model from CDN (vendor locally later for offline).
  - `apps/stage/src/routes/Scan.tsx` (rewritten) — state machine (ready→record→watch→matched), skeleton canvas, debug telemetry + tuners.
  - `apps/stage/src/styles.css` — pose-station styles. `apps/stage/package.json` — `@mediapipe/tasks-vision` dep.
- **Output already fits the contract:** matched template → `archetypeGuess`, similarity → `confidence`, landmarks → `keypoints` of the existing `PoseScan` schema. Not wired to the brain yet — fully self-contained in-browser, as scoped for iteration 1.
- **Next (iteration 2):** swap the self-recorded template for a small library of pre-authored archetype poses (the real "match your spirit animal" flow); then POST `scan` + emit `scan.pose`.
- **Verified:** `pnpm -r typecheck` clean; stage production build clean (MediaPipe WASM loads at runtime from CDN, bundle stays ~113 kB gz). Live camera/matching behavior not yet hands-on tested.
- **Docs touched:** `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md` §6.

---

## 2026-06-10 — Fix STT: brain-side Whisper for all browsers

- **What:** All browsers now use brain-side STT: `MediaRecorder` → WAV in-browser → `POST /api/stt` → local Whisper on Node. Fixed brain `transcribeWav()` to pass a `Float32Array` directly (Node has no `AudioContext`; file-path input was causing 500s). Removed browser `@xenova/transformers` (had crashed the whole site with `registerBackend` under Vite).
- **Why:** Runtime logs showed `network` errors on cloud Web Speech in **both** Cursor/Electron and standalone Chrome — not an embedded-browser-only issue. Brain logs confirmed the 500 root cause: `Unable to load audio from path/URL since AudioContext is not available`.
- **Files/areas:** `apps/stage/src/lib/speech.ts`, `apps/brain/src/stt.ts`, `apps/brain/src/index.ts`, `apps/brain/package.json`, `apps/stage/package.json`.
- **Docs touched:** `docs/CHANGELOG.md`.

---

## 2026-06-10 — Robust divination-session recovery (refresh-safe + orphan reaper)

- **What:** Sessions now survive a `/station` refresh and clean themselves up when abandoned.
  - **Recovery:** new `session.rejoin` (client→server) / `session.resumed` (server→client) protocol messages. The client persists its `{sessionId, visitorId}` handle in localStorage (`sessionHandle.ts`) and, on every (re)connect, re-asserts it via `session.rejoin`; the brain replies with full state (history + teleprompter) so the in-session UI restores transparently.
  - **Cleanup:** the `Bus` now mints a per-connection `connId`, threads it to the command/connect handlers, and fires a new `onDisconnect(connId)` hook on socket close. Divination tags each session with its `ownerConn` and starts a grace timer (`SESSION_GRACE_MS` = 90s) on disconnect, reaping the orphan if no one re-attaches — so an abandoned tab frees the visitor.
  - **Backstop:** the lobby's active-session rows gained manual **Reclaim** / **End** buttons (keyed on the `sessionId` already in the roster). `/console` stays read-only.
- **Why:** refreshing `/station` mid-divination stranded the session — the only handle to it (`mySessionId`) lived in ephemeral React state, the brain only removed sessions on explicit `session.end`, and the `Bus` had no socket-close handling. The visitor was stuck "being channelled" with no way to rejoin, end, or re-claim. Root cause: ephemeral client state held the sole handle to a durable server resource whose lifetime was bound to a command rather than to owner liveness.
- **Files/areas:** `packages/shared/src/protocol.ts` (rejoin/resumed messages), `apps/brain/src/bus.ts` (connId + onDisconnect), `apps/brain/src/divination.ts` (ownerConn, `rejoin`, `reap`, grace timer), `apps/stage/src/lib/sessionHandle.ts` (new), `apps/stage/src/routes/Station.tsx` (persist + re-attach effect + resumed handling + lobby Reclaim/End).
- **Docs touched:** `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md` §5.3 (session liveness & recovery), `docs/CLAUDE.md` (new convention: stateful resources need recovery + liveness-bound cleanup).

---

## 2026-06-10 — Fix /station STT: surface errors + fix stuck-listening state

- **What:** Made the browser Web Speech API recognizer observable. Added `onstart`, `onend`, and `onerror` handlers to `createRecognizer` (new handlers-object signature replaces single callback). `onerror` maps error codes to friendly performer-facing messages (`not-allowed`, `network`, `no-speech`, `audio-capture`). Lifecycle events now drive React `listening` state instead of the `onresult` callback — fixing the stuck "● listening" button after any non-result end. STT errors surface through the existing in-session error banner.
- **Why:** STT was silently failing with no feedback — clicking the mic did nothing and there was no way to diagnose why. The missing `onerror`/`onend` handlers meant permission denials, network blocks, and silence timeouts were all swallowed.
- **Files/areas:** `apps/stage/src/lib/speech.ts`, `apps/stage/src/routes/Station.tsx`.
- **Docs touched:** `docs/CHANGELOG.md`.

---

## 2026-06-09 — Parallel sessions, unified /station page, visitor-chosen oracle, auto-seeds

- **What:** Four interconnected architecture changes:
  1. **Parallel divinations** — the brain now tracks multiple concurrent sessions in a `Map<sessionId, Session>` (was a single `active` singleton). Each `session.say` and `session.end` command carries a `sessionId`; server messages tag their `sessionId` so clients filter to only their own stream. A new `roster` WS message broadcasts the live session list on every change and on new-client connect.
  2. **Unified `/station` performer page** — replaces the two-page Console+Oracle split. In lobby mode it shows available visitors (not yet being channelled) with their chosen oracle name and a **Channel** button. One tap claims the visitor and drops the performer directly into the full teleprompter+mic/text UI with a whisper-TTS toggle and End button. No page navigation required. `/oracle` is removed.
  3. **Visitor-chosen oracle** — visitors pick their own archetype at the end of the intake survey (new `oracle` field in `SurveyField` and `SurveyResponse.archetype`). The performer just channels whoever they claim; there is no archetype dropdown for them. `ARCHETYPES` now carries a visitor-facing `blurb` for the intake picker.
  4. **Auto-generate seeds on submit** — the brain fires the Opus 4.8 transform fire-and-forget when a visitor submits (`POST /api/visitors`), so Anna/Jeff get their seeds early and the lobby shows visitors as ready. Manual `POST /api/visitors/:id/seeds` endpoint is kept for regeneration.
- **Why:** Performers were navigating between two pages mid-performance, and only one divination could run at a time, which bottlenecked the show when multiple visitors were ready. Letting visitors choose their own oracle is more thematically consistent (fate, not operator assignment). Auto-seeding removes an operator step.
- **Files/areas:**
  - `packages/shared/src/protocol.ts` — `sessionId` on `session.say`, `session.end`, and all server streaming messages; new `roster` + `SessionSummary`; `session.start` drops `archetype` (read from visitor record now); updated protocol comment.
  - `packages/shared/src/schemas.ts` — `SurveyResponse.archetype?: string`.
  - `packages/shared/src/survey.ts` — new `oracle` field kind; new final SURVEY entry "Choose your oracle".
  - `packages/shared/src/archetypes.ts` — `blurb` added to each archetype for the intake picker.
  - `apps/brain/src/bus.ts` — command handler now receives a per-socket `reply` closure for targeted errors; new `onConnect(fn)` hook to push current roster to each new socket.
  - `apps/brain/src/divination.ts` — `Map<string, Session>` replaces singleton; `start/say/end` all keyed by `sessionId`; one-session-per-visitor guard; archetype read from `visitor.survey.archetype` with fallback to `ARCHETYPES[0]`; `rosterMsg()` helper; register roster on connect via `bus.onConnect`.
  - `apps/brain/src/index.ts` — `POST /api/visitors` now fire-and-forgets the seeds transform.
  - `apps/stage/src/routes/Station.tsx` — **new** unified performer page (lobby + in-session mode, session-ID-filtered WS messages).
  - `apps/stage/src/routes/Intake.tsx` — oracle-picker field (choice buttons with blurb, required before submit).
  - `apps/stage/src/routes/Console.tsx` — rewritten as a passive read-only monitor (active sessions + waiting queue; no controls).
  - `apps/stage/src/routes/Oracle.tsx` — **deleted** (functionality moved into Station.tsx).
  - `apps/stage/src/App.tsx` — `/station` added; `/oracle` removed; Home menu updated.
- **Verified:** `pnpm -r typecheck` passes across all packages (0 errors). No API key needed — offline fallback streams word-by-word per session.
- **Docs touched:** `CHANGELOG.md` (this entry), `ARCHITECTURE.md` (§4, §5.3, §8, §9, §11 to be updated in next pass).

---

## 2026-06-09 — Documentation: context-transfer infrastructure
- **What:** Added this changelog; an "update the changelog + relevant docs after every change" agreement in `docs/CLAUDE.md`; and `CLAUDE.md` files at the app root (`app/CLAUDE.md`) and the project root (`CHANNELERS/CLAUDE.md`).
- **Why:** Make context transfer reliable across sessions regardless of which directory a session starts in. The root file is loaded as a parent everywhere in the tree; the app-level file ensures the changelog agreement applies during implementation work (where `docs/CLAUDE.md` isn't auto-loaded).
- **Files/areas:** `docs/CHANGELOG.md`, `docs/CLAUDE.md`, `app/CLAUDE.md`, `CLAUDE.md` (project root).
- **Docs touched:** all of the above.

## 2026-06-09 — Live divination loop
- **What:** End-to-end streaming oracle: visitor utterance → Claude (as the chosen persona, seeded by intake) → streamed to the performer as a teleprompter + browser TTS. Operator starts/ends the session; one active divination at a time.
- **Why:** This is the heart of the show and the highest-value vertical slice after the pipeline; it also exercises the persona-voice work (ARCHITECTURE.md §5.3, §5.5) for real.
- **Files/areas:**
  - `packages/shared/src/protocol.ts` — typed WS protocol: client cmds `session.start|say|end` (zod-validated), server msgs `session.started|transcript`, `oracle.delta|done`, `session.ended|error`. `packages/shared/src/archetypes.ts` — `ARCHETYPES` menu.
  - `apps/brain/src/bus.ts` — extended to `broadcast()` + `setCommandHandler()`; ShowEvents now wrapped as `{ kind: "event", event }`. `apps/brain/src/divination.ts` — owns the active session, builds the persona via `@channelers/oracles`, streams Claude (Sonnet 4.6, temp 1) with a word-by-word **offline fallback** when no API key. `config.ts` gains `ORACLE_MODEL`.
  - `apps/stage` — new `lib/useBrainSocket.ts` (replaces `useShowSocket`) and `lib/speech.ts` (TTS + Web Speech STT). `/console` gains the Oracle menu + Start/End + live monitor; `/oracle` is the performer teleprompter with a whisper(TTS) toggle and mic/typed visitor input.
- **Verified:** all packages typecheck; stage builds; WS smoke test confirmed streamed deltas reconstruct the final text exactly. Fixed two real bugs (an `await` in a non-async state updater; the fallback repeating its opening line).
- **Docs touched:** this changelog (created).

## 2026-06-09 — App monorepo scaffold (intake → seeds pipeline)
- **What:** Created `x:\projects\CHANNELERS\app`, a pnpm + TypeScript monorepo, and the working intake→seeds pipeline. A visitor fills `/intake`, the operator sees them on `/console` and generates seeds.
- **Why:** Replace the manual copy/paste process with one streamlined path; establish the Show Brain hub + shared contract everything else plugs into.
- **Files/areas:** `apps/brain` (Fastify + `ws` + OSC hub, in-memory store, transform on Opus 4.8 with an offline stub, `/api/demo/echo` integration demo), `apps/stage` (Vite/React; routes `/intake /scan /console /oracle /souvenir`), `packages/shared` (zod schemas, `ShowEvent` + OSC address map, `SURVEY` from `intake.md`), `packages/oracles` (3 personas, anti-slop deny-list, system-prompt builder). Added a Fastify content-type parser so body-less POSTs don't 415; added an ambient type for `node-osc`.
- **Verified:** install, typecheck (all packages), brain boot + full REST flow, stage production build. The stub transform wove a survey answer into the generated lyric themes (pipeline confirmed flowing).
- **Docs touched:** `CLAUDE.md` (conventions); `app/README.md` (run instructions).

## 2026-06-09 — Planning & architecture
- **What:** Initial architecture and project context.
- **Why:** Resolve the major forks before building so the workshop MVP has a clear target.
- **Files/areas:** `ARCHITECTURE.md` (v0.1 — Show Brain hub, data model, pipeline, §5.5 persona voice, §6 human-QR, §8 OSC contract, §9 roadmap, §11 open questions); `CLAUDE.md` (repo context + decisions).
- **Decisions:** custom TypeScript intake app; music output = lyrics + params for Anna; hybrid pose-scan + souvenir QR for the "human QR code"; Claude API (Opus 4.8 for transforms, Sonnet 4.6 for the live loop). Bespoke/fine-tuned models = phase-2 exploration on open weights.
- **Docs touched:** `ARCHITECTURE.md`, `CLAUDE.md` (created).
