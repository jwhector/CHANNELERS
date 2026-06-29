import { z } from "zod";

/**
 * Altered-State Console — the live oracle generation control surface.
 *
 * Derived from the PHARMAICY "Ayahuasca" module (app/Ayahuasca_v1.3.js). We keep the genuinely
 * real part — the preset → sampling-param map and the effects → sampling nudge — and port the
 * text-styling utilities for the opt-in theatrical pipeline. The multi-variant Explore/Curate/
 * Converge pipeline is intentionally NOT ported: there's no place for deduped variants in a
 * single live oracle turn.
 *
 * One `OracleTuning` is the single source of truth, shared by the brain (applies it) and the
 * stage `/channel` console (edits it). See docs/superpowers/specs/2026-06-21-altered-state-console.md.
 */

export const Intensity = z.enum([
  "baseline",
  "light",
  "moderate",
  "deep",
  "beyond",
  "surreal",
  "custom",
]);
export type Intensity = z.infer<typeof Intensity>;

/** Raw OpenAI sampling knobs, bounded to the API's hard-valid ranges. */
export const OracleSampling = z.object({
  temperature: z.number().min(0).max(2),
  top_p: z.number().min(0).max(1),
  presence_penalty: z.number().min(-2).max(2),
  frequency_penalty: z.number().min(-2).max(2),
  max_completion_tokens: z.number().int().min(16).max(2000),
});
export type OracleSampling = z.infer<typeof OracleSampling>;

/** The module's "effects" vocabulary. Decorative unless `effectsDriveSampling` is on. */
export const OracleEffects = z.object({
  creativityBoost: z.number().min(0).max(5),
  cognitionFlexibility: z.number().min(0).max(5),
  memoryBlend: z.number().min(0).max(5),
  driftIntensity: z.number().min(0).max(5),
  hallucinationFactor: z.number().min(0).max(1),
  egoDissolution: z.boolean(),
  decenteringScore: z.number().min(0).max(5),
});
export type OracleEffects = z.infer<typeof OracleEffects>;

export const OracleTone = z.enum(["none", "explorer_dreamy"]);
export type OracleTone = z.infer<typeof OracleTone>;

/** The opt-in theatrical text pipeline. Both transforms default OFF. */
export const OraclePipeline = z.object({
  /** Inject an [ALTERED PERCEPTION] directive into the system prompt (LLM-native). */
  promptDrift: z.boolean(),
  /** Run the finished reply through the regex text-manglers (destructive). */
  outputMangle: z.boolean(),
  tone: OracleTone,
  semanticDrift: z.number().min(0).max(1),
  hallucinationBudget: z.number().min(0).max(1),
  microDrift: z.boolean(),
});
export type OraclePipeline = z.infer<typeof OraclePipeline>;

export const OracleScope = z.object({
  applyToOracle: z.boolean(),
  applyToTransform: z.boolean(),
});
export type OracleScope = z.infer<typeof OracleScope>;

export const OracleTuning = z.object({
  intensity: Intensity,
  sampling: OracleSampling,
  effects: OracleEffects,
  /** When true, port the module's getApiSettings() math so effects nudge sampling. */
  effectsDriveSampling: z.boolean(),
  pipeline: OraclePipeline,
  scope: OracleScope,
});
export type OracleTuning = z.infer<typeof OracleTuning>;

/** What a preset loads into the editable fields. */
export type Preset = {
  sampling: OracleSampling;
  effects: OracleEffects;
  semanticDrift: number;
  hallucinationBudget: number;
};

export type PresetName = Exclude<Intensity, "baseline" | "custom">;

const TOKENS = 100; // module has no max-tokens; seed every preset with today's oracle value
const HBUDGET = 0.6; // module default hallucinationBudget

