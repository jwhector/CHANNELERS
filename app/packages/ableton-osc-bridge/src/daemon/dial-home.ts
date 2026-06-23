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
