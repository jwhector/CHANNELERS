import { describe, expect, it } from "vitest";
import { clampRate, DEFAULT_PLAYBACK_RATE, RATE_MAX, RATE_MIN } from "./playbackRate";

describe("clampRate", () => {
  it("defaults the oracle to 0.7 (≈30% slower than the synth)", () => {
    expect(DEFAULT_PLAYBACK_RATE).toBe(0.7);
  });

  it("passes an in-range value straight through", () => {
    expect(clampRate(0.85)).toBe(0.85);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampRate(0.1)).toBe(RATE_MIN);
    expect(clampRate(9)).toBe(RATE_MAX);
  });

  it("falls back to the default for NaN / non-finite input (e.g. empty localStorage)", () => {
    expect(clampRate(Number.NaN)).toBe(DEFAULT_PLAYBACK_RATE);
    expect(clampRate(Number.POSITIVE_INFINITY)).toBe(RATE_MAX);
  });
});
