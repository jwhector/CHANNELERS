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
