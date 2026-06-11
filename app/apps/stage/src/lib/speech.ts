/** Browser TTS — feeds the performer's earpiece in whisper mode. Swap for ElevenLabs later. */
export function speak(text: string, opts?: { rate?: number; pitch?: number }): void {
  if (!("speechSynthesis" in window) || !text.trim()) return;
  const u = new SpeechSynthesisUtterance(text);
  if (opts?.rate) u.rate = opts.rate;
  if (opts?.pitch) u.pitch = opts.pitch;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
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

/** Cursor/Electron cannot reach Google's cloud Web Speech backend (logs: network error despite online). */
export function isEmbeddedBrowser(): boolean {
  return /\bElectron\b/i.test(navigator.userAgent);
}

/** Decode recorded audio to 16 kHz mono WAV for the brain's local Whisper endpoint. */
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

/** MediaRecorder STT → brain Whisper. Works in Cursor/Electron where cloud Web Speech fails. */
function createBrainSttRecognizer(handlers: RecognizerHandlers): Recognizer {
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
                // #region agent log
                fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',runId:'post-fix',location:'speech.ts:brain-stt-start',message:'brain stt transcribe start',data:{blobBytes:blob.size,mime:blob.type},timestamp:Date.now(),hypothesisId:'H7'})}).catch(()=>{});
                // #endregion
                const wav = await blobToWav(blob);
                const text = await transcribeViaBrain(wav);
                // #region agent log
                fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',runId:'post-fix',location:'speech.ts:brain-stt-result',message:'brain stt transcribe done',data:{textLen:text.length,hasText:!!text,wavBytes:wav.size},timestamp:Date.now(),hypothesisId:'H7'})}).catch(()=>{});
                // #endregion
                if (text) handlers.onFinal(text);
                else handlers.onError?.("Didn't catch anything — try again.");
              } catch (err) {
                // #region agent log
                fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',runId:'post-fix',location:'speech.ts:brain-stt-error',message:'brain stt transcribe failed',data:{err:String(err)},timestamp:Date.now(),hypothesisId:'H7'})}).catch(()=>{});
                // #endregion
                handlers.onError?.("Transcription failed — try again or type the visitor's words.");
              }
              handlers.onEnd?.();
            })();
          };
          mediaRecorder.start();
          // #region agent log
          fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',runId:'post-fix',location:'speech.ts:brain-stt-recorder',message:'brain stt recorder started',data:{mime:mediaRecorder.mimeType},timestamp:Date.now(),hypothesisId:'H7'})}).catch(()=>{});
          // #endregion
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

/** Chrome/Edge cloud Web Speech STT. Calls handlers for each lifecycle event. */
function createWebSpeechRecognizer(handlers: RecognizerHandlers): Recognizer {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    // #region agent log
    fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',location:'speech.ts:createRecognizer',message:'STT ctor missing',data:{userAgent:navigator.userAgent},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    return { start: () => {}, stop: () => {}, supported: false };
  }

  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.continuous = false;
  let startedAt = 0;
  let gotStart = false;

  rec.onstart = () => {
    gotStart = true;
    startedAt = Date.now();
    console.debug("[STT] started");
    // #region agent log
    fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',location:'speech.ts:onstart',message:'STT started',data:{lang:rec.lang,continuous:rec.continuous},timestamp:Date.now(),hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    handlers.onStart?.();
  };

  rec.onresult = (e: any) => {
    const transcript = e?.results?.[0]?.[0]?.transcript;
    console.debug("[STT] result:", transcript);
    // #region agent log
    fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',location:'speech.ts:onresult',message:'STT result',data:{hasTranscript:!!transcript,transcriptLen:transcript?String(transcript).length:0},timestamp:Date.now(),hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    if (transcript) handlers.onFinal(String(transcript));
  };

  rec.onend = () => {
    console.debug("[STT] ended");
    // #region agent log
    fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',location:'speech.ts:onend',message:'STT ended',data:{gotStart,elapsedMs:startedAt?Date.now()-startedAt:0},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    gotStart = false;
    handlers.onEnd?.();
  };

  rec.onerror = (e: any) => {
    const code: string = e?.error ?? "unknown";
    const message: string | undefined = e?.message;
    console.warn("[STT] error:", code);
    // #region agent log
    fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',location:'speech.ts:onerror',message:'STT error',data:{code,message,gotStart,elapsedMs:startedAt?Date.now()-startedAt:0,online:navigator.onLine,secureContext:window.isSecureContext,protocol:location.protocol,host:location.host},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    if (code === "aborted") return;
    const msg =
      code === "not-allowed" || code === "service-not-allowed"
        ? "Microphone blocked — allow mic access for this site, then retry."
        : code === "no-speech"
          ? "Didn't catch anything — try again."
          : code === "audio-capture"
            ? "No microphone found."
            : code === "network"
              ? "Speech service unreachable (check network/VPN)."
              : `Speech error: ${code}`;
    handlers.onError?.(msg);
  };

  return {
    start: () => {
      gotStart = false;
      startedAt = 0;
      // #region agent log
      fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',location:'speech.ts:start',message:'STT start() called',data:{online:navigator.onLine,secureContext:window.isSecureContext,protocol:location.protocol,host:location.host,userAgent:navigator.userAgent},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      try {
        rec.start();
      } catch (err) {
        console.warn("[STT] start() threw:", err);
        // #region agent log
        fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',location:'speech.ts:start-throw',message:'STT start() threw',data:{err:String(err)},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
    supported: true,
  };
}

/** Always use brain-side Whisper — cloud Web Speech fails with `network` in Chrome and Electron (logs). */
export function createRecognizer(handlers: RecognizerHandlers): Recognizer {
  const embedded = isEmbeddedBrowser();
  // #region agent log
  fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',runId:'post-fix',location:'speech.ts:createRecognizer',message:'STT backend selected',data:{backend:'brain',embedded,userAgent:navigator.userAgent},timestamp:Date.now(),hypothesisId:'H8'})}).catch(()=>{});
  // #endregion
  return createBrainSttRecognizer(handlers);
}
