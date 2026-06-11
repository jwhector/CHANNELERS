# CHANNELERS — Claude context

This is the **planning/docs repo** for CHANNELERS. The application code will live in a sibling folder (proposed `../app`, a pnpm + TypeScript monorepo); this repo holds the brief, the survey, and the architecture.

## What the project is
An experimental AI-driven performance piece: a "DMV-esque void" where visitors fill out absurdist intake surveys that seed generated music and dance, culminating in a divination ritual where they talk to AI Oracle personae (a child, an AI on drugs, a tree…) **channelled live by performers via in-ear receivers**. Themes: surveillance, transactional AI, bodily/ecological autonomy. Collaborators: Anna Oxygen / Anna Huff (music), Jeff Larson (visuals), director Chi-wang Yang, Jane Paik (dance). Jared is the AI/pipeline architect.

**Deadline:** development workshop **June 22–28, 2026**. Build toward a working-for-the-workshop MVP, not a tour-hardened product.

## Source-of-truth docs (read these)
- `ARCHITECTURE.md` — system design, data model, roadmap, and the **Open Questions for the team** (§11, kept here — no separate questions file; append as questions arise).
- `intake.md` — the actual intake survey questions.
- `annaoxygenwebsite.md`, `emails.md` — project background and the brief from the team.

## Architecture in one breath
A local **Show Brain** (Fastify + `ws` + OSC + Anthropic SDK) owns visitor data and all AI calls. A Vite/React **stage** app renders every screen (intake kiosk, scan station, operator console, performer view, souvenir QR). `packages/shared` holds zod types + the event contract. Anna's and Jeff's tools integrate over **OSC/WebSocket**, never via internal coupling.

## Decisions & conventions
- **All TypeScript.** Computer vision runs in-browser (MediaPipe Tasks for Web for pose; ArUco for fiducial cards) — no Python sidecar.
- **Loose coupling.** Everything outward-facing goes through the OSC/WebSocket event bus (ARCHITECTURE.md §8).
- **Human-in-the-loop.** AI proposes; the operator and performers dispose. Nothing reaches the audience unmediated.
- **Offline-resilient.** The Brain runs locally; API failures must degrade gracefully (fallback lines, manual override).
- **Stateful server resources need recovery + liveness-bound cleanup.** Any durable server-side resource (e.g. a divination session) must have (a) a recovery path keyed on stable identity — clients persist a handle and re-attach on refresh/reconnect — and (b) a lifetime bound to its owner's liveness (socket close + grace timer), never solely an explicit close command or ephemeral client state. (Earned the hard way: refreshing `/station` once stranded sessions permanently.)
- **LLM = Claude API** (prototyping). Opus 4.8 (`claude-opus-4-8`) for the intake→seeds transforms with **structured outputs**; Sonnet 4.6 (`claude-sonnet-4-6`) / Haiku 4.5 (`claude-haiku-4-5`) are the latency option for the live voice loop. **Stream** the live loop and **prompt-cache the persona+intake prefix** (pre-warm on Oracle selection).
- **Persona voice** must avoid the generic helpful-assistant register — few-shot from real source material, prefill the turn, an anti-slop deny-list, raised temperature (ARCHITECTURE.md §5.5). Bespoke/fine-tuned models are a phase-2 exploration on **open** weights, not for the workshop.
- **Music output** = lyrics + mood/tempo/key/synth-palette params for Anna to perform live (not finished audio, not raw MIDI).

## Working agreements
- **After every change, update `CHANGELOG.md` (newest entry on top) and any docs the change affects** (ARCHITECTURE.md, this file, app docs). The changelog is how context transfers between sessions — treat it as required, not optional.
- New team questions go in **ARCHITECTURE.md §11**, not a new file.
- Keep work scoped to the workshop MVP; prefer one full working path over breadth.
- For anything touching the Claude API (models, params, caching, fine-tuning), check the current reference rather than relying on memory.
