import type { SurveyResponse } from "@channelers/shared";

/**
 * The choreographer translates each divination turn into a movement cue for live dancers.
 * Its system prompt is functional (an instructor to bodies), NOT a character — the clarity
 * rules below are the mirror of the oracle's ANTI_SLOP_INSTRUCTION (spec §8).
 */
const CLARITY_CORE =
  "Name concrete, performable actions — body part, direction, quality, timing. " +
  "Present tense, addressed to the dancers' bodies. " +
  "No abstract-only or metaphor-only directions, no questions, no explanations, no lists, no stage jargon. " +
  "Anyone reading it cold must be able to perform it immediately.";

/** Per-turn cue: a single short, followable movement. */
export const CHOREO_CLARITY_INSTRUCTION =
  "Output ONE movement cue of one or two short imperative sentences. " + CLARITY_CORE;

/** First pass: a short opening score of a few movement ideas. */
export const CHOREO_SCORE_INSTRUCTION =
  "Write a 2–4 line opening movement score, each line one performable movement idea. " + CLARITY_CORE;

function facts(survey: SurveyResponse): string {
  return [
    `Name: ${survey.name}`,
    ...Object.entries(survey.freeText).map(([k, v]) => `${k}: ${v}`),
    ...survey.phrases.map((p) => `${p.axis}: ${p.choice}`),
  ].join("\n");
}

/** f(intake, archetype) — generated at persona-set. Split system/user so the call can prompt-cache. */
export function buildChoreoFirstPassPrompt(
  survey: SurveyResponse,
  archetype: string,
): { system: string; user: string } {
  const system = [
    "You are a choreographer translating a person's absurdist DMV-intake into a short movement score for live dancers.",
    `The oracle they will meet is the "${archetype}" archetype — let it color the movement's quality.`,
    CHOREO_SCORE_INSTRUCTION,
    "Return only the score lines — no preamble.",
  ].join("\n\n");
  return { system, user: facts(survey) };
}

/** Stable per-session prefix for the live loop: persona-colored first pass + intake + clarity rules. */
export function buildChoreoSystemPrompt(
  survey: SurveyResponse,
  archetype: string,
  firstPass: string,
): string {
  return [
    `You are the choreographer for a live divination ritual. The visitor is meeting the "${archetype}" oracle.`,
    "Each turn you receive what the visitor said (and sometimes the oracle's reply); you answer with ONE movement cue for the dancers.",
    "",
    "Your opening movement score (the first pass, from their intake):",
    firstPass,
    "",
    "Their intake, for reference:",
    facts(survey),
    "",
    CHOREO_CLARITY_INSTRUCTION,
  ].join("\n");
}

/** The per-turn user message. Includes the oracle reply only when timing reacts to it. */
export function buildChoreoTurnPrompt(turn: { visitor: string; oracle?: string }): string {
  const lines = [`The visitor said: "${turn.visitor}"`];
  if (turn.oracle) lines.push(`The oracle replied: "${turn.oracle}"`);
  lines.push("Give the next movement cue.");
  return lines.join("\n");
}
