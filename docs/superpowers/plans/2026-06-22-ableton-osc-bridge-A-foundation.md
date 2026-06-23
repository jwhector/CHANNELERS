# `ableton-osc-bridge` — Plan A: Foundation & Generic Bridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, reusable bridge that lets any web app drive and observe Ableton (via AbletonOSC) over a generic `send`/`query`/`subscribe` API — working both same-machine (import the core) and across a NAT boundary (daemon dials home to a cloud controller), with a REPL and a browser playground.

**Architecture:** One pnpm/TS package at `app/packages/ableton-osc-bridge/`. A `VerbProvider` seam (`send`/`query`/`subscribe`) is implemented twice: by `AbletonLive` (UDP-OSC via `node-osc`, same machine as Ableton) and by `AbletonBridgeClient` (the WS wire protocol, browser-safe). A daemon wraps `AbletonLive` and bridges it to WS connections — it both serves locally (playground + LAN clients) and optionally dials home to a remote controller. Plan B layers a typed facade on the same seam.

**Tech Stack:** TypeScript (ESM), `node-osc` (OSC over UDP), `ws` (WebSocket), `zod` (protocol validation), `tsx` (run), `vitest` (test). No build step — packages expose TS source via `exports`, consumed via `tsx`/bundler (`moduleResolution: "bundler"`), exactly like the repo's other packages.

## Global Constraints

