import OpenAI from "openai";
import { config } from "./config";

const OCR_INSTRUCTION =
  "Transcribe the typed text on this page exactly as written. " +
  "Return only the transcribed text — no preamble, no commentary, no quotes. " +
  "If nothing is legible, return an empty string.";

/**
 * OCR a captured page image (a data: URL) to its text, using the configured multimodal model.
 * Returns null when OPENAI_API_KEY is unset (offline) — the caller substitutes placeholder text,
 * so the feed spectacle never blocks (project offline-resilience convention).
 * NOTE: verify the chat.completions vision message shape against the current OpenAI reference
 * (docs/CLAUDE.md) before trusting this verbatim.
 */
export async function ocrPage(dataUrl: string): Promise<string | null> {
  if (!config.openaiApiKey) return null;
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const res = await client.chat.completions.create({
    model: config.transformModel, // gpt-4o (multimodal)
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_INSTRUCTION },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim();
  return text && text.length > 0 ? text : null;
}
