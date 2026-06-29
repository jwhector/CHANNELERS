let current: HTMLAudioElement | null = null;
// Bumped on every stopSpeaking()/speak(); an in-flight speak() captures the value and
// bails the moment a newer call supersedes it, so two cues arriving within one fetch
// window can't both reach play() and talk over each other.
let generation = 0;

// Whether oracle audio is currently sounding (MP3 element or browser TTS). Drives the
// /channel "Stop voice" control so a performer can see — and cut — an overlong divination.
let speaking = false;
const speakingListeners = new Set<(speaking: boolean) => void>();

function setSpeaking(next: boolean): void {
  if (next === speaking) return;
  speaking = next;
  for (const cb of speakingListeners) cb(next);
}

/** True while an oracle clip is sounding. */
export function isSpeaking(): boolean {
  return speaking;
}

/** Subscribe to playback start/stop; returns an unsubscribe. Fires only on change. */
export function onSpeakingChange(cb: (speaking: boolean) => void): () => void {
  speakingListeners.add(cb);
  return () => {
    speakingListeners.delete(cb);
  };
}

/** Stop any in-flight oracle audio — MP3 playback and/or browser speech. */
export function stopSpeaking(): void {
  generation++;
  if (current) {
    current.pause();
    current = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  setSpeaking(false);
}

/** Browser speechSynthesis — the offline fallback when the brain has no ElevenLabs key. */
function speakViaBrowser(text: string, rate?: number): void {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  if (rate !== undefined) u.rate = rate; // utterance rate ≈ <audio> playbackRate (1 = normal, lower = slower)
  u.onend = () => setSpeaking(false);
  u.onerror = () => setSpeaking(false);
  window.speechSynthesis.cancel();
  setSpeaking(true);
  window.speechSynthesis.speak(u);
}

type SpeakResult = { via: "element" | "speechSynthesis" };
type ClipOpts = { archetype?: string; sinkId?: string; rate?: number };

/**
 * Fetch one clip's MP3 and start it on the chosen sink, returning the playing <audio> (so a
 * caller can await its end) — or null when it fell back to browser TTS / had no audio / was
 * superseded. `mine` is the generation captured by the caller; a newer speak()/stopSpeaking()
 * moves the generation past it and this clip bails out, so cues never talk over each other.
 */
async function startClip(text: string, opts: ClipOpts, mine: number): Promise<HTMLAudioElement | null> {
  const superseded = () => mine !== generation;
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, archetype: opts.archetype ?? "" }),
    });
    if (superseded()) return null;
    if (res.ok && res.status !== 204) {
      const blob = await res.blob();
      if (superseded()) return null;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      // Slow the oracle to ritual pace without warping it: preserve pitch, drop only the rate.
      if (opts.rate !== undefined) {
        audio.preservesPitch = true;
        audio.playbackRate = opts.rate;
      }
      current = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        setSpeaking(false);
      };
      audio.onended = done;
      audio.onerror = done;
      if (opts.sinkId && typeof audio.setSinkId === "function") {
        try {
          await audio.setSinkId(opts.sinkId);
        } catch {
          /* device gone / not permitted — play on default */
        }
        if (superseded()) {
          audio.pause();
          done();
          return null;
        }
      }
      await audio.play();
      setSpeaking(true);
      return audio;
    }
  } catch {
    /* network/playback failed — fall through to browser TTS */
  }
  if (superseded()) return null;
  speakViaBrowser(text, opts.rate);
  return null;
}

/** Resolve once the clip finishes — or sooner if a newer call preempts it (pause/superseded). */
function whenClipEnds(audio: HTMLAudioElement, superseded: () => boolean): Promise<void> {
  if (audio.ended || superseded()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => resolve();
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    audio.addEventListener("pause", finish, { once: true }); // stopSpeaking() preempted us
  });
}

/**
 * Speak the oracle's line into the performer's earpiece. Pulls an MP3 from the brain
 * (/api/tts; ElevenLabs or OpenAI voice); on 204 (no keys) or any error, falls back to
 * browser TTS. Pass `sinkId` to route the MP3 to a chosen output device (setSinkId);
 * the speechSynthesis fallback cannot be routed, hence the `via` in the result.
 */
export async function speak(text: string, opts: ClipOpts = {}): Promise<SpeakResult> {
  if (!text.trim()) return { via: "element" };
  stopSpeaking();
  const mine = generation; // claimed after the bump above; a newer call moves generation past it
  const audio = await startClip(text, opts, mine);
  return { via: audio ? "element" : "speechSynthesis" };
}

/**
 * Voice several clips on one device back-to-back, each starting only after the previous ends —
 * so e.g. a "prepare to channel" warning lands AFTER the movement cue rather than cutting it off.
 * The whole sequence is preemptible: a later speak()/speakSequence()/stopSpeaking() bumps the
 * generation and abandons whatever clips remain.
 */
export async function speakSequence(
  clips: Array<{ text: string; archetype?: string; sinkId?: string }>,
  opts: { sinkId?: string; rate?: number } = {},
): Promise<void> {
  const items = clips.filter((c) => c.text.trim());
  if (!items.length) return;
  stopSpeaking();
  const mine = generation;
  const superseded = () => mine !== generation;
  for (const clip of items) {
    if (superseded()) return;
    // A per-clip sinkId wins over the sequence default — this is how the dual-channel
    // Pluribus broadcast voices its intro to the room and its numbers to the in-ear.
    const audio = await startClip(clip.text, { ...opts, archetype: clip.archetype, sinkId: clip.sinkId ?? opts.sinkId }, mine);
    if (superseded()) return;
    // No element → browser-TTS fallback (no-keys dev path); can't await it precisely, so move on.
    if (audio) await whenClipEnds(audio, superseded);
  }
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

/**
 * MediaRecorder STT → the brain's Whisper endpoint (OpenAI when keyed, else local).
 * Pass `getDeviceId` to record from a chosen mic (read at each start() so changing the
 * picker takes effect on the next listen); falsy/absent → the system default mic.
 */
export function createRecognizer(
  handlers: RecognizerHandlers,
  opts: { getDeviceId?: () => string | undefined } = {},
): Recognizer {
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
          const id = opts.getDeviceId?.();
          stream = await navigator.mediaDevices.getUserMedia({
            audio: id ? { deviceId: { exact: id } } : true,
          });
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
