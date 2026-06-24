import { PERSONAS } from "./personas";

/** Neutral fallback voice (ElevenLabs "Rachel", a stock premade voice) for any archetype without its own. */
export const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

/** Neutral OpenAI TTS voice for the fallback synthesis path (and choreo cues). */
export const DEFAULT_OPENAI_VOICE = "sage";

/** Resolve an archetype id to its ElevenLabs voice id. Unknown ids get the neutral default. */
export function voiceForArchetype(archetypeId: string): string {
  return PERSONAS[archetypeId]?.voiceId ?? DEFAULT_VOICE_ID;
}