- **Zero `@channelers/*` imports** anywhere in the package — it must lift out cleanly.
- **`/client` and `/protocol` entry points must be browser-safe** — no `node:*` and no `node-osc` imports reachable from them. The client uses the global `WebSocket`, or an injected impl.
- **ESM, `"type": "module"`.** `moduleResolution: "bundler"` → relative imports take **no** `.js` extension (match existing packages).
- **`tsconfig.json` extends `../../tsconfig.base.json`.** Typecheck = `tsc -p tsconfig.json --noEmit`.
- **TDD throughout:** failing test → run-it-fails → minimal impl → run-it-passes → commit.
- **`OscArg = string | number`** is the only OSC arg type on the wire (booleans are caller-coerced to `1`/`0` in Plan B's facade, never sent raw).
- **AbletonOSC address facts:** commands → UDP `11000`; replies/listens → UDP `11001`; query replies arrive at the *same* `…/get/…` address echoing the request's id args first; `…/start_listen/<p>` streams at `…/get/<p>`; stop via `…/stop_listen/<p>`; `/live/startup` is sent when AbletonOSC (re)starts.
- **Commit message trailer** (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Package scaffold + protocol + transport seam

**Files:**
- Create: `app/packages/ableton-osc-bridge/package.json`
- Create: `app/packages/ableton-osc-bridge/tsconfig.json`
- Create: `app/packages/ableton-osc-bridge/vitest.config.ts`
- Create: `app/packages/ableton-osc-bridge/src/transport.ts`
- Create: `app/packages/ableton-osc-bridge/src/protocol.ts`
- Create: `app/packages/ableton-osc-bridge/src/index.ts` (stub — fleshed out in Task 4)
- Test: `app/packages/ableton-osc-bridge/test/protocol.test.ts`

**Interfaces:**
- Produces: `OscArg = string | number`; `interface Subscription { unsubscribe(): void }`; `interface VerbProvider { send(address, args?); query(address, args?, timeoutMs?): Promise<OscArg[]>; subscribe(startListenAddress, args, cb): Subscription }`.
- Produces: zod `ClientMessage`, `ServerMessage` + inferred types `ClientMessage`, `ServerMessage`, and `parseClientMessage(raw: string): ClientMessage | null`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ableton-osc-bridge",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client/index.ts",
    "./protocol": "./src/protocol.ts"
  },
  "bin": {
    "ableton-bridge": "./src/cli.ts"
  },
  "scripts": {
    "serve": "tsx src/cli.ts serve",
    "repl": "tsx src/cli.ts repl",
    "ping": "tsx src/cli.ts test",
    "dev": "tsx watch src/cli.ts serve",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "node-osc": "^9.1.4",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.1",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test", "scripts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 4: Create `src/transport.ts`** (the seam — pure, browser-safe)

```ts
/** The only OSC argument type carried on the wire. */
export type OscArg = string | number;

/** Handle returned by subscribe(); call to stop receiving and tear down the listen. */
export interface Subscription {
  unsubscribe(): void;
}

/**
 * The three verbs every transport implements. The typed facade (Plan B) depends
 * ONLY on this, so the same calls work over the local core and the network client.
 *  - send: fire-and-forget (no reply)
 *  - query: request → one reply, correlated back as a Promise
 *  - subscribe: start_listen → a stream of replies via cb
 */
export interface VerbProvider {
  send(address: string, args?: OscArg[]): void;
  query(address: string, args?: OscArg[], timeoutMs?: number): Promise<OscArg[]>;
  subscribe(
    startListenAddress: string,
    args: OscArg[],
    cb: (args: OscArg[]) => void,
  ): Subscription;
}
```

- [ ] **Step 5: Write the failing protocol test** — `test/protocol.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { ClientMessage, ServerMessage, parseClientMessage } from "../src/protocol";

describe("protocol", () => {
  it("accepts a valid query message", () => {
    const msg = { id: "1", kind: "query", address: "/live/song/get/tempo", args: [] };
    expect(ClientMessage.parse(msg)).toEqual(msg);
  });

  it("defaults args to [] when omitted on send", () => {
    const parsed = ClientMessage.parse({ id: "1", kind: "send", address: "/live/song/start_playing" });
    expect(parsed).toMatchObject({ kind: "send", args: [] });
  });

  it("round-trips a subscribe with client-generated subId", () => {
    const msg = { id: "1", kind: "subscribe", subId: "s1", address: "/live/song/start_listen/beat", args: [] };
    expect(ClientMessage.parse(msg)).toEqual(msg);
  });

  it("validates server reply/event/error/status/hello", () => {
    expect(ServerMessage.parse({ kind: "reply", id: "1", args: [120] })).toBeTruthy();
    expect(ServerMessage.parse({ kind: "event", subId: "s1", address: "/live/song/get/beat", args: [4] })).toBeTruthy();
    expect(ServerMessage.parse({ kind: "error", message: "boom" })).toBeTruthy();
    expect(ServerMessage.parse({ kind: "status", ableton: "up" })).toBeTruthy();
    expect(ServerMessage.parse({ kind: "hello" })).toBeTruthy();
  });

  it("parseClientMessage returns null on garbage", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ kind: "bogus" }))).toBeNull();
  });
});
```

- [ ] **Step 6: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test`
Expected: FAIL — cannot find module `../src/protocol`.

- [ ] **Step 7: Create `src/protocol.ts`**

```ts
import { z } from "zod";

export const OscArgZ = z.union([z.string(), z.number()]);

/** client → daemon */
export const ClientMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("send"), id: z.string(), address: z.string(), args: z.array(OscArgZ).default([]) }),
  z.object({ kind: z.literal("query"), id: z.string(), address: z.string(), args: z.array(OscArgZ).default([]), timeoutMs: z.number().optional() }),
  z.object({ kind: z.literal("subscribe"), id: z.string(), subId: z.string(), address: z.string(), args: z.array(OscArgZ).default([]) }),
  z.object({ kind: z.literal("unsubscribe"), id: z.string(), subId: z.string() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** daemon → client */
export const ServerMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hello") }),
  z.object({ kind: z.literal("reply"), id: z.string(), args: z.array(OscArgZ) }),
  z.object({ kind: z.literal("event"), subId: z.string(), address: z.string(), args: z.array(OscArgZ) }),
  z.object({ kind: z.literal("error"), id: z.string().optional(), message: z.string() }),
  z.object({ kind: z.literal("status"), ableton: z.enum(["up", "down"]) }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Safe-parse a raw WS string into a ClientMessage, or null. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientMessage.safeParse(json);
  return result.success ? result.data : null;
}
```

- [ ] **Step 8: Create stub `src/index.ts`** (real exports land in Task 4)

```ts
export * from "./transport";
export * from "./protocol";
```

- [ ] **Step 9: Install deps + run tests + typecheck**

Run: `pnpm install` (from `app/`), then `pnpm --filter ableton-osc-bridge test && pnpm --filter ableton-osc-bridge typecheck`
Expected: protocol tests PASS; typecheck 0 errors.

- [ ] **Step 10: Commit**

```bash
git add app/packages/ableton-osc-bridge app/pnpm-lock.yaml
git commit -m "feat(bridge): scaffold ableton-osc-bridge + protocol + transport seam"
```

---

### Task 2: Correlator (pure reply-routing logic)

**Files:**
- Create: `app/packages/ableton-osc-bridge/src/core/correlator.ts`
- Test: `app/packages/ableton-osc-bridge/test/correlator.test.ts`

**Interfaces:**
- Consumes: `OscArg` from `../transport`.
- Produces: `interface SubRecord { subId: string; startListenAddress: string; replyAddress: string; stopAddress: string; matchArgs: OscArg[]; cb: (args: OscArg[]) => void }`; class `Correlator` with `registerQuery(address, matchArgs, timeoutMs): Promise<OscArg[]>`, `addSubscription(rec: SubRecord): void`, `removeSubscription(subId): void`, `activeSubscriptions(): SubRecord[]`, `handleIncoming(address, args): void`, `rejectAll(err): void`.

- [ ] **Step 1: Write the failing test** — `test/correlator.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { Correlator, type SubRecord } from "../src/core/correlator";

function sub(partial: Partial<SubRecord> & Pick<SubRecord, "subId" | "replyAddress" | "cb">): SubRecord {
  return { startListenAddress: "", stopAddress: "", matchArgs: [], ...partial };
}

describe("Correlator", () => {
  it("resolves a query when a matching reply arrives", async () => {
    const c = new Correlator();
    const p = c.registerQuery("/live/song/get/tempo", [], 1000);
    c.handleIncoming("/live/song/get/tempo", [120]);
    expect(await p).toEqual([120]);
  });

  it("matches a parameterized query on its echoed id args", async () => {
    const c = new Correlator();
    const p = c.registerQuery("/live/track/get/volume", [2], 1000);
    c.handleIncoming("/live/track/get/volume", [5, 0.1]); // wrong track — ignored
    c.handleIncoming("/live/track/get/volume", [2, 0.8]); // right track
    expect(await p).toEqual([2, 0.8]);
  });

  it("resolves identical concurrent queries FIFO", async () => {
    const c = new Correlator();
    const a = c.registerQuery("/x", [], 1000);
    const b = c.registerQuery("/x", [], 1000);
    c.handleIncoming("/x", [1]);
    c.handleIncoming("/x", [2]);
    expect(await a).toEqual([1]);
    expect(await b).toEqual([2]);
  });

  it("rejects a query on timeout", async () => {
    vi.useFakeTimers();
    const c = new Correlator();
    const p = c.registerQuery("/slow", [], 500);
    const assertion = expect(p).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(600);
    await assertion;
    vi.useRealTimers();
  });

  it("fans incoming to matching subscriptions until removed", () => {
    const c = new Correlator();
    const cb = vi.fn();
    c.addSubscription(sub({ subId: "s1", replyAddress: "/live/song/get/beat", cb }));
    c.handleIncoming("/live/song/get/beat", [1]);
    c.handleIncoming("/live/song/get/beat", [2]);
    c.removeSubscription("s1");
    c.handleIncoming("/live/song/get/beat", [3]);
    expect(cb.mock.calls).toEqual([[[1]], [[2]]]);
  });

  it("exposes active subscriptions for replay", () => {
    const c = new Correlator();
    c.addSubscription(sub({ subId: "s1", replyAddress: "/live/song/get/beat", startListenAddress: "/live/song/start_listen/beat", cb: () => {} }));
    expect(c.activeSubscriptions().map((s) => s.startListenAddress)).toEqual(["/live/song/start_listen/beat"]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test correlator`
Expected: FAIL — cannot find `../src/core/correlator`.

- [ ] **Step 3: Implement `src/core/correlator.ts`**

```ts
import type { OscArg } from "../transport";

export interface SubRecord {
  subId: string;
  startListenAddress: string;
  replyAddress: string;
  stopAddress: string;
  matchArgs: OscArg[];
  cb: (args: OscArg[]) => void;
}

interface Pending {
  address: string;
  matchArgs: OscArg[];
  resolve: (args: OscArg[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function prefixMatches(args: OscArg[], prefix: OscArg[]): boolean {
  return prefix.every((v, i) => args[i] === v);
}

/** Routes incoming OSC messages to waiting queries and active subscriptions. Pure (no IO). */
export class Correlator {
  private pending: Pending[] = [];
  private subs = new Map<string, SubRecord>();

  registerQuery(address: string, matchArgs: OscArg[], timeoutMs: number): Promise<OscArg[]> {
    return new Promise<OscArg[]>((resolve, reject) => {
      const entry: Pending = {
        address,
        matchArgs,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending = this.pending.filter((p) => p !== entry);
          reject(new Error(`query timeout: ${address}`));
        }, timeoutMs),
      };
      this.pending.push(entry);
    });
  }

  addSubscription(rec: SubRecord): void {
    this.subs.set(rec.subId, rec);
  }

  removeSubscription(subId: string): void {
    this.subs.delete(subId);
  }

  activeSubscriptions(): SubRecord[] {
    return [...this.subs.values()];
  }

  handleIncoming(address: string, args: OscArg[]): void {
    const idx = this.pending.findIndex((p) => p.address === address && prefixMatches(args, p.matchArgs));
    if (idx >= 0) {
      const [p] = this.pending.splice(idx, 1);
      clearTimeout(p.timer);
      p.resolve(args);
    }
    for (const s of this.subs.values()) {
      if (s.replyAddress === address && prefixMatches(args, s.matchArgs)) s.cb(args);
    }
  }

  rejectAll(err: Error): void {
    for (const p of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending = [];
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm --filter ableton-osc-bridge test correlator`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/packages/ableton-osc-bridge/src/core/correlator.ts app/packages/ableton-osc-bridge/test/correlator.test.ts
git commit -m "feat(bridge): pure reply-correlation logic (Correlator)"
```

---

### Task 3: Core `AbletonLive` (VerbProvider over an injected `OscIo`)

**Files:**
- Create: `app/packages/ableton-osc-bridge/src/core/osc.ts`
- Create: `app/packages/ableton-osc-bridge/src/node-osc.d.ts`
- Create: `app/packages/ableton-osc-bridge/src/core/live.ts`
- Test: `app/packages/ableton-osc-bridge/test/live.test.ts`

**Interfaces:**
- Consumes: `Correlator`, `SubRecord`; `OscArg`, `Subscription`, `VerbProvider`.
- Produces: `interface OscIo { send(address, args): void; onMessage(cb): void; close(): void }`; `createNodeOscIo(cfg: { host; sendPort; recvPort }): OscIo`; `class AbletonLive implements VerbProvider` with extra `dispose(): void`; `createAbletonLive(cfg?): AbletonLive`.

- [ ] **Step 1: Create the `node-osc` ambient types** — `src/node-osc.d.ts`

```ts
// node-osc ships no type declarations; this covers the surface we use.
declare module "node-osc" {
  export class Client {
    constructor(host: string, port: number);
    send(...args: Array<string | number | ((err?: Error) => void)>): void;
    close(): void;
  }
  export class Server {
    constructor(port: number, host?: string, cb?: () => void);
    on(event: "message", listener: (msg: [string, ...Array<string | number>], rinfo: unknown) => void): this;
    close(cb?: () => void): void;
  }
}
```

- [ ] **Step 2: Create `src/core/osc.ts`** (the only node-osc consumer)

```ts
import { Client, Server } from "node-osc";
import type { OscArg } from "../transport";

/** Minimal OSC IO seam — AbletonLive depends on this, not on node-osc directly (testable). */
export interface OscIo {
  send(address: string, args: OscArg[]): void;
  onMessage(cb: (address: string, args: OscArg[]) => void): void;
  close(): void;
}

export interface OscIoConfig {
  host: string;
  sendPort: number;
  recvPort: number;
}

/** Real OSC IO backed by node-osc: a Client to send (11000) + a Server to receive (11001). */
export function createNodeOscIo(cfg: OscIoConfig): OscIo {
  const client = new Client(cfg.host, cfg.sendPort);
  const server = new Server(cfg.recvPort, "0.0.0.0");
  let handler: ((address: string, args: OscArg[]) => void) | null = null;
  server.on("message", (msg) => {
    const [address, ...args] = msg;
    handler?.(address, args as OscArg[]);
  });
  return {
    send(address, args) {
      client.send(address, ...args, () => {});
    },
    onMessage(cb) {
      handler = cb;
    },
    close() {
      client.close();
      server.close();
    },
  };
}
```

- [ ] **Step 3: Write the failing test** — `test/live.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { AbletonLive } from "../src/core/live";
import type { OscIo } from "../src/core/osc";
import type { OscArg } from "../src/transport";

/** A controllable in-memory OscIo: records sends, lets the test inject incoming messages. */
function fakeIo() {
  const sent: Array<{ address: string; args: OscArg[] }> = [];
  let handler: ((address: string, args: OscArg[]) => void) = () => {};
  const io: OscIo = {
    send: (address, args) => sent.push({ address, args }),
    onMessage: (cb) => { handler = cb; },
    close: () => {},
  };
  return { io, sent, emit: (address: string, args: OscArg[]) => handler(address, args) };
}

describe("AbletonLive", () => {
  it("send() forwards to the io", () => {
    const { io, sent } = fakeIo();
    new AbletonLive(io).send("/live/song/start_playing");
    expect(sent).toEqual([{ address: "/live/song/start_playing", args: [] }]);
  });

  it("query() sends then resolves on the matching reply", async () => {
    const { io, sent, emit } = fakeIo();
    const live = new AbletonLive(io);
    const p = live.query("/live/track/get/volume", [2]);
    expect(sent).toEqual([{ address: "/live/track/get/volume", args: [2] }]);
    emit("/live/track/get/volume", [2, 0.8]);
    expect(await p).toEqual([2, 0.8]);
  });

  it("subscribe() sends start_listen and streams; unsubscribe sends stop_listen", () => {
    const { io, sent, emit } = fakeIo();
    const live = new AbletonLive(io);
    const cb = vi.fn();
    const subn = live.subscribe("/live/song/start_listen/beat", [], cb);
    emit("/live/song/get/beat", [1]);
    subn.unsubscribe();
    emit("/live/song/get/beat", [2]);
    expect(sent[0]).toEqual({ address: "/live/song/start_listen/beat", args: [] });
    expect(sent[1]).toEqual({ address: "/live/song/stop_listen/beat", args: [] });
    expect(cb.mock.calls).toEqual([[[1]]]);
  });

  it("replays active start_listens when /live/startup arrives", () => {
    const { io, sent, emit } = fakeIo();
    const live = new AbletonLive(io);
    live.subscribe("/live/song/start_listen/beat", [], () => {});
    emit("/live/startup", []);
    expect(sent.filter((s) => s.address === "/live/song/start_listen/beat")).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test live`
Expected: FAIL — cannot find `../src/core/live`.

- [ ] **Step 5: Implement `src/core/live.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { OscArg, Subscription, VerbProvider } from "../transport";
import { Correlator } from "./correlator";
import { createNodeOscIo, type OscIo } from "./osc";

export interface AbletonLiveConfig {
  host?: string;
  sendPort?: number;
  recvPort?: number;
  defaultTimeoutMs?: number;
}

export class AbletonLive implements VerbProvider {
  private correlator = new Correlator();
  private defaultTimeoutMs: number;

  constructor(private io: OscIo, opts: { defaultTimeoutMs?: number } = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 1000;
    this.io.onMessage((address, args) => this.handleIncoming(address, args));
  }

  send(address: string, args: OscArg[] = []): void {
    this.io.send(address, args);
  }

  query(address: string, args: OscArg[] = [], timeoutMs = this.defaultTimeoutMs): Promise<OscArg[]> {
    const p = this.correlator.registerQuery(address, args, timeoutMs);
    this.io.send(address, args);
    return p;
  }

  subscribe(startListenAddress: string, args: OscArg[], cb: (args: OscArg[]) => void): Subscription {
    const subId = randomUUID();
    const replyAddress = startListenAddress.replace("/start_listen/", "/get/");
    const stopAddress = startListenAddress.replace("/start_listen/", "/stop_listen/");
    this.correlator.addSubscription({ subId, startListenAddress, replyAddress, stopAddress, matchArgs: args, cb });
    this.io.send(startListenAddress, args);
    return {
      unsubscribe: () => {
        this.correlator.removeSubscription(subId);
        this.io.send(stopAddress, args);
      },
    };
  }

  dispose(): void {
    this.correlator.rejectAll(new Error("AbletonLive disposed"));
    this.io.close();
  }

  private handleIncoming(address: string, args: OscArg[]): void {
    if (address === "/live/startup") {
      for (const s of this.correlator.activeSubscriptions()) this.io.send(s.startListenAddress, s.matchArgs);
    }
    this.correlator.handleIncoming(address, args);
  }
}

/** Convenience factory wiring the real node-osc IO. */
export function createAbletonLive(cfg: AbletonLiveConfig = {}): AbletonLive {
  const io = createNodeOscIo({
    host: cfg.host ?? "127.0.0.1",
    sendPort: cfg.sendPort ?? 11000,
    recvPort: cfg.recvPort ?? 11001,
  });
  return new AbletonLive(io, { defaultTimeoutMs: cfg.defaultTimeoutMs });
}
```

- [ ] **Step 6: Run tests — verify pass**

Run: `pnpm --filter ableton-osc-bridge test live`
Expected: PASS (4 tests).

- [ ] **Step 7: Manual smoke (optional, requires Ableton + AbletonOSC running)**

Create a throwaway `app/packages/ableton-osc-bridge/smoke.ts`:

```ts
import { createAbletonLive } from "./src/core/live";
const live = createAbletonLive();
live.send("/live/test");
live.query("/live/song/get/tempo").then((a) => { console.log("tempo:", a); live.dispose(); });
```

Run: `pnpm --filter ableton-osc-bridge exec tsx smoke.ts`
Expected: prints `tempo: [ <bpm> ]`. Then delete `smoke.ts` (do not commit).

- [ ] **Step 8: Commit**

```bash
git add app/packages/ableton-osc-bridge/src/core/osc.ts app/packages/ableton-osc-bridge/src/node-osc.d.ts app/packages/ableton-osc-bridge/src/core/live.ts app/packages/ableton-osc-bridge/test/live.test.ts
git commit -m "feat(bridge): AbletonLive core (VerbProvider over node-osc) + startup resubscribe"
```

---

### Task 4: Daemon connection handler + `serve`

**Files:**
- Create: `app/packages/ableton-osc-bridge/src/daemon/daemon.ts`
- Create: `app/packages/ableton-osc-bridge/src/daemon/serve.ts`
- Create: `app/packages/ableton-osc-bridge/src/daemon/public/index.html` (placeholder; full page in Task 5)
- Modify: `app/packages/ableton-osc-bridge/src/index.ts` (export core + daemon)
- Test: `app/packages/ableton-osc-bridge/test/daemon.test.ts`

**Interfaces:**
- Consumes: `AbletonLive`/`VerbProvider`; `ServerMessage`, `parseClientMessage`.
- Produces: `interface Conn { send(msg: ServerMessage): void; onMessage(cb: (raw: string) => void): void; onClose(cb: () => void): void }`; `attachConnection(provider: VerbProvider, conn: Conn): void`; `serve(opts: { provider: VerbProvider; port: number; token?: string }): { port: number; close(): Promise<void> }`.

- [ ] **Step 1: Write the failing test** — `test/daemon.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { attachConnection, type Conn } from "../src/daemon/daemon";
import type { ServerMessage } from "../src/protocol";
import type { VerbProvider, Subscription } from "../src/transport";

function fakeConn() {
  const out: ServerMessage[] = [];
  let onMsg: (raw: string) => void = () => {};
  let onClose: () => void = () => {};
  const conn: Conn = {
    send: (m) => out.push(m),
    onMessage: (cb) => { onMsg = cb; },
    onClose: (cb) => { onClose = cb; },
  };
  return { conn, out, recv: (m: object) => onMsg(JSON.stringify(m)), close: () => onClose() };
}

function fakeProvider() {
  const calls: string[] = [];
  let lastSubCb: ((args: number[]) => void) | null = null;
  const provider: VerbProvider = {
    send: (a) => { calls.push(`send ${a}`); },
    query: async (a) => { calls.push(`query ${a}`); return [120]; },
    subscribe: (a, _args, cb): Subscription => {
      calls.push(`subscribe ${a}`);
      lastSubCb = cb as (args: number[]) => void;
      return { unsubscribe: () => calls.push("unsubscribe") };
    },
  };
  return { provider, calls, fire: (args: number[]) => lastSubCb?.(args) };
}

describe("attachConnection", () => {
  it("greets with hello", () => {
    const { conn, out } = fakeConn();
    attachConnection(fakeProvider().provider, conn);
    expect(out[0]).toEqual({ kind: "hello" });
  });

  it("answers a query with a reply carrying the same id", async () => {
    const { conn, out, recv } = fakeConn();
    attachConnection(fakeProvider().provider, conn);
    recv({ id: "q1", kind: "query", address: "/live/song/get/tempo", args: [] });
    await vi.waitFor(() => expect(out).toContainEqual({ kind: "reply", id: "q1", args: [120] }));
  });

  it("streams subscription updates as events, then stops after unsubscribe", () => {
    const { conn, out, recv } = fakeConn();
    const p = fakeProvider();
    attachConnection(p.provider, conn);
    recv({ id: "1", kind: "subscribe", subId: "s1", address: "/live/song/start_listen/beat", args: [] });
    p.fire([1]);
    recv({ id: "2", kind: "unsubscribe", subId: "s1" });
    p.fire([2]);
    expect(out).toContainEqual({ kind: "event", subId: "s1", address: "/live/song/start_listen/beat", args: [1] });
    expect(out).not.toContainEqual({ kind: "event", subId: "s1", address: "/live/song/start_listen/beat", args: [2] });
    expect(p.calls).toContain("unsubscribe");
  });

  it("cleans up subscriptions when the connection closes", () => {
    const { conn, recv, close } = fakeConn();
    const p = fakeProvider();
    attachConnection(p.provider, conn);
    recv({ id: "1", kind: "subscribe", subId: "s1", address: "/live/song/start_listen/beat", args: [] });
    close();
    expect(p.calls).toContain("unsubscribe");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test daemon`
Expected: FAIL — cannot find `../src/daemon/daemon`.

- [ ] **Step 3: Implement `src/daemon/daemon.ts`**

```ts
import type { VerbProvider, Subscription } from "../transport";
import { parseClientMessage, type ServerMessage } from "../protocol";

/** Transport-agnostic view of one bidirectional connection (a WS socket, in practice). */
export interface Conn {
  send(msg: ServerMessage): void;
  onMessage(cb: (raw: string) => void): void;
  onClose(cb: () => void): void;
}

/**
 * Wire one connection to the shared provider: translate the id-based wire protocol
 * to/from the provider's verbs. Subscriptions are per-connection and reaped on close.
 */
export function attachConnection(provider: VerbProvider, conn: Conn): void {
  const subs = new Map<string, Subscription>();
  conn.send({ kind: "hello" });

  conn.onMessage((raw) => {
    const msg = parseClientMessage(raw);
    if (!msg) {
      conn.send({ kind: "error", message: "malformed message" });
      return;
    }
    switch (msg.kind) {
      case "send":
        provider.send(msg.address, msg.args);
        break;
      case "query":
        provider
          .query(msg.address, msg.args, msg.timeoutMs)
          .then((args) => conn.send({ kind: "reply", id: msg.id, args }))
          .catch((err: Error) => conn.send({ kind: "error", id: msg.id, message: err.message }));
        break;
      case "subscribe": {
        const subscription = provider.subscribe(msg.address, msg.args, (args) =>
          conn.send({ kind: "event", subId: msg.subId, address: msg.address, args }),
        );
        subs.set(msg.subId, subscription);
        break;
      }
      case "unsubscribe": {
        subs.get(msg.subId)?.unsubscribe();
        subs.delete(msg.subId);
        break;
      }
    }
  });

  conn.onClose(() => {
    for (const s of subs.values()) s.unsubscribe();
    subs.clear();
  });
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm --filter ableton-osc-bridge test daemon`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement `src/daemon/serve.ts`** (http + ws; token auth; serves the playground)

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { VerbProvider } from "../transport";
import { attachConnection, type Conn } from "./daemon";

const here = dirname(fileURLToPath(import.meta.url));

export interface ServeOptions {
  provider: VerbProvider;
  port: number;
  token?: string;
}

export interface ServeHandle {
  port: number;
  close(): Promise<void>;
}

export function serve(opts: ServeOptions): ServeHandle {
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/" || req.url?.startsWith("/?")) {
      readFile(join(here, "public", "index.html")).then(
        (html) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); },
        () => { res.writeHead(404); res.end("playground not found"); },
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (opts.token) {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.searchParams.get("token") !== opts.token) {
        ws.close(1008, "unauthorized");
        return;
      }
    }
    const conn: Conn = {
      send: (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
      onMessage: (cb) => ws.on("message", (raw) => cb(raw.toString())),
      onClose: (cb) => ws.on("close", cb),
    };
    attachConnection(opts.provider, conn);
  });

  httpServer.listen(opts.port);
  return {
    port: opts.port,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close();
        httpServer.close(() => resolve());
      }),
  };
}
```

- [ ] **Step 6: Create placeholder `src/daemon/public/index.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>ableton-osc-bridge</title></head>
<body><p>Playground placeholder — replaced in Task 5.</p></body></html>
```

- [ ] **Step 7: Update `src/index.ts`** (main entry — node)

```ts
export * from "./transport";
export * from "./protocol";
export { AbletonLive, createAbletonLive, type AbletonLiveConfig } from "./core/live";
export { createNodeOscIo, type OscIo, type OscIoConfig } from "./core/osc";
export { serve, type ServeOptions, type ServeHandle } from "./daemon/serve";
export { attachConnection, type Conn } from "./daemon/daemon";
```

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm --filter ableton-osc-bridge test && pnpm --filter ableton-osc-bridge typecheck`
Expected: all PASS; 0 type errors.

- [ ] **Step 9: Commit**

```bash
git add app/packages/ableton-osc-bridge/src/daemon app/packages/ableton-osc-bridge/src/index.ts app/packages/ableton-osc-bridge/test/daemon.test.ts
git commit -m "feat(bridge): daemon connection handler + http/ws serve (token auth, serves playground)"
```

---

### Task 5: Browser playground

**Files:**
- Modify: `app/packages/ableton-osc-bridge/src/daemon/public/index.html` (full page)
- Test: extend `app/packages/ableton-osc-bridge/test/daemon.test.ts` (serve returns the page at `/`)

**Interfaces:**
- Consumes: the WS wire protocol (§7 of the spec) directly via the browser global `WebSocket` — no TS import (stays build-free).

- [ ] **Step 1: Write the failing test** (append to `test/daemon.test.ts`)

```ts
import { serve } from "../src/daemon/serve";
import type { VerbProvider } from "../src/transport";

const noopProvider: VerbProvider = {
  send: () => {},
  query: async () => [],
  subscribe: () => ({ unsubscribe: () => {} }),
};

describe("serve playground", () => {
  it("serves the playground HTML at /", async () => {
    const handle = serve({ provider: noopProvider, port: 8799 });
    const res = await fetch("http://127.0.0.1:8799/");
    const body = await res.text();
    await handle.close();
    expect(res.status).toBe(200);
    expect(body).toContain("ableton-osc-bridge");
    expect(body).toContain("Subscribe"); // a control from the full page
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test daemon`
Expected: FAIL — body lacks `"Subscribe"` (placeholder page).

- [ ] **Step 3: Replace `src/daemon/public/index.html`** with the full playground

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ableton-osc-bridge playground</title>
  <style>
    body { font: 14px/1.4 ui-monospace, monospace; margin: 0; background: #111; color: #ddd; }
    header { padding: 8px 12px; background: #1c1c1c; display: flex; gap: 12px; align-items: center; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #844; display: inline-block; }
    .dot.up { background: #4a4; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; }
    section { background: #181818; border: 1px solid #2a2a2a; border-radius: 6px; padding: 10px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #888; margin: 0 0 8px; }
    input, button { font: inherit; background: #222; color: #ddd; border: 1px solid #333; border-radius: 4px; padding: 4px 6px; }
    button { cursor: pointer; }
    #log { grid-column: 1 / 3; height: 240px; overflow: auto; white-space: pre-wrap; }
    .out { color: #6cf; } .in { color: #9d9; } .err { color: #f88; }
    .readout { font-size: 20px; }
  </style>
</head>
<body>
  <header>
    <span class="dot" id="conn"></span> <span id="connlabel">connecting…</span>
    <span class="dot" id="ableton"></span> <span>Ableton</span>
  </header>
  <main>
    <section>
      <h2>Send / Query</h2>
      <div><input id="addr" size="40" placeholder="/live/song/get/tempo" /></div>
      <div style="margin-top:6px"><input id="args" size="40" placeholder="args, comma-separated" /></div>
      <div style="margin-top:6px">
        <button id="send">Send</button>
        <button id="query">Query</button>
        <button id="ping">/live/test</button>
      </div>
    </section>
    <section>
      <h2>Subscribe</h2>
      <div><input id="sub" size="40" value="/live/song/start_listen/beat" /></div>
      <div style="margin-top:6px"><button id="subscribe">Subscribe</button></div>
      <div style="margin-top:10px">beat: <span class="readout" id="beat">–</span></div>
      <div>last event: <span id="lastevent">–</span></div>
    </section>
    <section id="log"></section>
  </main>
  <script>
    const log = (cls, msg) => {
      const el = document.getElementById("log");
      const line = document.createElement("div");
      line.className = cls; line.textContent = msg;
      el.appendChild(line); el.scrollTop = el.scrollHeight;
    };
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws" + (token ? "?token=" + encodeURIComponent(token) : "");
    let ws, nextId = 0;
    const newId = () => "p" + (++nextId);
    const parseArgs = (s) => s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => (isNaN(Number(x)) ? x : Number(x)));

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => { document.getElementById("conn").classList.add("up"); document.getElementById("connlabel").textContent = "connected"; };
      ws.onclose = () => { document.getElementById("conn").classList.remove("up"); document.getElementById("connlabel").textContent = "disconnected — retrying"; setTimeout(connect, 1000); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.kind === "reply") log("in", "reply " + JSON.stringify(m.args));
        else if (m.kind === "error") log("err", "error " + m.message);
        else if (m.kind === "status") document.getElementById("ableton").classList.toggle("up", m.ableton === "up");
        else if (m.kind === "event") {
          document.getElementById("lastevent").textContent = m.address + " " + JSON.stringify(m.args);
          if (m.address.endsWith("/get/beat")) document.getElementById("beat").textContent = m.args[m.args.length - 1];
          log("in", "event " + m.address + " " + JSON.stringify(m.args));
        }
      };
    }
    connect();

    const send = (msg) => { ws.send(JSON.stringify(msg)); log("out", msg.kind + " " + (msg.address || "")); };
    document.getElementById("send").onclick = () => send({ id: newId(), kind: "send", address: document.getElementById("addr").value, args: parseArgs(document.getElementById("args").value) });
    document.getElementById("query").onclick = () => send({ id: newId(), kind: "query", address: document.getElementById("addr").value, args: parseArgs(document.getElementById("args").value) });
    document.getElementById("ping").onclick = () => send({ id: newId(), kind: "send", address: "/live/test", args: [] });
    document.getElementById("subscribe").onclick = () => send({ id: newId(), kind: "subscribe", subId: "sub-" + newId(), address: document.getElementById("sub").value, args: [] });
  </script>
</body>
</html>
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm --filter ableton-osc-bridge test daemon`
Expected: PASS (serve playground test now finds `"Subscribe"`).

- [ ] **Step 5: Manual check (optional, with Ableton running)**

Run: `pnpm --filter ableton-osc-bridge serve` then open `http://127.0.0.1:8788`. Click **/live/test** (Live shows a message), **Subscribe** to `/live/song/start_listen/beat`, press Play in Live → beat readout ticks.

- [ ] **Step 6: Commit**

```bash
git add app/packages/ableton-osc-bridge/src/daemon/public/index.html app/packages/ableton-osc-bridge/test/daemon.test.ts
git commit -m "feat(bridge): self-contained browser playground (status, send/query, live subscribe)"
```

---

### Task 6: `AbletonBridgeClient` (VerbProvider over WS) + `/client` entry

**Files:**
- Create: `app/packages/ableton-osc-bridge/src/client/index.ts`
- Test: `app/packages/ableton-osc-bridge/test/client.test.ts`

**Interfaces:**
- Consumes: `VerbProvider`, `Subscription`, `OscArg`; `ClientMessage`, `ServerMessage`.
- Produces: `class AbletonBridgeClient implements VerbProvider` with `constructor(url: string, opts?: { token?: string; WebSocketImpl?: WebSocketCtor; autoReconnect?: boolean })`, plus `connect()`, `close()`, `onStatus(cb)`. Type `WebSocketCtor` (minimal structural WebSocket constructor). Browser-safe (no `node:*`).

- [ ] **Step 1: Write the failing test** — `test/client.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { AbletonBridgeClient } from "../src/client/index";

/** A fake WebSocket whose constructor signature matches the browser global. */
class FakeWS {
  static last: FakeWS;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];
  readyState = 1;
  constructor(public url: string) { FakeWS.last = this; queueMicrotask(() => this.onopen?.()); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  // helpers
  serverSend(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

function lastSent(): any { return JSON.parse(FakeWS.last.sent.at(-1)!); }

describe("AbletonBridgeClient", () => {
  it("query resolves on the reply with the matching id", async () => {
    const c = new AbletonBridgeClient("ws://x/ws", { WebSocketImpl: FakeWS as any });
    await c.connect();
    const p = c.query("/live/song/get/tempo", []);
    const sent = lastSent();
    expect(sent).toMatchObject({ kind: "query", address: "/live/song/get/tempo" });
    FakeWS.last.serverSend({ kind: "reply", id: sent.id, args: [120] });
    expect(await p).toEqual([120]);
  });

  it("subscribe streams events for its subId until unsubscribed", async () => {
    const c = new AbletonBridgeClient("ws://x/ws", { WebSocketImpl: FakeWS as any });
    await c.connect();
    const cb = vi.fn();
    const subn = c.subscribe("/live/song/start_listen/beat", [], cb);
    const subMsg = lastSent();
    FakeWS.last.serverSend({ kind: "event", subId: subMsg.subId, address: "/live/song/start_listen/beat", args: [1] });
    subn.unsubscribe();
    expect(lastSent()).toMatchObject({ kind: "unsubscribe", subId: subMsg.subId });
    expect(cb).toHaveBeenCalledWith([1]);
  });

  it("replays subscriptions after a reconnect", async () => {
    const c = new AbletonBridgeClient("ws://x/ws", { WebSocketImpl: FakeWS as any, autoReconnect: true });
    await c.connect();
    c.subscribe("/live/song/start_listen/beat", [], () => {});
    const before = FakeWS.last;
    before.close(); // triggers reconnect → new FakeWS
    await vi.waitFor(() => expect(FakeWS.last).not.toBe(before));
    await vi.waitFor(() =>
      expect(FakeWS.last.sent.map((s) => JSON.parse(s))).toContainEqual(
        expect.objectContaining({ kind: "subscribe", address: "/live/song/start_listen/beat" }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test client`
Expected: FAIL — cannot find `../src/client/index`.

- [ ] **Step 3: Implement `src/client/index.ts`** (browser-safe)

```ts
import type { OscArg, Subscription, VerbProvider } from "../transport";
import type { ServerMessage } from "../protocol";

/** Minimal structural WebSocket — matches both the browser global and `ws`. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
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

interface PendingQuery { resolve: (args: OscArg[]) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout>; }
interface ClientSub { subId: string; address: string; args: OscArg[]; cb: (args: OscArg[]) => void; }

function newId(): string {
  // Browser + Node 19+ both expose crypto.randomUUID on the global.
  return (globalThis.crypto as Crypto).randomUUID();
}

export class AbletonBridgeClient implements VerbProvider {
  private ws: WebSocketLike | null = null;
  private readonly Impl: WebSocketCtor;
  private readonly pending = new Map<string, PendingQuery>();
  private readonly subs = new Map<string, ClientSub>();
  private readonly defaultTimeoutMs: number;
  private readonly reconnectDelayMs: number;
  private statusCb: ((open: boolean) => void) | null = null;
  private closed = false;

  constructor(private url: string, private opts: ClientOptions = {}) {
    const Impl = opts.WebSocketImpl ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Impl) throw new Error("No WebSocket implementation: pass opts.WebSocketImpl (e.g. `ws` in Node).");
    this.Impl = Impl;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 1000;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 1000;
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve) => {
      const full = this.url + (this.opts.token ? (this.url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(this.opts.token) : "");
      const ws = new this.Impl(full);
      this.ws = ws;
      ws.onopen = () => {
        for (const s of this.subs.values()) this.raw({ kind: "subscribe", id: newId(), subId: s.subId, address: s.address, args: s.args });
        this.statusCb?.(true);
        resolve();
      };
      ws.onclose = () => {
        this.statusCb?.(false);
        if (this.opts.autoReconnect && !this.closed) setTimeout(() => this.connect(), this.reconnectDelayMs);
      };
      ws.onmessage = (ev) => this.onMessage(ev.data);
    });
  }

  onStatus(cb: (open: boolean) => void): void { this.statusCb = cb; }

  send(address: string, args: OscArg[] = []): void {
    this.raw({ kind: "send", id: newId(), address, args });
  }

  query(address: string, args: OscArg[] = [], timeoutMs = this.defaultTimeoutMs): Promise<OscArg[]> {
    const id = newId();
    return new Promise<OscArg[]>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`query timeout: ${address}`)); }, timeoutMs);
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

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private raw(msg: object): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(raw: string): void {
    let msg: ServerMessage;
    try { msg = JSON.parse(raw) as ServerMessage; } catch { return; }
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
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm --filter ableton-osc-bridge test client`
Expected: PASS (3 tests).

- [ ] **Step 5: Guard the browser-safety of `/client`** — add to `test/client.test.ts`

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("the /client entry imports nothing node-only", () => {
  const src = readFileSync(join(__dirname, "../src/client/index.ts"), "utf8");
  expect(src).not.toMatch(/from "node:/);
  expect(src).not.toMatch(/from "node-osc"/);
});
```

- [ ] **Step 6: Run tests + typecheck; commit**

Run: `pnpm --filter ableton-osc-bridge test && pnpm --filter ableton-osc-bridge typecheck`
Expected: all PASS.

```bash
git add app/packages/ableton-osc-bridge/src/client app/packages/ableton-osc-bridge/test/client.test.ts
git commit -m "feat(bridge): browser-safe AbletonBridgeClient (WS VerbProvider) + reconnect/resubscribe"
```

---

### Task 7: CLI — `serve`, `repl`, `test`

**Files:**
- Create: `app/packages/ableton-osc-bridge/src/cli.ts`
- Test: `app/packages/ableton-osc-bridge/test/cli.test.ts`

**Interfaces:**
- Consumes: `createAbletonLive`, `serve`, `AbletonBridgeClient`; `dialHome` (Task 8 — guarded behind the `BRIDGE_DIAL_URL` env so this task runs without it).
- Produces: `readConfig(env): { host; sendPort; recvPort; httpPort; token?; dialUrl?; queryTimeoutMs }`; `main(argv: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test** — `test/cli.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { readConfig } from "../src/cli";

describe("readConfig", () => {
  it("uses documented defaults", () => {
    const cfg = readConfig({});
    expect(cfg).toMatchObject({ host: "127.0.0.1", sendPort: 11000, recvPort: 11001, httpPort: 8788, queryTimeoutMs: 1000 });
    expect(cfg.token).toBeUndefined();
    expect(cfg.dialUrl).toBeUndefined();
  });

  it("reads overrides from env", () => {
    const cfg = readConfig({ ABLETON_OSC_HOST: "10.0.0.5", BRIDGE_HTTP_PORT: "9000", BRIDGE_TOKEN: "secret", BRIDGE_DIAL_URL: "wss://brain/agent" });
    expect(cfg).toMatchObject({ host: "10.0.0.5", httpPort: 9000, token: "secret", dialUrl: "wss://brain/agent" });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test cli`
Expected: FAIL — cannot find `../src/cli`.

- [ ] **Step 3: Implement `src/cli.ts`**

```ts
import { createInterface } from "node:readline";
import { WebSocket } from "ws";
import { createAbletonLive } from "./core/live";
import { serve } from "./daemon/serve";
import { AbletonBridgeClient, type WebSocketCtor } from "./client/index";

export interface BridgeConfig {
  host: string;
  sendPort: number;
  recvPort: number;
  httpPort: number;
  token?: string;
  dialUrl?: string;
  queryTimeoutMs: number;
}

export function readConfig(env: NodeJS.ProcessEnv): BridgeConfig {
  return {
    host: env.ABLETON_OSC_HOST ?? "127.0.0.1",
    sendPort: Number(env.ABLETON_OSC_SEND_PORT ?? 11000),
    recvPort: Number(env.ABLETON_OSC_RECV_PORT ?? 11001),
    httpPort: Number(env.BRIDGE_HTTP_PORT ?? 8788),
    token: env.BRIDGE_TOKEN || undefined,
    dialUrl: env.BRIDGE_DIAL_URL || undefined,
    queryTimeoutMs: Number(env.BRIDGE_QUERY_TIMEOUT_MS ?? 1000),
  };
}

async function runServe(cfg: BridgeConfig): Promise<void> {
  const live = createAbletonLive({ host: cfg.host, sendPort: cfg.sendPort, recvPort: cfg.recvPort, defaultTimeoutMs: cfg.queryTimeoutMs });
  const handle = serve({ provider: live, port: cfg.httpPort, token: cfg.token });
  console.log(`[bridge] serving playground + ws on http://127.0.0.1:${handle.port}  (Ableton ${cfg.host}:${cfg.sendPort}/${cfg.recvPort})`);
  if (cfg.dialUrl) {
    const { dialHome } = await import("./daemon/dial-home");
    dialHome({ provider: live, url: cfg.dialUrl, token: cfg.token });
    console.log(`[bridge] dialing home → ${cfg.dialUrl}`);
  }
}

function clientFor(cfg: BridgeConfig): AbletonBridgeClient {
  const url = `ws://127.0.0.1:${cfg.httpPort}/ws`;
  return new AbletonBridgeClient(url, { token: cfg.token, WebSocketImpl: WebSocket as unknown as WebSocketCtor, autoReconnect: true });
}

async function runRepl(cfg: BridgeConfig): Promise<void> {
  const client = clientFor(cfg);
  await client.connect();
  console.log("ableton-osc-bridge REPL. Type an address (query) or `send <addr> [args]`. Ctrl-D to exit.");
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: ">>> " });
  rl.prompt();
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (trimmed) {
      const parts = trimmed.split(/\s+/);
      const isSend = parts[0] === "send";
      const address = isSend ? parts[1] : parts[0];
      const args = (isSend ? parts.slice(2) : parts.slice(1)).map((x) => (isNaN(Number(x)) ? x : Number(x)));
      try {
        if (isSend) { client.send(address, args); console.log("(sent)"); }
        else console.log(JSON.stringify(await client.query(address, args)));
      } catch (err) { console.error("error:", (err as Error).message); }
    }
    rl.prompt();
  });
  rl.on("close", () => { client.close(); process.exit(0); });
}

async function runPing(cfg: BridgeConfig): Promise<void> {
  const client = clientFor(cfg);
  await client.connect();
  client.send("/live/test");
  try { console.log("tempo:", await client.query("/live/song/get/tempo")); }
  catch (err) { console.error("no reply (is the daemon serving and Ableton running?):", (err as Error).message); }
  client.close();
}

export async function main(argv: string[]): Promise<void> {
  const cfg = readConfig(process.env);
  const cmd = argv[2] ?? "serve";
  if (cmd === "serve") await runServe(cfg);
  else if (cmd === "repl") await runRepl(cfg);
  else if (cmd === "test") await runPing(cfg);
  else { console.error(`unknown command: ${cmd} (use: serve | repl | test)`); process.exit(1); }
}

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv);
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm --filter ableton-osc-bridge test cli`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/packages/ableton-osc-bridge/src/cli.ts app/packages/ableton-osc-bridge/test/cli.test.ts
git commit -m "feat(bridge): CLI — serve / repl / test (config from env)"
```

---

### Task 8: Dial-home (outbound reconnecting link to a remote controller)

**Files:**
- Create: `app/packages/ableton-osc-bridge/src/daemon/dial-home.ts`
- Test: `app/packages/ableton-osc-bridge/test/dial-home.test.ts`

**Interfaces:**
- Consumes: `VerbProvider`; `attachConnection`, `Conn`; `ws` `WebSocket`.
- Produces: `dialHome(opts: { provider: VerbProvider; url: string; token?: string; reconnectDelayMs?: number }): { close(): void }`.

Note: in dial-home, the daemon is the WS **client**; the remote controller is the WS **server**. Over that one socket the daemon *services* commands (same `attachConnection` logic), so the controller drives Ableton through it.

- [ ] **Step 1: Write the failing test** — `test/dial-home.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { WebSocketServer } from "ws";
import { dialHome } from "../src/daemon/dial-home";
import type { VerbProvider } from "../src/transport";

function fakeProvider() {
  const calls: string[] = [];
  const provider: VerbProvider = {
    send: (a) => calls.push(`send ${a}`),
    query: async () => [120],
    subscribe: () => ({ unsubscribe: () => {} }),
  };
  return { provider, calls };
}

describe("dialHome", () => {
  it("connects out and services a command from the controller", async () => {
    const wss = new WebSocketServer({ port: 8911 });
    const received: any[] = [];
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
      ws.send(JSON.stringify({ id: "c1", kind: "send", address: "/live/song/start_playing", args: [] }));
    });
    const p = fakeProvider();
    const handle = dialHome({ provider: p.provider, url: "ws://127.0.0.1:8911" });
    await vi.waitFor(() => expect(p.calls).toContain("send /live/song/start_playing"));
    handle.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("reconnects after the controller drops", async () => {
    let connections = 0;
    const wss = new WebSocketServer({ port: 8912 });
    wss.on("connection", (ws) => { connections++; if (connections === 1) ws.close(); });
    const handle = dialHome({ provider: fakeProvider().provider, url: "ws://127.0.0.1:8912", reconnectDelayMs: 20 });
    await vi.waitFor(() => expect(connections).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    handle.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter ableton-osc-bridge test dial-home`
Expected: FAIL — cannot find `../src/daemon/dial-home`.

- [ ] **Step 3: Implement `src/daemon/dial-home.ts`**

```ts
import { WebSocket } from "ws";
import type { VerbProvider } from "../transport";
import { attachConnection, type Conn } from "./daemon";

export interface DialHomeOptions {
  provider: VerbProvider;
  url: string;
  token?: string;
  reconnectDelayMs?: number;
}

export function dialHome(opts: DialHomeOptions): { close(): void } {
  const delay = opts.reconnectDelayMs ?? 1000;
  let closed = false;
  let current: WebSocket | null = null;

  const connect = (): void => {
    if (closed) return;
    const url = opts.url + (opts.token ? (opts.url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(opts.token) : "");
    const ws = new WebSocket(url);
    current = ws;
    ws.on("open", () => {
      const conn: Conn = {
        send: (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
        onMessage: (cb) => ws.on("message", (raw) => cb(raw.toString())),
        onClose: (cb) => ws.on("close", cb),
      };
      attachConnection(opts.provider, conn);
    });
    ws.on("close", () => { if (!closed) setTimeout(connect, delay); });
    ws.on("error", () => { /* close handler schedules the retry */ });
  };
  connect();

  return {
    close: () => { closed = true; current?.close(); },
  };
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm --filter ableton-osc-bridge test dial-home`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/packages/ableton-osc-bridge/src/daemon/dial-home.ts app/packages/ableton-osc-bridge/test/dial-home.test.ts
git commit -m "feat(bridge): dial-home outbound reconnecting link to a remote controller"
```

---

### Task 9: End-to-end integration (real node-osc mock Ableton + daemon + client)

**Files:**
- Create: `app/packages/ableton-osc-bridge/test/integration.test.ts`

**Interfaces:**
- Consumes: `createAbletonLive`/`AbletonLive`, `serve`, `AbletonBridgeClient`; a `node-osc` `Server` + `Client` to emulate AbletonOSC.

- [ ] **Step 1: Write the integration test** — `test/integration.test.ts`

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { Client, Server } from "node-osc";
import { WebSocket } from "ws";
import { AbletonLive } from "../src/core/live";
import { createNodeOscIo } from "../src/core/osc";
import { serve, type ServeHandle } from "../src/daemon/serve";
import { AbletonBridgeClient, type WebSocketCtor } from "../src/client/index";

/**
 * Mock Ableton: listens on 11020 (commands) and answers on 11021 (replies),
 * mirroring AbletonOSC's port split. Replies to /live/song/get/tempo with [120],
 * and to /live/song/start_listen/beat by emitting one /live/song/get/beat [1].
 */
function mockAbleton() {
  const replyTo = new Client("127.0.0.1", 11021);
  const server = new Server(11020, "0.0.0.0");
  server.on("message", (msg) => {
    const [address] = msg;
    if (address === "/live/song/get/tempo") replyTo.send("/live/song/get/tempo", 120, () => {});
    if (address === "/live/song/start_listen/beat") replyTo.send("/live/song/get/beat", 1, () => {});
  });
  return { close: () => { server.close(); replyTo.close(); } };
}

let ableton: { close(): void }, daemon: ServeHandle, client: AbletonBridgeClient;

afterEach(async () => {
  client?.close();
  await daemon?.close();
  ableton?.close();
});

describe("integration", () => {
  it("client → daemon → node-osc → mock Ableton: query + subscribe", async () => {
    ableton = mockAbleton();
    const io = createNodeOscIo({ host: "127.0.0.1", sendPort: 11020, recvPort: 11021 });
    const live = new AbletonLive(io);
    daemon = serve({ provider: live, port: 8920 });
    client = new AbletonBridgeClient("ws://127.0.0.1:8920/ws", { WebSocketImpl: WebSocket as unknown as WebSocketCtor });
    await client.connect();

    expect(await client.query("/live/song/get/tempo", [])).toEqual([120]);

    const beat = await new Promise<number[]>((resolve) => {
      client.subscribe("/live/song/start_listen/beat", [], (args) => resolve(args));
    });
    expect(beat).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run it — verify pass**

Run: `pnpm --filter ableton-osc-bridge test integration`
Expected: PASS. (If flaky on UDP timing, raise the query timeout via `client.query(addr, [], 2000)`.)

- [ ] **Step 3: Full suite + typecheck**

Run: `pnpm --filter ableton-osc-bridge test && pnpm --filter ableton-osc-bridge typecheck`
Expected: all PASS; 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add app/packages/ableton-osc-bridge/test/integration.test.ts
git commit -m "test(bridge): end-to-end integration (mock Ableton ↔ daemon ↔ client)"
```

---

### Task 10: README (generic-bridge sections) + CHANGELOG

**Files:**
- Create: `app/packages/ableton-osc-bridge/README.md`
- Modify: `docs/CHANGELOG.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Write `README.md`** covering: what it is (layer + topology diagrams from the spec §4/§6); install + `pnpm --filter ableton-osc-bridge serve`, open `http://127.0.0.1:8788`, click **/live/test**; the three verbs (`send`/`query`/`subscribe`) with examples; reuse recipes — browser (`import { AbletonBridgeClient } from "ableton-osc-bridge/client"`), same-machine (`import { createAbletonLive } from "ableton-osc-bridge"`), remote/cloud (run daemon with `BRIDGE_DIAL_URL` + `BRIDGE_TOKEN`; controller is the WS server); the env table (spec §12); the wire protocol (spec §7); a security note (token; never expose AbletonOSC UDP to the internet); a pointer to `docs/AbletonOSC-readme.md` for the full address space. Add a note: "the typed facade (`createLive`) is documented in Plan B."

- [ ] **Step 2: Add a CHANGELOG entry** (newest on top) to `docs/CHANGELOG.md`:

```markdown
## 2026-06-22 — Built ableton-osc-bridge foundation (generic bridge, Plan A)

- **What:** Implemented Plan A of the reusable bridge at `app/packages/ableton-osc-bridge`: the `VerbProvider` seam, the pure `Correlator`, the `AbletonLive` core (node-osc, startup-resubscribe), the daemon (`attachConnection` + `serve` with token auth + a self-contained browser playground), the browser-safe `AbletonBridgeClient` (reconnect/resubscribe), the CLI (`serve`/`repl`/`test`), `dial-home`, and an end-to-end integration test (mock Ableton ↔ daemon ↔ client). Generic `send`/`query`/`subscribe` over the whole AbletonOSC surface; cloud topology works (dial-home).
- **Why:** Jared wants a reusable, well-documented Ableton↔web-app bridge decoupled from CHANNELERS (spec `docs/superpowers/specs/2026-06-22-ableton-osc-bridge-design.md`). Plan B adds the comprehensive typed facade on the same seam.
- **Files/areas:** `app/packages/ableton-osc-bridge/**`. Branch `ableton-osc-bridge`.
- **Verification:** `pnpm --filter ableton-osc-bridge test` + `typecheck` green.
- **Docs touched:** this entry; package `README.md`.
```

- [ ] **Step 3: Commit**

```bash
git add app/packages/ableton-osc-bridge/README.md docs/CHANGELOG.md
git commit -m "docs(bridge): README (generic bridge + reuse recipes) + CHANGELOG"
```

---

## Self-Review (completed against the spec)

- **Spec coverage:** §4 layout (all files present across tasks), §5 `VerbProvider` seam (Task 1; facade itself is Plan B), §6 topology / dial-home (Task 8), §7 wire protocol (Task 1 + daemon Task 4 + client Task 6), §8 correlation + node-osc + startup-resubscribe (Tasks 2–3), §9 reconnect/auth (client Task 6, serve token Task 4, dial-home Task 8), §10 demo apps (REPL Task 7, playground Task 5), §12 env (Task 7 `readConfig`), §13 testing (each task + integration Task 9), §14 build order (task ordering matches). Facade (§5 codegen) and README facade section are intentionally **Plan B**.
- **Placeholder scan:** none — every step has full code or an exact command + expected output.
- **Type consistency:** `OscArg`, `VerbProvider`, `Subscription` (Task 1) used verbatim by `Correlator` (2), `AbletonLive`/`OscIo` (3), `attachConnection`/`Conn` (4), `AbletonBridgeClient`/`WebSocketCtor` (6), `dialHome` (8). `ServerMessage`/`ClientMessage`/`parseClientMessage` (Task 1) used by daemon (4) and client (6). `serve`/`ServeHandle` (4) used by CLI (7) and integration (9). `subId` is client-generated everywhere.
- **Note for the engineer:** the integration test (Task 9) uses ports 11020/11021 for the mock so it never collides with a real Ableton on 11000/11001; the daemon/serve tests use 879x/892x ports.
