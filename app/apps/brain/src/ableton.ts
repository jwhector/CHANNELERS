import type { Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { createBridgeHost, type BridgeHost } from "ableton-osc-bridge/host";

let host: BridgeHost | null = null;

function tokenOk(reqUrl: string | undefined, token: string): boolean {
  const provided = new URL(reqUrl ?? "/", "http://localhost").searchParams.get("token") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Arm the /agent endpoint the venue daemon dials home to (Plan C). Optional + graceful:
 * no token → endpoint never created, Brain runs unchanged. Returns the host (or null).
 */
export function initAbleton(server: Server, token: string | undefined, path = "/agent"): BridgeHost | null {
  if (!token) return null;
  host = createBridgeHost();
  const wss = new WebSocketServer({
    server,
    path,
    verifyClient: (info: { req: { url?: string } }) => tokenOk(info.req.url, token),
  });
  wss.on("connection", (ws) => { host!.handleSocket(ws); });
  host.onStatus((c) => console.log(`[ableton] agent ${c ? "connected" : "disconnected"}`));
  console.log(`[ableton] /agent armed — daemon dials home here`);
  return host;
}

/** The typed Ableton facade, or null if the agent endpoint is off / no daemon connected yet. */
export function getLive() {
  return host?.live ?? null;
}

/** test-only reset */
export function __resetAbletonForTest(): void {
  host = null;
}
