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
