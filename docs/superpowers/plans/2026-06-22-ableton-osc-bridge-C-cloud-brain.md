# `ableton-osc-bridge` — Plan C: Cloud Brain (daemon dials home)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Prerequisite:** Plans A + B complete (the generic bridge + the typed facade; 50 tests passing).

**Goal:** Complete the "daemon dials home to a cloud Brain" topology. Build the missing **controller-that-accepts-an-inbound-socket** quadrant as a reusable package piece (`createBridgeHost`), and wire it into the CHANNELERS Brain as a token-gated `/agent` WebSocket endpoint exposing `getLive()`. The daemon needs **zero changes** — it already dials out via `dialHome()`.

**Architecture:** Extract the controller logic from `AbletonBridgeClient` into a transport-agnostic `ChannelController` (browser-safe), so it can be driven by *either* a dial-out socket (the client) *or* an accepted socket (the new host). `createBridgeHost()` wraps an accepted daemon socket and exposes a stable `Live`. The Brain runs a `ws` server at `/agent`, authenticates the token at the upgrade, and feeds the socket to the host.

**Tech Stack:** Same as A/B. The Brain consumes `ableton-osc-bridge/host` (a new node entry, free of `node-osc`).

## Global Constraints

- **No daemon changes.** `dialHome()` already sends `?token=` and runs `attachConnection` — it is the counterpart to the host. The integration test uses the *real* `dialHome()`.
- **`ChannelController` + `host.ts` import only from `../transport` / `./facade` / `./controller`** — no `node-osc`. (`ChannelController` stays browser-safe; `host.ts` is isomorphic.)
- **Client public API unchanged.** The `AbletonBridgeClient` refactor must keep all of Plan A's `test/client.test.ts` green.
- **Brain wiring is env-gated + graceful.** No `ABLETON_AGENT_TOKEN` → `/agent` endpoint is never created; the Brain runs exactly as today.
- **Whole suite green after every task:** `pnpm --filter ableton-osc-bridge test && pnpm --filter ableton-osc-bridge typecheck`, and (Task 4+) `pnpm --filter @channelers/brain test && pnpm --filter @channelers/brain typecheck`.
- **TDD throughout. Commit trailer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Extract `ChannelController` + refactor the client onto it

