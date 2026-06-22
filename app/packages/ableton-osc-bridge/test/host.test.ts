import { describe, it, expect, vi } from "vitest";
import { createBridgeHost, type AgentSocket } from "../src/host";

/** A fake daemon socket (node-ws shaped): records sends, lets the test push messages/close. */
function fakeSocket() {
  const sent: any[] = [];
  let onMsg: (d: string) => void = () => {};
  let onClose: () => void = () => {};
  let closed = false;
  const ws: AgentSocket = {
    send: (d) => sent.push(JSON.parse(d)),
    on: (ev: any, cb: any) => { if (ev === "message") onMsg = cb; else if (ev === "close") onClose = cb; },
    close: () => { closed = true; onClose(); },
  };
  return { ws, sent, last: () => sent.at(-1), recv: (m: object) => onMsg(JSON.stringify(m)), drop: () => onClose(), isClosed: () => closed };
}

describe("createBridgeHost", () => {
  it("is disconnected until a socket is attached", () => {
    const host = createBridgeHost();
    expect(host.connected()).toBe(false);
  });

  it("routes facade calls over the attached socket and resolves queries", async () => {
    const host = createBridgeHost();
    const s = fakeSocket();
    host.handleSocket(s.ws);
    expect(host.connected()).toBe(true);
    host.live.song.startPlaying();
    expect(s.sent.some((m) => m.kind === "send" && m.address === "/live/song/start_playing")).toBe(true);
    const q = host.live.song.tempo.get();
    s.recv({ kind: "reply", id: s.last().id, args: [120] });
    expect(await q).toBe(120);
  });

  it("supersedes a prior socket (latest wins) and replays subscriptions on reattach", () => {
    const host = createBridgeHost();
    const a = fakeSocket();
    host.handleSocket(a.ws);
    host.live.song.beat.subscribe(() => {});
    const b = fakeSocket();
    host.handleSocket(b.ws);                    // new daemon connection
    expect(a.isClosed()).toBe(true);            // old one closed
    expect(b.sent.some((m) => m.kind === "subscribe" && m.address === "/live/song/start_listen/beat")).toBe(true);
  });

  it("reflects disconnect when the socket drops", () => {
    const host = createBridgeHost();
    const s = fakeSocket();
    host.handleSocket(s.ws);
    s.drop();
    expect(host.connected()).toBe(false);
  });
});
