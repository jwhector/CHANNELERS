import { describe, it, expect } from "vitest";
import { OBJECTS, ROOT } from "../src/manifest";

describe("manifest", () => {
  it("declares the core object kinds", () => {
    for (const k of ["song", "view", "application", "track", "clip", "clipSlot", "scene", "device", "deviceParameter"]) {
      expect(OBJECTS[k], k).toBeDefined();
    }
  });

  it("song is a singleton with tempo (get/set/listen) and a startPlaying method", () => {
    const song = OBJECTS.song;
    expect(song.singleton).toBe(true);
    expect(song.props.tempo).toMatchObject({ osc: "tempo", type: "number", get: true, set: true, listen: true });
    expect(song.methods?.startPlaying).toMatchObject({ osc: "start_playing" });
  });

  it("track carries a trackId and exposes clip/device/clipSlot children", () => {
    const track = OBJECTS.track;
    expect(track.idParams).toEqual([{ name: "trackId", tsType: "number | string" }]);
    expect(track.children?.map((c) => c.accessor).sort()).toEqual(["clip", "clipSlot", "device"]);
  });

  it("root exposes singletons + track/scene factories", () => {
    expect(ROOT.singletons.map((s) => s.accessor).sort()).toEqual(["application", "song", "view"]);
    expect(ROOT.factories.find((f) => f.accessor === "track")).toBeTruthy();
  });

  it("every prop has at least one of get/set/listen", () => {
    for (const [k, obj] of Object.entries(OBJECTS)) {
      for (const [p, spec] of Object.entries(obj.props)) {
        expect(spec.get || spec.set || spec.listen, `${k}.${p}`).toBeTruthy();
      }
    }
  });
});
