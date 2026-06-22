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
