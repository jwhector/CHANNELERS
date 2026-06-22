# Design: `ableton-osc-bridge` — a reusable Ableton ↔ web-app OSC bridge

- **Date:** 2026-06-22
- **Status:** Approved (brainstorm complete) — ready for implementation planning
- **Author:** Jared (with Claude)
- **Scope:** the standalone bridge package (incl. a **comprehensive typed facade**) + its dev/demo apps + its docs. **Not** the CHANNELERS Brain integration (a thin, separate consumer wired later).

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
decoupled from CHANNELERS so it can be lifted into other projects — with a **comprehensive, fully
typed API** so that getting Ableton to behave takes as little application-specific wiring as
possible. Plus a small app to develop and exercise the connection.

## 2. Goals / non-goals

**Goals**
- A reusable package usable from: a browser app, a same-machine TS backend, a **remote/cloud** TS
  backend, and any non-TS app (via a documented wire protocol).
- A **comprehensive, fully typed facade** over the whole AbletonOSC surface (Application, Song,
  View, Track, ClipSlot, Clip, Scene, Device, Device-parameter, MidiMap) with first-class
  autocomplete, hover docs (description + OSC address), and clean type errors — so reuse is
  delightful and app code stays tiny: `await live.track(2).volume.get()`, `live.clip(0,0).fire()`,
  `live.song.beat.subscribe(cb)`.
- The same facade works **identically** in-process (local core) and over the network (client) —
  via a single `VerbProvider` seam.
- A **generic transport** (`send`/`query`/`subscribe`) underneath the facade, always available as an
  escape hatch for the few irregular/bulk calls the facade won't type.
- Safe, robust transport for a **live show**: NAT-friendly, authenticated, auto-reconnecting,
  resubscribing after drops/Ableton restarts.
- First-class **dev/demo tools** (a REPL and a browser playground) that double as reuse examples.
- Documentation that teaches reuse in other apps.

**Non-goals (YAGNI for now)**
- The CHANNELERS Brain wiring (separate, later, thin consumer — keeps the package un-intertwined).
- TLS termination logic (assume `wss://` terminated by the cloud platform / reverse proxy).
- Typing the few irregular/bulk endpoints (`/live/song/get/track_data`, `/live/midimap/map_cc`) —
  reachable via the generic verbs; not worth bespoke facade types.
- A published-to-npm build pipeline for the workshop (see §15) — develops as source in the monorepo
  like the other packages; a `dist` build is a later, additive step.

## 3. Decisions (from the brainstorm)

| Decision | Choice |
|---|---|
| Runtime shape | **Core library + reference daemon** (Option A), one package, 3 entry points |
| How CHANNELERS consumes it | Cloud Brain imports the **client** (+ facade); the **daemon** runs at the venue |
| Connection direction | **Daemon dials home** — outbound authed WS from venue, auto-reconnect |
| API surface | **Comprehensive typed facade** over a generic transport; facade is **codegen'd from a curated manifest** |
| Facade portability | Built on a **`VerbProvider`** seam → runs over the local core *and* the network client unchanged |
| Placement | **Package in this monorepo**, project-neutral name, zero `@channelers/*` imports, extractable |
| OSC library | **`node-osc`** (already a repo dependency; `Client` to send, `Server` to receive/decode) |
| Demo app | **Both** a terminal REPL and a daemon-served browser playground |

Proposed package name: **`ableton-osc-bridge`** (unscoped/publishable; can be scoped `@jared/…` later).
Directory: `app/packages/ableton-osc-bridge/`.

## 4. Architecture — layers & package layout

One npm package, three entry points so each consumer takes only what it needs. The dependency
arrow always points **down**; nothing above the `VerbProvider` seam knows whether it's local or
networked.

```
        ┌─────────────────────────── Typed facade (createLive → Live) ───────────────────────────┐
        │  generated from manifest; depends ONLY on VerbProvider; browser-safe & isomorphic        │
        └───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                                     │ VerbProvider { send, query, subscribe }
                  ┌──────────────────────────────────┴───────────────────────────────────┐
        ┌─────────┴──────────┐                                            ┌────────────────┴───────────────┐
        │ AbletonLive (core) │  UDP-OSC via node-osc + correlator         │ AbletonBridgeClient            │
        │ NODE only          │                                            │ WS protocol; browser-safe      │
        └─────────┬──────────┘                                            └────────────────┬───────────────┘
                  │ OscIo (node-osc Client+Server)                                          │ wire protocol (§7)
            Ableton/AbletonOSC                                                       Bridge daemon (serve/dial-home)
```

