# Design: `ableton-osc-bridge` — a reusable Ableton ↔ web-app OSC bridge

- **Date:** 2026-06-22
- **Status:** Approved (brainstorm complete) — ready for implementation planning
- **Author:** Jared (with Claude)
- **Scope:** the standalone bridge package + its dev/demo apps + its docs. **Not** the CHANNELERS Brain integration (a thin, separate consumer wired later).

---

## 1. Problem & intent

AbletonOSC exposes Ableton Live's full Live Object Model over OSC, but it does so as a
**bidirectional UDP protocol** (commands to port `11000`, replies on `11001`) with **no
authentication** and **no request IDs**. Two facts shape everything:

1. **Browsers can't speak raw UDP**, so any "control Ableton from a web app" story needs a
   Node-side process in the middle.
2. **The controller and Ableton may be on different machines** — for CHANNELERS the Show Brain
   is moving to the **cloud** while Ableton runs at the **venue**, behind NAT. Firing UDP across
   the public internet to a NATed, unauthenticated control surface is fragile and unsafe.

We want a **standalone, reusable, well-documented bridge** between AbletonOSC and *any* web app —
decoupled from CHANNELERS so it can be lifted into other projects — plus a small app to develop and
exercise the connection.

## 2. Goals / non-goals

**Goals**
- A reusable package usable from: a browser app, a same-machine TS backend, a **remote/cloud** TS
  backend, and any non-TS app (via a documented wire protocol).
- Cover the **entire** AbletonOSC address space generically (no per-address code) via three verbs.
- Safe, robust transport for a **live show**: NAT-friendly, authenticated, auto-reconnecting,
  resubscribing after drops/Ableton restarts.
- First-class **dev/demo tools** (a REPL and a browser playground) that double as reuse examples.
- Documentation that teaches reuse in other apps.

**Non-goals (YAGNI for now)**
- A typed "sugar" facade over specific LOM operations (accrete later, where friction appears).
- Exhaustive typed coverage of the Live Object Model.
- The CHANNELERS Brain wiring (separate, later, thin consumer — keeps the package un-intertwined).
- TLS termination logic (assume `wss://` terminated by the cloud platform / reverse proxy).

## 3. Decisions (from the brainstorm)

| Decision | Choice |
|---|---|
| Runtime shape | **Core library + reference daemon** (Option A), one package, 3 entry points |
| How CHANNELERS consumes it | Cloud Brain imports the **client**; the **daemon** runs at the venue |
| Connection direction | **Daemon dials home** — outbound authed WS from venue, auto-reconnect |
| API surface | **Generic transport now** (`send`/`query`/`subscribe`); typed sugar later |
| Placement | **Package in this monorepo**, project-neutral name, zero `@channelers/*` imports, extractable |
| Demo app | **Both** a terminal REPL and a daemon-served browser playground |

Proposed package name: **`ableton-osc-bridge`** (unscoped/publishable; can be scoped `@jared/…` later).
Directory: `app/packages/ableton-osc-bridge/`.

## 4. Architecture — three layers, one package

One npm package, three entry points so each consumer takes only what it needs:

| Export | Symbol | For |
|---|---|---|
| `ableton-osc-bridge` (main) | `AbletonLive` (**core**) | UDP-OSC ↔ verbs; same-machine TS use |
| `ableton-osc-bridge/client` | `AbletonBridgeClient` | **browser-safe** WS client (no `node:*` imports) |
| `ableton-osc-bridge/protocol` | zod message schemas | anyone speaking the wire protocol in TS |
| `bin: ableton-bridge` | CLI | `serve` (daemon) · `repl` · `test` (ping) |

- **Core** owns the hard logic (OSC encode/decode + reply correlation). Pure enough to unit-test
  **without Ableton or a real socket**.
- **Daemon** = core + a **local WS/HTTP server** (serves the playground + any LAN clients) **plus**
  an optional outbound **dial-home** link to a remote controller. It can serve local clients and
  dial home *simultaneously* — keep the playground open at the venue while the cloud Brain drives
  the show. It multiplexes connections; **subscriptions are per-connection**.
- **Client** mirrors the core's three verbs over the network; the primary browser reuse path.

### Proposed layout