**Files:**
- Create: `app/packages/ableton-osc-bridge/src/controller.ts`
- Modify: `app/packages/ableton-osc-bridge/src/client/index.ts`
- Test: `app/packages/ableton-osc-bridge/test/controller.test.ts`
- (Plan A's `test/client.test.ts` must keep passing unchanged.)

**Interfaces:**
- Produces: `interface Channel { send(data: string): void }`; `class ChannelController implements VerbProvider` with `attach(channel: Channel): void`, `detach(): void`, `get connected(): boolean`, `handleMessage(raw: string): void` (plus the three verbs).

- [ ] **Step 1: Write the failing test** — `test/controller.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { ChannelController, type Channel } from "../src/controller";

function fakeChannel() {
  const sent: any[] = [];
  const channel: Channel = { send: (d) => sent.push(JSON.parse(d)) };
  return { channel, sent, last: () => sent.at(-1) };
}

describe("ChannelController", () => {
  it("send/query/subscribe are no-ops or reject until attached", async () => {
    const c = new ChannelController(50);
    expect(c.connected).toBe(false);
    c.send("/live/song/start_playing"); // dropped silently
    await expect(c.query("/live/song/get/tempo")).rejects.toThrow(/disconnected/);
  });

  it("query resolves on the matching reply once attached", async () => {
    const c = new ChannelController();
    const ch = fakeChannel();
    c.attach(ch.channel);
    const p = c.query("/live/song/get/tempo", []);
    const id = ch.last().id;
    c.handleMessage(JSON.stringify({ kind: "reply", id, args: [120] }));
    expect(await p).toEqual([120]);
  });

  it("subscribe streams events for its subId", () => {
    const c = new ChannelController();
    const ch = fakeChannel();
    c.attach(ch.channel);
    const cb = vi.fn();
    c.subscribe("/live/song/start_listen/beat", [], cb);
    const subId = ch.last().subId;
    c.handleMessage(JSON.stringify({ kind: "event", subId, address: "/live/song/start_listen/beat", args: [4] }));
    expect(cb).toHaveBeenCalledWith([4]);
  });

  it("detach rejects pending queries; reattach replays active subscriptions", async () => {
    const c = new ChannelController();
    const ch1 = fakeChannel();
    c.attach(ch1.channel);
    c.subscribe("/live/song/start_listen/beat", [], () => {});
    const p = c.query("/live/song/get/tempo", [], 1000);
    c.detach();
    await expect(p).rejects.toThrow(/disconnected/);
    const ch2 = fakeChannel();
    c.attach(ch2.channel);
    expect(ch2.sent.some((m) => m.kind === "subscribe" && m.address === "/live/song/start_listen/beat")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test controller`
Expected: FAIL — cannot find `../src/controller`.

- [ ] **Step 3: Implement `src/controller.ts`** (lifted from the client internals; browser-safe)

```ts
import type { OscArg, Subscription, VerbProvider } from "./transport";
import type { ServerMessage } from "./protocol";

/** Anything that can carry a serialized wire message outward. */
export interface Channel {
  send(data: string): void;
}

interface PendingQuery { resolve: (a: OscArg[]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; }
interface ActiveSub { subId: string; address: string; args: OscArg[]; cb: (args: OscArg[]) => void; }

function newId(): string {
  return (globalThis as { crypto: { randomUUID(): string } }).crypto.randomUUID();
}

/**
 * Transport-agnostic controller: issues send/query/subscribe over a Channel, correlates
 * replies by id and events by subId, and (re)plays subscriptions whenever a channel attaches.
 * Drives both the dial-out client and the accept-inbound host.
 */
export class ChannelController implements VerbProvider {
  private channel: Channel | null = null;
  private readonly pending = new Map<string, PendingQuery>();
  private readonly subs = new Map<string, ActiveSub>();

  constructor(private readonly defaultTimeoutMs = 1000) {}

  get connected(): boolean {
    return this.channel !== null;
  }

  attach(channel: Channel): void {
    this.channel = channel;
    for (const s of this.subs.values()) {
      this.raw({ kind: "subscribe", id: newId(), subId: s.subId, address: s.address, args: s.args });
    }
  }

  detach(): void {
    this.channel = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("bridge disconnected"));
    }
    this.pending.clear();
  }

  send(address: string, args: OscArg[] = []): void {
    this.raw({ kind: "send", id: newId(), address, args });
  }

  query(address: string, args: OscArg[] = [], timeoutMs = this.defaultTimeoutMs): Promise<OscArg[]> {
    return new Promise<OscArg[]>((resolve, reject) => {
      if (!this.channel) {
        reject(new Error("bridge disconnected"));
        return;
      }
      const id = newId();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`query timeout: ${address}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.raw({ kind: "query", id, address, args, timeoutMs });
    });
  }

  subscribe(startListenAddress: string, args: OscArg[], cb: (args: OscArg[]) => void): Subscription {
    const subId = newId();
    this.subs.set(subId, { subId, address: startListenAddress, args, cb });
    this.raw({ kind: "subscribe", id: newId(), subId, address: startListenAddress, args });
    return {
      unsubscribe: () => {
        this.subs.delete(subId);
        this.raw({ kind: "unsubscribe", id: newId(), subId });
      },
    };
  }

  handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (msg.kind === "reply") {
      const p = this.pending.get(msg.id);
      if (p) { clearTimeout(p.timer); this.pending.delete(msg.id); p.resolve(msg.args); }
    } else if (msg.kind === "error" && msg.id) {
      const p = this.pending.get(msg.id);
      if (p) { clearTimeout(p.timer); this.pending.delete(msg.id); p.reject(new Error(msg.message)); }
    } else if (msg.kind === "event") {
      this.subs.get(msg.subId)?.cb(msg.args);
    }
  }

  private raw(msg: object): void {
    this.channel?.send(JSON.stringify(msg));
  }
}
```

- [ ] **Step 4: Refactor `src/client/index.ts`** to delegate to `ChannelController`

Keep the file's exports (`AbletonBridgeClient`, `WebSocketLike`, `WebSocketCtor`, `ClientOptions`) identical. Replace the internal pending/subs/onMessage machinery with a `ChannelController`:

```ts
import type { OscArg, Subscription, VerbProvider } from "../transport";
import { ChannelController } from "../controller";

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readonly readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface ClientOptions {
  token?: string;
  WebSocketImpl?: WebSocketCtor;
  autoReconnect?: boolean;
  defaultTimeoutMs?: number;
  reconnectDelayMs?: number;
}

