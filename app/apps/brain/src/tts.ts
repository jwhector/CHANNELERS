import { voiceForArchetype } from "@channelers/oracles";
import { config } from "./config";

/**
 * Synthesize the oracle's line to MP3 via ElevenLabs, using the per-archetype voice.
 * Returns null when ELEVENLABS_API_KEY is unset — the /api/tts route then answers 204 so the
 * performer's browser falls back to local speechSynthesis. Offline-resilient (ARCHITECTURE §3).
 */
export async function synthesizeSpeech(text: string, archetype: string): Promise<Buffer | null> {
  if (!config.elevenLabsApiKey) return null;
  const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
  const client = new ElevenLabsClient({ apiKey: config.elevenLabsApiKey });
  const audio = await client.textToSpeech.convert(voiceForArchetype(archetype), {
    text,
    modelId: config.elevenLabsModel,
    outputFormat: "mp3_44100_128",
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of audio) chunks.push(chunk);
  return Buffer.concat(chunks);
}
