import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { VerbProvider } from "../transport";
import { attachConnection, type Conn } from "./daemon";

const here = dirname(fileURLToPath(import.meta.url));
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface ServeOptions {
  provider: VerbProvider;
  port: number;
  /** Bind interface. Defaults to loopback; a non-loopback host requires a token. */
  host?: string;
  /** Shared bearer token. Required to bind a non-loopback host. */
  token?: string;
  /**
   * Browser Origins allowed to open the WS, in addition to loopback. Non-browser
   * clients (the REPL, dial-home, anything using `ws`) send no Origin and are always
   * allowed. Cross-site browser Origins are rejected (anti-CSWSH).
   */
  allowedOrigins?: string[];
}

export interface ServeHandle {
  port: number;
  close(): Promise<void>;
}

/** Constant-time string compare (rejects on length mismatch). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true; // non-browser client — no Origin header
  if (allowed.includes(origin)) return true;
  try {
    return LOOPBACK.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function tokenAllowed(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const provided = new URL(req.url ?? "/", "http://localhost").searchParams.get("token") ?? "";
  return safeEqual(provided, token);
}

export function serve(opts: ServeOptions): ServeHandle {
  const host = opts.host ?? "127.0.0.1";
  if (!LOOPBACK.has(host) && !opts.token) {
    throw new Error(
      `serve(): refusing to bind non-loopback host "${host}" without a token. ` +
        `Set a token (BRIDGE_TOKEN) or bind to 127.0.0.1.`,
    );
  }
  const allowedOrigins = opts.allowedOrigins ?? [];

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

  // Reject disallowed Origins and bad tokens at the upgrade, before the socket opens.
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) =>
      originAllowed(info.origin, allowedOrigins) && tokenAllowed(info.req, opts.token),
  });
  wss.on("connection", (ws: WebSocket) => {
    const conn: Conn = {
      send: (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
      onMessage: (cb) => ws.on("message", (raw) => cb(raw.toString())),
      onClose: (cb) => ws.on("close", cb),
    };
    attachConnection(opts.provider, conn);
  });

  httpServer.listen(opts.port, host);
  return {
    port: opts.port,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close();
        httpServer.close(() => resolve());
      }),
  };
}
