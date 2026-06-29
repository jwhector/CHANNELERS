import { buildChoreoFirstPassPrompt, buildChoreoTurnPrompt } from "@channelers/oracles";
import type { ChoreoConfig, ChoreoScore, SurveyResponse } from "@channelers/shared";
import { config } from "./config";
import type { VisitorRecord } from "./store";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── live, in-memory config (flippable at /api/choreo/config, no restart) ──
let cfg: ChoreoConfig = { ...config.choreo };
export function getChoreoConfig(): ChoreoConfig {
  return cfg;
}
export function setChoreoConfig(next: ChoreoConfig): ChoreoConfig {
  cfg = next;
  return cfg;
}
/** Pure: is the oracle reply numbered `turnNumber` (1-based) a mimic turn? */
export function isMimicTurn(c: ChoreoConfig, turnNumber: number): boolean {
  return c.mimicManual || (c.mimicCadenceEnabled && turnNumber % c.mimicEveryNTurns === 0);
}

// ── deterministic offline content (mirrors transform.stubSeeds / divination.fallbackLine) ──
export function stubFirstPass(survey: SurveyResponse, archetype: string): ChoreoScore {
  const lost = survey.freeText.lost ?? "something nameless";
  return {
    score: [
      "Enter slowly, single file, as if waiting to be processed.",
      `Reach one hand toward "${lost}", then withdraw it.`,
      `Shape the whole body to the idea of a ${archetype}, and hold.`,
    ].join("\n"),
  };
}

export function fallbackCue(visitor: string, oracle?: string): string {
  const src = (oracle ?? visitor).split(/\s+/).slice(0, 4).join(" ") || "this moment";
  return `Step forward together, then freeze as if the words "${src}" just landed on your shoulders.`;
}

/** Stream a fixed line word-by-word (offline cadence), mirroring divination.streamWords. */
async function streamWords(line: string, onDelta: (chunk: string) => void): Promise<string> {
  let acc = "";
  for (const word of line.split(" ")) {
    const chunk = acc ? ` ${word}` : word;
    acc += chunk;
    onDelta(chunk);
    await delay(35);
  }
  return acc;
}

/** f(intake, archetype) → an NL movement score, generated at persona-set. Stub when no key/on error. */
export async function generateFirstPass(visitor: VisitorRecord): Promise<ChoreoScore> {
  const archetype = visitor.archetype ?? "child"; // single-persona show (was "tree")
  if (!visitor.survey) return { score: "" };
  if (!config.openaiApiKey) return stubFirstPass(visitor.survey, archetype);
  try {
    const { system, user } = buildChoreoFirstPassPrompt(visitor.survey, archetype);
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const completion = await client.chat.completions.create({
      model: config.choreoModel,
      max_completion_tokens: 256,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const score = completion.choices[0]?.message?.content?.trim();
    return score ? { score } : stubFirstPass(visitor.survey, archetype);
  } catch (err) {
    console.warn("[choreo] first-pass fell back to stub:", err);
    return stubFirstPass(visitor.survey, archetype);
  }
}

type ChoreoTurn = { role: "user" | "assistant"; content: string };

/** One per-turn cue. Streams via onDelta; falls back to a deterministic cue with no key/on error. */
export async function streamCue(
  ctx: { systemPrompt: string; history: ChoreoTurn[]; visitor: string; oracle?: string },
  onDelta: (chunk: string) => void,
): Promise<string> {
  const userMsg = buildChoreoTurnPrompt({ visitor: ctx.visitor, oracle: ctx.oracle });
  if (!config.openaiApiKey) {
    return streamWords(fallbackCue(ctx.visitor, ctx.oracle), onDelta);
  }
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const stream = await client.chat.completions.create({
      model: config.choreoModel,
      stream: true,
      messages: [
        { role: "system", content: ctx.systemPrompt },
        ...ctx.history.map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: userMsg },
      ],
    });
    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
    return full || fallbackCue(ctx.visitor, ctx.oracle);
  } catch (err) {
    console.warn("[choreo] live cue fell back to stub:", err);
    return streamWords(fallbackCue(ctx.visitor, ctx.oracle), onDelta);
  }
}

export type { ChoreoTurn };
// Re-exported so the live loop (divination.ts) can rebuild the turn prompt for choreoHistory.
export { buildChoreoTurnPrompt };
