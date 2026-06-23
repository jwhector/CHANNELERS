import { describe, it, expect, vi } from "vitest";
import { WebSocketServer } from "ws";
import { dialHome } from "../src/daemon/dial-home";
import type { VerbProvider } from "../src/transport";

function fakeProvider() {
  const calls: string[] = [];
  const provider: VerbProvider = {
    send: (a) => calls.push(`send ${a}`),
    query: async () => [120],
    subscribe: () => ({ unsubscribe: () => {} }),
  };
  return { provider, calls };
}

describe("dialHome", () => {
  it("connects out and services a command from the controller", async () => {
    const wss = new WebSocketServer({ port: 8911 });
    const received: any[] = [];
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
      ws.send(JSON.stringify({ id: "c1", kind: "send", address: "/live/song/start_playing", args: [] }));
    });
    const p = fakeProvider();
    const handle = dialHome({ provider: p.provider, url: "ws://127.0.0.1:8911" });
    await vi.waitFor(() => expect(p.calls).toContain("send /live/song/start_playing"));
    handle.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("reconnects after the controller drops", async () => {
    let connections = 0;
    const wss = new WebSocketServer({ port: 8912 });
    wss.on("connection", (ws) => { connections++; if (connections === 1) ws.close(); });
    const handle = dialHome({ provider: fakeProvider().provider, url: "ws://127.0.0.1:8912", reconnectDelayMs: 20 });
    await vi.waitFor(() => expect(connections).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    handle.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });
});
