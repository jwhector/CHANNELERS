import OpenAI from "openai";
import { voiceForArchetype, DEFAULT_OPENAI_VOICE } from "@channelers/oracles";
import { config } from "./config";

/**
 * Synthesize the oracle's line to MP3, using the per-archetype voice when ElevenLabs is keyed.
 * Fallback order (each returns ROUTABLE MP3 so the stage's setSinkId output routing keeps working):
 *   ElevenLabs → OpenAI TTS (gpt-4o-mini-tts) → null.
 * Returns null only when neither ELEVENLABS_API_KEY nor OPENAI_API_KEY is set; the /api/tts route
 * then answers 204 and the browser falls back to (unroutable) speechSynthesis. (ARCHITECTURE §3, §7.)
 */
export async function synthesizeSpeech(text: string, archetype: string): Promise<Buffer | null> {
  if (config.elevenLabsApiKey) {
    const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
    const client = new ElevenLabsClient({ apiKey: config.elevenLabsApiKey });
    const audio = await client.textToSpeech.convert(voiceForArchetype(archetype), {
      text,
      modelId: config.elevenLabsModel,
      outputFormat: "mp3_44100_128",
      voiceSettings: {
        speed: 0.7,
      }
    });
    const chunks: Uint8Array[] = [];
    for await (const chunk of audio) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  if (config.openaiApiKey) {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const res = await client.audio.speech.create({
      model: config.openAiTtsModel,
      voice: DEFAULT_OPENAI_VOICE,
      input: text,
      response_format: "mp3",
    });
    return Buffer.from(await res.arrayBuffer());
  }
  return null;
}
