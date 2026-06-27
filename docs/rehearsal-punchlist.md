# CHANNELERS — Rehearsal punchlist (workshop, Jun 22–28 2026)

Source of truth for the software-change backlog from the **2026-06-26 full-run rehearsal**. Read this after `CHANGELOG.md` to see what's outstanding and where to pick up. Updated every session (status + "next up").

## How this work is organized (operating model)

- **Group by code-locus, not by the rehearsal note's station heading.** Several notes filed under different stations live in the same file (e.g. #3/#4/#14/#17/#24 are all the dispatcher). Working a whole *stream* in one session loads one mental model once.
- **One stream per session, then stop at a clean boundary** (committed · `pnpm -r typecheck` clean · relevant suite green · CHANGELOG written). Trivial streams (config/text/board) can batch 2–3 small items.
- **Delegate exploration to subagents** (return conclusions, not file dumps) to keep the main session's context fresh; read only what you'll edit.
- The limit is *coherence*, not the 1M window — see the operating-model memory entry.

### Per-session handoff checklist

1. Branch landed; `pnpm -r typecheck` clean; relevant `test` suite green.
2. `CHANGELOG.md` entry (what / why / files-areas / docs-touched).
3. **Reconcile `ARCHITECTURE.md` + `CLAUDE.md` route lists** if routes/architecture changed (this step gets missed — make it explicit).
4. Flip item status here; record decisions / new open questions.
5. Save durable cross-session decisions to memory.
6. Update the **Next up** pointer at the bottom.

## Legend

Priority: **P0** show-breaking · **P1** legibility/runnability · **P2** experience polish · **P3** defer past workshop.
Status: 🔴 todo · 🟡 in progress · 🟢 done · ⏸ blocked · ✅ shipped — verify in build · 🗓 deferred.

## Already shipped on `friday-preshow` — verify before doing work


| #   | Item                            | Note                                                                                                                                                                                   |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | Station display = alias, not id | `STATION_LABEL` shipped (2026-06-26); `/dispatch` shows "STATION C - BODY SCAN". Likely **label-text tuning only** to match performers' aliases, not new code. ✅                       |
| 6   | `/station` ability to release   | **Release** (repool) button already exists on `/station` rows. Confirm whether you mean releasing an **in_progress** kiosk visitor (bodyscan/altar), not just timed. ✅                 |
| 18  | ALTAR READY on board            | **Done S7** — `boardRows` now labels the `altarReadyList` subset `ALTAR READY` (covers both the in-queue and altar-closed/unplaced cases); `ON HOLD` still wins for a held visitor. 🟢 |


## Streams

### Stream A — Dispatcher logic (`apps/brain/src/dispatcher.ts`, `packages/shared/src/protocol.ts`)


| #   | Item                                                             | Pri | Status | Notes / deps                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------- | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3   | No-show hold persists after a late arrival completes the station | P0  | 🟢     | Fixed S1: `arrive()`/`checkin()` now clear `noShowHoldUntil`. TDD red→green.                                                                                                                                                                                                                                                         |
| 4   | 1-min intro hold after number registration                       | P1  | 🟢     | Fixed S1: `introHoldMs` default 30s → 60s.                                                                                                                                                                                                                                                                                           |
| 17  | Paper: remove auto-dwell timer, enforce manual checkout          | P1  | 🟢     | Done S5: `paper` is now a `groupStation` with **no dwell** — `reconcile()` never auto-completes/stale-reaps it; only manual **Done** (`markComplete`) exits. Decoupled "always-online" from "dwell-completing"; the `timed` machinery is kept generic but configured to `{}`. TDD red→green.                                         |
| 24  | Waiting room → **overflow holding space**, not a station         | P2  | 🟢     | Done S5: `waitingroom` fully retired (enum/label/milestone/config/dispatcher/`/station` picker). `/board` derives a holding bucket via a new pure `boardRows()`. **Superseded by 24b** — direction changed, the room is back (see below). |
| 24b | **Time Offering room** — re-add the room as a timed `offering` station (timed release + manual early release) | P2 | 🟢 | Done S8 (direction change): new `offering` station built on the kept `timed`/dwell machinery — listing it in `config.dispatcher.timed` gives always-online + dwell auto-release; manual **Done** (`markComplete`) releases early. New id/milestone (`offering`/`offeringAt`), label `STATION A - TIME OFFERING`, 5 slots, 5-min dwell (`OFFERING_DWELL_MS`), non-gating do-it-once. No new dispatcher logic. `/board` lobby-overflow label renamed `WAITING ROOM`→`WAITING`. TDD red→green. |
| 14  | Bodyscan "watch-3" viewing queue (3 assigned, 1 processes)       | P3  | 🗓     | Doesn't map to one-slot model; needs design. Post-workshop.                                                                                                                                                                                                                                                                          |


