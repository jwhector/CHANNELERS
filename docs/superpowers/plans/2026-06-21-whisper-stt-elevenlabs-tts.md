# Divination voice loop: OpenAI Whisper STT + ElevenLabs TTS

**Goal:** Replace the divination flow's local/browser speech with cloud APIs — OpenAI Whisper for transcribing the visitor's dictated audio, ElevenLabs for the oracle's spoken voice — while keeping the no-key offline fallbacks intact.

**Approach:** STT stays server-side (it already is): the brain's `/api/stt` picks OpenAI Whisper when a key is present, else the existing local Xenova model. TTS becomes a new server-side `/api/tts` ElevenLabs proxy the performer device pulls MP3 from (key stays off the browser); `speak()` plays that MP3 and falls back to browser `speechSynthesis` on 204/error. Voices are per-archetype, mapped in the oracles package; the model defaults favor low latency.

**Tech stack:** TypeScript pnpm monorepo · brain = Fastify + `openai` SDK (already present) + new `@elevenlabs/elevenlabs-js` · stage = Vite/React · tests = vitest (brain: node, in `apps/brain/test/`; stage: jsdom, co-located in `src/`).

> Implementation note (reconciled post-build): brain tests live in `apps/brain/test/` per its `vitest.config.ts` (`include: ["test/**/*.test.ts"]`) and import from `../src/...`; the `src/*.test.ts` paths below were the original guess. The route test was named `test/tts-route.test.ts` to avoid colliding with the existing `test/endpoints.test.ts`.

---

## Why / design

### The problem
Today the divination loop uses:
- **STT:** browser `MediaRecorder` → 16 kHz mono WAV → `POST /api/stt` → brain transcribes with a **local** model (`Xenova/whisper-tiny.en`, via `@xenova/transformers`). The browser Web Speech recognizer in `speech.ts` still exists but is **dead code** — `createRecognizer` always returns the brain path.
- **TTS:** browser `window.speechSynthesis` via `speak()` in `Channel.tsx`, fired once on the opening line and once per completed oracle reply (`oracle.done`).

We want characterful cloud voices and a better transcriber, without losing the project's "works with no API key / offline-resilient" property (ARCHITECTURE.md §3).

### Scope
**In:** swap the brain's transcriber to OpenAI Whisper (key-gated, local fallback); add an ElevenLabs `/api/tts` proxy + per-archetype voice mapping; rewrite `speak()` to pull MP3 with a browser-TTS fallback; wire archetype through `Channel.tsx`; strip leftover `#region agent log` debug instrumentation from the two files we rewrite; remove the dead Web Speech recognizer.

**Out:** streaming TTS (we synthesize the *complete* line, as today); changing the WAV recording pipeline (kept — the local fallback needs it); voice cloning / custom ElevenLabs voices (defaults are stock premade voices the team retunes); any change to the `oracle.delta` streaming text path or the WS contract.

### Approaches considered

**STT — where the cloud call lives.**
- **Chosen: brain-side swap, keep the WAV pipeline.** The browser already produces 16 kHz WAV; the brain chooses OpenAI (key set) or local Xenova (else). Both consume the same `Buffer`, so the local fallback stays trivial. Minimal blast radius.
- Rejected: send raw webm to OpenAI and drop the WAV conversion. Simpler browser, but the local Xenova fallback can't parse webm (it needs decoded PCM), breaking the chosen "keep local fallback."

**TTS — delivery path.**
- **Chosen: client-pull `/api/tts`.** Performer device POSTs `{ text, archetype }`, brain returns `audio/mpeg`, browser plays it. Mirrors `/api/stt`; key stays server-side; the existing `whisper (TTS)` toggle still decides whether the client calls at all.
- Rejected: brain synthesizes at `oracle.done` and pushes audio over the WS bus. Binary-over-WS plumbing, and TTS isn't a show event — it doesn't belong on the OSC/event bus.

**ElevenLabs client.** Use the official `@elevenlabs/elevenlabs-js` SDK (`textToSpeech.convert`) — typed, one call, room for `voice_settings`/streaming later. (Raw `fetch` to the REST endpoint was the zero-dep alternative; we chose the SDK.)

