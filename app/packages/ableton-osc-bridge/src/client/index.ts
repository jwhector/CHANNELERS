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

export { createLive } from "../facade/index";
export * from "../facade/generated";
