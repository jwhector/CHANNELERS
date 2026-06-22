import { pipeline, env } from "@xenova/transformers";
import { config } from "./config";

let transcriberPromise: ReturnType<typeof pipeline> | null = null;

async function getTranscriber() {
  if (!transcriberPromise) {
    env.allowLocalModels = false;
    transcriberPromise = pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en");
  }
  return transcriberPromise;
}

/** Parse 16-bit mono PCM WAV (from the stage recorder) into Float32 samples at 16 kHz. */
function wavToFloat32(wav: Buffer): Float32Array {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("invalid wav");
  }
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const bitsPerSample = wav.readUInt16LE(34);
  if (channels !== 1 || sampleRate !== 16000 || bitsPerSample !== 16) {
    throw new Error(`unsupported wav: ${channels}ch ${sampleRate}Hz ${bitsPerSample}bit`);
  }
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "data") {
      const start = offset + 8;
      const numSamples = Math.floor(size / 2);
      const samples = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        const int16 = wav.readInt16LE(start + i * 2);
        samples[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
      }
      return samples;
    }
    offset += 8 + size;
  }
  throw new Error("wav data chunk missing");
}

/** Local Whisper fallback (Xenova/whisper-tiny.en) — runs on the brain, needs no API key. */
async function transcribeViaLocal(wav: Buffer): Promise<string> {
  const audio = wavToFloat32(wav);
  const transcriber = await getTranscriber();
  const out = await (transcriber as (data: Float32Array) => Promise<{ text?: string }>)(audio);
  return String(out?.text ?? "").trim();
}

/** OpenAI Whisper API (config.sttModel, default whisper-1). Sends the 16 kHz mono WAV as-is. */
async function transcribeViaOpenAI(wav: Buffer): Promise<string> {
  const { default: OpenAI, toFile } = await import("openai");
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const file = await toFile(wav, "audio.wav", { type: "audio/wav" });
  const res = await client.audio.transcriptions.create({ file, model: config.sttModel });
  return String(res.text ?? "").trim();
}

/**
 * Transcribe 16-bit mono WAV from the stage recorder. Uses the OpenAI Whisper API when a key is
 * set, else the local model. If the OpenAI call throws (e.g. flaky venue wifi) we fall back to
 * local so the divination mic never hard-fails mid-show (ARCHITECTURE §3).
 */
export async function transcribeWav(wav: Buffer): Promise<string> {
  if (config.openaiApiKey) {
    try {
      return await transcribeViaOpenAI(wav);
    } catch {
      return transcribeViaLocal(wav);
    }
  }
  return transcribeViaLocal(wav);
}
