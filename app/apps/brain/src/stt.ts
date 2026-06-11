import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline, env } from "@xenova/transformers";

const DEBUG_LOG = join(process.cwd(), "..", "..", "..", ".cursor", "debug-6ee986.log");

function debugLog(location: string, message: string, data: Record<string, unknown>) {
  try {
    appendFileSync(
      DEBUG_LOG,
      `${JSON.stringify({ sessionId: "6ee986", runId: "post-fix", location, message, data, timestamp: Date.now(), hypothesisId: "H8" })}\n`,
    );
  } catch {
    /* ignore */
  }
}

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

/** Transcribe 16-bit mono WAV audio via local Whisper (runs on the Show Brain, not in the browser). */
export async function transcribeWav(wav: Buffer): Promise<string> {
  const audio = wavToFloat32(wav);
  debugLog("stt.ts:transcribeWav", "parsed wav", { wavBytes: wav.length, samples: audio.length });
  const transcriber = await getTranscriber();
  const out = await (transcriber as (data: Float32Array) => Promise<{ text?: string }>)(audio);
  const text = String(out?.text ?? "").trim();
  debugLog("stt.ts:transcribeWav", "transcribed", { textLen: text.length, hasText: !!text });
  return text;
}