/** Verbatim values from app/Ayahuasca_v1.3.js (PRESETS). */
export const PRESETS: Record<PresetName, Preset> = {
  light: {
    sampling: { temperature: 0.8, top_p: 0.9, presence_penalty: 0.0, frequency_penalty: 0.0, max_completion_tokens: TOKENS },
    effects: { creativityBoost: 1.2, cognitionFlexibility: 1.15, memoryBlend: 1.1, driftIntensity: 1.05, hallucinationFactor: 0.0, egoDissolution: false, decenteringScore: 0.8 },
    semanticDrift: 0.5,
    hallucinationBudget: HBUDGET,
  },
  moderate: {
    sampling: { temperature: 0.95, top_p: 0.95, presence_penalty: -0.1, frequency_penalty: 0.0, max_completion_tokens: TOKENS },
    effects: { creativityBoost: 1.5, cognitionFlexibility: 1.35, memoryBlend: 1.2, driftIntensity: 1.15, hallucinationFactor: 0.2, egoDissolution: true, decenteringScore: 0.9 },
    semanticDrift: 0.5,
    hallucinationBudget: HBUDGET,
  },
  deep: {
    sampling: { temperature: 1.15, top_p: 0.98, presence_penalty: -0.2, frequency_penalty: -0.05, max_completion_tokens: TOKENS },
    effects: { creativityBoost: 1.8, cognitionFlexibility: 1.6, memoryBlend: 1.35, driftIntensity: 1.25, hallucinationFactor: 0.4, egoDissolution: true, decenteringScore: 1.0 },
    semanticDrift: 0.6,
    hallucinationBudget: HBUDGET,
  },
  beyond: {
    sampling: { temperature: 1.35, top_p: 1.0, presence_penalty: -0.35, frequency_penalty: -0.1, max_completion_tokens: TOKENS },
    effects: { creativityBoost: 2.0, cognitionFlexibility: 1.8, memoryBlend: 1.5, driftIntensity: 1.35, hallucinationFactor: 0.6, egoDissolution: true, decenteringScore: 1.1 },
    semanticDrift: 0.65,
    hallucinationBudget: HBUDGET,
  },
  surreal: {
    sampling: { temperature: 1.55, top_p: 1.0, presence_penalty: -0.45, frequency_penalty: -0.15, max_completion_tokens: TOKENS },
    effects: { creativityBoost: 2.2, cognitionFlexibility: 2.0, memoryBlend: 1.7, driftIntensity: 1.45, hallucinationFactor: 0.75, egoDissolution: true, decenteringScore: 1.2 },
    semanticDrift: 0.65,
    hallucinationBudget: HBUDGET,
  },
};

