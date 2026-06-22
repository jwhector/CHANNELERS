import { PERSONAS } from "./personas";

/** Neutral fallback voice (ElevenLabs "Rachel", a stock premade voice) for any archetype without its own. */
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

/** Resolve an archetype id to its ElevenLabs voice id. Unknown ids get the neutral default. */
export function voiceForArchetype(archetypeId: string): string {
  return PERSONAS[archetypeId]?.voiceId ?? DEFAULT_VOICE_ID;
}