```
app/packages/ableton-osc-bridge/
├── package.json          # name, exports map, bin, build/test scripts
├── README.md             # the reuse documentation (see §10)
├── tsconfig.json
├── src/
│   ├── index.ts          # main export → AbletonLive (core)
│   ├── protocol.ts       # zod wire-protocol schemas (client ↔ daemon)
│   ├── core/
│   │   ├── live.ts       # AbletonLive: dgram socket; send/query/subscribe
│   │   ├── osc.ts        # OSC encode/decode (thin wrapper over the OSC lib)
│   │   └── correlator.ts # pending-query waiters + subscription registry (PURE)
│   ├── daemon/
│   │   ├── daemon.ts     # wires core ↔ connections; status; fan-out
│   │   ├── serve.ts      # local WS+HTTP server (playground + LAN clients)
│   │   ├── dial-home.ts  # outbound reconnecting WS to a remote controller
│   │   └── public/
│   │       └── index.html# self-contained browser playground (no build step)
│   ├── client/
│   │   └── client.ts     # AbletonBridgeClient (browser-safe; reconnect + resub)
│   └── cli.ts            # bin entry: serve | repl | test
└── test/
    ├── correlator.test.ts
    ├── osc.test.ts
    ├── live.test.ts      # against a mock UDP loopback emulating AbletonOSC
    ├── protocol.test.ts
    └── integration.test.ts # in-process daemon + mock Ableton + client
```

**Build/publish:** emit ESM + `.d.ts` to `dist/` (tool TBD — `tsup` or `tsc`; repo is `type:module`).
The **client** and **protocol** entry points must stay free of `node:*` imports so they bundle for
the browser. The client uses `WebSocket`: the browser global, or an injected impl (`ws`) in Node.

## 5. Topology (the cloud-Brain case)

```
        Venue LAN                                  Cloud
 ┌────────────────────────────┐            ┌──────────────────┐
 │ Ableton + AbletonOSC        │            │   Show Brain      │
 │   ▲ UDP 11000 / 11001 local │            │ imports /client   │
 │ ┌─┴──────────────┐          │  1 WS      └─────────┬────────┘
 │ │ Bridge daemon   │─────────┼─(wss + token)────────┘
 │ │  (core inside)  │   outbound dial-home, auto-reconnect
 │ │  + playground   │          │
 │ └─────────────────┘          │
 └────────────────────────────┘
```

Raw OSC never leaves the venue LAN; only the authenticated WS crosses the internet. The **same code
path** serves local dev (everything on `localhost`) and the show (WS spans the WAN) — only the URL
changes.

## 6. Wire protocol (client ↔ daemon)

JSON, zod-validated. This layer **does** have real request IDs (we own it), so it is clean — its job
is to translate to/from the messy address-based AbletonOSC correlation in §7.

- **client → daemon**
  - `{ id, kind: "send", address, args }`
  - `{ id, kind: "query", address, args, timeoutMs? }`
  - `{ id, kind: "subscribe", subId, address, args }`  — **client generates `subId`** (no round-trip needed to start mapping events)
  - `{ id, kind: "unsubscribe", subId }`
- **daemon → client**
  - `{ kind: "reply", id, args }`
  - `{ kind: "event", subId, address, args }`     (subscription updates)
  - `{ kind: "error", id?, message }`
  - `{ kind: "status", ableton: "up" | "down" }`
  - `{ kind: "hello" }`                             (on connect)

## 7. The hard part — AbletonOSC reply correlation (in the core)

AbletonOSC has **no request IDs**. The core handles three reply behaviors:

- **send** — fire-and-forget (`/live/clip/fire`, `/live/song/start_playing`). No reply.
- **query** — `/live/song/get/tempo` → a reply **at the same address** (`/live/song/get/tempo`).
  Correlate by registering a one-shot waiter keyed on the reply address, **matched against the
  echoed identifying args** (AbletonOSC echoes `track_id`/`clip_id`/`send_id` back) to disambiguate
  concurrent parameterized gets. Timeout → reject. (Document the residual ambiguity: two identical
  concurrent gets resolve in arrival order — acceptable.)
- **subscribe** — `start_listen/<prop>` → a **stream** at `get/<prop>`. Register a persistent
  listener keyed by address (+ arg prefix for per-track/per-clip listens). `unsubscribe` sends
  `stop_listen/<prop>` and drops the listener.

**Resubscribe on Ableton restart:** the daemon listens for `/live/startup` and replays active
`start_listen`s. (Mirrors CHANNELERS' "stateful resources need recovery + liveness-bound cleanup"
rule, applied to the bridge.)

The correlator is **pure logic** → unit-tested directly. `AbletonLive` is tested against a **mock UDP
loopback** that binds `11000` and emulates AbletonOSC's reply/listen patterns on `11001` — no Ableton
needed in CI.

