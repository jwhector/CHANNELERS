import { describe, it, expect, beforeEach } from "vitest";
import { generateFirstPass, getChoreoConfig, setChoreoConfig, streamCue } from "../src/choreo";
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

describe("choreo live config flag", () => {
  beforeEach(() => setChoreoConfig({ reactToOracle: true }));
  it("toggles reactToOracle", () => {
    expect(getChoreoConfig().reactToOracle).toBe(true);
    expect(setChoreoConfig({ reactToOracle: false }).reactToOracle).toBe(false);
    expect(getChoreoConfig().reactToOracle).toBe(false);
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
