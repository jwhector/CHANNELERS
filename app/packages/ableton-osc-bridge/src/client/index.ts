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
  // Structural cast (not the DOM `Crypto` type) keeps this entry lib-DOM-free.
  return (globalThis as { crypto: { randomUUID(): string } }).crypto.randomUUID();
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
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 250;
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

export { createLive } from "../facade/index";
export * from "../facade/generated";