export class AbletonBridgeClient implements VerbProvider {
  private ws: WebSocketLike | null = null;
  private readonly Impl: WebSocketCtor;
  private readonly controller: ChannelController;
  private readonly reconnectDelayMs: number;
  private statusCb: ((open: boolean) => void) | null = null;
  private closed = false;

  constructor(private url: string, private opts: ClientOptions = {}) {
    const Impl = opts.WebSocketImpl ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Impl) throw new Error("No WebSocket implementation: pass opts.WebSocketImpl (e.g. `ws` in Node).");
    this.Impl = Impl;
    this.controller = new ChannelController(opts.defaultTimeoutMs ?? 1000);
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 250;
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve) => {
      const full = this.url + (this.opts.token ? (this.url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(this.opts.token) : "");
      const ws = new this.Impl(full);
      this.ws = ws;
      ws.onopen = () => { this.controller.attach({ send: (d) => ws.send(d) }); this.statusCb?.(true); resolve(); };
      ws.onclose = () => {
        this.controller.detach();
        this.statusCb?.(false);
        if (this.opts.autoReconnect && !this.closed) setTimeout(() => this.connect(), this.reconnectDelayMs);
      };
      ws.onmessage = (ev) => this.controller.handleMessage(ev.data);
    });
  }

  onStatus(cb: (open: boolean) => void): void { this.statusCb = cb; }
  send(address: string, args: OscArg[] = []): void { this.controller.send(address, args); }
  query(address: string, args: OscArg[] = [], timeoutMs?: number): Promise<OscArg[]> { return this.controller.query(address, args, timeoutMs); }
  subscribe(startListenAddress: string, args: OscArg[], cb: (args: OscArg[]) => void): Subscription { return this.controller.subscribe(startListenAddress, args, cb); }
  close(): void { this.closed = true; this.ws?.close(); }
}
```

- [ ] **Step 5: Run controller + client tests + the browser-safety guard**

Run: `pnpm --filter ableton-osc-bridge test controller client && pnpm --filter ableton-osc-bridge typecheck`
Expected: controller tests PASS; **all 4 Plan A client tests still PASS** (no regression); typecheck clean. The existing guard "the /client entry imports nothing node-only" must still hold — `controller.ts` is browser-safe.

- [ ] **Step 6: Commit**

```bash
git add app/packages/ableton-osc-bridge/src/controller.ts app/packages/ableton-osc-bridge/src/client/index.ts app/packages/ableton-osc-bridge/test/controller.test.ts
git commit -m "refactor(bridge): extract ChannelController; client delegates to it (no API change)"
```

---

### Task 2: `createBridgeHost` + the `/host` entry

**Files:**
- Create: `app/packages/ableton-osc-bridge/src/host.ts`
- Modify: `app/packages/ableton-osc-bridge/package.json` (add `./host` export)
- Modify: `app/packages/ableton-osc-bridge/src/index.ts` (re-export host from main)
- Test: `app/packages/ableton-osc-bridge/test/host.test.ts`

**Interfaces:**
- Consumes: `ChannelController`, `Channel`; `createLive`, `Live`; `VerbProvider`.
- Produces: `interface AgentSocket { send(data: string): void; on(event: "message", cb: (data: string | Buffer) => void): void; on(event: "close", cb: () => void): void; close(): void }`; `interface BridgeHost { readonly live: Live; readonly provider: VerbProvider; handleSocket(ws: AgentSocket): void; connected(): boolean; onStatus(cb: (connected: boolean) => void): void }`; `createBridgeHost(opts?: { defaultTimeoutMs?: number }): BridgeHost`.

- [ ] **Step 1: Write the failing test** — `test/host.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { createBridgeHost, type AgentSocket } from "../src/host";

