import { describe, it, expect } from "vitest";
import {
  PRESETS,
  DEFAULT_TUNING,
  OracleTuning,
  resolveSampling,
  buildDriftDirective,
  mangleOutput,
  type OracleTuning as OracleTuningT,
} from "@channelers/shared";

/** Deep-clone the default and apply nested overrides for a test case. */
function tune(overrides: {
  sampling?: Partial<OracleTuningT["sampling"]>;
  effects?: Partial<OracleTuningT["effects"]>;
  pipeline?: Partial<OracleTuningT["pipeline"]>;
  scope?: Partial<OracleTuningT["scope"]>;
  effectsDriveSampling?: boolean;
  intensity?: OracleTuningT["intensity"];
}): OracleTuningT {
  const base = structuredClone(DEFAULT_TUNING);
  return {
    ...base,
    ...(overrides.intensity ? { intensity: overrides.intensity } : {}),
    ...(overrides.effectsDriveSampling !== undefined
      ? { effectsDriveSampling: overrides.effectsDriveSampling }
      : {}),
    sampling: { ...base.sampling, ...overrides.sampling },
    effects: { ...base.effects, ...overrides.effects },
    pipeline: { ...base.pipeline, ...overrides.pipeline },
    scope: { ...base.scope, ...overrides.scope },
  };
}

describe("PRESETS (verbatim from Ayahuasca_v1.3.js)", () => {
  it("surreal preset matches the module's numbers exactly", () => {
    const s = PRESETS.surreal;
    expect(s.sampling.temperature).toBe(1.55);
    expect(s.sampling.top_p).toBe(1.0);
    expect(s.sampling.presence_penalty).toBe(-0.45);
    expect(s.sampling.frequency_penalty).toBe(-0.15);
    expect(s.effects.creativityBoost).toBe(2.2);
    expect(s.effects.cognitionFlexibility).toBe(2.0);
    expect(s.effects.egoDissolution).toBe(true);
    expect(s.effects.hallucinationFactor).toBe(0.75);
    expect(s.semanticDrift).toBe(0.65);
    expect(s.hallucinationBudget).toBe(0.6);
  });

  it("light preset matches the module's numbers exactly", () => {
    const l = PRESETS.light;
    expect(l.sampling.temperature).toBe(0.8);
    expect(l.sampling.top_p).toBe(0.9);
    expect(l.effects.egoDissolution).toBe(false);
    expect(l.effects.hallucinationFactor).toBe(0.0);
  });
});

describe("DEFAULT_TUNING reproduces today's oracle behavior", () => {
  it("is a valid OracleTuning", () => {
    expect(OracleTuning.safeParse(DEFAULT_TUNING).success).toBe(true);
  });

  it("resolves to temperature 1, defaults elsewhere, 300 tokens", () => {
    const r = resolveSampling(DEFAULT_TUNING);
    expect(r).toEqual({
      temperature: 1,
      top_p: 1,
      presence_penalty: 0,
      frequency_penalty: 0,
      max_completion_tokens: 300,
    });
  });
});

describe("resolveSampling", () => {
  it("passes concrete sampling through untouched when effects don't drive it", () => {
    const t = tune({
      sampling: { temperature: 1.55, top_p: 1, presence_penalty: -0.45, frequency_penalty: -0.15 },
      effects: { creativityBoost: 2.2, egoDissolution: true },
      effectsDriveSampling: false,
    });
    const r = resolveSampling(t);
    expect(r.temperature).toBe(1.55);
    expect(r.top_p).toBe(1);
    expect(r.presence_penalty).toBe(-0.45);
  });

  it("nudges temp/top_p/presence when effectsDriveSampling is on (module getApiSettings math)", () => {
    const t = tune({
      sampling: { temperature: 1.0, top_p: 0.9, presence_penalty: 0.0 },
      effects: { creativityBoost: 1.8, egoDissolution: true },
      effectsDriveSampling: true,
    });
    const r = resolveSampling(t);
    expect(r.temperature).toBeCloseTo(1.2, 5); // 1.0 + (1.8-1)*0.25
    expect(r.top_p).toBeCloseTo(0.98, 5); // 0.9 + (1.8-1)*0.1
    expect(r.presence_penalty).toBe(-0.25); // min(0, -0.25)
  });

  it("clamps post-nudge values to OpenAI-valid ranges", () => {
    const t = tune({
      sampling: { temperature: 1.9, top_p: 1.0 },
      effects: { creativityBoost: 3.0 },
      effectsDriveSampling: true,
    });
    const r = resolveSampling(t);
    expect(r.temperature).toBe(2); // 1.9 + 2.0*0.25 = 2.4 → clamp 2.0
    expect(r.top_p).toBe(1); // 1.0 + 2.0*0.1 = 1.2 → clamp 1.0
  });
});

describe("OracleTuning schema guards the transport payload", () => {
  it("rejects a temperature above the API max", () => {
    const bad = tune({ sampling: { temperature: 2.5 } });
    expect(OracleTuning.safeParse(bad).success).toBe(false);
  });
});

describe("buildDriftDirective", () => {
  it("returns empty string when promptDrift is off", () => {
    expect(buildDriftDirective(DEFAULT_TUNING)).toBe("");
  });

  it("returns an ALTERED PERCEPTION block when promptDrift is on", () => {
    const t = tune({ pipeline: { promptDrift: true }, effects: { hallucinationFactor: 0 } });
    const block = buildDriftDirective(t);
    expect(block).toContain("ALTERED PERCEPTION");
    expect(block).not.toContain("visionary");
  });

  it("adds a visionary clause only when hallucinationFactor > 0", () => {
    const t = tune({ pipeline: { promptDrift: true }, effects: { hallucinationFactor: 0.4 } });
    expect(buildDriftDirective(t)).toContain("visionary");
  });
});

describe("mangleOutput", () => {
  const input = "the idea of the future signal in this network world";

  it("returns the text unchanged when outputMangle is off", () => {
    expect(mangleOutput(input, DEFAULT_TUNING, 1)).toBe(input);
  });

  it("transforms the text when outputMangle is on", () => {
    const t = tune({ pipeline: { outputMangle: true, tone: "explorer_dreamy", semanticDrift: 1 } });
    expect(mangleOutput(input, t, 1)).not.toBe(input);
  });

  it("is deterministic for the same (text, tuning, seed)", () => {
    const t = tune({ pipeline: { outputMangle: true, tone: "explorer_dreamy", semanticDrift: 1 } });
    expect(mangleOutput(input, t, 7)).toBe(mangleOutput(input, t, 7));
  });
});