### Decision log
- **STT default model `whisper-1`** (the literal Whisper API, cheap), env-overridable to `gpt-4o-transcribe` via `STT_MODEL`.
- **TTS default model `eleven_flash_v2_5`** (low latency — intelligibility > character in earpiece/whisper mode, ARCHITECTURE §7), env `ELEVENLABS_MODEL`.
- **Per-archetype voices**, mapped as a `voiceId` field on each `Persona` in the oracles package; unknown archetypes resolve to a neutral `DEFAULT_VOICE_ID`. Defaults are ElevenLabs **stock premade** voice IDs, explicitly placeholder "living content" the team retunes (like the persona text itself).
- **One-shot TTS**, unchanged: synthesis fires on the complete line (opening + each `oracle.done`), never on streaming `oracle.delta`.
- **Fallbacks preserved at both layers:** OpenAI→Xenova (brain, including on an OpenAI *error* mid-show), ElevenLabs→browser `speechSynthesis` (client, on 204 or any failure).
- **Cleanup is in-scope** for the two files we rewrite: remove the `#region agent log` fetches to `127.0.0.1:7562`, the `.cursor/debug-6ee986.log` writer, the dead `createWebSpeechRecognizer`, and `isEmbeddedBrowser`.

### Data flow (target)
```
PERFORMER DEVICE (Channel.tsx)              SHOW BRAIN (Fastify)               CLOUD
mic ▶ MediaRecorder ▶ 16kHz WAV ▶ POST /api/stt ▶ stt.ts:
                                              key? ▶ OpenAI transcriptions ▶ whisper-1
                                              else/err ▶ local Xenova
        session.say ◀──────────── { text } ◀──┘

oracle.done(text) ▶ speak(text, archetype) ▶ POST /api/tts ▶ tts.ts:
   (only if whisper toggle on)                   key? ▶ ElevenLabs convert(voice) ▶ flash
   200 mp3 ▶ Audio().play()  ◀── audio/mpeg ◀──┘  else ▶ 204
   204/err ▶ speechSynthesis (fallback)
```

---

## Global constraints

These apply to every task:

