import { SURVEY, type VisitorProfile, type SurveyResponse, type OraclePersona } from "@channelers/shared";
import { PERSONAS, type Persona } from "./personas";
import { ANTI_SLOP_INSTRUCTION } from "./denylist";

/** Field ids whose answers carry real emotional / divination weight — the "confessions".
 *  Everything else in the intake is absurdist texture the oracle may glance off but must not catalogue.
 *  (Ordered most divination-rich first.) */
const CONFESSION_FIELDS = [
  "broughtYou",
  "anyQuestion",
  "dontKnowConfident",
  "knowConfident",
  "aiFeeling",
  "happyMemory",
  "tenderTexture",
  "cryFrequency",
] as const;

/** Human phrasings for the intake field ids, so the prompt reads as a person's answers and not
 *  machine keys. Falls back to the survey's own label, then the raw id, for any field not listed. */
const FIELD_PHRASING: Record<string, string> = {
  broughtYou: "Why they came",
  anyQuestion: "The one answer they wish they had",
  dontKnowConfident: "Something they're sure they don't know",
  knowConfident: "Something they're sure they know",
  aiFeeling: "How AI makes them feel",
  happyMemory: "A happy memory",
  tenderTexture: "The texture of their tenderness",
  cryFrequency: "How often they cry",
  birthMonth: "Month of birth",
  birthPlace: "Born in",
  eyeColor: "Eye color",
  occupation: "Occupation",
  passiveAggression: "Passive-aggression (1–5)",
  backupFrequency: "How often they back up their data",
  relationshipPhrases: "A close relationship feels like",
  shoeSize: "Shoe size",
  broughtWater: "Brought water",
  touchedBodyPart: "Just touched",
  weekMood: "The mood of their week",
};

function fieldPhrasing(id: string): string {
  return FIELD_PHRASING[id] ?? SURVEY.find((f) => f.id === id)?.label ?? id;
}

/**
 * Render the visitor's intake as a tiered, human-readable block: the weighty "confessions" first,
 * then the absurdist form trivia, then an instruction that drives ONE elegant connection across the
 * two — a collision, not a recital. The tiering + this instruction are the lever against the oracle
 * hamfisting every field it can find (ARCHITECTURE.md §5.5).
 */
function renderIntake(survey: SurveyResponse): string {
  const val = (id: string) => (survey.freeText[id] ?? "").trim();
  const isConfession = new Set<string>(CONFESSION_FIELDS);

  const confessions = CONFESSION_FIELDS.filter((id) => val(id)).map((id) => ` · ${fieldPhrasing(id)}: ${val(id)}`);
  const trivia = Object.keys(survey.freeText)
    .filter((id) => !isConfession.has(id) && val(id))
    .map((id) => `${fieldPhrasing(id)}: ${val(id)}`);

  const out = [`This visitor — ticket #${survey.name} — just filled out the intake desk's form. Most of it is noise.`];
  if (confessions.length) out.push(``, `What they let slip:`, ...confessions);
  if (trivia.length) out.push(``, `Incidental marks on the form (texture — most of it doesn't matter):`, `  ${trivia.join(" · ")}`);
  out.push(
    ``,
    `Let at least one thing they confessed AND at least one incidental detail catch on you, and let the two collide — ` +
      `as if the small absurd thing were secretly about the large unspoken one. Anchor on what they confessed; glance ` +
      `off the absurd detail sideways. Don't explain the connection, don't itemize, and never read the form back. ` +
      `Everything else is allowed to fall away.`,
  );
  return out.join("\n");
}

/**
 * Assemble the Oracle's system prompt from a persona + the visitor's intake.
 * In the live loop this prefix is stable per session, so it's the natural thing to
 * prompt-cache (ARCHITECTURE.md §5.3) — only the latest utterance changes per turn.
 */
export function buildSystemPrompt(persona: Persona, survey: SurveyResponse): string {
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
    renderIntake(survey),
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
