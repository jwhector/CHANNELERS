import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AbletonBridgeClient } from "../src/client/index";

/** A fake WebSocket whose constructor signature matches the browser global. */
class FakeWS {
  static last: FakeWS;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];
  readyState = 1;
  constructor(public url: string) { FakeWS.last = this; queueMicrotask(() => this.onopen?.()); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  // helpers
  serverSend(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

function lastSent(): any { return JSON.parse(FakeWS.last.sent.at(-1)!); }

describe("AbletonBridgeClient", () => {
  it("query resolves on the reply with the matching id", async () => {
    const c = new AbletonBridgeClient("ws://x/ws", { WebSocketImpl: FakeWS as any });
    await c.connect();
    const p = c.query("/live/song/get/tempo", []);
    const sent = lastSent();
    expect(sent).toMatchObject({ kind: "query", address: "/live/song/get/tempo" });
    FakeWS.last.serverSend({ kind: "reply", id: sent.id, args: [120] });
    expect(await p).toEqual([120]);
  });

  it("subscribe streams events for its subId until unsubscribed", async () => {
    const c = new AbletonBridgeClient("ws://x/ws", { WebSocketImpl: FakeWS as any });
    await c.connect();
    const cb = vi.fn();
    const subn = c.subscribe("/live/song/start_listen/beat", [], cb);
    const subMsg = lastSent();
    FakeWS.last.serverSend({ kind: "event", subId: subMsg.subId, address: "/live/song/start_listen/beat", args: [1] });
    subn.unsubscribe();
    expect(lastSent()).toMatchObject({ kind: "unsubscribe", subId: subMsg.subId });
    expect(cb).toHaveBeenCalledWith([1]);
  });

  it("replays subscriptions after a reconnect", async () => {
    const c = new AbletonBridgeClient("ws://x/ws", { WebSocketImpl: FakeWS as any, autoReconnect: true });
    await c.connect();
    c.subscribe("/live/song/start_listen/beat", [], () => {});
    const before = FakeWS.last;
    before.close(); // triggers reconnect → new FakeWS
    await vi.waitFor(() => expect(FakeWS.last).not.toBe(before));
    await vi.waitFor(() =>
      expect(FakeWS.last.sent.map((s) => JSON.parse(s))).toContainEqual(
        expect.objectContaining({ kind: "subscribe", address: "/live/song/start_listen/beat" }),
      ),
    );
  });

  it("the /client entry imports nothing node-only", () => {
    const src = readFileSync(join(__dirname, "../src/client/index.ts"), "utf8");
    expect(src).not.toMatch(/from "node:/);
    expect(src).not.toMatch(/from "node-osc"/);
  });
});