### Stream B — Oracle / TTS (`apps/brain/src/{choreo,divination,tts}.ts`, `apps/stage/src/{routes/Choreo.tsx,lib/speech.ts}`)


| #   | Item                                                               | Pri | Status | Notes / deps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------ | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22  | Mimic cadence broken: knobs don't toggle, once started never stops | P0  | ⏸      | **Paused S2** pending a better repro. Investigation so far: brain `isMimicTurn` reads **fresh** cfg per turn ([divination.ts:252-255](../app/apps/brain/src/divination.ts#L252)); cadence math, config round-trip, route, and client `update()` (sends the full cfg) all look correct in isolation — so the bug isn't obvious in code. The display `mimicking` banner persists *by design* while mimic is on (mimic turns emit only `choreo.mimic`, no cue to reset it) and clears on the next normal cue. Need to characterize: which knob, which surface, what exact sequence. |
| 23  | TTS reads too fast even at slowest ElevenLabs setting              | P0  | 🟢     | Done S2. Per-device client `playbackRate` knob (default 0.7, preserve pitch) on `/channel` + `/choreo`; `localStorage`-persisted. Compounds with the brain's ElevenLabs `speed: 0.7` (left as-is). New `lib/playbackRate.ts` + `components/SpeedPicker.tsx`. TDD; typecheck clean; 22/22 touched tests green.                                                                                                                                                                                                                                                                    |


### Stream C — Intake (`apps/stage/src/routes/Intake.tsx`, CrtShell)


| #   | Item                                            | Pri | Status | Notes / deps                                                                                                                                                           |
| --- | ----------------------------------------------- | --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | Replace form content with Rachel's new form     | P1  | ⏸      | Blocked: need Rachel's content (update `docs/intake.md` too).                                                                                                          |
| 9   | Post-intake exit instructions (direct user out) | P1  | 🟢     | Done S4: `done` screen is now `ExitScreen` — large thematic amber directive ("step away from the terminal" / "await your summons"), **no number** (per operator). TDD. |
| 7   | Increase intake form font size                  | P1  | 🟢     | Done S4: `.win` base `clamp(15,2vmin,19)` + label/chip/subject bumps in `crt.css`. CSS-only; eyeball on CRT.                                                           |
| 10  | Mac mini resolution doesn't fit CRT monitors    | P1  | 🔴     | Investigate: viewport scaling / overscan. Software fix if possible.                                                                                                    |


### Stream D — Windows-XP skin (stage CSS + shared skin component)


| #   | Item                                                                         | Pri | Status | Notes / deps                                            |
| --- | ---------------------------------------------------------------------------- | --- | ------ | ------------------------------------------------------- |
| 1   | `/dispatch` redesign: clarity for the operator + XP style (audience sees it) | P2  | 🔴     | UX-clarity has a brainstorm component, not just visual. |
| 5   | `/station` XP style                                                          | P2  | 🔴     | Apply shared skin.                                      |
| 15  | `/feed` scanning interface as Windows popup, XP style                        | P2  | 🔴     | Apply shared skin.                                      |
| —   | (establish the XP skin **once**, then apply across D)                        | —   | —      | frontend-design.                                        |


