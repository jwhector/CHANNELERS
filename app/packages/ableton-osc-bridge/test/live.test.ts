import { describe, it, expect, vi } from "vitest";
import { AbletonLive } from "../src/core/live";
import type { OscIo } from "../src/core/osc";
import type { OscArg } from "../src/transport";

/** A controllable in-memory OscIo: records sends, lets the test inject incoming messages. */
function fakeIo() {
  const sent: Array<{ address: string; args: OscArg[] }> = [];
  let handler: ((address: string, args: OscArg[]) => void) = () => {};
  const io: OscIo = {
    send: (address, args) => sent.push({ address, args }),
    onMessage: (cb) => { handler = cb; },
    close: () => {},
  };
  return { io, sent, emit: (address: string, args: OscArg[]) => handler(address, args) };
}

describe("AbletonLive", () => {
  it("send() forwards to the io", () => {
    const { io, sent } = fakeIo();
    new AbletonLive(io).send("/live/song/start_playing");
    expect(sent).toEqual([{ address: "/live/song/start_playing", args: [] }]);
  });

  it("query() sends then resolves on the matching reply", async () => {
    const { io, sent, emit } = fakeIo();
    const live = new AbletonLive(io);
    const p = live.query("/live/track/get/volume", [2]);
    expect(sent).toEqual([{ address: "/live/track/get/volume", args: [2] }]);
    emit("/live/track/get/volume", [2, 0.8]);
    expect(await p).toEqual([2, 0.8]);
  });

  it("subscribe() sends start_listen and streams; unsubscribe sends stop_listen", () => {
    const { io, sent, emit } = fakeIo();
    const live = new AbletonLive(io);
    const cb = vi.fn();
    const subn = live.subscribe("/live/song/start_listen/beat", [], cb);
    emit("/live/song/get/beat", [1]);
    subn.unsubscribe();
    emit("/live/song/get/beat", [2]);
    expect(sent[0]).toEqual({ address: "/live/song/start_listen/beat", args: [] });
    expect(sent[1]).toEqual({ address: "/live/song/stop_listen/beat", args: [] });
    expect(cb.mock.calls).toEqual([[[1]]]);
  });

  it("replays active start_listens when /live/startup arrives", () => {
    const { io, sent, emit } = fakeIo();
    const live = new AbletonLive(io);
    live.subscribe("/live/song/start_listen/beat", [], () => {});
    emit("/live/startup", []);
    expect(sent.filter((s) => s.address === "/live/song/start_listen/beat")).toHaveLength(2);
  });
});
