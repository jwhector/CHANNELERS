import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";

// Best-effort transcription: the paper station feeds spectacle text into the "into the matrix"
// animation, so a partial/uncertain reading beats a blank "illegible" fallback. We only want an
// empty result for a genuinely textless frame (the caller then substitutes PAPER_FALLBACK_TEXT).
const OCR_INSTRUCTION =
  "Transcribe the typed text on this page exactly as written, word for word. " +
  "Do not summarize, paraphrase, translate, or add any commentary, preamble, or quotation marks. " +
  "Transcribe whatever you can make out — even if the page is faint, partial, or skewed, a " +
  "best-effort reading is better than nothing. Only return an empty string if the image shows no text at all.";

/**
 * Build the chat.completions vision request for one captured page. Pure + exported so the message
 * shape — notably `detail:"high"` — is unit-testable without a network call.
 * `detail:"high"` forces the high-resolution tiled vision path; omitting it defaults to "auto",
 * which can downsample the frame to 512px and make small typed text unreadable (OpenAI vision guide).
 */
export function buildOcrRequest(model: string, dataUrl: string): ChatCompletionCreateParamsNonStreaming {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_INSTRUCTION },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
  };
}

/** Normalize a model completion to trimmed text, or null when nothing legible was read. */
export function ocrTextFromResponse(content: string | null | undefined): string | null {
  const text = content?.trim();
  return text && text.length > 0 ? text : null;
}

/**
 * OCR a captured page image (a data: URL) to its text, using the configured multimodal model.
 * Returns null when OPENAI_API_KEY is unset (offline) or nothing legible is read — the caller
 * substitutes placeholder text so the feed spectacle never blocks (offline-resilience convention).
 */
export async function ocrPage(dataUrl: string): Promise<string | null> {
  if (!config.openaiApiKey) return null;
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const res = await client.chat.completions.create(buildOcrRequest(config.transformModel, dataUrl));
  return ocrTextFromResponse(res.choices[0]?.message?.content);
}

/** Decode a data: URL to raw bytes (strip the base64 header). */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  return Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, "base64");
}

/**
 * Diagnostic dump (gated on PAPER_DEBUG_DIR): write the captured frame + the OCR result side by side
 * so an unreliable station is debuggable by eye — a dark/blurry/glary capture vs. an empty model read.
 * Best-effort: any write failure is logged and swallowed so the spectacle is never blocked.
 */
export async function savePaperDebugFrame(
  dir: string,
  dataUrl: string,
  text: string | null,
  fedAt: string,
  log?: { error: (obj: unknown, msg?: string) => void },
): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const stamp = fedAt.replace(/[:.]/g, "-");
    await writeFile(join(dir, `paper-${stamp}.jpg`), dataUrlToBuffer(dataUrl));
    await writeFile(join(dir, `paper-${stamp}.txt`), text ?? "(empty — no legible text read)");
  } catch (err) {
    log?.error({ err }, "paper debug-frame write failed");
  }
}