**OSC library:** TBD at implementation — needs UDP **send to 11000** *and* **receive + decode on
11001**. Candidates: `osc` (osc.js, batteries-included UDP+decode) or `node-osc` (already in the
repo, but verify its receive/decode surface). Check the chosen library's current docs rather than
relying on memory.

## 8. Reconnection & auth

- **Daemon → controller:** dial-home with exponential backoff; re-auth on every (re)connect via a
  **shared bearer token** (env on both ends). `wss://` for TLS (terminated by the cloud
  platform/proxy). Never expose AbletonOSC's UDP ports to the internet.
- **Subscriptions across drops:** the **client** tracks its desired subscriptions and replays them
  on reconnect; the daemon re-issues `start_listen` to Ableton. Nothing is silently lost.

## 9. Demo apps (both)

- **REPL** (`ableton-bridge repl`) — type an address, see the reply
  (`>>> /live/song/get/tempo` → `(120.0,)`), like AbletonOSC's `run-console.py`. Fastest bring-up;
  scriptable.
- **Browser playground** — a single **self-contained HTML page** the daemon serves (no build step):
  daemon + Ableton connection status; a raw **send/query** box for any address; a **subscribe**
  panel with **live readouts** (beat ticking, transport state, playing slot); a two-way **traffic
  log**. It *is* the canonical "browser → bridge" reuse example.

Both drive the same client/protocol, keeping the package honest.

## 10. Documentation (the reuse instructions)

README structured as:
1. What it is — the 3-layer model + topology diagram.
2. Quick start — install, `ableton-bridge serve`, open the playground, fire `/live/test`.
3. **Reuse recipes:**
   - Browser app — `import { AbletonBridgeClient } from "ableton-osc-bridge/client"`.
   - Same-machine TS backend — `import { AbletonLive } from "ableton-osc-bridge"`.
   - **Remote/cloud controller (CHANNELERS' case)** — run the daemon in dial-home mode at the
     site; import the client in the cloud app.
   - Any language — the §6 wire-protocol spec.
4. Config / env + ports reference (§11).
5. The three verbs + a pointer to the AbletonOSC readme for the address space.
6. Security note — token; never expose AbletonOSC UDP to the internet.

## 11. Config / env reference

| Env | Default | Meaning |
|---|---|---|
| `ABLETON_OSC_HOST` | `127.0.0.1` | where AbletonOSC listens |
| `ABLETON_OSC_SEND_PORT` | `11000` | command port |
| `ABLETON_OSC_RECV_PORT` | `11001` | reply/listen port |
| `BRIDGE_HTTP_PORT` | e.g. `8788` | local serve: playground + WS for LAN clients |
| `BRIDGE_DIAL_URL` | _(unset)_ | remote controller `wss://` URL (enables dial-home) |
| `BRIDGE_TOKEN` | _(required when networked)_ | shared bearer token |
| `BRIDGE_QUERY_TIMEOUT_MS` | `1000` | default `query` timeout |

## 12. Testing strategy

- **correlator** — pure unit tests (query match/timeout, subscription register/replay/unsub).
- **osc** — encode/decode round-trip.
- **live** — against the mock UDP loopback (send → canned reply → resolved promise; listen → stream).
- **protocol** — zod round-trip.
- **integration** — in-process daemon + mock Ableton + a real client (fire, query, subscribe,
  reconnect-and-resubscribe).
- TDD throughout (project preference). Tests run **without Ableton**.

## 13. Build order (a working slice fast)

1. **Core + mock-UDP tests** — `AbletonLive` + correlator; smoke against local Ableton via a throwaway script.
2. **Daemon `serve` + browser playground** — *first end-to-end "fire a clip from a browser."*
3. **Client + REPL.**
4. **Dial-home + auth + reconnect/resubscribe** — *the cloud topology.*
5. **README + reuse recipes.**

## 14. Follow-ups / open questions (not part of this package)

- **CHANNELERS integration** — a later, thin consumer: Brain imports `ableton-osc-bridge/client`;
  the daemon runs at the venue in dial-home mode pointed at the Brain. Tracked separately so the
  package stays decoupled.
- **Cloud Brain is an architectural shift** from the documented "local Show Brain." It affects more
  than this bridge (stage-screen connections, live-oracle latency budget). Add a note/question to
  `docs/ARCHITECTURE.md` §11.
- **Final package name & scope** (`ableton-osc-bridge` vs scoped) — confirm before publish.
- **OSC library choice** (`osc` vs `node-osc`) — decide in build step 1 against current docs.