- **Monorepo commands** (run from `app/`): typecheck `pnpm -r typecheck`; brain tests `pnpm --filter @channelers/brain test`; stage tests `pnpm --filter @channelers/stage test`; everything `pnpm -r test`.
- **Final gate before "done":** `pnpm -r typecheck` AND `pnpm -r test` both clean.
- **Conventions:** all TypeScript, ES modules. Brain dynamic-imports cloud SDKs (matches `divination.ts`'s `await import("openai")`) so the no-key path loads no SDK. Keep functions small and data-driven; degrade gracefully on API failure.
- **Models/format (verbatim):** STT default `"whisper-1"`; TTS model default `"eleven_flash_v2_5"`, output format `"mp3_44100_128"`.
- **Voice IDs (verbatim, ElevenLabs stock premade):** child `"MF3mGyEYCl7XYWbV9V6O"` (Elli) · tree `"pNInz6obpgDQGcFmaJgB"` (Adam) · drugged_ai `"AZnzlk1XvdvUeBnXmlld"` (Domi) · default `"21m00Tcm4TlvDq8ikWAM"` (Rachel). Mark as placeholders to retune.
- **Docs:** after the work lands, `docs/CHANGELOG.md` (newest on top: what/why/files-areas/docs-touched) and `docs/ARCHITECTURE.md` §7 must be updated (Task 6).
- **`app/.env` already holds live keys** — never echo them; only `app/.env.example` is edited (placeholders).

---

## File structure

**Created**
- `app/apps/brain/src/tts.ts` — ElevenLabs synthesis: `synthesizeSpeech(text, archetype) → Buffer | null`.
- `app/packages/oracles/src/voices.ts` — `DEFAULT_VOICE_ID` + `voiceForArchetype(id)` resolver.
- `app/apps/brain/test/tts.test.ts` — voice resolver + `synthesizeSpeech` (null no-key / Buffer on mock).
- `app/apps/brain/test/tts-route.test.ts` — `/api/tts` route (204 no-key / `audio/mpeg` synthesized).
- `app/apps/brain/test/stt.test.ts` — STT dispatch (local no-key / OpenAI on key / OpenAI-error→local).
- `app/apps/stage/src/lib/speech.test.ts` — `speak()` fallback + playback branches.

**Modified**
- `app/packages/oracles/src/personas.ts` — add `voiceId` to the `Persona` interface + all three personas.
- `app/packages/oracles/src/index.ts` — re-export `./voices`.
- `app/apps/brain/src/config.ts` — add `sttModel`, `elevenLabsApiKey`, `elevenLabsModel`.
- `app/apps/brain/src/stt.ts` — dispatch OpenAI vs local; remove debug logger.
- `app/apps/brain/src/app.ts` — register `POST /api/tts`.
- `app/apps/brain/package.json` — add `@elevenlabs/elevenlabs-js` dependency.
- `app/apps/stage/src/lib/speech.ts` — new `speak`/`stopSpeaking`/`speakViaBrowser`; remove dead Web Speech + debug cruft.
- `app/apps/stage/src/routes/Channel.tsx` — `archetypeRef`, pass archetype to `speak()`, `stopSpeaking()` on end.
- `app/.env.example` — `ELEVENLABS_API_KEY` / `ELEVENLABS_MODEL` / `STT_MODEL`.
- `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md` — Task 6.

---

## Task 1 — Per-archetype voices + ElevenLabs synthesis (brain `tts.ts`)

Bundles the oracles voice map with its only consumer and its test (oracles has no test runner; the resolver is verified from the brain suite).

**Files**
- Create: `app/packages/oracles/src/voices.ts`, `app/apps/brain/src/tts.ts`, `app/apps/brain/src/tts.test.ts`
- Modify: `app/packages/oracles/src/personas.ts`, `app/packages/oracles/src/index.ts`, `app/apps/brain/src/config.ts`, `app/apps/brain/package.json`

**Interfaces**
- Consumes: `PERSONAS` (`packages/oracles/src/personas.ts`); `config` (`apps/brain/src/config.ts`).
- Produces:
  - `DEFAULT_VOICE_ID: string` and `voiceForArchetype(archetypeId: string): string` (from `@channelers/oracles`).
  - `synthesizeSpeech(text: string, archetype: string): Promise<Buffer | null>` (from `./tts`).
  - `config.elevenLabsApiKey: string | undefined`, `config.elevenLabsModel: string`, `config.sttModel: string`.

**Steps**

- [ ] Add the dependency. In `app/apps/brain/package.json`, add to `dependencies` (alphabetical, before `@fastify/cors`):
  ```json
  "@elevenlabs/elevenlabs-js": "^2.0.0",
  ```
  Then from `app/` run `pnpm install` and expect it to resolve (note the actual installed version; bump the caret to match if pnpm picks a newer major).

- [ ] Add config fields. In `app/apps/brain/src/config.ts`, after the `oracleModel` line (`oracleModel: process.env.ORACLE_MODEL ?? "gpt-4o",`), insert:
  ```ts
  // OpenAI Whisper STT model for the divination mic (apps/brain/src/stt.ts).
  // Falls back to the local Xenova transcriber when OPENAI_API_KEY is unset.
  sttModel: process.env.STT_MODEL ?? "whisper-1",
  // ElevenLabs TTS for the oracle's voice into the performer's earpiece (apps/brain/src/tts.ts).
  // When the key is unset the client falls back to browser speechSynthesis.
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  elevenLabsModel: process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5",
  ```

- [ ] Add `voiceId` to the `Persona` interface. In `app/packages/oracles/src/personas.ts`, add to the `interface Persona` (after `opening: string;`'s field — place it logically near the top, after `id`):
  ```ts
  /** ElevenLabs voice id used for TTS in the divination loop. Stock premade voice — retune freely. */
  voiceId: string;
  ```
  Then add a `voiceId` to each persona object:
  - `child`: `voiceId: "MF3mGyEYCl7XYWbV9V6O",`
  - `tree`: `voiceId: "pNInz6obpgDQGcFmaJgB",`
  - `drugged_ai`: `voiceId: "AZnzlk1XvdvUeBnXmlld",`

- [ ] Create the resolver `app/packages/oracles/src/voices.ts`:
  ```ts
  import { PERSONAS } from "./personas";

  /** Neutral fallback voice (ElevenLabs "Rachel", a stock premade voice) for any archetype without its own. */
  export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

  /** Resolve an archetype id to its ElevenLabs voice id. Unknown ids get the neutral default. */
  export function voiceForArchetype(archetypeId: string): string {
    return PERSONAS[archetypeId]?.voiceId ?? DEFAULT_VOICE_ID;
  }
  ```

- [ ] Re-export it. In `app/packages/oracles/src/index.ts`, add:
  ```ts
  export * from "./voices";
  ```

- [ ] Write the failing test `app/apps/brain/src/tts.test.ts`:
  ```ts
  import { beforeEach, expect, test, vi } from "vitest";
  import { synthesizeSpeech } from "./tts";
  import { voiceForArchetype } from "@channelers/oracles";

  // vitest hoists vi.hoisted + vi.mock above the imports, so the mock vars exist when ./tts loads.
  const { mockConfig, convert } = vi.hoisted(() => ({
    mockConfig: { elevenLabsApiKey: undefined as string | undefined, elevenLabsModel: "eleven_flash_v2_5" },
    convert: vi.fn(),
  }));
  vi.mock("./config", () => ({ config: mockConfig }));
  vi.mock("@elevenlabs/elevenlabs-js", () => ({
    ElevenLabsClient: vi.fn(() => ({ textToSpeech: { convert } })),
  }));

  beforeEach(() => {
    mockConfig.elevenLabsApiKey = undefined;
    convert.mockReset();
  });

  test("voiceForArchetype maps known + unknown archetypes", () => {
    expect(voiceForArchetype("tree")).toBe("pNInz6obpgDQGcFmaJgB");
    expect(voiceForArchetype("nope")).toBe("21m00Tcm4TlvDq8ikWAM");
  });

  test("synthesizeSpeech returns null when no ElevenLabs key", async () => {
    expect(await synthesizeSpeech("hi", "tree")).toBeNull();
    expect(convert).not.toHaveBeenCalled();
  });

  test("synthesizeSpeech calls ElevenLabs with the archetype voice and returns a Buffer", async () => {
    mockConfig.elevenLabsApiKey = "test-key";
    async function* fakeStream() {
      yield new Uint8Array([1, 2]);
      yield new Uint8Array([3]);
    }
    convert.mockResolvedValue(fakeStream());
    const out = await synthesizeSpeech("hello", "tree");
    expect(convert).toHaveBeenCalledWith("pNInz6obpgDQGcFmaJgB", {
      text: "hello",
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
    });
    expect(Buffer.isBuffer(out)).toBe(true);
    expect([...out!]).toEqual([1, 2, 3]);
  });
  ```

- [ ] Run it, expect FAIL (module `./tts` not found yet): `pnpm --filter @channelers/brain test`.

- [ ] Create `app/apps/brain/src/tts.ts`:
  ```ts
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
  ```

- [ ] Run, expect PASS: `pnpm --filter @channelers/brain test`. Then `pnpm -r typecheck` clean.

- [ ] Commit: `git add -A && git commit -m "feat(brain): per-archetype ElevenLabs TTS synthesis"`

---

## Task 2 — `POST /api/tts` route (brain `app.ts`)

**Files**
- Modify: `app/apps/brain/src/app.ts`
- Create: `app/apps/brain/src/app.test.ts`

**Interfaces**
- Consumes: `synthesizeSpeech(text, archetype)` (Task 1); `buildApp()` (`./app`); `z` (already imported in `app.ts`).
- Produces: `POST /api/tts` — JSON body `{ text: string, archetype: string }` → `200 audio/mpeg` (MP3 bytes) | `204` (no key) | `400` (bad body) | `500` (synthesis threw).

**Steps**

- [ ] Write the failing test `app/apps/brain/src/app.test.ts`:
  ```ts
  import { afterEach, expect, test, vi, type Mock } from "vitest";
  import { synthesizeSpeech } from "./tts";
  import { buildApp } from "./app";

  vi.mock("./tts", () => ({ synthesizeSpeech: vi.fn() }));

  let app: Awaited<ReturnType<typeof buildApp>> | null = null;
  afterEach(async () => {
    await app?.close();
    app = null;
    (synthesizeSpeech as Mock).mockReset();
  });

  test("POST /api/tts → 204 when synthesis returns null (no key)", async () => {
    (synthesizeSpeech as Mock).mockResolvedValue(null);
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { text: "the forms are processing", archetype: "tree" },
    });
    expect(res.statusCode).toBe(204);
  });

  test("POST /api/tts → audio/mpeg bytes when synthesized", async () => {
    (synthesizeSpeech as Mock).mockResolvedValue(Buffer.from([1, 2, 3]));
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { text: "hello", archetype: "tree" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("audio/mpeg");
    expect(res.rawPayload).toEqual(Buffer.from([1, 2, 3]));
  });

  test("POST /api/tts → 400 on empty text", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { text: "", archetype: "tree" },
    });
    expect(res.statusCode).toBe(400);
  });
  ```

- [ ] Run, expect FAIL (no route yet → `inject` returns 404, so the 204/200/400 assertions fail): `pnpm --filter @channelers/brain test`.

- [ ] Add the import. In `app/apps/brain/src/app.ts`, after `import { transcribeWav } from "./stt";`:
  ```ts
  import { synthesizeSpeech } from "./tts";
  ```

- [ ] Register the route. In `app/apps/brain/src/app.ts`, immediately after the existing `/api/stt` handler block (the one ending `return reply.code(500).send({ error: "transcription failed" });` `});`), insert:
  ```ts
  const TtsBody = z.object({ text: z.string().min(1), archetype: z.string() });
  app.post("/api/tts", async (req, reply) => {
    const parsed = TtsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const mp3 = await synthesizeSpeech(parsed.data.text, parsed.data.archetype);
      if (!mp3) return reply.code(204).send();
      return reply.type("audio/mpeg").send(mp3);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: "tts failed" });
    }
  });
  ```

- [ ] Run, expect PASS: `pnpm --filter @channelers/brain test`. Then `pnpm -r typecheck` clean.

- [ ] Commit: `git add -A && git commit -m "feat(brain): POST /api/tts ElevenLabs proxy route"`

---

## Task 3 — OpenAI Whisper in the STT path (brain `stt.ts`)

**Files**
- Modify: `app/apps/brain/src/stt.ts`
- Create: `app/apps/brain/src/stt.test.ts`

**Interfaces**
- Consumes: `config.openaiApiKey`, `config.sttModel` (Task 1); `pipeline`, `env` (`@xenova/transformers`); `OpenAI`, `toFile` (`openai`).
- Produces: `transcribeWav(wav: Buffer): Promise<string>` (unchanged signature; callers in `app.ts` untouched).

**Steps**

- [ ] Write the failing test `app/apps/brain/src/stt.test.ts`:
  ```ts
  import { beforeEach, expect, test, vi } from "vitest";
  import { transcribeWav } from "./stt";

  // vitest hoists vi.hoisted + vi.mock above the imports, so the mock vars exist when ./stt loads.
  const { mockConfig, create, toFile, transcriber } = vi.hoisted(() => ({
    mockConfig: { openaiApiKey: undefined as string | undefined, sttModel: "whisper-1" },
    create: vi.fn(),
    toFile: vi.fn(async (buf: Buffer, name: string) => ({ buf, name })),
    transcriber: vi.fn(async () => ({ text: "local words" })),
  }));
  vi.mock("./config", () => ({ config: mockConfig }));
  vi.mock("openai", () => ({
    default: vi.fn(() => ({ audio: { transcriptions: { create } } })),
    toFile,
  }));
  vi.mock("@xenova/transformers", () => ({
    pipeline: vi.fn(async () => transcriber),
    env: {},
  }));

  // Minimal valid 16 kHz mono 16-bit WAV with two samples — satisfies wavToFloat32's header checks.
  function makeWav(): Buffer {
    const dataSize = 4;
    const b = Buffer.alloc(44 + dataSize);
    b.write("RIFF", 0, "ascii");
    b.writeUInt32LE(36 + dataSize, 4);
    b.write("WAVE", 8, "ascii");
    b.write("fmt ", 12, "ascii");
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(16000, 24);
    b.writeUInt32LE(32000, 28);
    b.writeUInt16LE(2, 32);
    b.writeUInt16LE(16, 34);
    b.write("data", 36, "ascii");
    b.writeUInt32LE(dataSize, 40);
    b.writeInt16LE(1000, 44);
    b.writeInt16LE(-1000, 46);
    return b;
  }

  beforeEach(() => {
    mockConfig.openaiApiKey = undefined;
    create.mockReset();
    toFile.mockClear();
  });

  test("no key → local Xenova transcriber", async () => {
    expect(await transcribeWav(makeWav())).toBe("local words");
    expect(create).not.toHaveBeenCalled();
  });

  test("key present → OpenAI Whisper with config.sttModel", async () => {
    mockConfig.openaiApiKey = "k";
    create.mockResolvedValue({ text: "cloud words" });
    expect(await transcribeWav(Buffer.from("anything"))).toBe("cloud words");
    expect(create).toHaveBeenCalledWith({ file: expect.anything(), model: "whisper-1" });
  });

  test("OpenAI failure falls back to local", async () => {
    mockConfig.openaiApiKey = "k";
    create.mockRejectedValue(new Error("network"));
    expect(await transcribeWav(makeWav())).toBe("local words");
  });
  ```

- [ ] Run, expect FAIL (current `stt.ts` ignores the key and always runs local; the key-present test fails): `pnpm --filter @channelers/brain test`.

- [ ] Rewrite `app/apps/brain/src/stt.ts` to dispatch and drop the debug logger. Full file:
  ```ts
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
  ```

- [ ] Run, expect PASS: `pnpm --filter @channelers/brain test`. Then `pnpm -r typecheck` clean.

- [ ] Commit: `git add -A && git commit -m "feat(brain): OpenAI Whisper STT with local fallback"`

---

## Task 4 — `speak()` pulls ElevenLabs MP3, browser fallback (stage `speech.ts`)

**Files**
- Modify: `app/apps/stage/src/lib/speech.ts`
- Create: `app/apps/stage/src/lib/speech.test.ts`

**Interfaces**
- Consumes: `POST /api/tts` (Task 2) via the Vite `/api` proxy.
- Produces (replacing the old `speak`):
  - `speak(text: string, opts?: { archetype?: string }): Promise<void>`
  - `stopSpeaking(): void`
  - Unchanged exports kept: `createRecognizer(handlers): Recognizer`, `Recognizer`, `RecognizerHandlers`.
- Removed exports: the old `speak(text, opts?: { rate?; pitch? })` signature; `isEmbeddedBrowser` (dead). `createWebSpeechRecognizer` (internal, dead) is deleted.

**Steps**

- [ ] Write the failing test `app/apps/stage/src/lib/speech.test.ts`:
  ```ts
  import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
  import { speak } from "./speech";

  let speakSpy: Mock;

  beforeEach(() => {
    speakSpy = vi.fn();
    // jsdom has no Web Speech — stub the minimum speak()/stopSpeaking() touch.
    vi.stubGlobal("speechSynthesis", { speak: speakSpy, cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  test("POSTs to /api/tts and falls back to browser TTS on 204 (no ElevenLabs key)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    await speak("the forms are processing", { archetype: "tree" });
    expect(fetchMock).toHaveBeenCalledWith("/api/tts", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ text: "the forms are processing", archetype: "tree" });
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  test("plays the MP3 and does NOT use browser TTS when the brain returns audio", async () => {
    const playSpy = vi.fn().mockResolvedValue(undefined);
    class FakeAudio {
      onended: unknown = null;
      onerror: unknown = null;
      constructor(public src: string) {}
      play = playSpy;
      pause = vi.fn();
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob() }));
    await speak("hello", { archetype: "tree" });
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy).not.toHaveBeenCalled();
  });

  test("falls back to browser TTS when the fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await speak("hello", { archetype: "tree" });
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });
  ```

- [ ] Run, expect FAIL (current `speak` is sync `speechSynthesis`, no `/api/tts` fetch): `pnpm --filter @channelers/stage test`.

- [ ] Rewrite `app/apps/stage/src/lib/speech.ts`. Replace the old `speak` and remove the dead Web Speech recognizer + all `#region agent log` blocks. The new file keeps the brain STT recognizer (cleaned) and adds the TTS functions. Full file:
  ```ts
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
  ```

- [ ] Run, expect PASS: `pnpm --filter @channelers/stage test`. Then `pnpm -r typecheck` clean (this confirms `Channel.tsx` still compiles against the kept `createRecognizer`/`Recognizer` exports — its `speak()` calls are updated in Task 5).

  > Note: `pnpm -r typecheck` may flag the two `speak(m.opening)` / `speak(m.text)` calls in `Channel.tsx` as now returning a floating Promise, but the signature is still call-compatible (extra arg optional), so typecheck stays green; Task 5 updates those call sites. If your tsconfig's `no-floating-promises` is enforced via lint (not tsc), it won't fail typecheck here.

- [ ] Commit: `git add -A && git commit -m "feat(stage): speak() pulls ElevenLabs MP3 with browser-TTS fallback; drop dead Web Speech path"`

---

## Task 5 — Wire archetype + stop-on-end (stage `Channel.tsx`)

**Files**
- Modify: `app/apps/stage/src/routes/Channel.tsx`

**Interfaces**
- Consumes: `speak(text, { archetype })`, `stopSpeaking()` (Task 4). `m.archetype` is already present on `session.started` and `session.resumed` server messages.
- Produces: no new exports. Behavior: TTS uses the session's archetype voice; audio stops when a session ends.

**Steps**

- [ ] Update the import (line 12). Change:
  ```ts
  import { speak, createRecognizer, type Recognizer } from "../lib/speech";
  ```
  to:
  ```ts
  import { speak, stopSpeaking, createRecognizer, type Recognizer } from "../lib/speech";
  ```

- [ ] Add an archetype ref alongside the other refs (after `const mySessionIdRef = useRef(mySessionId);` / its assignment, near line 50–51):
  ```ts
  const archetypeRef = useRef<string | null>(null);
  ```

- [ ] In the `session.started` case, set the ref and pass the archetype. Replace:
  ```ts
          setTeleprompter(m.opening);
          setError(null);
          if (whisperRef.current) speak(m.opening);
  ```
  with:
  ```ts
          setTeleprompter(m.opening);
          setError(null);
          archetypeRef.current = m.archetype;
          if (whisperRef.current) void speak(m.opening, { archetype: m.archetype });
  ```

- [ ] In the `session.resumed` case, keep the ref in sync (still no speak on silent reconnect). Replace:
  ```ts
        setTeleprompter(m.teleprompter);
        setError(null);
        // Intentionally no speak() here — don't blast TTS into the earpiece on a silent reconnect.
  ```
  with:
  ```ts
        setTeleprompter(m.teleprompter);
        setError(null);
        archetypeRef.current = m.archetype;
        // Intentionally no speak() here — don't blast TTS into the earpiece on a silent reconnect.
  ```

- [ ] In the `oracle.done` case, pass the archetype. Replace:
  ```ts
        if (whisperRef.current) speak(m.text);
  ```
  with:
  ```ts
        if (whisperRef.current) void speak(m.text, { archetype: archetypeRef.current ?? undefined });
  ```

- [ ] In the `session.ended` case, stop any playing audio and clear the ref. Replace:
  ```ts
        clearHandle();
        setMySessionId(null);
        mySessionIdRef.current = null;
        setSessionMeta(null);
        setLive("");
        setTeleprompter("");
  ```
  with:
  ```ts
        clearHandle();
        stopSpeaking();
        archetypeRef.current = null;
        setMySessionId(null);
        mySessionIdRef.current = null;
        setSessionMeta(null);
        setLive("");
        setTeleprompter("");
  ```

- [ ] Run the full gate: `pnpm -r typecheck` clean, `pnpm -r test` clean.

- [ ] Manual verification (browser audio can't be meaningfully unit-tested):
  - With `ELEVENLABS_API_KEY` set in `app/.env`: `pnpm dev`, claim a visitor on `/channel`, confirm the opening line plays in the per-archetype voice and each oracle reply speaks; toggle `whisper (TTS)` off → no audio; End → audio stops.
  - With the key unset: confirm it still speaks via the browser voice (fallback), proving offline resilience.

- [ ] Commit: `git add -A && git commit -m "feat(stage): channel passes archetype to TTS, stops audio on session end"`

---

## Task 6 — Env example + docs + final gate

**Files**
- Modify: `app/.env.example`, `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`

**Steps**

- [ ] Update `app/.env.example`. After the `ORACLE_MODEL=gpt-4o` line, add:
  ```
  STT_MODEL=whisper-1

  # ElevenLabs TTS for the oracle voice (apps/brain/src/tts.ts). Unset → browser speechSynthesis fallback.
  ELEVENLABS_API_KEY=
  ELEVENLABS_MODEL=eleven_flash_v2_5
  ```

- [ ] Update `docs/ARCHITECTURE.md` §7 (STT / TTS). Adjust the bullets to reflect the new defaults: STT now defaults to OpenAI Whisper (`whisper-1`, `STT_MODEL`) with a local Xenova fallback; TTS now uses ElevenLabs (`eleven_flash_v2_5`, `ELEVENLABS_MODEL`) with per-archetype voices mapped in `packages/oracles`, falling back to browser `speechSynthesis`. Keep the existing "close mic matters more than the model" guidance.

- [ ] Add a `docs/CHANGELOG.md` entry on top: *what* (cloud STT/TTS for the divination loop — OpenAI Whisper + ElevenLabs, both key-gated with offline fallbacks; per-archetype voices; dead Web Speech path removed) / *why* (characterful oracle voice + better transcription while preserving no-key resilience) / *files-areas* (`brain/{stt,tts,app,config}.ts`, `oracles/{personas,voices,index}.ts`, `stage/{lib/speech.ts,routes/Channel.tsx}`, `.env.example`) / *docs-touched* (ARCHITECTURE §7, this plan).

- [ ] Final gate: `pnpm -r typecheck` clean, `pnpm -r test` clean.

- [ ] Commit: `git add -A && git commit -m "docs: cloud STT/TTS env + ARCHITECTURE §7 + CHANGELOG"`

---

## Notes for the implementer
- **Voice IDs are placeholders.** The four stock IDs are real ElevenLabs premade voices, chosen so it works out of the box; the team should swap them for curated voices per archetype (edit `personas.ts` / `voices.ts`). Verify against the operator's ElevenLabs account if voices sound wrong.
- **`@elevenlabs/elevenlabs-js` major version:** pin to whatever `pnpm install` actually resolves. The `textToSpeech.convert(voiceId, { text, modelId, outputFormat })` shape and the async-iterable return are current (v2.x); if a future major changes it, adjust `tts.ts` and its test together.
- **Don't touch `app/.env`** (it has live keys) — only `.env.example`.
- **The `addContentTypeParser("*", …)` in `app.ts`** doesn't affect `/api/tts`: JSON bodies use Fastify's built-in JSON parser; the wildcard parser is for other content types. `inject` with `payload: {…}` sends JSON, so the route tests exercise the real parser.
