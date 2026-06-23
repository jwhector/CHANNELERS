import { describe, it, expect } from "vitest";
import { ShowEvent, toOsc } from "@channelers/shared";

describe("paper.fed event", () => {
  it("parses as a ShowEvent", () => {
    const ev = { type: "paper.fed", text: "i confess nothing", fedAt: "2026-06-22T00:00:00.000Z" };
    expect(ShowEvent.safeParse(ev).success).toBe(true);
  });

  it("flattens to its OSC address + args", () => {
    const osc = toOsc({ type: "paper.fed", text: "hello", fedAt: "2026-06-22T00:00:00.000Z" });
    expect(osc.address).toBe("/channelers/paper/fed");
    expect(osc.args).toEqual(["hello", "2026-06-22T00:00:00.000Z"]);
  });
});
