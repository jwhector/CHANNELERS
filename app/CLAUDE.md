# CHANNELERS app — Claude context

This is the application monorepo for CHANNELERS. **Planning + source-of-truth docs live in `../docs`** — read `../docs/ARCHITECTURE.md` (design), `../docs/CLAUDE.md` (decisions & conventions), and `../docs/CHANGELOG.md` (what's been built) before making changes.

## Required after every change
Update **`../docs/CHANGELOG.md`** — newest entry on top, with *what / why / files-areas / docs-touched* — and any affected docs in `../docs` (ARCHITECTURE.md, etc.). This is how context transfers between sessions; it is not optional.

## Stack
pnpm + TypeScript monorepo:
- `apps/brain` — Show Brain: Fastify + `ws` + OSC + OpenAI SDK. Owns visitor data and all AI calls.
- `apps/stage` — Vite/React; one app, role-based routes:
  - `/intake` — visitor kiosk: number gate → data-only survey → handoff to Physical Challenge
  - `/bodyscan` — pose identity token enrollment (enroll self-invented pose → poseTemplate)
  - `/altar` — pose verify + persona pick → oracle-ready; station screens wire in via `useStationPresence` + `station` prop on `NumberGate`
  - `/channel` — performer page: lobby of oracle-ready visitors → teleprompter (renamed from `/station`)
  - `/console` — **master overseer** (3 panels): visitors+inline controls / flow funnel+station LEDs / active sessions+event log. No longer read-only.
  - `/board` — public call display: `#N → STATION` from live `dispatch.state` WS broadcast
  - `/dispatch` — lobby-operator interface: register visitor arrivals, confirm/skip pending calls, manage queue + slots
  - `/souvenir` — QR takeaway
  - `/waiting` — **deferred** (only remaining Tier 3 screen: waiting-room self-serve kiosk, not yet built)
  - The **dispatcher** lives in `apps/brain/src/dispatcher.ts` (`createDispatcher(bus)`). Dispatch state rides the `dispatch.state` WS channel — **never OSC**. Dispatcher logistics are deliberately kept off the `ShowEvent`/OSC contract.
- `packages/shared` — zod schemas, the `ShowEvent` + OSC contract, the WS divination protocol, the survey.
- `packages/oracles` — persona library (voices, anti-slop deny-list, system-prompt builder).

Run: `pnpm dev` (brain → :8787, stage → :5173). Works with **no API key** (stub seeds + offline oracle fallback); add `OPENAI_API_KEY` to `.env` for real OpenAI.

## Conventions
- All TypeScript; computer vision runs in-browser (MediaPipe / ArUco) — no Python sidecar.
- Loose coupling: anything outward-facing (Anna's audio, Jeff's visuals) goes through the OSC/WebSocket event bus, never internal coupling.
- Human-in-the-loop; offline-resilient (degrade gracefully on API failure — keep the stub/fallback paths working).
- OpenAI: **gpt-4o** for both intake→seeds transforms and the live oracle loop (stream the oracle loop; OpenAI caches prompts automatically). Configurable via `TRANSFORM_MODEL` / `ORACLE_MODEL` env. Check the current OpenAI API reference rather than relying on memory.
- Typecheck before claiming done: `pnpm -r typecheck`.
