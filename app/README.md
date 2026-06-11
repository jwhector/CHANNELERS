# CHANNELERS — app

Monorepo for the CHANNELERS intake → AI → live-divination pipeline.
Design lives in `../docs/ARCHITECTURE.md`; conventions in `../docs/CLAUDE.md`.

## Layout
- `apps/brain` — the **Show Brain**: HTTP + WebSocket + OSC hub. Owns visitor data and all AI calls.
- `apps/stage` — one Vite/React app, role-based routes: `/intake` `/scan` `/console` `/oracle` `/souvenir`.
- `packages/shared` — zod schemas, types, the survey definition, and the OSC/event contract.
- `packages/oracles` — Oracle persona library (voices, anti-slop deny-list, prompt builder).

## Run
```
pnpm install
pnpm dev          # brain on :8787, stage on :5173
```
Open http://localhost:5173 — fill `/intake`, watch `/console`, click **Generate seeds**.
No API key needed: the brain falls back to stub seeds. For real Claude transforms, copy
`.env.example` to `.env` and set `ANTHROPIC_API_KEY`.

## Integration demo (for Anna & Jeff)
`POST /api/demo/echo` broadcasts one of every show event over WebSocket (and OSC if
`OSC_ENABLED=true`) so external tools can see exactly what they can react to. See ARCHITECTURE.md §8.
