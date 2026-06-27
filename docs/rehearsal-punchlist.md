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

| # | Item | Note |
|---|------|------|
| 2 | Station display = alias, not id | `STATION_LABEL` shipped (2026-06-26); `/dispatch` shows "STATION C - BODY SCAN". Likely **label-text tuning only** to match performers' aliases, not new code. ✅ |
| 6 | `/station` ability to release | **Release** (repool) button already exists on `/station` rows. Confirm whether you mean releasing an **in_progress** kiosk visitor (bodyscan/altar), not just timed. ✅ |
| 17 | Paper manual checkout | **Done** early-complete already exists; real work = *remove the auto-dwell timer* so manual is the only exit. (partial) |
| 18 | ALTAR READY on board | `isAltarReady` predicate + Pluribus broadcast exist on `/dispatch`/`/console`; this is adding the display to `/board`. (partial) |

## Streams

### Stream A — Dispatcher logic (`apps/brain/src/dispatcher.ts`, `packages/shared/src/protocol.ts`)
| # | Item | Pri | Status | Notes / deps |
|---|------|-----|--------|--------------|
| 3 | No-show hold persists after a late arrival completes the station | P0 | 🟢 | Fixed S1: `arrive()`/`checkin()` now clear `noShowHoldUntil`. TDD red→green. |
| 4 | 1-min intro hold after number registration | P1 | 🟢 | Fixed S1: `introHoldMs` default 30s → 60s. |
| 17 | Paper: remove auto-dwell timer, enforce manual checkout | P1 | 🔴 | Done button exists; make `paper` non-timer-completing. |
| 24 | Waiting room → **overflow holding space**, not a station | P2 | 🔴 | Design (brainstorm-and-plan). Board shows WAITING ROOM for unassigned/uncalled; dispatcher only "confirm call" to WR when no station assigned AND all stations occupied. **Open Qs:** which are "the 3 stations" (intake/bodyscan/altar — where's paper?); transient vs. milestone; retire timed `waitingroom` + `/station/waitingroom` + physical hourglass? |
| 14 | Bodyscan "watch-3" viewing queue (3 assigned, 1 processes) | P3 | 🗓 | Doesn't map to one-slot model; needs design. Post-workshop. |

### Stream B — Oracle / TTS (`apps/brain/src/{choreo,divination,tts}.ts`, `apps/stage/src/{routes/Choreo.tsx,lib/speech.ts}`)
| # | Item | Pri | Status | Notes / deps |
|---|------|-----|--------|--------------|
| 22 | Mimic cadence broken: knobs don't toggle, once started never stops | P0 | 🔴 | systematic-debugging. Trace `isMimicTurn` (brain) + the `/api/choreo/config` toggle path. |
| 23 | TTS reads too fast even at slowest ElevenLabs setting | P0 | 🔴 | Likely client-side `audio.playbackRate` (instant, free) rather than ElevenLabs settings — confirm. |

### Stream C — Intake (`apps/stage/src/routes/Intake.tsx`, CrtShell)
| # | Item | Pri | Status | Notes / deps |
|---|------|-----|--------|--------------|
| 8 | Replace form content with Rachel's new form | P1 | ⏸ | Blocked: need Rachel's content (update `docs/intake.md` too). |
| 9 | Post-intake exit instructions (direct user out) | P1 | 🔴 | Post-submit screen copy. |
| 7 | Increase intake form font size | P1 | 🔴 | CSS; can batch with legibility. |
| 10 | Mac mini resolution doesn't fit CRT monitors | P1 | 🔴 | Investigate: viewport scaling / overscan. Software fix if possible. |

### Stream D — Windows-XP skin (stage CSS + shared skin component)
| # | Item | Pri | Status | Notes / deps |
|---|------|-----|--------|--------------|
| 1 | `/dispatch` redesign: clarity for the operator + XP style (audience sees it) | P2 | 🔴 | UX-clarity has a brainstorm component, not just visual. |
| 5 | `/station` XP style | P2 | 🔴 | Apply shared skin. |
| 15 | `/feed` scanning interface as Windows popup, XP style | P2 | 🔴 | Apply shared skin. |
| — | (establish the XP skin **once**, then apply across D) | — | — | frontend-design. |

### Stream E — Channeling consolidation (`routes/{Channel,Choreo,Altar,Console}.tsx`)
| # | Item | Pri | Status | Notes / deps |
|---|------|-----|--------|--------------|
| 19 | Centralize `/channel` + `/choreo` + `/altar` onto one device | P2 | 🔴 | Design; **dep:** real audio-routing constraints (is consolidation forced, or convenience?). |
| 20 | Add altar bodyscan override to `/console` (mirror `/altar`'s override) | P2 | 🔴 | Small. |
| 21 | Disable bodyscan confirmation at altar, default to override | P2 | 🔴 | Small; pairs with #20. |

### Stream F — Bodyscan experience (`routes/BodyScan.tsx`, pose libs)
| # | Item | Pri | Status | Notes / deps |
|---|------|-----|--------|--------------|
| 11 | Ask user to repeat their shape to affirm pose memory | P2 | 🔴 | UX flow change (enroll → confirm). |
| 13 | Aura/colorblob stylized skeleton; remove webcam bg; 100% stylized | P3 | 🗓 | Creative/rendering; meaty. |
| 12 | Change pose tracking model | P3 | 🗓 | Low priority (explicit). |

### Stream G — Board (`routes/Board.tsx`)
| # | Item | Pri | Status | Notes / deps |
|---|------|-----|--------|--------------|
| 18 | Show ALTAR READY on board for completed-stations visitors | P1 | 🔴 | Use existing `isAltarReady`; small. Can batch with C/legibility. |

## Open decisions (needed before the dependent stream)

- **#8** — Rachel's new intake form content: have it yet?
- **#24** — which are "the 3 stations"? does WR keep any dwell/milestone or is it purely transient? retire the existing timed `waitingroom` station + `/station/waitingroom` + hourglass?
- **#19** — is one-device consolidation *forced* by audio routing, or a convenience? (decides P2-design vs quick merge)
- **#23** — OK to slow the oracle via client `playbackRate`?

## Session log / next up

- **Session 1 (2026-06-26):** set up this tracker + operating-model memory; **shipped #3 (no-show hold) + #4 (intro hold → 1 min)** (brain 148/148, typecheck clean, CHANGELOG written). Merged to `friday-preshow` (fast-forward, `fcdbfa7`).
- **Next up:** Session 2 — Stream B oracle/TTS (#22 mimic bug — needs systematic-debugging to trace `isMimicTurn` + the `/api/choreo/config` toggle path; #23 TTS speed — confirm client `playbackRate` approach first).
