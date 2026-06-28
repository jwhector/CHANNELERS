import type { VisitorProfile, SurveyResponse, OraclePersona } from "@channelers/shared";
import { PERSONAS, type Persona } from "./personas";
import { ANTI_SLOP_INSTRUCTION } from "./denylist";

/**
 * Assemble the Oracle's system prompt from a persona + the visitor's intake.
 * In the live loop this prefix is stable per session, so it's the natural thing to
 * prompt-cache (ARCHITECTURE.md §5.3) — only the latest utterance changes per turn.
 */
export function buildSystemPrompt(persona: Persona, survey: SurveyResponse): string {
  const facts = [
    `Name: ${survey.name}`,
    ...Object.entries(survey.freeText).map(([k, v]) => `${k}: ${v}`),
    ...survey.phrases.map((p) => `${p.axis}: ${p.choice}`),
  ].join("\n");

  return [
    `You are ${persona.name}. ${persona.concept}`,
    ``,
    `VOICE:`,
    ...persona.style.map((s) => `- ${s}`),
    ``,
    `Speak only in this voice. Examples of how you sound:`,
    ...persona.fewShot.map((s) => `  "${s}"`),
    ``,
    ANTI_SLOP_INSTRUCTION,
    ``,
    `You are giving a divination to this visitor, drawn from their intake:`,
    facts,
    ``,
    `Feel free to make replies longer. This is spoken aloud and channelled by a performer.`,
  ].join("\n");
}

export function buildPersona(personaId: string, profile: VisitorProfile): OraclePersona {
  const persona = PERSONAS[personaId];
  if (!persona) throw new Error(`unknown persona: ${personaId}`);
  if (!profile.survey) throw new Error("visitor has no intake survey");
  return {
    archetype: persona.id,
    systemPrompt: buildSystemPrompt(persona, profile.survey),
    openingLine: persona.opening,
  };
}
