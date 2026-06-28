# Deploying CHANNELERS (single-origin, cloud)

The **Brain** serves the **stage** build plus `/api` and `/ws` from **one HTTPS origin**.
Every screen — the 5–6 intake/scan/altar kiosks, `/channel`, `/console`, `/board`,
`/dispatch`, `/souvenir` — just opens `https://<your-app>/<route>` over the venue's
internet. No LAN peer-to-peer, no IP discovery (which campus/enterprise WiFi often
blocks via client isolation). `wss` works for free under HTTPS.

## Topology

```
  kiosks + operator/performer screens ──https/wss──▶  CLOUD BRAIN (this image)
                                                       serves stage + /api + /ws
  Ableton + Anna + Jeff (your own travel router) ──wss /agent──▶  (dials home)
```

Local show gear (Ableton, and Anna/Jeff's OSC tools) talks UDP-OSC, which is LAN-local
and which campus isolation would block anyway. Put that gear on **your own small router/
switch**; the Ableton dial-home daemon reaches the cloud Brain over outbound 443 (see
`packages/ableton-osc-bridge`). Generic OSC out to Jeff/Anna would need the same
dial-home relay treatment (open item, ARCHITECTURE §12).

## Deploy (Fly.io)

Run from this `app/` directory (it holds `Dockerfile` + `fly.toml`).

```bash
fly launch --no-deploy        # first time only: creates the app; keep the provided fly.toml
# edit fly.toml: set primary_region to the Fly region nearest the venue

# Secrets (NOT baked into the image — app/.env is .dockerignore'd):
fly secrets set OPENAI_API_KEY=sk-...          # real oracle/transform/STT; unset → offline fallbacks
fly secrets set ELEVENLABS_API_KEY=...         # optional: oracle TTS; unset → browser speechSynthesis
fly secrets set ABLETON_AGENT_TOKEN=...        # optional: arms the /agent dial-home endpoint

# Persistence volume for the visitor-store snapshot (VISITOR_SNAPSHOT_PATH + [[mounts]] in
# fly.toml). One-time; region MUST match primary_region. Omit this + those two fly.toml lines
# to run fully volatile (the old behavior).
fly volumes create channelers_data --region sjc --size 1

fly deploy
```

`fly.toml` pins **one always-on machine** (`min_machines_running = 1`,
`auto_stop_machines = false`) because the Brain's store is in memory.

### Point the venue Ableton daemon at the cloud

On the show machine next to Ableton, the daemon dials out — no code change (see
`packages/ableton-osc-bridge` README → "Cloud controller"):

```bash
BRIDGE_DIAL_URL=wss://<your-app>.fly.dev/agent BRIDGE_TOKEN=<same ABLETON_AGENT_TOKEN> \
  pnpm --filter ableton-osc-bridge serve
```

## Seed a test visitor on the remote

The dev seed (`apps/brain/src/seed.ts`) just drives the public endpoints
(`register → intake → persona → verify`), so you can point it at the deploy from your
laptop — no SSH, no DB. Override the target with `--base` (or `SEED_BASE`); omit it and
you still hit localhost (backwards-compatible):

```bash
pnpm seed --base https://<your-app>.fly.dev                     # oracle-ready dummy #9000+
pnpm seed --base https://<your-app>.fly.dev --name "Mara" --archetype drugged_ai
SEED_BASE=https://<your-app>.fly.dev pnpm seed --number 9042    # env form (flag wins if both)
```

It then shows up under "Available visitors" on `/channel`. (You can also run it *inside*
the machine — `fly ssh console -C "/bin/sh -lc 'cd /app && pnpm seed'"` — which targets
the container's own loopback.) Seeded visitors live in the in-memory store until the next
redeploy/crash, same as real ones.

## Operating caveats (read before show day)

- **State recovery (opt-in).** With `VISITOR_SNAPSHOT_PATH=/data/visitors.json` (a mounted
  volume — see `[[mounts]]` in `fly.toml`) the Brain snapshots the visitor store every
  `VISITOR_SNAPSHOT_MS` (default 2 s) and restores it on boot, so a crash/redeploy recovers
  participant data (surveys, poses, archetypes, milestones). **Not** restored: live divination
  sessions and dispatcher slot positions — they re-derive as screens reconnect, so re-place
  anyone caught mid-station. Unset the var (and drop the `[[mounts]]` block) → fully volatile,
  as before. A redeploy mid-show is still best avoided, but is now recoverable rather than total
  data loss. **Caveat:** a Fly volume is pinned to one machine/region — this covers process
  crash / redeploy / restart, not a host-level move that abandons the volume.
- **Single instance only** — in-memory store + sticky WS + a single-machine volume. Never scale
  horizontally.
- **Set `OPENAI_API_KEY`** so STT uses the Whisper API; otherwise the Brain loads a
  local Xenova model at runtime (a large first-call download in the container).
- **Test the venue network early**, on a real kiosk: confirm it can load the URL *and*
  hold a `wss` connection. Watch for captive portals / re-auth that drop sockets — the
  stage auto-reconnects and the WS keepalive (`WS_HEARTBEAT_MS`, default 30s) keeps idle
  sockets warm, but you want to see the behavior before you're live.
- **If campus WiFi is hostile**, put any/all devices on a 5G hotspot — nothing changes,
  because there is no LAN dependency.

## Env reference

See `.env.example`. Production-relevant: `HOST=0.0.0.0`, `PORT`, `SERVE_STAGE=true`,
`STAGE_DIST` (defaults to `apps/stage/dist`), `WS_HEARTBEAT_MS`, plus the secrets above.

## Local production smoke test

```bash
pnpm -r build
SERVE_STAGE=true HOST=127.0.0.1 PORT=8799 pnpm --filter @channelers/brain start
# → http://127.0.0.1:8799/intake serves the SPA; /api/health is JSON; /ws upgrades
```
