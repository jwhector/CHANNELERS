import { describe, it, expect, vi } from "vitest";
import { createLive } from "../src/facade/index";
import type { OscArg, VerbProvider, Subscription } from "../src/transport";

/** Records sends; lets a test answer queries and fire subscription events. */
function spyProvider(replies: Record<string, OscArg[]> = {}) {
  const sends: Array<{ address: string; args: OscArg[] }> = [];
  const queries: Array<{ address: string; args: OscArg[] }> = [];
  let lastSub: { address: string; args: OscArg[]; cb: (a: OscArg[]) => void } | null = null;
  const provider: VerbProvider = {
    send: (address, args = []) => sends.push({ address, args }),
    query: async (address, args = []) => { queries.push({ address, args }); return replies[address] ?? []; },
    subscribe: (address, args, cb): Subscription => { lastSub = { address, args, cb }; return { unsubscribe: () => sends.push({ address: address.replace("/start_listen/", "/stop_listen/"), args }) }; },
  };
  return { provider, sends, queries, fireSub: (a: OscArg[]) => lastSub?.cb(a), subAddr: () => lastSub?.address };
}

describe("facade", () => {
  it("method → send (no id)", () => {
    const s = spyProvider();
    createLive(s.provider).song.startPlaying();
    expect(s.sends).toContainEqual({ address: "/live/song/start_playing", args: [] });
  });

  it("no-id getter unwraps reply[0]", async () => {
    const s = spyProvider({ "/live/song/get/tempo": [120] });
    expect(await createLive(s.provider).song.tempo.get()).toBe(120);
    expect(s.queries).toContainEqual({ address: "/live/song/get/tempo", args: [] });
  });

  it("no-id setter sends the value", () => {
    const s = spyProvider();
    createLive(s.provider).song.tempo.set(128);
    expect(s.sends).toContainEqual({ address: "/live/song/set/tempo", args: [128] });
  });

  it("id'd getter sends the id and unwraps the value after it", async () => {
    const s = spyProvider({ "/live/track/get/volume": [2, 0.8] });
    expect(await createLive(s.provider).track(2).volume.get()).toBe(0.8);
    expect(s.queries).toContainEqual({ address: "/live/track/get/volume", args: [2] });
  });

  it("boolean prop coerces both directions", async () => {
    const s = spyProvider({ "/live/track/get/mute": [2, 1] });
    const track = createLive(s.provider).track(2);
    track.mute.set(true);
    expect(s.sends).toContainEqual({ address: "/live/track/set/mute", args: [2, 1] });
    expect(await track.mute.get()).toBe(true);
  });

  it("listen-only prop exposes subscribe and streams unwrapped values", () => {
    const s = spyProvider();
    const cb = vi.fn();
    createLive(s.provider).song.beat.subscribe(cb);
    expect(s.subAddr()).toBe("/live/song/start_listen/beat");
    s.fireSub([4]);
    expect(cb).toHaveBeenCalledWith(4);
  });

  it("nested method carries both ids", () => {
    const s = spyProvider();
    createLive(s.provider).track(0).clip(3).fire();
    expect(s.sends).toContainEqual({ address: "/live/clip/fire", args: [0, 3] });
  });

  it("device parameter value carries three ids", () => {
    const s = spyProvider();
    createLive(s.provider).track(1).device(0).parameter(5).value.set(0.5);
    expect(s.sends).toContainEqual({ address: "/live/device/set/parameter/value", args: [1, 0, 5, 0.5] });
  });

  it("master + return helpers pass string ids", () => {
    const s = spyProvider();
    const live = createLive(s.provider);
    live.master.mute.set(false);
    live.returnTrack("A").volume.set(0.3);
    expect(s.sends).toContainEqual({ address: "/live/track/set/mute", args: ["master", 0] });
    expect(s.sends).toContainEqual({ address: "/live/track/set/volume", args: ["A", 0.3] });
  });

  it("array getter slices the tail after the ids", async () => {
    const s = spyProvider({ "/live/device/get/parameters/name": [0, 0, "Attack", "Release"] });
    expect(await createLive(s.provider).track(0).device(0).parametersName.get()).toEqual(["Attack", "Release"]);
  });

  it("raw escape hatch passes through verbatim", () => {
    const s = spyProvider();
    createLive(s.provider).raw.send("/live/song/get/track_data", [0, 12, "track.name"]);
    expect(s.sends).toContainEqual({ address: "/live/song/get/track_data", args: [0, 12, "track.name"] });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

it("facade + generated import nothing node-only", () => {
  for (const f of ["../src/facade/index.ts", "../src/facade/generated.ts"]) {
    const src = readFileSync(join(__dirname, f), "utf8");
    expect(src, f).not.toMatch(/from "node:/);
    expect(src, f).not.toMatch(/from "node-osc"/);
  }
});
