import { Seeds, type VisitorProfile } from "@channelers/shared";
import { config } from "./config";

/**
 * Deterministic fallback so the whole pipeline runs with no API key (and as a safety
 * net if a live call fails mid-show). Replace the persona stub at runtime with
 * buildPersona() from @channelers/oracles once an archetype is chosen.
 */
function stubSeeds(profile: VisitorProfile): Seeds {
  const lost = profile.survey.freeText.lost ?? "something nameless";
  return {
    music: {
      mood: "fluorescent melancholy",
      tempoBpm: 96,
      key: "A minor",
      lyricThemes: ["waiting rooms", lost, "being processed"],
      synthPalette: ["detuned saw pad", "DX bell", "tape hiss"],
    },
    dance: {
      qualities: ["bureaucratic", "tender", "stop-motion"],
      spatial: "single file, facing an unseen window",
      spiritAnimalShape: "heron mid-step",
      cues: ["take a number", "hold the shape until processed"],
    },
    persona: {
      archetype: "tree",
      systemPrompt: "(stub — built from @channelers/oracles when an Oracle is selected)",
      openingLine: "You smell like paper. Sit.",
    },
  };
}

/**
 * Intake → seeds. Uses Claude when a key is present, else the stub.
 * TODO: switch to the SDK's structured-output (json_schema) mode for guaranteed shape;
 * for now we prompt for JSON and validate with zod, falling back to the stub on any miss.
 */
export async function transform(profile: VisitorProfile): Promise<Seeds> {
  if (!config.anthropicApiKey) return stubSeeds(profile);
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const msg = await client.messages.create({
      model: config.transformModel,
      max_tokens: 1024,
      system:
        "You convert an absurdist DMV-style intake survey into JSON 'seeds' for a performance. " +
        "Return ONLY JSON of this shape: " +
        "{ music:{ mood, tempoBpm, key, lyricThemes[], synthPalette[] }, " +
        "dance:{ qualities[], spatial, spiritAnimalShape, cues[] }, " +
        "persona:{ archetype, systemPrompt, openingLine } }.",
      messages: [{ role: "user", content: JSON.stringify(profile.survey) }],
    });
    const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const parsed = Seeds.safeParse(json);
    return parsed.success ? parsed.data : stubSeeds(profile);
  } catch (err) {
    console.warn("[transform] falling back to stub:", err);
    return stubSeeds(profile);
  }
}
