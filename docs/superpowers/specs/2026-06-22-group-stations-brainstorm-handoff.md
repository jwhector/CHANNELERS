# HANDOFF — Brainstorm: two new "group/timed" stations (Typewriter + Scan/Shred/Feed)

> Status: **mid-brainstorm, NOT yet a spec** · Date: **2026-06-22** · Owner: Jared
> This is a context hand-off for a fresh agent to resume the `superpowers:brainstorming` flow with clean tokens.
> The prior branch was grounded on a **stale** read of the architecture (see §0). Re-ground first, then continue.

---

## 0. READ THIS FIRST — the prior branch was grounded on stale docs

The previous session opened by reading `docs/CHANGELOG.md` (top entries) and `docs/ARCHITECTURE.md` (v0.1), which describe an **earlier, single-linear-path, Anthropic/Claude-era** build. The project has since moved on substantially. **Trust current code + the recent specs below over the CHANGELOG's older entries and ARCHITECTURE v0.1.**

What's actually true now (corroborated by the updated `docs/CLAUDE.md`):
- **Stack pivoted to the OpenAI API** (`gpt-4o`; `TRANSFORM_MODEL` / `ORACLE_MODEL` / `CHOREO_MODEL`). OpenAI auto-caches prompt prefixes (no manual cache step).
- **`Seeds = { music }` only** — the dead `dance` and `persona` seeds were removed.
- There is a **Tier-2 choreography agent** (second live AI loop, `choreo.delta` channel).
- The performer route is **`/channel`** (renamed from `/station`).
- ARCHITECTURE "Open Questions" section is now **§12** (was §11).

**Before continuing, re-ground by reading (in this order):**
1. `docs/CLAUDE.md` (current decisions/stack — already updated).
2. `docs/superpowers/specs/2026-06-19-multi-station-architecture-design.md` — the spine. Routes, identity/state model, dispatcher, tiers.
3. `docs/superpowers/specs/2026-06-20-dispatch-confirm-and-addressable-slots-design.md` — the **addressable, kiosk-bound slot** model + confirm-at-station arrival + 3-zone `/dispatch` board.
4. `docs/superpowers/specs/2026-06-21-station-presence-lifetime-and-waiting-pool-cards.md` and `2026-06-21-one-device-kiosk-identity-and-kiosk-reset.md` — presence lifetime + kiosk identity refinements.
5. The actual code: `apps/brain/src/` (dispatcher, divination, store, bus), `apps/stage/src/routes/` (`/intake`, `/bodyscan`, `/altar`, `/channel`, `/dispatch`, `/board`, `/console`), `packages/shared/src/protocol.ts` + `schemas.ts`. Verify route names, the `Slot`/`DispatchState` shapes, and the milestone/`location` state before proposing anything.

---

## 1. The goal (what we're brainstorming)

Add **two new stations** to the existing multi-station ritual that:
- **Accommodate multiple people at once** (group stations, not the 1-visitor-at-a-time altar/channel).
- **Do not necessarily have a kiosk of their own** (no per-visitor data-entry tablet at the station).
- Are **dispatcher-driven** — the dispatcher can send people **who haven't visited that station before**.
- Have a **fixed-timer dwell** — the visitor's time at the station is governed by a set countdown, not by completing a task.

**Scope decision (locked):** Design **now** = (a) the shared "group/timed station" backbone and (b) **Station #1: Scan / Shred / Feed** (detailed below). **Station #2 is undefined** — leave it as a slot the backbone can host later (YAGNI; don't invent it).

---

## 2. How the asks map onto the EXISTING architecture (do not reinvent)

Most of what Jared described already has a home in the Tier 0/Tier 3 spine. The fresh agent's job is to find the smallest extension of it, and to identify the genuinely-new wrinkles.

