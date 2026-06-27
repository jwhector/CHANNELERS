# CHANNELERS app — Claude context

Application monorepo for CHANNELERS. **Design lives in `../docs`** — read `../docs/ARCHITECTURE.md` (system design), `../docs/CLAUDE.md` (decisions), and `../docs/CHANGELOG.md` (what's been built) before changing anything. This file is the code map; ARCHITECTURE.md is the detail.

## Commands
- `pnpm dev` — brain → :8787, stage → :5173. **Works with no API key** (stub seeds + offline oracle/choreo fallback); add `OPENAI_API_KEY` to `.env` for real OpenAI.
- `pnpm -r typecheck` — run before claiming done.
- `pnpm --filter @channelers/stage test` / `pnpm --filter @channelers/brain test` — vitest suites.
- `pnpm -r build && SERVE_STAGE=true pnpm --filter @channelers/brain start` — local prod smoke (single-origin).

## Stack (pnpm + TypeScript monorepo)
- **`apps/brain`** — Show Brain: Fastify + `ws` + OSC + OpenAI SDK. Owns visitor data and all AI calls. Also hosts the visitor **dispatcher** (`src/dispatcher.ts`), the **choreographer** loop (`src/choreo.ts`), oracle **tuning** (`src/tuning.ts`), `/api/tts` (routable fallback chain), and an optional token-gated `/agent` WS endpoint for the **Ableton dial-home bridge** (`src/ableton.ts`, off unless `ABLETON_AGENT_TOKEN` set). For cloud deploys, serves the stage build + `/api` + `/ws` from one origin (`SERVE_STAGE`). See ARCHITECTURE §5.x, §5.6, §7, §12; `DEPLOY.md`.
- **`apps/stage`** — Vite/React; one app, role-based routes. Station screens (`/intake`, `/bodyscan`, `/altar`) gate on **confirm-at-station**, not a typed number (`/intake` & `/altar` via `CalledGate`; `/bodyscan` renders straight from `dispatch.state`). `/intake` is visitor self-confirm; `/bodyscan` & `/altar` are **performer-confirmed** (a guide admits the visitor from `/station`). Routes:
  - `/intake` · `/altar` — visitor stations (survey · pose verify + persona). `/intake` uses the CRT skin (`CrtShell`).
  - `/bodyscan` — **controls-free front display** (an input-less TV facing the visitor): retro called-number → live camera + skeleton once admitted. Pose **capture is operator-armed** from `/station/bodyscan` (tapping Capture arms a 3.5s framed-stillness hold on the kiosk; it saves only while framed + held still); `?setup=1` exposes the camera picker for one-time install.
  - `/channel` — performer teleprompter + the operator **Altered-State Console** (oracle tuning dials).
  - `/choreo` — Tier 2 choreography feed (text + in-ear TTS).
  - `/console` — master overseer (visitors / flow funnel / sessions) · Pluribus altar-ready broadcast (TTS, output picker).
  - `/board` — public roster as a bare white-phosphor PC terminal (VT323; every visitor number + current location, `called` = inverse-video now-serving) · `/dispatch` — lobby-operator queue board (+ flow strip: altar CLOSED/OPEN gate, altar-ready count, bodyscan idle/blocked; right column lists altar-ready visitors; + Pluribus altar-ready broadcast control) · `/souvenir` — QR takeaway.
  - `/station` (`/station/:station`) — per-station performer arrival-confirm view (bodyscan/altar/paper/waitingroom); passive, calls `arrive`/`repool` (+ `complete` "Done" early-completes a timed station; + bodyscan **Capture pose** arms the kiosk's stillness-hold, and a **camera picker** switches the kiosk's camera remotely — both via `station.cmd`, kiosk cameras reported through `dispatch.state`).
  - `/feed` — Scan/Shred/Feed, the first **timed group station** (kiosk-less spectacle screen). `waitingroom` is a second timed group station (10 slots, 5-min hourglass hold) confirmed at `/station/waitingroom` — no own screen; the `/waiting` self-serve kiosk screen stays deferred.

  See ARCHITECTURE.md §3 for the route map and the relevant §5 subsection for each one's internals.
- **`packages/shared`** — zod schemas, the `ShowEvent` + OSC contract, the WS divination protocol, tuning, the survey.
- **`packages/oracles`** — persona library (voices, anti-slop deny-list, prompt builder) + the choreographer prompt builders.
- **`packages/ableton-osc-bridge`** — standalone, decoupled OSC bridge (zero `@channelers/*` imports).

## Conventions
- All TypeScript; computer vision runs in-browser (MediaPipe / ArUco) — no Python sidecar.
- **Loose coupling:** anything outward-facing (Anna's audio, Jeff's visuals) goes through the OSC/WebSocket event bus, never internal coupling. Screen-only streams (dispatch, choreo, tuning) stay *off* the OSC contract.
- Human-in-the-loop; offline-resilient — degrade gracefully on API failure, keep the stub/fallback paths working.
- **OpenAI = gpt-4o** for the intake→seeds transform, the live oracle loop, and the choreographer; stream the live loops. Env: `TRANSFORM_MODEL` / `ORACLE_MODEL` / `CHOREO_MODEL`. Check the current OpenAI reference rather than relying on memory.
- **Brain tests run offline by design:** `apps/brain/test/setup.ts` forces `OPENAI_API_KEY=""` so transform/oracle/choreo take deterministic fallbacks. Tests needing the keyed path `vi.mock("../src/config")`.

## Docs
After a substantive change, update `../docs/CHANGELOG.md` (newest on top: what / why / files-areas / docs-touched). Update `../docs/ARCHITECTURE.md` only on an architectural shift, and this file only if the stack, routes, or conventions above actually change.