| Export | Symbol(s) | For |
|---|---|---|
| `ableton-osc-bridge` (main) | `createLive`, `AbletonLive`, `createAbletonLive`, facade types, verbs | same-machine TS use (**node**) |
| `ableton-osc-bridge/client` | `AbletonBridgeClient`, `createLive`, facade types, verbs | **browser-safe** WS client + sugar |
| `ableton-osc-bridge/protocol` | zod message schemas + types | anyone speaking the wire protocol in TS |
| `bin: ableton-bridge` | CLI | `serve` (daemon) · `repl` · `test` (ping) |

- **Facade** (`createLive(provider)` → `Live`) is the headline surface. It depends *only* on the
  `VerbProvider` seam, so it is isomorphic and exported from both the main and `/client` entries.
- **Core** (`AbletonLive`) implements `VerbProvider` over UDP-OSC (node-osc) + the correlator. Node-only.
- **Client** (`AbletonBridgeClient`) implements `VerbProvider` over the WS protocol. Browser-safe.
- **Daemon** = core + a **local WS/HTTP server** (serves the playground + LAN clients) **plus** an
  optional outbound **dial-home** link. Serves local clients and dials home *simultaneously*;
  multiplexes connections; **subscriptions are per-connection**.

### Layout

```
app/packages/ableton-osc-bridge/
├── package.json          # name, exports map, scripts (generate/serve/repl/test/typecheck)
├── README.md             # the reuse documentation (see §11)
├── tsconfig.json         # extends ../../tsconfig.base.json
├── scripts/
│   └── generate-facade.ts# reads manifest → writes src/facade/generated.ts (committed output)
├── src/
│   ├── index.ts          # MAIN entry (node): re-exports core + facade + verbs + protocol
│   ├── transport.ts      # VerbProvider, Subscription, OscArg (the seam) — pure, browser-safe
│   ├── protocol.ts       # zod wire-protocol schemas (client ↔ daemon) — browser-safe
│   ├── manifest.ts       # CURATED data: every object/property/method (single source of truth)
│   ├── node-osc.d.ts     # ambient types for node-osc Client + Server (self-contained)
│   ├── facade/
│   │   ├── index.ts      # createLive(provider) + raw escape hatch + re-exports — browser-safe
│   │   └── generated.ts  # GENERATED typed classes (Live, Song, Track, Clip, …) — browser-safe
│   ├── core/
│   │   ├── live.ts       # AbletonLive implements VerbProvider (node-osc + correlator) — NODE
│   │   ├── osc.ts        # OscIo interface + createNodeOscIo (node-osc Client+Server) — NODE
│   │   └── correlator.ts # pending-query waiters + subscription registry (PURE)
│   ├── client/
│   │   └── index.ts      # CLIENT entry: AbletonBridgeClient + createLive re-export — browser-safe
│   ├── daemon/
│   │   ├── daemon.ts     # attachConnection: protocol ↔ AbletonLive for one connection — NODE
│   │   ├── serve.ts      # node:http + ws server (playground + LAN clients) — NODE
│   │   ├── dial-home.ts  # outbound reconnecting ws to a remote controller — NODE
│   │   └── public/
│   │       └── index.html# self-contained browser playground (no build step)
│   └── cli.ts            # serve | repl | test — NODE
└── test/
    ├── correlator.test.ts
    ├── protocol.test.ts
    ├── live.test.ts       # AbletonLive with a fake OscIo
    ├── facade.test.ts     # facade over a fake VerbProvider (representative shape matrix)
    ├── generated.test.ts  # guard: re-running the generator yields no diff (output is committed)
    ├── client.test.ts     # AbletonBridgeClient over a fake WebSocket
    ├── dial-home.test.ts  # reconnect/resubscribe against an in-process fake controller
    └── integration.test.ts# real node-osc mock Ableton + daemon serve + client + facade
```

**Build/consume:** follows the repo convention — packages expose **TS source** via `exports`
(`moduleResolution: "bundler"`, no build step) and run via `tsx`; `typecheck` is `tsc --noEmit`
extending `tsconfig.base.json`. The **client** and **protocol** entries must stay free of `node:*`
and `node-osc` imports so they bundle for the browser. The client uses `WebSocket`: the browser
global, or an injected impl (`ws`) in Node.

## 5. The typed facade (the headline surface)

### The seam

```ts
// transport.ts — both core and client implement this; the facade depends only on it.
export type OscArg = string | number;
export interface Subscription { unsubscribe(): void }
export interface VerbProvider {
  send(address: string, args?: OscArg[]): void;
  query(address: string, args?: OscArg[], timeoutMs?: number): Promise<OscArg[]>;
  subscribe(startListenAddress: string, args: OscArg[], cb: (args: OscArg[]) => void): Subscription;
}
```