/** A fake daemon socket (node-ws shaped): records sends, lets the test push messages/close. */
function fakeSocket() {
  const sent: any[] = [];
  let onMsg: (d: string) => void = () => {};
  let onClose: () => void = () => {};
  let closed = false;
  const ws: AgentSocket = {
    send: (d) => sent.push(JSON.parse(d)),
    on: (ev: any, cb: any) => { if (ev === "message") onMsg = cb; else if (ev === "close") onClose = cb; },
    close: () => { closed = true; onClose(); },
  };
  return { ws, sent, last: () => sent.at(-1), recv: (m: object) => onMsg(JSON.stringify(m)), drop: () => onClose(), isClosed: () => closed };
}

describe("createBridgeHost", () => {
  it("is disconnected until a socket is attached", () => {
    const host = createBridgeHost();
    expect(host.connected()).toBe(false);
  });

  it("routes facade calls over the attached socket and resolves queries", async () => {
    const host = createBridgeHost();
    const s = fakeSocket();
    host.handleSocket(s.ws);
    expect(host.connected()).toBe(true);
    host.live.song.startPlaying();
    expect(s.sent.some((m) => m.kind === "send" && m.address === "/live/song/start_playing")).toBe(true);
    const q = host.live.song.tempo.get();
    s.recv({ kind: "reply", id: s.last().id, args: [120] });
    expect(await q).toBe(120);
  });

  it("supersedes a prior socket (latest wins) and replays subscriptions on reattach", () => {
    const host = createBridgeHost();
    const a = fakeSocket();
    host.handleSocket(a.ws);
    host.live.song.beat.subscribe(() => {});
    const b = fakeSocket();
    host.handleSocket(b.ws);                    // new daemon connection
    expect(a.isClosed()).toBe(true);            // old one closed
    expect(b.sent.some((m) => m.kind === "subscribe" && m.address === "/live/song/start_listen/beat")).toBe(true);
  });

  it("reflects disconnect when the socket drops", () => {
    const host = createBridgeHost();
    const s = fakeSocket();
    host.handleSocket(s.ws);
    s.drop();
    expect(host.connected()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test host`
Expected: FAIL — cannot find `../src/host`.

- [ ] **Step 3: Implement `src/host.ts`**

```ts
import { ChannelController, type Channel } from "./controller";
import { createLive } from "./facade/index";
import type { Live } from "./facade/generated";
import type { VerbProvider } from "./transport";

/** A daemon socket the host accepts (node `ws` WebSocket shape). */
export interface AgentSocket {
  send(data: string): void;
  on(event: "message", cb: (data: string | Buffer) => void): void;
  on(event: "close", cb: () => void): void;
  close(): void;
}

export interface BridgeHost {
  readonly live: Live;
  readonly provider: VerbProvider;
  /** Attach a freshly-connected daemon socket. Supersedes any prior one (latest wins). */
  handleSocket(ws: AgentSocket): void;
  connected(): boolean;
  onStatus(cb: (connected: boolean) => void): void;
}

/**
 * The controller side of dial-home: the cloud Brain accepts the daemon's outbound socket
 * and drives Ableton through `host.live`. Exposes a STABLE Live usable before/after connection;
 * subscriptions replay when a daemon (re)connects; while disconnected, queries reject fast.
 */
export function createBridgeHost(opts: { defaultTimeoutMs?: number } = {}): BridgeHost {
  const controller = new ChannelController(opts.defaultTimeoutMs);
  let current: AgentSocket | null = null;
  let statusCb: ((c: boolean) => void) | null = null;

  return {
    provider: controller,
    live: createLive(controller),
    connected: () => controller.connected,
    onStatus: (cb) => { statusCb = cb; },
    handleSocket(ws) {
      if (current && current !== ws) current.close();
      current = ws;
      const channel: Channel = { send: (d) => ws.send(d) };
      controller.attach(channel);
      statusCb?.(true);
      ws.on("message", (data) => controller.handleMessage(typeof data === "string" ? data : data.toString()));
      ws.on("close", () => {
        if (current === ws) { current = null; controller.detach(); statusCb?.(false); }
      });
    },
  };
}
```

- [ ] **Step 4: Add the `./host` export to `package.json`** (`exports`)

```json
    "./host": "./src/host.ts",
```

- [ ] **Step 5: Re-export host from `src/index.ts`** (append)

```ts
export { createBridgeHost, type BridgeHost, type AgentSocket } from "./host";
export { ChannelController, type Channel } from "./controller";
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter ableton-osc-bridge test host && pnpm --filter ableton-osc-bridge typecheck`
Expected: host tests PASS (4); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add app/packages/ableton-osc-bridge/src/host.ts app/packages/ableton-osc-bridge/src/index.ts app/packages/ableton-osc-bridge/package.json app/packages/ableton-osc-bridge/test/host.test.ts
git commit -m "feat(bridge): createBridgeHost — controller accepts daemon dial-home (/host entry)"
```

---

### Task 3: End-to-end — real `dialHome()` ↔ host ↔ mock Ableton

**Files:**
- Create: `app/packages/ableton-osc-bridge/test/host-integration.test.ts`

**Interfaces:**
- Consumes: `createBridgeHost`; `dialHome`; `AbletonLive` + `createNodeOscIo`; a `node-osc` mock Ableton; `ws` `WebSocketServer`.

This proves the whole cloud loop with the **real daemon code**: a `ws` server (the Brain) feeds each connection to `host.handleSocket`; the daemon's real `dialHome()` connects out to it and services verbs against a mock Ableton.

- [ ] **Step 1: Write the integration test** — `test/host-integration.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { Client, Server } from "node-osc";
import { WebSocketServer } from "ws";
import { createBridgeHost } from "../src/host";
import { dialHome } from "../src/daemon/dial-home";
import { AbletonLive } from "../src/core/live";
import { createNodeOscIo } from "../src/core/osc";

/** Mock Ableton on 11030/11031: answers tempo, emits one beat on listen. */
function mockAbleton() {
  const reply = new Client("127.0.0.1", 11031);
  const server = new Server(11030, "127.0.0.1");
  server.on("message", (msg) => {
    const [address] = msg;
    if (address === "/live/song/get/tempo") reply.send("/live/song/get/tempo", 120, () => {});
    if (address === "/live/song/start_listen/beat") reply.send("/live/song/get/beat", 7, () => {});
  });
  return { close: () => { server.close(); reply.close(); } };
}

let ableton: { close(): void };
let wss: WebSocketServer;
let daemon: { close(): void };

afterEach(async () => {
  daemon?.close();
  ableton?.close();
  await new Promise<void>((r) => (wss ? wss.close(() => r()) : r()));
});

describe("cloud loop: dialHome ↔ host ↔ mock Ableton", () => {
  it("the host drives Ableton via a daemon that dialed home", async () => {
    ableton = mockAbleton();
    const host = createBridgeHost();

    // The Brain: a ws server that hands each connection to the host.
    wss = new WebSocketServer({ port: 8930 });
    wss.on("connection", (ws) => host.handleSocket(ws));

    // The daemon: real dialHome() out to the Brain, servicing a real AbletonLive over node-osc.
    const io = createNodeOscIo({ host: "127.0.0.1", sendPort: 11030, recvPort: 11031 });
    const live = new AbletonLive(io);
    daemon = dialHome({ provider: live, url: "ws://127.0.0.1:8930" });

    await vi.waitFor(() => expect(host.connected()).toBe(true), { timeout: 2000 });

    expect(await host.live.song.tempo.get(undefined as any)).toBe(120);

    const beat = await new Promise<number>((resolve) => {
      host.live.song.beat.subscribe((n) => resolve(n));
    });
    expect(beat).toBe(7);
  });
});
```

> Note: `import { vi } from "vitest"` at the top alongside the others. If UDP timing makes the query flaky, pass an explicit timeout: `host.live.song.tempo.get(2000)`.

- [ ] **Step 2: Run it — verify pass**

Run: `pnpm --filter ableton-osc-bridge test host-integration`
Expected: PASS.

- [ ] **Step 3: Full package suite + typecheck**

Run: `pnpm --filter ableton-osc-bridge test && pnpm --filter ableton-osc-bridge typecheck`
Expected: all PASS (Plan A/B + controller + host + host-integration); 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add app/packages/ableton-osc-bridge/test/host-integration.test.ts
git commit -m "test(bridge): cloud loop — real dialHome ↔ host ↔ mock Ableton"
```

---

### Task 4: Wire the host into the CHANNELERS Brain (`/agent` endpoint)

**Files:**
- Modify: `app/apps/brain/package.json` (add the workspace dep)
- Modify: `app/apps/brain/src/config.ts` (add the `ableton` block)
- Create: `app/apps/brain/src/ableton.ts`
- Modify: `app/apps/brain/src/app.ts` (call `initAbleton(app.server, …)`)
- Test: `app/apps/brain/test/ableton.test.ts`

**Interfaces:**
- Consumes: `createBridgeHost` from `ableton-osc-bridge/host`; `WebSocketServer` from `ws`.
- Produces: `initAbleton(server: import("node:http").Server, token: string | undefined, path?: string): BridgeHost | null`; `getLive(): Live | null`.

- [ ] **Step 1: Add the workspace dep** to `app/apps/brain/package.json` (`dependencies`)

```json
    "ableton-osc-bridge": "workspace:*",
```
Then run `pnpm install` from `app/`.

- [ ] **Step 2: Add the `ableton` config block** to `app/apps/brain/src/config.ts` (alongside `osc`)

```ts
  ableton: {
    /** Set this to arm the /agent endpoint the venue daemon dials home to. Unset → endpoint off. */
    agentToken: process.env.ABLETON_AGENT_TOKEN || undefined,
    agentPath: process.env.ABLETON_AGENT_PATH ?? "/agent",
  },
```

- [ ] **Step 3: Write the failing test** — `app/apps/brain/test/ableton.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { initAbleton, getLive, __resetAbletonForTest } from "../src/ableton";
import { createServer, type Server } from "node:http";
import { attachConnection } from "ableton-osc-bridge";
import type { VerbProvider } from "ableton-osc-bridge";

let server: Server;
afterEach(async () => { __resetAbletonForTest(); await new Promise<void>((r) => (server ? server.close(() => r()) : r())); });

function listen(s: Server, port: number): Promise<void> { return new Promise((r) => s.listen(port, "127.0.0.1", r)); }

describe("brain ableton wiring", () => {
  it("is off when no token is set", () => {
    server = createServer();
    expect(initAbleton(server, undefined)).toBeNull();
    expect(getLive()).toBeNull();
  });

  it("arms /agent and drives a daemon that dials in", async () => {
    server = createServer();
    const host = initAbleton(server, "tok", "/agent");
    expect(host).not.toBeNull();
    await listen(server, 8940);

    // Simulate the daemon: dial in with the token and service a fake Ableton.
    const calls: string[] = [];
    const provider: VerbProvider = { send: (a) => calls.push(a), query: async () => [120], subscribe: () => ({ unsubscribe: () => {} }) };
    const ws = new WebSocket("ws://127.0.0.1:8940/agent?token=tok");
    await new Promise<void>((r) => ws.on("open", r));
    attachConnection(provider, {
      send: (m) => ws.send(JSON.stringify(m)),
      onMessage: (cb) => ws.on("message", (raw) => cb(raw.toString())),
      onClose: (cb) => ws.on("close", cb),
    });

    await vi.waitFor(() => expect(host!.connected()).toBe(true));
    getLive()!.song.startPlaying();
    await vi.waitFor(() => expect(calls).toContain("/live/song/start_playing"));
    ws.close();
  });

  it("rejects a daemon with the wrong token", async () => {
    server = createServer();
    initAbleton(server, "tok", "/agent");
    await listen(server, 8941);
    const ws = new WebSocket("ws://127.0.0.1:8941/agent?token=wrong");
    const outcome = await new Promise<"open" | "rejected">((r) => { ws.on("open", () => r("open")); ws.on("error", () => r("rejected")); });
    expect(outcome).toBe("rejected");
  });
});
```

> Add `import { vi } from "vitest"`. The brain test setup forces `OPENAI_API_KEY=""`; this test doesn't touch OpenAI.

- [ ] **Step 4: Run it — verify it fails**

Run: `pnpm --filter @channelers/brain test ableton`
Expected: FAIL — cannot find `../src/ableton`.

- [ ] **Step 5: Implement `app/apps/brain/src/ableton.ts`**

```ts
import type { Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { createBridgeHost, type BridgeHost } from "ableton-osc-bridge/host";

let host: BridgeHost | null = null;

function tokenOk(reqUrl: string | undefined, token: string): boolean {
  const provided = new URL(reqUrl ?? "/", "http://localhost").searchParams.get("token") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Arm the /agent endpoint the venue daemon dials home to (Plan C). Optional + graceful:
 * no token → endpoint never created, Brain runs unchanged. Returns the host (or null).
 */
export function initAbleton(server: Server, token: string | undefined, path = "/agent"): BridgeHost | null {
  if (!token) return null;
  host = createBridgeHost();
  const wss = new WebSocketServer({
    server,
    path,
    verifyClient: (info: { req: { url?: string } }) => tokenOk(info.req.url, token),
  });
  wss.on("connection", (ws) => { host!.handleSocket(ws); });
  host.onStatus((c) => console.log(`[ableton] agent ${c ? "connected" : "disconnected"}`));
  console.log(`[ableton] /agent armed — daemon dials home here`);
  return host;
}

/** The typed Ableton facade, or null if the agent endpoint is off / no daemon connected yet. */
export function getLive() {
  return host?.live ?? null;
}

/** test-only reset */
export function __resetAbletonForTest(): void {
  host = null;
}
```

- [ ] **Step 6: Wire it in `app/apps/brain/src/app.ts`** — after `const bus = new Bus(app.server);`

```ts
  initAbleton(app.server, config.ableton.agentToken, config.ableton.agentPath);
```
and add the import at the top:
```ts
import { initAbleton } from "./ableton";
```

- [ ] **Step 7: Run brain tests + typecheck**

Run: `pnpm --filter @channelers/brain test && pnpm --filter @channelers/brain typecheck`
Expected: the new `ableton` tests PASS; existing brain suite still green; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add app/apps/brain/package.json app/apps/brain/src/config.ts app/apps/brain/src/ableton.ts app/apps/brain/src/app.ts app/apps/brain/test/ableton.test.ts app/pnpm-lock.yaml
git commit -m "feat(brain): /agent endpoint — venue daemon dials home; getLive() exposes the Ableton facade"
```

---

### Task 5: Docs

**Files:**
- Modify: `app/packages/ableton-osc-bridge/README.md`
- Modify: `docs/superpowers/specs/2026-06-22-ableton-osc-bridge-design.md`
- Modify: `app/CLAUDE.md`
- Modify: `docs/ARCHITECTURE.md` (§12 note)
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: README** — add a "Cloud controller (daemon dials home)" section under the reuse recipes: `createBridgeHost()` API, the `/agent` server sketch (token at upgrade → `host.handleSocket(ws)`), and that the daemon side is just `BRIDGE_DIAL_URL=wss://brain/agent BRIDGE_TOKEN=…` with no daemon code change. Update the layer table to mention the `/host` entry.

- [ ] **Step 2: Spec** — §4 entry-points table: add `ableton-osc-bridge/host` → `createBridgeHost`. §6: note dial-home is now fully supported on both ends (daemon `dialHome` ↔ Brain `createBridgeHost`). §15: mark "controller-accepts-inbound-socket" / CHANNELERS `/agent` wiring as **done**; the remaining open item is the event→Ableton *mapping* (what show moments drive Live).

- [ ] **Step 3: `app/CLAUDE.md`** — under the brain bullet, note the new `/agent` WS endpoint (`apps/brain/src/ableton.ts`, env `ABLETON_AGENT_TOKEN`) and `getLive()`; note it's optional/off by default and consumes `ableton-osc-bridge/host`.

- [ ] **Step 4: `docs/ARCHITECTURE.md` §12** — update the cloud-Brain entry: the bridge's daemon-dials-home path is now wired (Brain `/agent` + `getLive()`); the open question narrows to *which show events should drive Ableton* and the cloud-deployment decision.

- [ ] **Step 5: CHANGELOG** (newest on top):

```markdown
## 2026-06-22 — ableton-osc-bridge Plan C: cloud-Brain dial-home (host + Brain /agent)

- **What:** Completed the daemon-dials-home topology. Extracted a transport-agnostic `ChannelController` (client refactored onto it, API unchanged) and added `createBridgeHost()` (`ableton-osc-bridge/host`) — the controller that accepts the daemon's inbound socket and exposes a stable typed `Live` (replays subscriptions on reconnect; queries reject fast while disconnected; latest connection wins). Wired into the Brain as a token-gated `/agent` WS endpoint (`apps/brain/src/ableton.ts`, env `ABLETON_AGENT_TOKEN`, off by default) with `getLive()`. Daemon unchanged — it already dials home. Proven end-to-end by a loopback test using the real `dialHome()`.
- **Why:** The Brain is planned to run in the cloud while Ableton is at the venue behind NAT; the daemon must dial out to the Brain (the WS server). (Spec §6; ARCHITECTURE §12.)
- **Files/areas:** `app/packages/ableton-osc-bridge/src/{controller,host}.ts`, `client/index.ts`, `index.ts`, `package.json`, tests; `app/apps/brain/src/{ableton,config,app}.ts` + test.
- **Verification:** bridge `test`+`typecheck` green; brain `test`+`typecheck` green.
- **Open / next:** the event→Ableton *mapping* (which show moments drive Live) is the remaining creative step; cloud-deployment decision still open (ARCHITECTURE §12).
- **Docs touched:** this entry; spec §4/§6/§15; package README; `app/CLAUDE.md`; `ARCHITECTURE.md` §12.
```

- [ ] **Step 6: Commit**

```bash
git add app/packages/ableton-osc-bridge/README.md docs/superpowers/specs/2026-06-22-ableton-osc-bridge-design.md app/CLAUDE.md docs/ARCHITECTURE.md docs/CHANGELOG.md
git commit -m "docs(bridge): Plan C — cloud-Brain dial-home (host + Brain /agent)"
```

---

## Self-Review (against the design)

- **Coverage:** the missing "controller-accepts-inbound-socket" quadrant (Task 2), built on a shared `ChannelController` (Task 1) so the client doesn't fork; the real daemon `dialHome()` is the counterpart (Task 3, no daemon change); Brain `/agent` wiring env-gated + graceful (Task 4); docs incl. the project's CHANGELOG/ARCHITECTURE/app-CLAUDE rules (Task 5).
- **No regressions:** Task 1 keeps `AbletonBridgeClient`'s public API + Plan A client tests; every task re-runs the whole suite.
- **Type consistency:** `ChannelController`/`Channel` (Task 1) consumed by `client` (1) and `host` (2); `BridgeHost`/`AgentSocket` (2) consumed by the Brain (4); `createBridgeHost` imported from `ableton-osc-bridge/host` in the Brain. `getLive()` returns the facade `Live | null`.
- **Security:** `/agent` token verified at the upgrade with constant-time compare (mirrors `serve.ts`); endpoint absent unless `ABLETON_AGENT_TOKEN` is set.
- **Note for the engineer:** ports — host-integration uses 11030/11031 (OSC) + 8930 (ws); brain test uses 8940/8941. The Brain's `/agent` shares `app.server` with the bus's `/ws` (different paths, same HTTP server).