### Stream E — Channeling consolidation (`routes/{Channel,Choreo,Altar,Console}.tsx`)


| #   | Item                                                                   | Pri | Status | Notes / deps                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------- | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19  | Centralize `/channel` + `/choreo` + `/altar` onto one device           | P2  | 🟢     | Done S3: new `**/perform`** tabbed shell reuses the existing components (all mounted, inactive `hidden` → sessions/sockets/audio persist). Consolidation was *convenience, not forced* (sinks route independently).       |
| 20  | Add altar bodyscan override to `/console` (mirror `/altar`'s override) | P2  | 🟢     | Done S3 (already present): Console `unlock` = same `api.verifyPose` override; relabeled `unlock (override)` for clarity. No behavior change.                                                                              |
| 21  | Disable bodyscan confirmation at altar, default to override            | P2  | 🟢     | Done S3: `Unlock (override)` is the primary altar action; camera pose-match is an opt-in `verify by camera` toggle. `/perform` altar is camera-less (`showCamera={false}`); standalone `/altar` keeps camera as fallback. |


### Stream F — Bodyscan experience (`routes/BodyScan.tsx`, pose libs)


| #   | Item                                                              | Pri | Status | Notes / deps                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------- | --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11  | Ask user to repeat their shape to affirm pose memory              | P2  | 🟢     | Done S5: `BodyScanCamera` is now `enroll → confirm` — first 3.5s hold captures pose A (unsaved), visitor must **break** it (sim<0.7) then re-form + hold 1.5s @≥0.9 (altar-style `poseSimilarity` loop), then `enrollPose`. Two-step prompt. Forced break per operator. No brain/server changes. TDD (4 tests). |
| 13  | Aura/colorblob stylized skeleton; remove webcam bg; 100% stylized | P3  | 🟢     | Done S5 (pulled from deferred): new `drawAura` — opaque void bg (removes webcam) + additive-glow bones + hue-swept colorblobs; `bodyscan-cam video { opacity:0 }`. Bodyscan-only; altar keeps diagnostic `drawSkeleton`. TDD (recording-ctx). **Eyeball palette on the rig.**                                   |
| 12  | Change pose tracking model                                        | P3  | 🗓     | Low priority (explicit). Localized to `usePoseLandmarker.ts` model/WASM URLs.                                                                                                                                                                                                                                   |


### Stream G — Board (`routes/Board.tsx`)


| #   | Item                                                      | Pri | Status | Notes / deps                                                                                                                                                                                           |
| --- | --------------------------------------------------------- | --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 18  | Show ALTAR READY on board for completed-stations visitors | P1  | 🟢     | Done S7: `boardRows` relabels the `altarReadyList` subset `WAITING ROOM` → `ALTAR READY` (both in-queue and altar-closed/unplaced); `ON HOLD` takes precedence for a held visitor. TDD; stage 114/114. |


## Open decisions (needed before the dependent stream)

- **#8** — Rachel's new intake form content: have it yet?
- ~~**#24** — which are "the 3 stations"? does WR keep any dwell/milestone or is it purely transient? retire the existing timed `waitingroom` station + `/station/waitingroom` + hourglass?~~ **Resolved (S5), then superseded (S8):** S5 retired `waitingroom` and made `/board` derive a holding label. **S8 reversed direction** — the room is back as a new timed `offering` station (#24b): timed dwell release + manual early Done, on the machinery #17 kept. The lobby-overflow board label is now `WAITING`.
- ~~**#19** — is one-device consolidation *forced* by audio routing, or a convenience?~~ **Resolved (S3):** convenience — the two TTS sinks already route independently, so one device can host all three. Shipped `/perform` as a tabbed shell reusing the components; camera dropped from the consolidated altar (operator: won't be used this iteration).
- ~~**#23** — OK to slow the oracle via client `playbackRate`?~~ **Resolved (S2):** yes — live per-device knob, default 0.7, preserve pitch.
- **#22** — need a concrete repro: which knob ("mimic oracle" vs "cadence" vs "every N"), on which surface, and the exact turn-by-turn sequence where it "doesn't toggle" / "never stops". Code review in S2 found no obvious defect.

## Session log / next up

- **Session 8 (2026-06-27):** Stream A (direction change). **Re-added the waiting room as the "time offering" room (#24b)** after the team reframed it. New `offering` station built entirely on the `timed`/dwell machinery kept by #17 — listing it in `config.dispatcher.timed` gives always-online + dwell auto-release (timed release), and manual **Done** (`markComplete`) gives the early release; **no new dispatcher logic**. New id/milestone (`offering`/`offeringAt`), label `STATION A - TIME OFFERING`, 5 slots, 5-min dwell (`OFFERING_DWELL_MS`), non-gating do-it-once, last in `fillPriority`; added to `/station`'s `PERFORMER_STATIONS`. `/board` lobby-overflow label renamed `WAITING ROOM` → `WAITING` (the room shows its slot label). Two commits, TDD red→green (timed-release + manual-early-release dispatcher tests; board label). Typecheck clean; brain 158/158; stage 129/129. Plan: `docs/superpowers/plans/2026-06-27-time-offering-room.md`. **Not eyeballed on the rig:** `/dispatch` countdown + early Done at `/station/offering`; board `STATION A - TIME OFFERING` vs `WAITING`.
- **Session 7 (2026-06-26):** Stream G. **Shipped #18 (ALTAR READY on `/board`).** `boardRows` now labels the `altarReadyList` subset `ALTAR READY` instead of the generic `WAITING ROOM` — covering both the in-queue case (altar open → eligible → in `queue`) and the unplaced case (altar closed → surfaced only via `altarReadyList`). `ON HOLD` takes precedence for a held visitor; plain not-yet-cleared waiters stay `WAITING ROOM`. No brain/protocol changes (the predicate + list already existed). TDD red→green (Board suite 6/6); typecheck clean; stage 114/114. **Not eyeballed on the rig:** a bodyscan-cleared visitor flipping to `ALTAR READY` on `/board`.
- **Session 6 (2026-06-26):** Stream A. **Shipped #17 (paper manual checkout) + #24 (waiting room → overflow bucket).** Both retire the "timed group station" model: #24 deletes `waitingroom` as a station (enum/`STATION_LABEL`/`waitingRoomAt`/config/dispatcher/`/station` picker) and `/board` now derives a `WAITING ROOM`/`ON HOLD` bucket via a new pure `boardRows()` (unions `queue` + `altarReadyList`, deduped); #17 splits "always-online" from "dwell-completing" via a new `groupStations` config — `paper` is a group station with **no dwell**, exits only on manual **Done**, no auto-complete/stale-reap (the called-phase no-show still applies). `timed`/`dwellMs`/`timedDwellMs` + the `/dispatch`/`/station` countdowns are kept generic but configured to `{}` (per Jared). Two commits (one per task), each TDD red→green. Typecheck clean; brain 139/139; stage 112/112. Plan: `docs/superpowers/plans/2026-06-26-stream-a-paper-manual-waitingroom-overflow.md`. **Not eyeballed on the rig:** `/board` WAITING ROOM display + `/station/paper` Done (no auto-eviction).
- **Session 5 (2026-06-26):** Stream F. **Shipped #11 (repeat-to-confirm) + #13 (aura render).** #11: `BodyScanCamera` gained an `enroll → confirm` machine — the first 3.5s hold captures pose A (not yet saved), the visitor must **break** the pose (`poseSimilarity` < 0.7) and then re-form + hold 1.5s @ ≥0.9 (the altar's match loop, against pose A) before `api.enrollPose` fires; two-step prompt ("release, then form it again" → "now hold the same shape"). Forced break added per operator. #13 (pulled from deferred): new `drawAura` paints an opaque void background (webcam removed) + additive-glow bones + hue-swept colorblobs, `bodyscan-cam video { opacity:0 }`; bodyscan-only (altar keeps the diagnostic `drawSkeleton`). **No brain/protocol/server changes** — `enrollPose` just fires after confirm. TDD (4 BodyScan + 4 poseUI tests); stage 108/108; typecheck clean. Plan: `docs/superpowers/plans/2026-06-26-stream-f-bodyscan.md`. **#12 (model swap) stays deferred.** Not yet eyeballed on the CRT rig (aura palette + the camera path are device-only).
- **Session 1 (2026-06-26):** set up this tracker + operating-model memory; **shipped #3 (no-show hold) + #4 (intro hold → 1 min)** (brain 148/148, typecheck clean, CHANGELOG written). Merged to `friday-preshow` (fast-forward, `fcdbfa7`).
- **Session 2 (2026-06-26):** Stream B. **Shipped #23 (TTS speed)** — per-device client `playbackRate` knob (default 0.7, preserve pitch) on `/channel` + `/choreo`, `localStorage`-persisted; TDD, typecheck clean, 22/22 touched stage tests green. **#22 (mimic) paused** at user's request pending a better characterization — investigation notes captured on the item + in Open decisions. (One unrelated pre-existing `CrtShell.test.tsx` failure noted, not from this work.)
- **Session 4 (2026-06-26):** Stream C (partial). **Shipped #9 (post-intake exit) + #7 (form font size).** #9: post-submit screen is now an exported `ExitScreen` — large amber thematic directive, **no visitor number** (per operator), copy "step away from the terminal / await your summons"; TDD (new `Intake.test.tsx` asserts directive + no `role="img"`). #7: `.win` base font `clamp(15,2vmin,19)` + label/chip/subject clamp bumps in `crt.css` (CSS-only; not eyeballed on the CRT rig). Stage 101/101; typecheck clean; CHANGELOG written. **#8 (Rachel's form) + #10 (CRT resolution) deferred** per request.
- **Session 3 (2026-06-26):** Stream E. **Shipped #19/#20/#21** — new `**/perform*`* one-device tabbed shell (altar · channel · choreo) reusing the existing components (all mounted, inactive `hidden` so sessions/sockets/choreo-audio persist); altar now defaults to override with camera as an opt-in fallback (#21); console override button relabeled (#20 was already present). Camera dropped from the consolidated altar per the operator (won't be used this iteration). TDD (new `Altar`/`Perform` suites); stage 100/100; typecheck clean. Plan: `docs/superpowers/plans/2026-06-26-stream-e-channeling-consolidation.md`. **#8 (Stream C) skipped** — still awaiting Rachel's content.
- **Next up:** Stream A + G closed. Candidates: **#10 (CRT resolution/overscan)** + **#8 (Rachel's form, still blocked on content)** to close Stream C; **#22 (mimic)** once a repro is in hand (resume systematic-debugging from the captured notes — brain logic looked correct, so suspect a live/multi-surface or sequence-specific condition); or **Stream D (XP skin)** — establish the shared skin once, then apply across `/dispatch` (#1, has a UX-clarity brainstorm), `/station` (#5), `/feed` (#15). **Device eyeballs pending:** **#24b — the Time Offering room: send a visitor to `/station/offering`, watch the `/dispatch` dwell countdown auto-release at 5 min, and confirm a performer **Done** releases early; `/board` shows `STATION A - TIME OFFERING` vs `WAITING`;** #18 (`/board` shows `ALTAR READY` for a bodyscan-cleared waiter); Stream F (#11 break→repeat flow + #13 aura palette); #7/#9 on the CRT rig; Stream E `/perform` (tab switching keeps choreo audio playing + a claimed channel session survives switching).

