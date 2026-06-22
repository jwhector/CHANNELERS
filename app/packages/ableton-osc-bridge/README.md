# `ableton-osc-bridge`

A standalone, reusable bridge that lets **any web app** drive and observe **Ableton Live** (via
[AbletonOSC](https://github.com/ideoforms/AbletonOSC)) over a generic `send` / `query` / `subscribe`
API. It works both **same-machine** (import the core) and **across a NAT boundary** (a daemon at the
venue dials home to a cloud controller), and ships with a CLI REPL and a self-contained browser
playground.

> This README documents the **generic bridge** (Plan A). The **comprehensive typed facade**
> (`createLive(provider)` → `live.track(2).volume.set(…)`) is documented in **Plan B**.

---

## What it is

AbletonOSC exposes Live's full object model over **UDP** — commands to port `11000`, replies/listens
on `11001` — with **no request IDs** and **no auth**. Two facts shape this package: browsers can't
speak raw UDP, and the controller may live on a different machine than Ableton. So a small Node
process sits in the middle and exposes a clean, id-correlated, authenticated WebSocket protocol.

### Layers

```
        ┌─────────────────── Typed facade (createLive → Live) — Plan B ─────────────────┐
        │  depends ONLY on VerbProvider; browser-safe & isomorphic                        │
        └───────────────────────────────────┬─────────────────────────────────────────────┘
                                             │ VerbProvider { send, query, subscribe }
          ┌──────────────────────────────────┴───────────────────────────────┐
 ┌────────┴──────────┐                                    ┌───────────────────┴────────────┐
 │ AbletonLive (core)│  UDP-OSC via node-osc + correlator │ AbletonBridgeClient             │
 │ NODE only         │                                    │ WS protocol; browser-safe       │
 └────────┬──────────┘                                    └───────────────────┬─────────────┘
          │ OscIo (node-osc Client+Server)                                     │ wire protocol
    Ableton/AbletonOSC                                              Bridge daemon (serve/dial-home)
```

The dependency arrow always points **down**; nothing above the `VerbProvider` seam knows whether it
is local or networked.

### Topology (the cloud-controller case)

```
        Venue LAN                                  Cloud
 ┌────────────────────────────┐            ┌──────────────────┐
 │ Ableton + AbletonOSC        │            │   Controller      │
 │   ▲ UDP 11000 / 11001 local │            │ imports /client   │
 │ ┌─┴──────────────┐          │  1 WS      │ + AbletonBridge…  │
 │ │ Bridge daemon   │─────────┼─(wss+token)└─────────┬────────┘
 │ │  (core inside)  │   outbound dial-home, auto-reconnect
 │ │  + playground   │          │
 │ └─────────────────┘          │
 └────────────────────────────┘
```

Raw OSC never leaves the venue LAN; only the authenticated WS crosses the internet. The **same code
path** serves local dev (everything on `localhost`) and the show (WS spans the WAN) — only the URL
changes.

---

## Quick start

From the monorepo `app/` directory:

```bash
pnpm install
pnpm --filter ableton-osc-bridge serve
```

Then open <http://127.0.0.1:8788>. With Ableton + AbletonOSC running, click **/live/test** (Live
shows a message), then **Subscribe** to `/live/song/start_listen/beat` and press Play in Live — the
beat readout ticks.

A terminal REPL is also available:

```bash
pnpm --filter ableton-osc-bridge repl
>>> /live/song/get/tempo        # query
[120]
>>> send /live/song/start_playing
(sent)
```

---

## The three verbs

Both the local core (`AbletonLive`) and the network client (`AbletonBridgeClient`) implement the same
`VerbProvider` seam:

```ts
export type OscArg = string | number;            // the only arg type on the wire
export interface Subscription { unsubscribe(): void }
export interface VerbProvider {
  send(address: string, args?: OscArg[]): void;                                    // fire-and-forget
  query(address: string, args?: OscArg[], timeoutMs?: number): Promise<OscArg[]>;  // request → reply
  subscribe(startListenAddress: string, args: OscArg[],                            // start_listen → stream
            cb: (args: OscArg[]) => void): Subscription;
}
```

```ts
provider.send("/live/song/start_playing");                 // no reply
await provider.query("/live/song/get/tempo");              // → [120]
await provider.query("/live/track/get/volume", [2]);       // id'd; reply echoes the id → [2, 0.8]
const sub = provider.subscribe("/live/song/start_listen/beat", [], (a) => console.log("beat", a));
sub.unsubscribe();                                         // sends /live/song/stop_listen/beat
```

**Correlation** (no request IDs in OSC): a `query` registers a one-shot waiter keyed on the reply
address, matched against the **echoed identifying args** (AbletonOSC echoes `track_id` / `clip_id`
first), with a timeout. A `subscribe` derives its reply/stop addresses by string-swap
(`start_listen` → `get` / `stop_listen`). On `/live/startup` (AbletonOSC restart) the core replays
all active `start_listen`s.

---

## Reuse recipes

### Browser app

```ts
import { AbletonBridgeClient } from "ableton-osc-bridge/client";

const client = new AbletonBridgeClient("ws://127.0.0.1:8788/ws", { autoReconnect: true });
await client.connect();
console.log(await client.query("/live/song/get/tempo")); // [120]
```

The `/client` entry is **browser-safe** (no `node:*`, no `node-osc`). It uses the global `WebSocket`,
or an injected impl (`{ WebSocketImpl }`) — e.g. `ws` in Node.

### Same-machine TS backend

```ts
import { createAbletonLive } from "ableton-osc-bridge";

const live = createAbletonLive(); // 127.0.0.1, ports 11000/11001
live.send("/live/song/start_playing");
console.log(await live.query("/live/song/get/tempo"));
```

### Remote / cloud controller (the CHANNELERS case)

Run the daemon **at the venue** in dial-home mode, pointed at the controller:

```bash
BRIDGE_DIAL_URL=wss://controller.example/agent BRIDGE_TOKEN=shhh \
  pnpm --filter ableton-osc-bridge serve
```

The controller is the WS **server**; the daemon dials out to it (NAT-friendly, auto-reconnecting).
In the cloud app, accept the connection and drive Ableton through it using the same wire protocol —
or, in the typical client-as-WS-server-consumer arrangement, point an `AbletonBridgeClient` at the
daemon's local serve port over the LAN. Either way the raw OSC stays on the venue LAN.

---

## Config / env

| Env | Default | Meaning |
|---|---|---|
| `ABLETON_OSC_HOST` | `127.0.0.1` | where AbletonOSC listens (send target) |
| `ABLETON_OSC_SEND_PORT` | `11000` | command port |
| `ABLETON_OSC_RECV_PORT` | `11001` | reply/listen port |
| `ABLETON_OSC_RECV_HOST` | `127.0.0.1` | interface the OSC reply Server binds to. Set to `0.0.0.0` **only** when Ableton runs on a different machine than the daemon |
| `BRIDGE_HTTP_HOST` | `127.0.0.1` | interface the daemon binds. Loopback by default; a non-loopback host **requires** `BRIDGE_TOKEN` (serve refuses otherwise) |
| `BRIDGE_HTTP_PORT` | `8788` | local serve: playground + WS |
| `BRIDGE_DIAL_URL` | _(unset)_ | remote controller `wss://` URL (enables dial-home) |
| `BRIDGE_TOKEN` | _(required to bind non-loopback)_ | shared bearer token |
| `BRIDGE_QUERY_TIMEOUT_MS` | `1000` | default `query` timeout |

---

## Wire protocol (client ↔ daemon)

JSON over WebSocket, zod-validated. This layer **does** have real request IDs.

**client → daemon**

- `{ id, kind: "send", address, args }`
- `{ id, kind: "query", address, args, timeoutMs? }`
- `{ id, kind: "subscribe", subId, address, args }` — **client generates `subId`**; `address` is the `start_listen/…` form
- `{ id, kind: "unsubscribe", subId }`

**daemon → client**

- `{ kind: "hello" }` — on connect
- `{ kind: "reply", id, args }`
- `{ kind: "event", subId, address, args }` — subscription updates
- `{ kind: "error", id?, message }`
- `{ kind: "status", ableton: "up" | "down" }`

The zod schemas + inferred types are exported from `ableton-osc-bridge/protocol` for anyone speaking
the protocol in TS; any language can speak it over plain JSON.

---

## Security

Secure-by-default — the bridge can fully control Ableton, so the defaults keep the control surface
local:

- **Loopback by default.** Both the daemon's WS/HTTP server and the OSC reply receiver bind to
  `127.0.0.1`. To bind a non-loopback interface you **must** set `BRIDGE_TOKEN` — `serve()` throws
  otherwise.
- **Token auth, constant-time.** When set, `BRIDGE_TOKEN` is required on every (re)connection and
  compared with `crypto.timingSafeEqual`. Use `wss://` (TLS terminated by the cloud platform /
  reverse proxy).
- **Origin allowlist (anti-CSWSH).** Browser WS upgrades from a cross-site `Origin` are rejected;
  loopback Origins (the served playground) and non-browser clients (no `Origin`: the REPL, dial-home,
  anything using `ws`) are allowed. Add extra browser origins via `serve({ allowedOrigins: [...] })`.
- **Never expose AbletonOSC's UDP ports (`11000`/`11001`) to the internet** — they are
  unauthenticated. Only the authenticated WS should cross the network; raw OSC stays on the LAN.

> **Known limitation:** browsers can't set WS headers, so the token rides in the URL query (`?token=`).
> Over `wss://` it's encrypted in transit, but may appear in proxy/access logs. A future hardening
> will also accept the token via the `Sec-WebSocket-Protocol` subprotocol for non-browser clients.

---

## The full address space

The three generic verbs reach the **entire** AbletonOSC surface. For the complete address reference
(every Application / Song / View / Track / Clip / Scene / Device / parameter endpoint), see
`docs/AbletonOSC-readme.md` in this repo.
