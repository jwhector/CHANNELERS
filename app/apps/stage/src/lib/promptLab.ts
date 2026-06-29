import { SURVEY, type SurveyField, type SurveyResponse } from "@channelers/shared";

/**
 * Pure helpers for the Prompt Lab (`/prompt-lab`) intake composer.
 *
 * The lab edits a flat form — a ticket name plus one string per survey field id — and converts
 * to/from the `SurveyResponse` the brain stores. Keeping this conversion pure (no React, no fetch)
 * means the round-trip and the randomiser are unit-testable, and the lab's preview can call
 * `buildSystemPrompt` on the exact same shape the brain receives.
 */
export interface LabForm {
  /** Ticket number, as a string — `SurveyResponse.name`. */
  name: string;
  /** Field id → answer string (single = chosen option, multi = options joined by ", ", scale = number). */
  values: Record<string, string>;
}

/** A blank form: every field present with an empty answer. */
export function emptyForm(fields: readonly SurveyField[] = SURVEY): LabForm {
  const values: Record<string, string> = {};
  for (const f of fields) values[f.id] = "";
  return { name: "", values };
}

/** Wrap the flat form into the `SurveyResponse` the intake endpoint expects. */
export function formToSurvey(form: LabForm): SurveyResponse {
  return { name: form.name, freeText: { ...form.values }, phrases: [] };
}

/**
 * Explode a stored survey back into a form. Field ids missing from `freeText` become empty inputs;
 * any extra `freeText` keys (e.g. legacy fields no longer in SURVEY) are preserved so an override
 * edit never silently drops data.
 */
export function surveyToForm(survey: SurveyResponse, fields: readonly SurveyField[] = SURVEY): LabForm {
  const values: Record<string, string> = {};
  for (const f of fields) values[f.id] = "";
  for (const [k, v] of Object.entries(survey.freeText)) values[k] = v;
  return { name: survey.name, values };
}

/** Pick an element by a rand() draw in [0,1). */
function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
}

const SAMPLE_TEXT: Record<string, string[]> = {
  birthMonth: ["March", "November", "August"],
  birthPlace: ["a town that no longer exists", "Cleveland", "the back of a moving car"],
  eyeColor: ["brown", "the colour of weak tea", "one of each"],
  occupation: ["night auditor", "freelance griever", "substitute teacher"],
  shoeSize: ["7.5", "10", "11 wide"],
  touchedBodyPart: ["left earlobe", "the back of my neck", "my own elbow"],
  broughtYou: ["I was told to come.", "Something is ending and I want a witness.", "Curiosity, mostly."],
  knowConfident: ["That I left the stove on.", "My mother's phone number.", "How to fold a fitted sheet, sort of."],
  dontKnowConfident: ["What happens after.", "Why I said that in 2014.", "Whether the dog forgives me."],
  happyMemory: ["A kitchen at 2am, everyone still awake.", "Rain on a tin roof.", "Winning a race I didn't train for."],
  aiFeeling: ["Watched and slightly flattered.", "Like talking to a very polite fog.", "Uneasy, then bored, then uneasy."],
  anyQuestion: ["Is anyone actually listening?", "Where did the time go, literally?", "Did I matter to them?"],
};

const GENERIC_TEXT = ["Hard to say.", "It depends on the weather.", "More than I'd admit here."];

/**
 * Fabricate a plausible-but-absurd intake. `rand` is injected (the app passes Math.random; tests
 * pass a fixed sequence) so the result is deterministic for a given draw. Every field is filled.
 */
export function randomFill(
  fields: readonly SurveyField[],
  rand: () => number,
  name = String(9000 + Math.floor(rand() * 1000)),
): LabForm {
  const values: Record<string, string> = {};
  for (const f of fields) {
    switch (f.kind) {
      case "single":
        values[f.id] = pick(f.options, rand);
        break;
      case "scale":
        values[f.id] = String(f.min + Math.floor(rand() * (f.max - f.min + 1)));
        break;
      case "multi": {
        const want = f.max ? 1 + Math.floor(rand() * f.max) : 1 + Math.floor(rand() * f.options.length);
        const cap = Math.min(want, f.options.length, f.max ?? f.options.length);
        const start = Math.floor(rand() * f.options.length);
        const chosen: string[] = [];
        for (let i = 0; i < f.options.length && chosen.length < cap; i++) {
          chosen.push(f.options[(start + i) % f.options.length]);
        }
        values[f.id] = chosen.join(", ");
        break;
      }
      default:
        values[f.id] = pick(SAMPLE_TEXT[f.id] ?? GENERIC_TEXT, rand);
        break;
    }
  }
  return { name, values };
}
