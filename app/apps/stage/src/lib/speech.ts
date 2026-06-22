let current: HTMLAudioElement | null = null;

/** Stop any in-flight oracle audio — MP3 playback and/or browser speech. */
export function stopSpeaking(): void {
  if (current) {
    current.pause();
    current = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Browser speechSynthesis — the offline fallback when the brain has no ElevenLabs key. */
function speakViaBrowser(text: string): void {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/**
 * Speak the oracle's line into the performer's earpiece. Pulls an ElevenLabs MP3 from the brain
 * (/api/tts, per-archetype voice); on 204 (no key) or any error, falls back to browser TTS.
 */
export async function speak(text: string, opts: { archetype?: string } = {}): Promise<void> {
  if (!text.trim()) return;
  stopSpeaking();
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, archetype: opts.archetype ?? "" }),
    });
    if (res.ok && res.status !== 204) {
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      current = audio;
      const done = () => URL.revokeObjectURL(url);
      audio.onended = done;
      audio.onerror = done;
      await audio.play();
      return;
    }
  } catch {
    /* network/playback failed — fall through to browser TTS */
  }
  speakViaBrowser(text);
}

export interface Recognizer {
  start: () => void;
  stop: () => void;
  supported: boolean;
}

export interface RecognizerHandlers {
  onFinal: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/** Decode recorded audio to 16 kHz mono WAV for the brain's Whisper endpoint. */
async function blobToWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const audioBuffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const samples = audioBuffer.getChannelData(0);
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]!));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const dataSize = pcm.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (off: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 16000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer));
    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    await ctx.close();
  }
}

async function transcribeViaBrain(wav: Blob): Promise<string> {
  const fd = new FormData();
  fd.append("audio", wav, "audio.wav");
  const res = await fetch("/api/stt", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = (await res.json()) as { text?: string };
  return String(data.text ?? "").trim();
}

/** MediaRecorder STT → the brain's Whisper endpoint (OpenAI when keyed, else local). */
export function createRecognizer(handlers: RecognizerHandlers): Recognizer {
  const supported = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];

  return {
    supported,
    start: () => {
      chunks = [];
      void (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data);
          };
          mediaRecorder.onstop = () => {
            stream?.getTracks().forEach((t) => t.stop());
            stream = null;
            void (async () => {
              const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || "audio/webm" });
              try {
                const wav = await blobToWav(blob);
                const text = await transcribeViaBrain(wav);
                if (text) handlers.onFinal(text);
                else handlers.onError?.("Didn't catch anything — try again.");
              } catch {
                handlers.onError?.("Transcription failed — try again or type the visitor's words.");
              }
              handlers.onEnd?.();
            })();
          };
          mediaRecorder.start();
          handlers.onStart?.();
        } catch {
          handlers.onError?.("Microphone blocked — allow mic access for this site, then retry.");
          handlers.onEnd?.();
        }
      })();
    },
    stop: () => {
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    },
  };
}