### The manifest (single source of truth)

A curated, typed data structure transcribed once from the in-repo `docs/AbletonOSC-readme.md`. One
entry per object kind, each declaring its **id arity**, its **properties** (`get`/`set`/`listen` +
value type + doc), and its **methods**. AbletonOSC's regularity makes this purely mechanical:

```ts
// manifest.ts (excerpt — shape only)
export const MANIFEST = {
  song: {
    osc: "song", idParams: [],
    methods: { startPlaying: { osc: "start_playing", doc: "Start session playback" }, /* … */ },
    props: {
      tempo:     { osc: "tempo",      type: "number",  get: true, set: true, listen: true,  doc: "Song tempo (BPM)" },
      isPlaying: { osc: "is_playing", type: "boolean", get: true, set: false, listen: true, doc: "Whether the song is playing" },
      beat:      { osc: "beat",       type: "int",     get: false, set: false, listen: true, doc: "Current beat number" },
      /* … */
    },
  },
  track: {
    osc: "track", idParams: ["trackId"],   // id echoed back in replies → matchArgs/value offset
    methods: { stopAllClips: { osc: "stop_all_clips", doc: "Stop all clips on the track" } },
    props: { volume: { osc: "volume", type: "number", get: true, set: true, listen: true, doc: "Track volume" }, /* … */ },
  },
  // clipSlot ["trackIndex","clipIndex"], clip ["trackId","clipId"], scene ["sceneId"],
  // device ["trackId","deviceId"], deviceParameter ["trackId","deviceId","parameterId"],
  // view (none), application (none), midimap (escape-hatch only)
} as const;
```

### Codegen → the object model

`scripts/generate-facade.ts` reads `manifest.ts` and writes `src/facade/generated.ts`: concrete,
readable TS classes with **emitted JSDoc** (doc + OSC address) on every member. Generated, then
committed (a test guards that committed output matches a fresh run). Ergonomics:

```ts
const live = createLive(provider);              // provider = AbletonLive OR AbletonBridgeClient

live.song.startPlaying();                        // method → send
await live.song.tempo.get();                     // getter → query, unwraps reply → number
live.song.tempo.set(120);                        // setter → send
live.song.tempo.subscribe(v => …);               // listener → start_listen, streams number
live.song.beat.subscribe(n => …);                // listen-only property
await live.track(2).volume.get();                // id'd getter; reply [2, 0.8] → 0.8
live.track(2).mute.set(true);                    // boolean → sent as 1/0, read back as boolean
live.track(0).clip(3).fire();                    // nested method
live.track(0).device(0).parameter(5).value.set(0.5);
live.scene(1).fire();
live.master.volume.get(); live.returnTrack("A").mute.set(false);  // master/return id helpers
live.raw.send("/live/song/get/track_data", [0, 12, "track.name"]); // escape hatch for the irregular
```

**Generation rules (uniform across all objects):**
- property value lives at reply index `idParams.length` (ids are echoed first); getter unwraps it.
- setter sends `[...idArgs, value]`; method sends `[...idArgs, ...methodParams]`.
- listener derives addresses by string-swap: `…/start_listen/<p>` (send), `…/get/<p>` (reply),
  `…/stop_listen/<p>` (unsubscribe) — holds for the entire AbletonOSC listen surface.
- `boolean` ↔ `1/0` coercion both directions; `int` vs `number` is documentation only.
- snake_case OSC names → camelCase TS members.

## 6. Topology (the cloud-Brain case)

```
        Venue LAN                                  Cloud
 ┌────────────────────────────┐            ┌──────────────────┐
 │ Ableton + AbletonOSC        │            │   Show Brain      │
 │   ▲ UDP 11000 / 11001 local │            │ imports /client   │
 │ ┌─┴──────────────┐          │  1 WS      │ + createLive      │
 │ │ Bridge daemon   │─────────┼─(wss+token)└─────────┬────────┘
 │ │  (core inside)  │   outbound dial-home, auto-reconnect
 │ │  + playground   │          │
 │ └─────────────────┘          │
 └────────────────────────────┘
```

Raw OSC never leaves the venue LAN; only the authenticated WS crosses the internet. The **same code
path** (and the **same facade calls**) serve local dev (everything on `localhost`) and the show (WS
spans the WAN) — only the URL changes.

## 7. Wire protocol (client ↔ daemon)

JSON, zod-validated. This layer **does** have real request IDs (we own it), so it is clean — its job
is to translate to/from the messy address-based AbletonOSC correlation in §8.

