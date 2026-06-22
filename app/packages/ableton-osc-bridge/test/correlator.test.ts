import { describe, it, expect, vi } from "vitest";
import { Correlator, type SubRecord } from "../src/core/correlator";

function sub(partial: Partial<SubRecord> & Pick<SubRecord, "subId" | "replyAddress" | "cb">): SubRecord {
  return { startListenAddress: "", stopAddress: "", matchArgs: [], ...partial };
}

describe("Correlator", () => {
  it("resolves a query when a matching reply arrives", async () => {
    const c = new Correlator();
    const p = c.registerQuery("/live/song/get/tempo", [], 1000);
    c.handleIncoming("/live/song/get/tempo", [120]);
    expect(await p).toEqual([120]);
  });

  it("matches a parameterized query on its echoed id args", async () => {
    const c = new Correlator();
    const p = c.registerQuery("/live/track/get/volume", [2], 1000);
    c.handleIncoming("/live/track/get/volume", [5, 0.1]); // wrong track — ignored
    c.handleIncoming("/live/track/get/volume", [2, 0.8]); // right track
    expect(await p).toEqual([2, 0.8]);
  });

  it("resolves identical concurrent queries FIFO", async () => {
    const c = new Correlator();
    const a = c.registerQuery("/x", [], 1000);
    const b = c.registerQuery("/x", [], 1000);
    c.handleIncoming("/x", [1]);
    c.handleIncoming("/x", [2]);
    expect(await a).toEqual([1]);
    expect(await b).toEqual([2]);
  });

  it("rejects a query on timeout", async () => {
    vi.useFakeTimers();
    const c = new Correlator();
    const p = c.registerQuery("/slow", [], 500);
    const assertion = expect(p).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(600);
    await assertion;
    vi.useRealTimers();
  });

  it("fans incoming to matching subscriptions until removed", () => {
    const c = new Correlator();
    const cb = vi.fn();
    c.addSubscription(sub({ subId: "s1", replyAddress: "/live/song/get/beat", cb }));
    c.handleIncoming("/live/song/get/beat", [1]);
    c.handleIncoming("/live/song/get/beat", [2]);
    c.removeSubscription("s1");
    c.handleIncoming("/live/song/get/beat", [3]);
    expect(cb.mock.calls).toEqual([[[1]], [[2]]]);
  });

  it("exposes active subscriptions for replay", () => {
    const c = new Correlator();
    c.addSubscription(sub({ subId: "s1", replyAddress: "/live/song/get/beat", startListenAddress: "/live/song/start_listen/beat", cb: () => {} }));
    expect(c.activeSubscriptions().map((s) => s.startListenAddress)).toEqual(["/live/song/start_listen/beat"]);
  });
});
