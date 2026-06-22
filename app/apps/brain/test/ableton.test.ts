import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { initAbleton, getLive, __resetAbletonForTest } from "../src/ableton";
import { createServer, type Server } from "node:http";
import { attachConnection } from "ableton-osc-bridge";
import type { VerbProvider } from "ableton-osc-bridge";

let server: Server;
afterEach(async () => { __resetAbletonForTest(); await new Promise<void>((r) => (server ? server.close(() => r()) : r())); });

function listen(s: Server, port: number): Promise<void> { return new Promise((r) => s.listen(port, "127.0.0.1", r)); }

describe("brain ableton wiring", () => {
  it("is off when no token is set", () => {
    server = createServer();
    expect(initAbleton(server, undefined)).toBeNull();
    expect(getLive()).toBeNull();
  });

  it("arms /agent and drives a daemon that dials in", async () => {
    server = createServer();
    const host = initAbleton(server, "tok", "/agent");
    expect(host).not.toBeNull();
    await listen(server, 8940);

    // Simulate the daemon: dial in with the token and service a fake Ableton.
    const calls: string[] = [];
    const provider: VerbProvider = { send: (a) => calls.push(a), query: async () => [120], subscribe: () => ({ unsubscribe: () => {} }) };
    const ws = new WebSocket("ws://127.0.0.1:8940/agent?token=tok");
    await new Promise<void>((r) => ws.on("open", r));
    attachConnection(provider, {
      send: (m) => ws.send(JSON.stringify(m)),
      onMessage: (cb) => ws.on("message", (raw) => cb(raw.toString())),
      onClose: (cb) => ws.on("close", cb),
    });

    await vi.waitFor(() => expect(host!.connected()).toBe(true));
    getLive()!.song.startPlaying();
    await vi.waitFor(() => expect(calls).toContain("/live/song/start_playing"));
    ws.close();
  });

  it("rejects a daemon with the wrong token", async () => {
    server = createServer();
    initAbleton(server, "tok", "/agent");
    await listen(server, 8941);
    const ws = new WebSocket("ws://127.0.0.1:8941/agent?token=wrong");
    const outcome = await new Promise<"open" | "rejected">((r) => { ws.on("open", () => r("open")); ws.on("error", () => r("rejected")); });
    expect(outcome).toBe("rejected");
  });
});