- **client → daemon**
  - `{ id, kind: "send", address, args }`
  - `{ id, kind: "query", address, args, timeoutMs? }`
  - `{ id, kind: "subscribe", subId, address, args }`  — **client generates `subId`** (`address` is the `start_listen/…` form)
  - `{ id, kind: "unsubscribe", subId }`
- **daemon → client**
  - `{ kind: "reply", id, args }`
  - `{ kind: "event", subId, address, args }`     (subscription updates)
  - `{ kind: "error", id?, message }`
  - `{ kind: "status", ableton: "up" | "down" }`
  - `{ kind: "hello" }`                             (on connect)

## 8. The hard part — AbletonOSC reply correlation (in the core)

AbletonOSC has **no request IDs**. `AbletonLive` (built on the pure `Correlator`) handles three
reply behaviors:

- **send** — fire-and-forget (`/live/clip/fire`, `/live/song/start_playing`). No reply.
- **query** — `/live/song/get/tempo` → a reply **at the same address**. Correlate by registering a
  one-shot waiter keyed on the reply address, **matched against the echoed identifying args**
  (`matchArgs` = the args sent; AbletonOSC echoes `track_id`/`clip_id`/`send_id` first). Timeout →
  reject. Residual ambiguity: two identical concurrent gets resolve FIFO — acceptable.
- **subscribe** — `start_listen/<p>` → a **stream** at `get/<p>`. The core derives reply/stop
  addresses by string-swap; registers a persistent listener keyed by the `get` address + arg prefix;
  `unsubscribe` sends `stop_listen/<p>` and drops it.

