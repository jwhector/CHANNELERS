import { describe, it, expect } from "vitest";
import { ClientMessage, ServerMessage, parseClientMessage } from "../src/protocol";

describe("protocol", () => {
  it("accepts a valid query message", () => {
    const msg = { id: "1", kind: "query", address: "/live/song/get/tempo", args: [] };
    expect(ClientMessage.parse(msg)).toEqual(msg);
  });

  it("defaults args to [] when omitted on send", () => {
    const parsed = ClientMessage.parse({ id: "1", kind: "send", address: "/live/song/start_playing" });
    expect(parsed).toMatchObject({ kind: "send", args: [] });
  });

  it("round-trips a subscribe with client-generated subId", () => {
    const msg = { id: "1", kind: "subscribe", subId: "s1", address: "/live/song/start_listen/beat", args: [] };
    expect(ClientMessage.parse(msg)).toEqual(msg);
  });

  it("validates server reply/event/error/status/hello", () => {
    expect(ServerMessage.parse({ kind: "reply", id: "1", args: [120] })).toBeTruthy();
    expect(ServerMessage.parse({ kind: "event", subId: "s1", address: "/live/song/get/beat", args: [4] })).toBeTruthy();
    expect(ServerMessage.parse({ kind: "error", message: "boom" })).toBeTruthy();
    expect(ServerMessage.parse({ kind: "status", ableton: "up" })).toBeTruthy();
    expect(ServerMessage.parse({ kind: "hello" })).toBeTruthy();
  });

  it("parseClientMessage returns null on garbage", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ kind: "bogus" }))).toBeNull();
  });
});