/** Reproduces today's oracle behavior exactly: temperature 1, defaults elsewhere, pipeline off. */
export const DEFAULT_TUNING: OracleTuning = {
  intensity: "baseline",
  sampling: { temperature: 1, top_p: 1, presence_penalty: 0, frequency_penalty: 0, max_completion_tokens: TOKENS },
  effects: { creativityBoost: 1, cognitionFlexibility: 1, memoryBlend: 1, driftIntensity: 1, hallucinationFactor: 0, egoDissolution: false, decenteringScore: 1 },
  effectsDriveSampling: false,
  pipeline: { promptDrift: false, outputMangle: false, tone: "none", semanticDrift: 0.5, hallucinationBudget: HBUDGET, microDrift: false },
  scope: { applyToOracle: true, applyToTransform: false },
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * The concrete API params for one call. The editable sliders already hold the numbers (presets
 * seed them), so this mostly passes through — it only layers the effects→sampling nudge when
 * enabled, then clamps to valid ranges so the API never rejects the request.
 */
export function resolveSampling(t: OracleTuning): OracleSampling {
  let { temperature, top_p, presence_penalty } = t.sampling;
  const { frequency_penalty, max_completion_tokens } = t.sampling;

  if (t.effectsDriveSampling) {
    temperature += (t.effects.creativityBoost - 1) * 0.25;
    top_p += (t.effects.creativityBoost - 1) * 0.1;
    if (t.effects.egoDissolution) presence_penalty = Math.min(presence_penalty, -0.25);
  }

  return {
    temperature: clamp(temperature, 0, 2),
    top_p: clamp(top_p, 0, 1),
    presence_penalty: clamp(presence_penalty, -2, 2),
    frequency_penalty: clamp(frequency_penalty, -2, 2),
    max_completion_tokens,
  };
}

/**
 * A prompt-level "altered perception" block appended to the persona system prompt. Self-gates:
 * returns "" unless pipeline.promptDrift is on. LLM-native (asks the model to drift) rather than
 * mangling its output.
 */
export function buildDriftDirective(t: OracleTuning): string {
  if (!t.pipeline.promptDrift) return "";
  const drift = t.pipeline.semanticDrift.toFixed(2);
  const decenter = t.effects.decenteringScore.toFixed(2);
  const lines = [
    "[ALTERED PERCEPTION]",
    `Your cognition is loosening (drift=${drift}, decentering=${decenter}). Let associations wander and follow tangents. Speak in fragmented, sensory, dream-logic images and let meaning blur at the edges.`,
  ];
  if (t.effects.hallucinationFactor > 0) {
    lines.push("Permit brief visionary non-sequiturs — small impossible images that feel true.");
  }
  lines.push("Stay inside your persona's voice; do not narrate this state.");
  return "\n\n" + lines.join("\n");
}

/* ── Text-mangling utilities, ported near-verbatim from Ayahuasca_v1.3.js ──────────────── */

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickOne<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}
function insertOccasionally(text: string, fn: () => string, chance: number, rand: () => number): string {
  if (rand() > chance) return text;
  const idx = Math.floor(rand() * Math.max(1, text.length - 1));
  return text.slice(0, idx) + fn() + text.slice(idx);
}
function sensoryPaint(text: string, strength: number, rand: () => number): string {
  if (strength <= 0) return text;
  const adj = ["luminous", "velvet", "sonic", "crystalline", "electric", "warm", "cool", "fragrant", "granular", "silken"];
  return text.replace(/\b(idea|future|signal|network|world|path|vision)\b/gi, (m) =>
    rand() > strength ? m : `${pickOne(adj, rand)} ${m}`,
  );
}
function metaphorize(text: string, strength: number, rand: () => number): string {
  if (strength <= 0) return text;
  const lib = ["constellation", "oracle", "atlas", "horizon", "odyssey", "heartbeat", "echo", "glow"];
  return text.replace(/\b(future|network|signal|now|connect|time)\b/gi, (m) =>
    rand() > strength ? m : `${m}-${pickOne(lib, rand)}`,
  );
}
function explorerDreamy(text: string, halluc: number, micro: boolean, rand: () => number): string {
  let t = text;
  t = t.replace(/\b(idea|vision|path|signal|network|future|now|world)\b/gi, (m) =>
    pickOne(["luminous", "velvet", "sonic", "crystalline", "amber", "silken"], rand) + " " + m,
  );
  if (micro) {
    t = insertOccasionally(
      t,
      () => pickOne(["…and what if we step sideways for a moment? ", "(a small detour—curiosity often finds doors), ", "—briefly, let's peer behind the obvious— "], rand),
      0.12 + halluc * 0.2,
      rand,
    );
  }
  t = insertOccasionally(
    t,
    () => pickOne(["What if the map is still being drawn? ", "Suppose the signal is also a compass. ", "Imagine the present as a doorway. "], rand),
    0.1 + halluc * 0.25,
    rand,
  );
  return t;
}

/**
 * Run a finished oracle reply through the theatrical text pipeline. Self-gates: returns the text
 * unchanged unless pipeline.outputMangle is on. Deterministic for a given (text, tuning, seed).
 * Strengths are wired to the tuning sliders so the operator controls how hard it fires.
 */
export function mangleOutput(text: string, t: OracleTuning, seed: number): string {
  if (!t.pipeline.outputMangle) return text;
  const rand = mulberry32(seed);
  const strength = t.pipeline.semanticDrift;
  let out = text;
  if (t.pipeline.tone === "explorer_dreamy") {
    out = explorerDreamy(out, t.pipeline.hallucinationBudget, t.pipeline.microDrift, rand);
  }
  out = sensoryPaint(out, strength, rand);
  out = metaphorize(out, strength * 0.75, rand);
  return out;
}
