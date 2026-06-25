import { describe, it, expect, beforeEach } from "vitest";
import { generateFirstPass, getChoreoConfig, setChoreoConfig, isMimicTurn, streamCue } from "../src/choreo";
import { DEFAULT_CHOREO_CONFIG } from "@channelers/shared";
import { store } from "../src/store";

const NUM = () => Math.floor(Math.random() * 1e9);

describe("choreo first-pass (offline stub)", () => {
  it("produces a non-empty deterministic score from intake + archetype", async () => {
    const v = store.register(NUM());
    store.upsertSurvey(v.id, { name: "Jo", freeText: { lost: "my keys" }, phrases: [] });
    store.setArchetype(v.id, "tree");
    const a = await generateFirstPass(store.get(v.id)!);
    const b = await generateFirstPass(store.get(v.id)!);
    expect(a.score.length).toBeGreaterThan(0);
    expect(a.score).toBe(b.score); // deterministic offline
  });
});

describe("choreo live config", () => {
  beforeEach(() => setChoreoConfig({ ...DEFAULT_CHOREO_CONFIG }));
  it("round-trips the full config", () => {
    expect(getChoreoConfig().reactToOracle).toBe(true);
    const next = setChoreoConfig({ ...DEFAULT_CHOREO_CONFIG, reactToOracle: false });
    expect(next.reactToOracle).toBe(false);
    expect(getChoreoConfig().reactToOracle).toBe(false);
  });
});

describe("isMimicTurn", () => {
  it("is false when both triggers are off", () => {
    expect(isMimicTurn(DEFAULT_CHOREO_CONFIG, 3)).toBe(false);
  });
  it("manual override makes every turn a mimic turn", () => {
    const c = { ...DEFAULT_CHOREO_CONFIG, mimicManual: true };
    expect(isMimicTurn(c, 1)).toBe(true);
    expect(isMimicTurn(c, 2)).toBe(true);
  });
  it("cadence fires only on multiples of N", () => {
    const c = { ...DEFAULT_CHOREO_CONFIG, mimicCadenceEnabled: true, mimicEveryNTurns: 3 };
    expect(isMimicTurn(c, 1)).toBe(false);
    expect(isMimicTurn(c, 2)).toBe(false);
    expect(isMimicTurn(c, 3)).toBe(true);
    expect(isMimicTurn(c, 6)).toBe(true);
  });
});

describe("choreo live cue (offline stub)", () => {
  it("streams a deterministic fallback cue and returns the full text", async () => {
    let streamed = "";
    const full = await streamCue(
      { systemPrompt: "sys", history: [], visitor: "where do I go", oracle: "nowhere" },
      (chunk) => { streamed += chunk; },
    );
    expect(full.length).toBeGreaterThan(0);
    expect(streamed).toBe(full); // every chunk was emitted
  });
});
