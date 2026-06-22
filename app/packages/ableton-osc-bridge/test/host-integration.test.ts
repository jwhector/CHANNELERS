import { describe, it, expect, afterEach, vi } from "vitest";
import { Client, Server } from "node-osc";
import { WebSocketServer } from "ws";
import { createBridgeHost } from "../src/host";
import { dialHome } from "../src/daemon/dial-home";
import { AbletonLive } from "../src/core/live";
import { createNodeOscIo } from "../src/core/osc";

/** Mock Ableton on 11030/11031: answers tempo, emits one beat on listen. */
function mockAbleton() {
  const reply = new Client("127.0.0.1", 11031);
  const server = new Server(11030, "127.0.0.1");
  server.on("message", (msg) => {
    const [address] = msg;
    if (address === "/live/song/get/tempo") reply.send("/live/song/get/tempo", 120, () => {});
    if (address === "/live/song/start_listen/beat") reply.send("/live/song/get/beat", 7, () => {});
  });
  return { close: () => { server.close(); reply.close(); } };
}

let ableton: { close(): void };
let wss: WebSocketServer;
let daemon: { close(): void };

afterEach(async () => {
  daemon?.close();
  ableton?.close();
  await new Promise<void>((r) => (wss ? wss.close(() => r()) : r()));
});

describe("cloud loop: dialHome ↔ host ↔ mock Ableton", () => {
  it("the host drives Ableton via a daemon that dialed home", async () => {
    ableton = mockAbleton();
    const host = createBridgeHost();

    // The Brain: a ws server that hands each connection to the host.
    wss = new WebSocketServer({ port: 8930 });
    wss.on("connection", (ws) => host.handleSocket(ws));

    // The daemon: real dialHome() out to the Brain, servicing a real AbletonLive over node-osc.
    const io = createNodeOscIo({ host: "127.0.0.1", sendPort: 11030, recvPort: 11031 });
    const live = new AbletonLive(io);
    daemon = dialHome({ provider: live, url: "ws://127.0.0.1:8930" });

    await vi.waitFor(() => expect(host.connected()).toBe(true), { timeout: 2000 });

    expect(await host.live.song.tempo.get(undefined as any)).toBe(120);

    const beat = await new Promise<number>((resolve) => {
      host.live.song.beat.subscribe((n) => resolve(n));
    });
    expect(beat).toBe(7);
  });
});
