# CHANNELERS app — Claude context

This is the application monorepo for CHANNELERS. **Planning + source-of-truth docs live in `../docs`** — read `../docs/ARCHITECTURE.md` (design), `../docs/CLAUDE.md` (decisions & conventions), and `../docs/CHANGELOG.md` (what's been built) before making changes.

## Required after every change
Update **`../docs/CHANGELOG.md`** — newest entry on top, with *what / why / files-areas / docs-touched* — and any affected docs in `../docs` (ARCHITECTURE.md, etc.). This is how context transfers between sessions; it is not optional.

## Stack
pnpm + TypeScript monorepo:
- `apps/brain` — Show Brain: Fastify + `ws` + OSC + OpenAI SDK. Owns visitor data and all AI calls. Also hosts an **optional, off-by-default `/agent` WS endpoint** (`apps/brain/src/ableton.ts`, armed only when `ABLETON_AGENT_TOKEN` is set) that the venue's Ableton **dial-home daemon** connects out to; it consumes `ableton-osc-bridge/host` (`createBridgeHost`) and exposes the typed Ableton facade via `getLive()`. Token verified constant-time at the WS upgrade. With no token the Brain runs exactly as before. (Which show events drive Ableton is not yet wired.)
- `apps/stage` — Vite/React; one app, role-based routes:
  - `/intake`, `/bodyscan`, `/altar` — station screens now gate on **confirm-at-station** (`CalledGate`), not typing a number: each screen binds an addressable kiosk slot via `useStationPresence` (sends `station.hello { station, kioskId, slotHint? }`; `kioskId` from `?kiosk=` else a stable `localStorage` UUID), idles until a visitor is `called` to its slot, shows the number + **Confirm arrival** (`POST /api/dispatch/arrive`), then runs the existing station work (survey / pose-enroll / verify+persona). `NumberGate` is retired from the stations. **`/intake` is reskinned as a DMV-purgatory CRT terminal** — `CalledGate skin="crt"` shows an amber segmented-LED number + an **I AM** confirm inside a reusable `CrtShell` (vaporwave void · `feTurbulence` static · toggleable scanline/curvature FX, `?crt=off`), and the survey renders as a Windows-9x dialog. The CRT pieces (`CrtShell`, `SegmentNumber`, `useCrtFx`, `styles/crt.css`) are reusable; `/bodyscan` + `/altar` keep the default gate. Stage now has a **vitest** suite (`pnpm --filter @channelers/stage test`).
  - `/channel` — performer page: lobby of oracle-ready visitors → teleprompter (renamed from `/station`). Hosts the **Altered-State Console** (`AlteredStateConsole`, operator-only) — live generation dials (preset/sampling/effects/text-pipeline/scope) from the PHARMAICY "Ayahuasca" module; edits a **global** `OracleTuning` over `tuning.set`/`tuning.state` WS messages (off the OSC contract). Brain side: `apps/brain/src/tuning.ts` (`getTuning`/`registerTuning`); pure logic in `packages/shared/src/tuning.ts` (`PRESETS` verbatim, `resolveSampling`, `mangleOutput`, `buildDriftDirective`); applied in `divination.ts` + `transform.ts`.
  - `/choreo` — **Tier 2 choreography feed** (read-only): the live movement cue (teleprompter) + a rolling log, fed by `choreo.delta`/`choreo.done` WS messages. Hosts the operator's **react to oracle reply** timing toggle (`GET`/`POST /api/choreo/config`). Brain side: `apps/brain/src/choreo.ts` (`generateFirstPass` at persona-set, `streamCue` per-turn, live `reactToOracle` flag); the per-turn fan-out lives in `divination.ts` `say()`; prompts in `packages/oracles/src/choreographer.ts`. The `choreo.*` channel is screens-only, off the OSC contract (like tuning/dispatcher). Final in-ear vs loudspeaker routing deferred.
  - `/console` — **master overseer** (3 panels): visitors+inline controls / flow funnel reading the **slot array** + per-slot LEDs / active sessions+event log. Keeps a hidden **manual override** (type a number + station → `POST /api/checkin`) as the operator safety net.
  - `/board` — public call display: `#N → STATION`, derived from `dispatch.state` slots in the `called` phase
  - `/dispatch` — lobby-operator **3-zone board** (spec §6): waiting pool (left) · the addressable slots as a responsive grid with online LEDs, the pending **Confirm call**, and re-pool (center) · completed (right). Register arrivals from the header.
  - `/souvenir` — QR takeaway
  - `/waiting` — **deferred** (waiting-room self-serve kiosk, not yet built)
  - The **dispatcher** lives in `apps/brain/src/dispatcher.ts` (`createDispatcher(bus)`) — an **addressable, kiosk-bound slot** engine: slot ids `${station}-${i}` from `config.dispatcher.slots`, capacity = free online slots, per-slot drop reap, pinned `pending → called → in_progress`. Dispatch state rides the `dispatch.state` WS channel (`slots: Slot[]`, `completed`, `surplus`, `stationsOnline`) — **never OSC**. Dispatcher logistics are deliberately kept off the `ShowEvent`/OSC contract.
- `packages/shared` — zod schemas, the `ShowEvent` + OSC contract, the WS divination protocol, the survey.
- `packages/oracles` — persona library (voices, anti-slop deny-list, system-prompt builder) **+ the choreographer prompt builders** (`choreographer.ts`: `CHOREO_CLARITY_INSTRUCTION` + first-pass/live/turn prompts).

Run: `pnpm dev` (brain → :8787, stage → :5173). Works with **no API key** (stub seeds + offline oracle fallback); add `OPENAI_API_KEY` to `.env` for real OpenAI.

## Conventions
- All TypeScript; computer vision runs in-browser (MediaPipe / ArUco) — no Python sidecar.
- Loose coupling: anything outward-facing (Anna's audio, Jeff's visuals) goes through the OSC/WebSocket event bus, never internal coupling.
- Human-in-the-loop; offline-resilient (degrade gracefully on API failure — keep the stub/fallback paths working).
- OpenAI: **gpt-4o** for the intake→seeds transform (now **music-only** — `Seeds = { music }`; dead dance/persona seeds removed), the live oracle loop, and the Tier 2 choreographer (stream the live loops; OpenAI caches prompts automatically). Configurable via `TRANSFORM_MODEL` / `ORACLE_MODEL` / `CHOREO_MODEL` env. Check the current OpenAI API reference rather than relying on memory.
- Brain tests run **offline by design**: `apps/brain/test/setup.ts` forces `OPENAI_API_KEY=""` so transform/oracle/choreo take deterministic fallbacks (app/.env has a real key). Tests needing the keyed path `vi.mock("../src/config")`.
- Typecheck before claiming done: `pnpm -r typecheck`.
