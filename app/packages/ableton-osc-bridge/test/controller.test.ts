import { describe, it, expect, vi } from "vitest";
import { ChannelController, type Channel } from "../src/controller";

function fakeChannel() {
  const sent: any[] = [];
  const channel: Channel = { send: (d) => sent.push(JSON.parse(d)) };
  return { channel, sent, last: () => sent.at(-1) };
}

describe("ChannelController", () => {
  it("send/query/subscribe are no-ops or reject until attached", async () => {
    const c = new ChannelController(50);
    expect(c.connected).toBe(false);
    c.send("/live/song/start_playing"); // dropped silently
    await expect(c.query("/live/song/get/tempo")).rejects.toThrow(/disconnected/);
  });

  it("query resolves on the matching reply once attached", async () => {
    const c = new ChannelController();
    const ch = fakeChannel();
    c.attach(ch.channel);
    const p = c.query("/live/song/get/tempo", []);
    const id = ch.last().id;
    c.handleMessage(JSON.stringify({ kind: "reply", id, args: [120] }));
    expect(await p).toEqual([120]);
  });

  it("subscribe streams events for its subId", () => {
    const c = new ChannelController();
    const ch = fakeChannel();
    c.attach(ch.channel);
    const cb = vi.fn();
    c.subscribe("/live/song/start_listen/beat", [], cb);
    const subId = ch.last().subId;
    c.handleMessage(JSON.stringify({ kind: "event", subId, address: "/live/song/start_listen/beat", args: [4] }));
    expect(cb).toHaveBeenCalledWith([4]);
  });

  it("detach rejects pending queries; reattach replays active subscriptions", async () => {
    const c = new ChannelController();
    const ch1 = fakeChannel();
    c.attach(ch1.channel);
    c.subscribe("/live/song/start_listen/beat", [], () => {});
    const p = c.query("/live/song/get/tempo", [], 1000);
    c.detach();
    await expect(p).rejects.toThrow(/disconnected/);
    const ch2 = fakeChannel();
    c.attach(ch2.channel);
    expect(ch2.sent.some((m) => m.kind === "subscribe" && m.address === "/live/song/start_listen/beat")).toBe(true);
  });
});
