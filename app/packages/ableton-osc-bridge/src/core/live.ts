import { randomUUID } from "node:crypto";
import type { OscArg, Subscription, VerbProvider } from "../transport";
import { Correlator } from "./correlator";
import { createNodeOscIo, type OscIo } from "./osc";

export interface AbletonLiveConfig {
  host?: string;
  sendPort?: number;
  recvPort?: number;
  /** Interface the OSC reply Server binds to (default loopback). Set for a remote-Ableton setup. */
  recvHost?: string;
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
    recvHost: cfg.recvHost,
  });
  return new AbletonLive(io, { defaultTimeoutMs: cfg.defaultTimeoutMs });
}
