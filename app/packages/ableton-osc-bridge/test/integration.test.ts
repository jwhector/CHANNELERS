import { describe, it, expect, afterEach, vi } from "vitest";
import { Client, Server } from "node-osc";
import { WebSocket } from "ws";
import { AbletonLive } from "../src/core/live";
import { createNodeOscIo } from "../src/core/osc";
import { serve, type ServeHandle } from "../src/daemon/serve";
import { AbletonBridgeClient, type WebSocketCtor } from "../src/client/index";
import type { OscArg } from "../src/transport";

/**
 * Mock Ableton: listens on 11020 (commands) and answers on 11021 (replies),
 * mirroring AbletonOSC's port split. Replies to /live/song/get/tempo with [120],
 * and to /live/song/start_listen/beat by emitting one /live/song/get/beat [1].
 */
function mockAbleton() {
  const replyTo = new Client("127.0.0.1", 11021);
  const server = new Server(11020, "0.0.0.0");
  server.on("message", (msg) => {
    const [address] = msg;
    if (address === "/live/song/get/tempo") replyTo.send("/live/song/get/tempo", 120, () => {});
    if (address === "/live/song/start_listen/beat") replyTo.send("/live/song/get/beat", 1, () => {});
  });
  return { close: () => { server.close(); replyTo.close(); } };
}

let ableton: { close(): void }, daemon: ServeHandle, client: AbletonBridgeClient;

afterEach(async () => {
  client?.close();
  await daemon?.close();
  ableton?.close();
});

describe("integration", () => {
  it("client → daemon → node-osc → mock Ableton: query + subscribe", async () => {
    ableton = mockAbleton();
    const io = createNodeOscIo({ host: "127.0.0.1", sendPort: 11020, recvPort: 11021 });
    const live = new AbletonLive(io);
    daemon = serve({ provider: live, port: 8920 });
    client = new AbletonBridgeClient("ws://127.0.0.1:8920/ws", { WebSocketImpl: WebSocket as unknown as WebSocketCtor });
    await client.connect();

    expect(await client.query("/live/song/get/tempo", [])).toEqual([120]);

    const beat = await new Promise<OscArg[]>((resolve) => {
      client.subscribe("/live/song/start_listen/beat", [], (args) => resolve(args));
    });
    expect(beat).toEqual([1]);
  });
});