| Ask | Existing primitive it extends | Genuinely new? |
|---|---|---|
| "Stations that accommodate multiple people" | Stations are already an array of **addressable slots** with a config-driven count (`config.dispatcher.slots: Record<Station, number>`). A group station ≈ a station with N slots — OR a new "shared-capacity" slot type. | Maybe — decide: N discrete slots vs. one shared group occupancy. |
| "Dispatch people who haven't visited before" | Dispatcher eligibility is already a **per-station predicate** over durable milestones (`intake: !intakeAt`, `bodyscan: !poseAt`, …). A new station = a new milestone (e.g. `paperAt`) + predicate. | No — it's a new milestone + predicate following the established pattern. |
| "Dwell time on a set timer" | Dwell already exists as `now − location.since`; timers exist for **stale-detection** (`T_stale`) and recovery, but they **don't auto-advance** a visitor. A fixed-countdown station that **auto-completes** when the timer expires is a new station *behavior*. | **Yes** — "timed auto-completing station" is a new completion mode (today completion = a milestone stamp from finishing a task). |
| "No kiosk of its own" | The current arrival model is **kiosk-bound**: a slot needs an online kiosk to display the called number and take "Confirm arrival." A station with **no dedicated kiosk** breaks that assumption. | **Yes — the central new design problem.** How does presence/arrival/completion work without a per-station screen? (operator-driven on `/dispatch`/`/console`? board-only? a shared station screen that isn't a per-visitor kiosk?) |

**Key tension to resolve:** the existing "confirm-at-station" arrival + per-slot kiosk binding + socket-drop reaping all assume one screen per slot. A kiosk-less, multi-person, timer-completed station likely needs an **operator-driven** presence model (dispatcher/usher marks the group as arrived; the timer drives completion; the milestone stamps on timer-expiry). Work this out explicitly.

---

## 3. Station #1 — Scan / Shred / Feed (the detailed one)

**Physical flow:** A visitor arrives carrying a **typewritten page** (produced upstream — see §4). At the station they choose to either **SHRED** the page or **FEED** it to the AI through a **slot**. If they feed it: the page is **scanned**, its text is captured, and the visitor sees an **animated version of their own text appear on a screen and animate "into the matrix."**

**Locked creative/architectural decisions:**
- **Feed payload = pure spectacle NOW, architected for later ingestion.** The animation is the only payoff for the workshop. BUT design the capture so the OCR'd text is a **first-class, identity-tagged artifact**: emit it as an event and (optionally) store it on the visitor record, so a later flip can thread it into the music seed / oracle / a collective wall **without re-plumbing**. Concretely: capture → `{ visitorId/number, text, fedAt }` → emit a new `ShowEvent` (e.g. `paper.fed`) and optionally persist; nothing downstream consumes it yet.
- **Identity matters even for spectacle-only**, because (a) the dispatcher tracks the "visited paper station" milestone and (b) the "feed into profile later" goal needs to know *who* fed. So the station must know which visitor/number is acting — which ties back to the §2 "no kiosk" presence problem.

**Still OPEN (the branch ended before these — resolve in the resumed brainstorm):**
- **Presence/identity at this kiosk-less station** — how the system knows *who* is feeding (operator on `/dispatch`/`/console`? a shared station-attendant screen? something else). This is the §2 central problem, applied here.
- **Trigger/operation** — how the scan+animation fires: an attendant tap, a physical paper sensor in the slot, an auto-capture webcam. (No visitor kiosk, by constraint.)
- **OCR approach** — recommend an **OpenAI vision** call (the Brain already owns AI calls; `gpt-4o` is multimodal) to OCR the page from a captured image. Confirm against the current API reference at build time (per `docs/CLAUDE.md`). Keep an **offline/degraded fallback** (project convention) — e.g. animate a placeholder/last-known text or skip OCR and animate the raw silhouette if the call fails.
- **Animation ownership** — the "into the matrix" screen: a **Brain-driven `stage` web route** we control (recommended for MVP — no dependency on Jeff, full control of the text-dissolve effect) vs. **Jeff's visual rig** reacting to a `paper.fed` OSC event. Could be MVP-web now, OSC-event-additive later.
- **The SHRED path** — physical-only (a real shredder; the system doesn't model it) vs. system-registered (a `paper.shredded` event / a destruction visual). Decide whether shred is even observed by software.
- **Timer/dwell mechanics for this station** — countdown length, who sees it (a station screen? the board? operator only?), and what auto-completion does (stamp the milestone, re-pool the visitor, free capacity).

## 4. The upstream Typewriter (a prop, not one of the two stations)

The page comes from a **typewriter station**: earlier in the journey, visitors sit at a (real or themed) typewriter and type a page — thematically perfect (analog, surveillance-confession). **Decision (locked):** the typewriter is a **separate upstream prop/station that produces the page** — it is **NOT** one of the two dispatcher-managed stations being designed. (Open: whether it's dispatcher-managed at all, or just a physical corner. Likely needs at least a "produced a page" notion if the feed station gates on it — revisit.)

---

## 5. Where the brainstorm stopped

Questions already answered (Q&A from the prior session):
1. **Paper origin** → a **typewriter station** (visitor-authored page).
2. **Is the typewriter station #2?** → **No** — typewriter is a separate prop; station #2 is something else, TBD. Design the paper station now.
3. **What does feeding DO?** → **Pure spectacle now, architected for optional profile-ingestion later.**

Question **in flight when the branch was cut** (re-ask, re-grounded against the real dispatcher/slot model):
4. **The dispatcher + identity at a kiosk-less station** — how a visitor becomes "present" at a station with no dedicated kiosk so the system can track the visit (and tag fed text to them). The prior options assumed no dispatcher existed; in reality the dispatcher, slots, milestones, and `/dispatch`/`/console` already exist — so reframe this as: *what presence/arrival/completion model does a kiosk-less, multi-person, timer-completed station use within the existing Tier 0/Tier 3 spine?*

Then continue with the still-open items in §3 (trigger, OCR, animation ownership, shred path, timer mechanics) and only afterward circle back to whether/when to define station #2.

---

## 6. Process for the resuming agent

1. Use `superpowers:brainstorming`. **Re-ground first** (§0), then resume one-question-at-a-time.
2. Respect the **HARD GATE**: no implementation, no plan-writing, no code until a design is presented and Jared approves it.
3. When the design is settled, write the spec to `docs/superpowers/specs/2026-06-22-group-stations-design.md` (match the format/voice of the existing specs — decision log + findings/gotchas sections; they're the durable hand-off format this project uses), commit it, run the spec self-review, get Jared's review, then invoke `superpowers:writing-plans`.
4. **Lean on the existing patterns:** new milestone + eligibility predicate (§2), the addressable-slot model, the recovery detectors, the `ShowEvent`/OSC bus for the animation hand-off, and the offline-fallback convention. Note: dispatch logistics currently stay **off** the `ShowEvent`/OSC bus (operator-facing only) — but the **`paper.fed` spectacle/animation** is exactly the kind of outward-facing event that SHOULD ride the bus (it's how Jeff's rig could pick it up). Keep that distinction.
5. Per project convention: **update `docs/CHANGELOG.md`** (newest on top) and any affected docs after changes; new team questions go in `docs/ARCHITECTURE.md` §12.

## 7. Verify-before-trust checklist (facts that may have drifted)

Confirm against current code, don't assume:
- Exact route names + which exist (`/channel`, `/dispatch`, `/board`, `/console`, `/altar`, `/bodyscan`).
- The `Slot` / `DispatchState` / `location` / milestone shapes in `protocol.ts` + the store.
- Current model ids / SDK (`gpt-4o` via OpenAI; check `config.ts`).
- Whether `gpt-4o` (or the configured model) is the right multimodal choice for OCR at build time (check the current OpenAI API reference).
- Whether any "group station" or "timer-completed station" notion already exists (the prior agent did not find one, but verify).
