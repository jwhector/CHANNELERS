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