**Resubscribe on Ableton restart:** `AbletonLive` listens for `/live/startup` and replays active
`start_listen`s. (Mirrors CHANNELERS' "stateful resources need recovery" rule.)

**OSC library = `node-osc`** (already a repo dependency): `Client(host, 11000)` to send;
`Server(11001)` emitting decoded `[address, ...args]` to receive. Bundled types are absent, so the
package ships a self-contained ambient `node-osc.d.ts` (Client + Server). `AbletonLive` depends on
an injected `OscIo` interface (`send` / `onMessage` / `close`); the real one wraps node-osc, so
`AbletonLive` is unit-tested with a **fake `OscIo`** (deterministic, no sockets). One **integration**
test exercises the real node-osc path against an in-process mock Ableton.

## 9. Reconnection & auth

- **Daemon → controller:** dial-home with exponential backoff; re-auth on every (re)connect via a
  **shared bearer token** (env on both ends). `wss://` for TLS (terminated by the cloud
  platform/proxy). Never expose AbletonOSC's UDP ports to the internet.
- **Subscriptions across drops:** the **client** tracks its desired subscriptions and replays them
  on reconnect; the daemon re-issues `start_listen` to Ableton. Nothing is silently lost. (Because
  the facade builds on the client, facade subscriptions survive reconnects for free.)

## 10. Demo apps (both)

- **REPL** (`ableton-bridge repl`) — connects a client to a daemon; type an address, see the reply
  (`>>> /live/song/get/tempo` → `(120.0,)`), like AbletonOSC's `run-console.py`. Fastest bring-up;
  scriptable.
- **Browser playground** — a single **self-contained HTML page** the daemon serves (no build step):
  daemon + Ableton connection status; a raw **send/query** box for any address; a **subscribe**
  panel with **live readouts** (beat ticking, transport state, playing slot); a two-way **traffic
  log**. It *is* the canonical "browser → bridge" reuse example. (Uses the raw protocol directly to
  stay build-free; the facade is exercised by the REPL and tests.)

## 11. Documentation (the reuse instructions)

README structured as:
1. What it is — the layer diagram + topology diagram.
2. Quick start — `ableton-bridge serve`, open the playground, fire `/live/test`.
3. **The facade** — the headline: `createLive(provider)` and the ergonomic call examples (§5);
   how to discover the surface via autocomplete; the `live.raw.*` escape hatch.
4. **Reuse recipes:**
   - Browser app — `import { AbletonBridgeClient, createLive } from "ableton-osc-bridge/client"`.
   - Same-machine TS backend — `import { createAbletonLive, createLive } from "ableton-osc-bridge"`.
   - **Remote/cloud controller (CHANNELERS' case)** — run the daemon in dial-home mode at the site;
     `createLive(new AbletonBridgeClient(url, { token }))` in the cloud app.
   - Any language — the §7 wire-protocol spec.
5. Config / env + ports reference (§12).
6. The generic verbs + a pointer to the AbletonOSC readme for the full address space.
7. Security note — token; never expose AbletonOSC UDP to the internet.

## 12. Config / env reference

| Env | Default | Meaning |
|---|---|---|
| `ABLETON_OSC_HOST` | `127.0.0.1` | where AbletonOSC listens (send target) |
| `ABLETON_OSC_SEND_PORT` | `11000` | command port |
| `ABLETON_OSC_RECV_PORT` | `11001` | reply/listen port |
| `ABLETON_OSC_RECV_HOST` | `127.0.0.1` | OSC reply Server bind interface; `0.0.0.0` only for remote Ableton |
| `BRIDGE_HTTP_HOST` | `127.0.0.1` | daemon bind interface; non-loopback **requires** `BRIDGE_TOKEN` |
| `BRIDGE_HTTP_PORT` | `8788` | local serve: playground + WS |
| `BRIDGE_DIAL_URL` | _(unset)_ | remote controller `wss://` URL (enables dial-home) |
| `BRIDGE_TOKEN` | _(required to bind non-loopback)_ | shared bearer token |
| `BRIDGE_QUERY_TIMEOUT_MS` | `1000` | default `query` timeout |

**Secure-by-default:** both the daemon and the OSC reply receiver bind to **loopback** unless
explicitly configured; binding a non-loopback interface requires a token (`serve()` throws
otherwise). Tokens are compared in constant time; browser WS upgrades from cross-site Origins are
rejected (anti-CSWSH); non-browser clients (no `Origin`) are allowed.

## 13. Testing strategy

- **correlator** — pure unit tests (query match/timeout/FIFO, subscription register/replay/unsub).
- **protocol** — zod round-trip + reject malformed.
- **live** — `AbletonLive` against a fake `OscIo` (send; query→canned reply→resolve; subscribe→stream;
  `/live/startup`→replay).
- **facade** — over a fake `VerbProvider`, a **representative shape matrix**: no-id get/set/listen
  (`song.tempo`), id'd get/set/listen (`track.volume`), boolean coercion (`track.mute`), listen-only
  (`song.beat`), nested method (`clip.fire`), device parameter, `master`/return helpers, `raw.*`.
- **generated** — guard test: running the generator in-memory equals the committed `generated.ts`.
- **client** — `AbletonBridgeClient` over a fake `WebSocket` (id/subId correlation; reconnect replay).
- **dial-home** — reconnect + resubscribe against an in-process fake controller server.
- **integration** — real node-osc mock Ableton + daemon serve + client + facade (query, subscribe).
- TDD throughout (project preference). Tests run **without Ableton**.

## 14. Build order (a working slice fast, sugar layered on)

1. **Scaffold + protocol + transport seam + correlator** (pure, fully tested).
2. **Core** — `OscIo` + `createNodeOscIo` + `AbletonLive` (implements `VerbProvider`); fake-OscIo tests.
   *Smoke against local Ableton via a throwaway script.*
3. **Manifest + generator + generated facade** — `createLive`; facade tests + generated-current guard.
   *The headline sugar; works over the core immediately.*
4. **Daemon `serve` + browser playground** — *first end-to-end "fire a clip from a browser."*
5. **Client + REPL** — `AbletonBridgeClient`; facade-over-client; REPL.
6. **Dial-home + auth + reconnect/resubscribe** — *the cloud topology.*
7. **Integration test** — real node-osc mock + daemon + client + facade.
8. **README + reuse recipes.**

## 15. Follow-ups / open questions (not part of the core build)

- **CHANNELERS integration** — a later, thin consumer: Brain imports `ableton-osc-bridge/client` +
  `createLive`; the daemon runs at the venue in dial-home mode pointed at the Brain. Tracked
  separately so the package stays decoupled.
- **Cloud Brain is an architectural shift** from the documented "local Show Brain." It affects more
  than this bridge (stage-screen connections, live-oracle latency budget). Add a note/question to
  `docs/ARCHITECTURE.md` §11.
- **Publish build** — adding a `dist` (ESM + `.d.ts`) build + swapping `exports` to built paths is an
  additive, post-workshop step; develops as source meanwhile (§4).
- **Token transport hardening** — browsers can't set WS headers, so the token currently rides in the
  URL query (encrypted under `wss://` but loggable). Future: also accept it via the
  `Sec-WebSocket-Protocol` subprotocol for non-browser clients (REPL, dial-home, the cloud Brain).
- **Final package name & scope** (`ableton-osc-bridge` vs scoped) — confirm before publish.
- **Manifest completeness** — transcribing the whole readme is mechanical but sizable; if a property
  is missing, app code falls back to `live.raw.*` until the manifest line is added + regenerated.
