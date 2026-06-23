# Device pickers + routable TTS (Scarlett out + iPhone cams)

**Goal:** Let each performer/dancer screen route its TTS to a chosen audio output (for a central machine + Focusrite Scarlett 8i6 feeding per-performer in-ears) and let the pose stations pick their camera (e.g. an iPhone via Continuity Camera).

**Approach:** One shared device layer (`useDevices` + `<DevicePicker>`) reused on `/channel`, `/choreo`, and the pose stations. `speak()` gains a `sinkId` and calls `HTMLAudioElement.setSinkId`. To keep audio *routable* (browser `speechSynthesis` cannot be routed), the Brain's `/api/tts` gains an OpenAI-TTS MP3 fallback so audio stays on a real `<audio>` element whenever either an ElevenLabs *or* OpenAI key is set. `usePoseLandmarker` gains an optional `deviceId`.

**Tech stack:** TypeScript; `apps/stage` (Vite/React, vitest + @testing-library); `apps/brain` (Fastify + OpenAI SDK, vitest); `packages/oracles`. Web APIs: `enumerateDevices`, `getUserMedia`, `HTMLMediaElement.setSinkId`. OpenAI TTS: `POST /v1/audio/speech`, model `gpt-4o-mini-tts`, `response_format: "mp3"`.

---

## Why / design

### Problem
The show wants a **central machine + Scarlett 8i6** driving per-performer in-ear monitors: each `/channel` (oracle) and `/choreo` (dancer cues) browser window must send its TTS to a *different* physical output. Separately, the `/bodyscan` + `/altar` pose stations should be able to use a high-quality **iPhone camera** (Continuity Camera) instead of the default webcam, which directly attacks the §6 framing/lighting robustness risk.

Today: oracle TTS plays through a plain `new Audio()` with no sink control ([speech.ts](../../../app/apps/stage/src/lib/speech.ts)); `/choreo` is silent text-only ([Choreo.tsx](../../../app/apps/stage/src/routes/Choreo.tsx)); the pose camera is the OS default with no `deviceId` ([usePoseLandmarker.ts:62](../../../app/apps/stage/src/lib/pose/usePoseLandmarker.ts#L62)).

### The routability constraint (the crux)
`HTMLMediaElement.setSinkId(deviceId)` routes an `<audio>` element to a chosen output device — but the **Web Speech API (`speechSynthesis`) has no sink selection and its audio cannot be captured or routed**. `speech.ts` currently falls back to `speechSynthesis` when the Brain returns 204 (no ElevenLabs key). So the routed path only works when TTS returns real audio data.

**Fix:** make `/api/tts` return routable MP3 whenever *any* TTS key exists. Fallback chain: ElevenLabs MP3 → **OpenAI TTS MP3** (`gpt-4o-mini-tts`) → (only with zero keys) 204 → browser `speechSynthesis`, which we visibly flag as "system default only". Since the project already carries `OPENAI_API_KEY`, every realistic show config stays routable.

### Scope
In: the shared device layer; `setSinkId` on oracle TTS; OpenAI-TTS fallback in the Brain; choreo TTS (**on by default, neutral voice**); camera picker on both pose stations; per-tab persistence + `?out=`/`?cam=` URL overrides; docs. Out (deferred): a local WASM/Xenova TTS for routable audio with *zero* keys; per-archetype OpenAI voices (one neutral OpenAI voice is enough on the rare fallback path); routing the STT mic input (single shared input is fine — one altar at a time, see ARCHITECTURE §12).

### Approaches considered
- **A — shared device module + routable-TTS fallback chain (CHOSEN).** DRY across the 3 call sites; directly fixes routability via the OpenAI fallback.
- **B — A plus a local WASM TTS** for zero-key routability. More code + bundle weight; the show will have keys. Deferred.
- **C — bespoke per-page pickers, ElevenLabs-only.** Least code, most duplication, weakest robustness (the rejected fallback behaviour).

### Decision log
- **Routable fallback = OpenAI TTS**, not "route speechSynthesis" (impossible) and not "warn and accept default" (weak). Keeps audio on `<audio>` → `setSinkId` works.
- **Persistence = per-tab `sessionStorage`** (each performer window keeps its own output), mirroring the per-tab kiosk-identity precedent — *not* `localStorage`, which all tabs share. Plus a `?out=` / `?cam=` URL override (label substring match) mirroring the existing `?kiosk=`/`?slot=` for fixed installs.
- **Choreo TTS on by default**, single neutral voice (no archetype → existing default-voice path), with a mute toggle since `/choreo` may be projected.
- **One neutral OpenAI fallback voice** (`sage`) for all OpenAI-path synthesis; per-archetype OpenAI voices deferred (the oracle path uses ElevenLabs in the real show).
- `setSinkId` requires a secure context — satisfied by the cloud HTTPS origin and `localhost`.

---

## Global constraints (every task)
- **TypeScript throughout.** Verify with `pnpm -r typecheck` (0 errors) before claiming a task done.
- **Tests are TDD:** write the failing test, run it red, implement, run it green. Brain tests run offline (`apps/brain/test/setup.ts` forces `OPENAI_API_KEY=""`); keyed paths are exercised by mocking, never live calls.
- Run the relevant suite per task: `pnpm --filter @channelers/stage test` and/or `pnpm --filter @channelers/brain test`.
- **Offline resilience preserved:** with no keys at all, TTS still speaks via `speechSynthesis` (just unroutable + flagged). Camera/pose behaviour with no `deviceId` is byte-for-byte the current default.
- **No behaviour change when unused:** omitting a `sinkId` / `deviceId` reproduces today's behaviour exactly. `DevicePicker` defaults to "System default" / "Default camera" (`value=""`).
- OpenAI TTS facts (verified against the live reference 2026-06-22): endpoint `POST /v1/audio/speech`; model `gpt-4o-mini-tts`; SDK `await new OpenAI({apiKey}).audio.speech.create({ model, voice, input, response_format: "mp3" })` → response with `.arrayBuffer()`; valid voices include `alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar`.
- After all tasks: update `docs/CHANGELOG.md` (newest on top), `docs/ARCHITECTURE.md` §7 + §12, `app/CLAUDE.md`, `app/.env.example` (Task 7).
- Commit per task with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File structure

**New**
- `app/apps/stage/src/lib/devices.ts` — `useDevices` hook + pure helpers (`resolveDeviceId`, `listDevices`, `unlockLabels`, `canRouteAudio`).
- `app/apps/stage/src/lib/devices.test.ts` — unit tests for `resolveDeviceId`.
- `app/apps/stage/src/components/DevicePicker.tsx` — the `<select>` UI (+ enable-labels button, routing warn badge).
- `app/apps/stage/src/components/DevicePicker.test.tsx` — render + change/enable tests.

**Modified**
- `app/apps/stage/src/lib/speech.ts` — `speak()` gains `sinkId`, applies `setSinkId`, returns `{ via }`.
- `app/apps/stage/src/lib/speech.test.ts` — `sinkId` + return-value tests.
- `app/apps/brain/src/tts.ts` — OpenAI-TTS fallback.
- `app/apps/brain/src/config.ts` — `openAiTtsModel`.
- `app/apps/brain/test/tts.test.ts` — fallback tests.
- `app/packages/oracles/src/voices.ts` + `index.ts` — `DEFAULT_OPENAI_VOICE`.
- `app/apps/stage/src/routes/Channel.tsx` — output picker + `sinkId` into `speak()`.
- `app/apps/stage/src/routes/Choreo.tsx` + `Choreo.test.tsx` — TTS on `choreo.done`, speak toggle, output picker.
- `app/apps/stage/src/lib/pose/usePoseLandmarker.ts` — `deviceId` param + `buildVideoConstraints`.
- `app/apps/stage/src/lib/pose/usePoseLandmarker.test.ts` (new file) — `buildVideoConstraints` unit tests.
- `app/apps/stage/src/routes/BodyScan.tsx`, `Altar.tsx` — camera picker wired to the pose hook.
- `app/apps/stage/src/styles.css` — `.device-picker` styling.

Each file's single responsibility: `devices.ts` owns enumerate/persist/resolve; `DevicePicker` is pure presentation; `speech.ts` owns playback+routing; `tts.ts` owns server synthesis + fallback; routes wire the hook to their TTS/camera.

---

## Task 1 — shared device layer (`lib/devices.ts`)

**Files:** create `app/apps/stage/src/lib/devices.ts`, `app/apps/stage/src/lib/devices.test.ts`.

**Interfaces — Produces:**
- `type DeviceKind = "audiooutput" | "videoinput"`
- `canRouteAudio(): boolean`
- `listDevices(kind: DeviceKind): Promise<MediaDeviceInfo[]>`
- `unlockLabels(kind: DeviceKind): Promise<void>`
- `resolveDeviceId(urlValue: string | null, stored: string | null, devices: MediaDeviceInfo[]): string`
- `useDevices(kind: DeviceKind, storageKey: string, urlParam: string): { devices: MediaDeviceInfo[]; deviceId: string; setDeviceId: (id: string) => void; needsPermission: boolean; enableLabels: () => Promise<void>; refresh: () => Promise<void> }`

**Steps:**
- [ ] Write the failing test `app/apps/stage/src/lib/devices.test.ts`:
  ```ts
  import { expect, test } from "vitest";
  import { resolveDeviceId } from "./devices";

  const dev = (deviceId: string, label: string): MediaDeviceInfo =>
    ({ deviceId, label, kind: "audiooutput", groupId: "", toJSON: () => ({}) } as MediaDeviceInfo);

  test("URL label substring match wins (case-insensitive)", () => {
    const devices = [dev("aaa", "Built-in"), dev("bbb", "Scarlett IEM-2")];
    expect(resolveDeviceId("iem-2", "aaa", devices)).toBe("bbb");
  });

  test("falls back to the stored id when it still exists", () => {
    const devices = [dev("aaa", "Built-in"), dev("bbb", "Scarlett")];
    expect(resolveDeviceId(null, "bbb", devices)).toBe("bbb");
  });

  test("trusts a stored id when labels are not loaded yet (empty list)", () => {
    expect(resolveDeviceId(null, "bbb", [])).toBe("bbb");
  });

  test("returns '' (system default) when nothing matches", () => {
    const devices = [dev("aaa", "Built-in")];
    expect(resolveDeviceId("nope", "gone", devices)).toBe("");
  });
  ```
- [ ] Run it, expect FAIL (module missing): `pnpm --filter @channelers/stage test devices`
- [ ] Implement `app/apps/stage/src/lib/devices.ts`:
  ```ts
  import { useCallback, useEffect, useState } from "react";

  export type DeviceKind = "audiooutput" | "videoinput";

  /** True when the browser can route an <audio> element to a chosen output device. */
  export function canRouteAudio(): boolean {
    return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  }

  /** enumerateDevices() filtered to one kind. Labels are blank until permission is granted. */
  export async function listDevices(kind: DeviceKind): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === kind);
  }

  /** Grant the matching permission so enumerateDevices() returns labels, then drop the stream. */
  export async function unlockLabels(kind: DeviceKind): Promise<void> {
    const constraints = kind === "videoinput" ? { video: true } : { audio: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach((t) => t.stop());
  }

  /**
   * Resolve a deviceId: URL param (label substring, case-insensitive) wins, then the per-tab
   * stored choice (if still present, or if labels aren't loaded yet), else "" (system default).
   */
  export function resolveDeviceId(
    urlValue: string | null,
    stored: string | null,
    devices: MediaDeviceInfo[],
  ): string {
    if (urlValue) {
      const hit = devices.find((d) => d.label.toLowerCase().includes(urlValue.toLowerCase()));
      if (hit) return hit.deviceId;
    }
    if (stored && (devices.length === 0 || devices.some((d) => d.deviceId === stored))) return stored;
    return "";
  }

  export function useDevices(kind: DeviceKind, storageKey: string, urlParam: string) {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [deviceId, setId] = useState<string>("");
    const [needsPermission, setNeedsPermission] = useState(true);

    const refresh = useCallback(async () => {
      const list = await listDevices(kind);
      setDevices(list);
      setNeedsPermission(list.length === 0 || list.every((d) => !d.label));
      const url = new URLSearchParams(window.location.search).get(urlParam);
      const stored = sessionStorage.getItem(storageKey);
      setId((cur) => cur || resolveDeviceId(url, stored, list));
    }, [kind, storageKey, urlParam]);

    useEffect(() => {
      void refresh();
      const handler = () => void refresh();
      navigator.mediaDevices?.addEventListener?.("devicechange", handler);
      return () => navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    }, [refresh]);

    const setDeviceId = useCallback((id: string) => {
      setId(id);
      if (id) sessionStorage.setItem(storageKey, id);
      else sessionStorage.removeItem(storageKey);
    }, [storageKey]);

    const enableLabels = useCallback(async () => {
      try { await unlockLabels(kind); } finally { await refresh(); }
    }, [kind, refresh]);

    return { devices, deviceId, setDeviceId, needsPermission, enableLabels, refresh };
  }
  ```
- [ ] Run it, expect PASS: `pnpm --filter @channelers/stage test devices`
- [ ] `pnpm --filter @channelers/stage typecheck`
- [ ] Commit: `git add -A && git commit -m "feat(stage): shared device-enumeration layer (useDevices + resolveDeviceId)"`

---

## Task 2 — `<DevicePicker>` component

**Files:** create `app/apps/stage/src/components/DevicePicker.tsx`, `app/apps/stage/src/components/DevicePicker.test.tsx`.

**Interfaces — Consumes:** `DeviceKind`, `canRouteAudio` from `../lib/devices` (Task 1). **Produces:** `DevicePicker` (named export) with props:
```ts
{ kind: DeviceKind; label: string; devices: MediaDeviceInfo[]; value: string;
  onChange: (id: string) => void; needsPermission: boolean; onEnableLabels: () => void; warn?: boolean }
```

**Steps:**
- [ ] Write the failing test `app/apps/stage/src/components/DevicePicker.test.tsx`:
  ```tsx
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { expect, test, vi } from "vitest";
  import { DevicePicker } from "./DevicePicker";

  const dev = (deviceId: string, label: string): MediaDeviceInfo =>
    ({ deviceId, label, kind: "audiooutput", groupId: "", toJSON: () => ({}) } as MediaDeviceInfo);

  test("lists devices and reports selection changes", async () => {
    const onChange = vi.fn();
    render(
      <DevicePicker kind="audiooutput" label="Earpiece" devices={[dev("bbb", "Scarlett IEM-2")]}
        value="" onChange={onChange} needsPermission={false} onEnableLabels={() => {}} />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "bbb");
    expect(onChange).toHaveBeenCalledWith("bbb");
  });

  test("shows the enable-names button only when permission is needed", async () => {
    const onEnable = vi.fn();
    const { rerender } = render(
      <DevicePicker kind="audiooutput" label="Earpiece" devices={[]} value=""
        onChange={() => {}} needsPermission onEnableLabels={onEnable} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /enable names/i }));
    expect(onEnable).toHaveBeenCalled();
    rerender(
      <DevicePicker kind="audiooutput" label="Earpiece" devices={[]} value=""
        onChange={() => {}} needsPermission={false} onEnableLabels={onEnable} />,
    );
    expect(screen.queryByRole("button", { name: /enable names/i })).toBeNull();
  });
  ```
- [ ] Run it, expect FAIL: `pnpm --filter @channelers/stage test DevicePicker`
- [ ] Implement `app/apps/stage/src/components/DevicePicker.tsx`:
  ```tsx
  import { canRouteAudio, type DeviceKind } from "../lib/devices";

  /** Compact output/camera selector for a screen header. value="" = system/default device. */
  export function DevicePicker({
    kind, label, devices, value, onChange, needsPermission, onEnableLabels, warn,
  }: {
    kind: DeviceKind;
    label: string;
    devices: MediaDeviceInfo[];
    value: string;
    onChange: (id: string) => void;
    needsPermission: boolean;
    onEnableLabels: () => void;
    warn?: boolean;
  }) {
    const showWarn = warn ?? (kind === "audiooutput" && !canRouteAudio());
    const noun = kind === "audiooutput" ? "Output" : "Camera";
    return (
      <span className="device-picker">
        <label>
          {label}{" "}
          <select value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{kind === "audiooutput" ? "System default" : "Default camera"}</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `${noun} ${i + 1}`}</option>
            ))}
          </select>
        </label>
        {needsPermission && (
          <button type="button" className="link" onClick={onEnableLabels}>enable names</button>
        )}
        {showWarn && (
          <span className="device-warn" title="This browser can't route to a chosen output — using the system default">
            ⚠ default only
          </span>
        )}
      </span>
    );
  }
  ```
- [ ] Run it, expect PASS: `pnpm --filter @channelers/stage test DevicePicker`
- [ ] `pnpm --filter @channelers/stage typecheck`
- [ ] Commit: `git add -A && git commit -m "feat(stage): DevicePicker UI (output/camera select + enable-names + route warn)"`

---

## Task 3 — routable `speak()` (`sinkId` + return value)

**Files:** modify `app/apps/stage/src/lib/speech.ts`, `app/apps/stage/src/lib/speech.test.ts`.

**Interfaces — Produces:** `speak(text: string, opts?: { archetype?: string; sinkId?: string }): Promise<{ via: "element" | "speechSynthesis" }>`. `stopSpeaking`, `createRecognizer`, `Recognizer` unchanged.

**Steps:**
- [ ] Add failing tests to `app/apps/stage/src/lib/speech.test.ts` (append). Extend the `FakeAudio` in the existing MP3 test to carry `setSinkId`, and add two tests:
  ```ts
  test("routes the MP3 to the chosen sink and reports via:element", async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    const playSpy = vi.fn().mockResolvedValue(undefined);
    class FakeAudio {
      onended: unknown = null; onerror: unknown = null;
      constructor(public src: string) {}
      play = playSpy; pause = vi.fn(); setSinkId = setSinkId;
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob() }));
    const r = await speak("hello", { archetype: "tree", sinkId: "iem-2" });
    expect(setSinkId).toHaveBeenCalledWith("iem-2");
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ via: "element" });
  });

  test("reports via:speechSynthesis when the brain returns 204 (no keys)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    const r = await speak("hello", { sinkId: "iem-2" });
    expect(r).toEqual({ via: "speechSynthesis" });
  });
  ```
- [ ] Run them, expect FAIL: `pnpm --filter @channelers/stage test speech`
- [ ] Implement in `app/apps/stage/src/lib/speech.ts` — replace the `speak` function:
  ```ts
  type SpeakResult = { via: "element" | "speechSynthesis" };

  /**
   * Speak the oracle's line into the performer's earpiece. Pulls an MP3 from the brain
   * (/api/tts; ElevenLabs or OpenAI voice); on 204 (no keys) or any error, falls back to
   * browser TTS. Pass `sinkId` to route the MP3 to a chosen output device (setSinkId);
   * the speechSynthesis fallback cannot be routed, hence the `via` in the result.
   */
  export async function speak(
    text: string,
    opts: { archetype?: string; sinkId?: string } = {},
  ): Promise<SpeakResult> {
    if (!text.trim()) return { via: "element" };
    stopSpeaking();
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, archetype: opts.archetype ?? "" }),
      });
      if (res.ok && res.status !== 204) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        current = audio;
        const done = () => URL.revokeObjectURL(url);
        audio.onended = done;
        audio.onerror = done;
        if (opts.sinkId && typeof audio.setSinkId === "function") {
          try { await audio.setSinkId(opts.sinkId); } catch { /* device gone / not permitted — play on default */ }
        }
        await audio.play();
        return { via: "element" };
      }
    } catch {
      /* network/playback failed — fall through to browser TTS */
    }
    speakViaBrowser(text);
    return { via: "speechSynthesis" };
  }
  ```
- [ ] Run them, expect PASS (and the 3 existing speech tests still green): `pnpm --filter @channelers/stage test speech`
- [ ] `pnpm --filter @channelers/stage typecheck`
- [ ] Commit: `git add -A && git commit -m "feat(stage): speak() routes MP3 via setSinkId, reports playback path"`

---

## Task 4 — Brain OpenAI-TTS fallback (keep audio routable)

**Files:** modify `app/apps/brain/src/tts.ts`, `app/apps/brain/src/config.ts`, `app/packages/oracles/src/voices.ts`, `app/packages/oracles/src/index.ts`, `app/apps/brain/test/tts.test.ts`.

**Interfaces — Consumes:** `config.elevenLabsApiKey`, `config.elevenLabsModel`, `config.openaiApiKey` (existing), `config.openAiTtsModel` (added here), `voiceForArchetype` + `DEFAULT_OPENAI_VOICE` from `@channelers/oracles`. **Produces:** `synthesizeSpeech(text, archetype): Promise<Buffer | null>` — now returns MP3 from OpenAI when ElevenLabs is unkeyed but OpenAI is keyed; `null` only when neither key is set.

**Steps:**
- [ ] Add `DEFAULT_OPENAI_VOICE` to `app/packages/oracles/src/voices.ts`:
  ```ts
  /** Neutral OpenAI TTS voice for the fallback synthesis path (and choreo cues). */
  export const DEFAULT_OPENAI_VOICE = "sage";
  ```
  and re-export it from `app/packages/oracles/src/index.ts` alongside the existing voices export (add `DEFAULT_OPENAI_VOICE` to the `export { ... } from "./voices"` list).
- [ ] Add to `app/apps/brain/src/config.ts` (after the `elevenLabsModel` line):
  ```ts
  // OpenAI TTS fallback (apps/brain/src/tts.ts) when ELEVENLABS_API_KEY is unset but OPENAI_API_KEY is.
  // Returns routable MP3 so the stage's setSinkId output routing keeps working. Verified model id.
  openAiTtsModel: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
  ```
- [ ] Write the failing tests — extend `app/apps/brain/test/tts.test.ts`. Update the hoisted mock to add OpenAI + the new config fields:
  ```ts
  const { mockConfig, convert, speechCreate } = vi.hoisted(() => ({
    mockConfig: {
      elevenLabsApiKey: undefined as string | undefined,
      elevenLabsModel: "eleven_flash_v2_5",
      openaiApiKey: undefined as string | undefined,
      openAiTtsModel: "gpt-4o-mini-tts",
    },
    convert: vi.fn(),
    speechCreate: vi.fn(),
  }));
  vi.mock("../src/config", () => ({ config: mockConfig }));
  vi.mock("@elevenlabs/elevenlabs-js", () => ({
    ElevenLabsClient: vi.fn(() => ({ textToSpeech: { convert } })),
  }));
  vi.mock("openai", () => ({ default: vi.fn(() => ({ audio: { speech: { create: speechCreate } } })) }));
  ```
  Update `beforeEach` to also reset the new state:
  ```ts
  beforeEach(() => {
    mockConfig.elevenLabsApiKey = undefined;
    mockConfig.openaiApiKey = undefined;
    convert.mockReset();
    speechCreate.mockReset();
  });
  ```
  Replace the old "returns null when no ElevenLabs key" test with these (the no-ElevenLabs case now depends on the OpenAI key):
  ```ts
  it("returns null only when NEITHER key is set", async () => {
    expect(await synthesizeSpeech("hi", "tree")).toBeNull();
    expect(convert).not.toHaveBeenCalled();
    expect(speechCreate).not.toHaveBeenCalled();
  });

  it("falls back to OpenAI TTS (routable MP3) when only OPENAI_API_KEY is set", async () => {
    mockConfig.openaiApiKey = "oai-key";
    speechCreate.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer });
    const out = await synthesizeSpeech("breathe", "tree");
    expect(convert).not.toHaveBeenCalled();
    expect(speechCreate).toHaveBeenCalledWith({
      model: "gpt-4o-mini-tts",
      voice: "sage",
      input: "breathe",
      response_format: "mp3",
    });
    expect(Buffer.isBuffer(out)).toBe(true);
    expect([...out!]).toEqual([7, 8, 9]);
  });

  it("prefers ElevenLabs over OpenAI when both keys are set", async () => {
    mockConfig.elevenLabsApiKey = "el-key";
    mockConfig.openaiApiKey = "oai-key";
    async function* fakeStream() { yield new Uint8Array([1]); }
    convert.mockResolvedValue(fakeStream());
    await synthesizeSpeech("hello", "tree");
    expect(convert).toHaveBeenCalledTimes(1);
    expect(speechCreate).not.toHaveBeenCalled();
  });
  ```
  (Keep the existing "calls ElevenLabs with the archetype voice…" test as-is — set `mockConfig.elevenLabsApiKey` inside it, which it already does.)
- [ ] Run them, expect FAIL: `pnpm --filter @channelers/brain test tts`
- [ ] Implement `app/apps/brain/src/tts.ts`:
  ```ts
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
  ```
- [ ] Run them, expect PASS: `pnpm --filter @channelers/brain test tts`
- [ ] `pnpm -r typecheck`
- [ ] Commit: `git add -A && git commit -m "feat(brain): OpenAI TTS fallback so /api/tts stays routable MP3 without an ElevenLabs key"`

---

## Task 5 — wire the output picker into `/channel`

**Files:** modify `app/apps/stage/src/routes/Channel.tsx`.

**Interfaces — Consumes:** `useDevices` (Task 1), `DevicePicker` (Task 2), `speak(text, { archetype, sinkId })` (Task 3).

**Steps:**
- [ ] Add imports at the top of `app/apps/stage/src/routes/Channel.tsx`:
  ```ts
  import { useDevices } from "../lib/devices";
  import { DevicePicker } from "../components/DevicePicker";
  ```
- [ ] Inside `Channel()`, after the `tuning` state, add the hook + a ref (closures in the WS handler can't see fresh state — mirrors the existing `whisperRef`/`archetypeRef`):
  ```ts
  const out = useDevices("audiooutput", "out.channel", "out");
  const outRef = useRef(out.deviceId);
  outRef.current = out.deviceId;
  ```
- [ ] Thread `sinkId` into both `speak()` calls in the WS handler:
  - `session.started`: `if (whisperRef.current) void speak(m.opening, { archetype: m.archetype, sinkId: outRef.current });`
  - `oracle.done`: `if (whisperRef.current) void speak(m.text, { archetype: archetypeRef.current ?? undefined, sinkId: outRef.current });`
- [ ] Add the picker to the **in-session** header (after the whisper `<label>`, before the End button):
  ```tsx
  <DevicePicker kind="audiooutput" label="earpiece" devices={out.devices} value={out.deviceId}
    onChange={out.setDeviceId} needsPermission={out.needsPermission} onEnableLabels={out.enableLabels} />
  ```
  and the same element to the **lobby** header (so the output can be chosen before claiming a visitor) after the `roster.length` span.
- [ ] Verify nothing else changed behaviour: `pnpm --filter @channelers/stage test` (existing 18 tests still green) and `pnpm --filter @channelers/stage typecheck`.
- [ ] Manual smoke (note in commit, not a blocker here): `pnpm dev`, open `/channel`, confirm the picker lists outputs after the mic grant and a claimed session's TTS plays.
- [ ] Commit: `git add -A && git commit -m "feat(stage): /channel earpiece output picker routes oracle TTS via setSinkId"`

---

## Task 6 — choreo TTS + camera picker (the remaining surfaces)

**Files:** modify `app/apps/stage/src/routes/Choreo.tsx`, `app/apps/stage/src/routes/Choreo.test.tsx`, `app/apps/stage/src/lib/pose/usePoseLandmarker.ts`, create `app/apps/stage/src/lib/pose/usePoseLandmarker.test.ts`, modify `app/apps/stage/src/routes/BodyScan.tsx`, `app/apps/stage/src/routes/Altar.tsx`.

**Interfaces — Consumes:** `useDevices`, `DevicePicker`, `speak`, `stopSpeaking`. **Produces:** `buildVideoConstraints(deviceId?: string): MediaTrackConstraints`; `usePoseLandmarker(onFrame, deviceId?: string)`; `ChoreoDisplay` gains `speakCues: boolean`, `onToggleSpeak: (next: boolean) => void`, `outputPicker?: React.ReactNode`.

### 6a — choreo TTS (on by default, neutral voice)
- [ ] Update the failing tests in `app/apps/stage/src/routes/Choreo.test.tsx`. The display now has two checkboxes, so target by name and add a speak-toggle test:
  ```tsx
  test("renders the current cue", () => {
    render(<ChoreoDisplay cue="Lower your gaze." log={[]} reactToOracle connected
      speakCues onToggleSpeak={() => {}} onToggle={() => {}} />);
    expect(screen.getByText("Lower your gaze.")).toBeInTheDocument();
  });

  test("toggling 'react to oracle' fires onToggle with the new value", async () => {
    const onToggle = vi.fn();
    render(<ChoreoDisplay cue="" log={[]} reactToOracle connected={false}
      speakCues onToggleSpeak={() => {}} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /react to oracle/i }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  test("toggling 'speak cues' fires onToggleSpeak with the new value", async () => {
    const onToggleSpeak = vi.fn();
    render(<ChoreoDisplay cue="" log={[]} reactToOracle connected={false}
      speakCues onToggleSpeak={onToggleSpeak} onToggle={() => {}} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /speak cues/i }));
    expect(onToggleSpeak).toHaveBeenCalledWith(false);
  });
  ```
- [ ] Run them, expect FAIL: `pnpm --filter @channelers/stage test Choreo`
- [ ] Rewrite `app/apps/stage/src/routes/Choreo.tsx`:
  ```tsx
  import { useEffect, useRef, useState, type ReactNode } from "react";
  import type { WsServerMsg } from "@channelers/shared";
  import { api } from "../lib/api";
  import { useBrainSocket } from "../lib/useBrainSocket";
  import { speak, stopSpeaking } from "../lib/speech";
  import { useDevices } from "../lib/devices";
  import { DevicePicker } from "../components/DevicePicker";

  type CueLine = { sessionId: string; text: string };

  /** Pure presentational cue display — unit-testable without a socket. */
  export function ChoreoDisplay({
    cue, log, reactToOracle, connected, onToggle, speakCues, onToggleSpeak, outputPicker,
  }: {
    cue: string;
    log: CueLine[];
    reactToOracle: boolean;
    connected: boolean;
    onToggle: (next: boolean) => void;
    speakCues: boolean;
    onToggleSpeak: (next: boolean) => void;
    outputPicker?: ReactNode;
  }) {
    return (
      <main className="void choreo">
        <header>
          <h1>Choreography</h1>
          <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
          <label className="toggle" style={{ marginLeft: "auto" }}>
            <input type="checkbox" checked={speakCues} onChange={(e) => onToggleSpeak(e.target.checked)} />{" "}
            speak cues
          </label>
          <label className="toggle">
            <input type="checkbox" checked={reactToOracle} onChange={(e) => onToggle(e.target.checked)} />{" "}
            react to oracle reply
          </label>
          {outputPicker}
        </header>
        <div className="teleprompter choreo-cue">{cue || "…"}</div>
        <ul className="transcript">
          {log.map((l, i) => (
            <li key={i} className="bubble oracle"><span>{l.text}</span></li>
          ))}
        </ul>
      </main>
    );
  }

  /** The /choreo route: live movement-cue feed, reactToOracle timing, and in-ear TTS (on by default). */
  export function Choreo() {
    const [cue, setCue] = useState("");
    const [log, setLog] = useState<CueLine[]>([]);
    const [reactToOracle, setReactToOracle] = useState(true);
    const [speakCues, setSpeakCues] = useState(true);
    const live = useRef("");

    const out = useDevices("audiooutput", "out.choreo", "out");
    const outRef = useRef(out.deviceId);
    outRef.current = out.deviceId;
    const speakRef = useRef(speakCues);
    speakRef.current = speakCues;

    const { connected } = useBrainSocket((m: WsServerMsg) => {
      if (m.kind === "choreo.delta") {
        live.current += m.text;
        setCue(live.current);
      } else if (m.kind === "choreo.done") {
        live.current = "";
        setCue(m.text);
        setLog((l) => [{ sessionId: m.sessionId, text: m.text }, ...l].slice(0, 30));
        if (speakRef.current) void speak(m.text, { sinkId: outRef.current }); // no archetype → neutral voice
      }
    });

    useEffect(() => {
      void api.choreo.config().then((c) => setReactToOracle(c.reactToOracle));
      return () => stopSpeaking();
    }, []);

    function toggle(next: boolean) {
      setReactToOracle(next);
      void api.choreo.setConfig(next);
    }
    function toggleSpeak(next: boolean) {
      setSpeakCues(next);
      if (!next) stopSpeaking();
    }

    const picker = (
      <DevicePicker kind="audiooutput" label="out" devices={out.devices} value={out.deviceId}
        onChange={out.setDeviceId} needsPermission={out.needsPermission} onEnableLabels={out.enableLabels} />
    );

    return (
      <ChoreoDisplay cue={cue} log={log} reactToOracle={reactToOracle} connected={connected}
        onToggle={toggle} speakCues={speakCues} onToggleSpeak={toggleSpeak} outputPicker={picker} />
    );
  }
  ```
- [ ] Run them, expect PASS: `pnpm --filter @channelers/stage test Choreo`

### 6b — camera picker on the pose stations
- [ ] Write the failing test `app/apps/stage/src/lib/pose/usePoseLandmarker.test.ts`:
  ```ts
  import { expect, test } from "vitest";
  import { buildVideoConstraints } from "./usePoseLandmarker";

  test("default (no deviceId) keeps the 1280x720 request only", () => {
    expect(buildVideoConstraints()).toEqual({ width: 1280, height: 720 });
  });

  test("pins an exact deviceId when provided", () => {
    expect(buildVideoConstraints("cam-iphone")).toEqual({
      width: 1280, height: 720, deviceId: { exact: "cam-iphone" },
    });
  });
  ```
- [ ] Run it, expect FAIL: `pnpm --filter @channelers/stage test usePoseLandmarker`
- [ ] Modify `app/apps/stage/src/lib/pose/usePoseLandmarker.ts`. Add the pure helper near the top (after the `MODEL_URL` const):
  ```ts
  /** Video constraints for the pose webcam; pins an exact camera when a deviceId is chosen. */
  export function buildVideoConstraints(deviceId?: string): MediaTrackConstraints {
    const base: MediaTrackConstraints = { width: 1280, height: 720 };
    return deviceId ? { ...base, deviceId: { exact: deviceId } } : base;
  }
  ```
  Change the signature to `export function usePoseLandmarker(onFrame: (lms: Landmark[] | null, tMs: number) => void, deviceId?: string)`. Replace the inline `getUserMedia({ video: { width: 1280, height: 720 }, audio: false })` in `start()` with an `acquire()` helper and add a live-swap effect:
  ```ts
  const activeDeviceRef = useRef<string | undefined>(undefined);

  const acquire = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: buildVideoConstraints(deviceId),
      audio: false,
    });
    activeDeviceRef.current = deviceId;
    const video = videoRef.current;
    if (!video) throw new Error("video element not mounted");
    (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    video.srcObject = stream;
    await video.play();
  }, [deviceId]);
  ```
  In `start()`, replace the `getUserMedia`/`video.srcObject`/`video.play()` block with `await acquire();` (keep the model-load block and `setStatus("running")` + `requestAnimationFrame(loop)`), and add `acquire` to its dependency array. After `start`, add the swap effect:
  ```ts
  // Switch cameras live when the chosen deviceId changes mid-session.
  useEffect(() => {
    if (status === "running" && activeDeviceRef.current !== deviceId) {
      void acquire().catch((err) => { setError(String(err)); setStatus("error"); });
    }
  }, [deviceId, status, acquire]);
  ```
- [ ] Run it, expect PASS: `pnpm --filter @channelers/stage test usePoseLandmarker`
- [ ] Wire the picker into `app/apps/stage/src/routes/BodyScan.tsx` — in `Enroll`, add imports (`useDevices`, `DevicePicker`), then:
  ```ts
  const cam = useDevices("videoinput", "cam.bodyscan", "cam");
  ```
  pass it to the hook: `const { videoRef, status, error: camError, start } = usePoseLandmarker(onFrame, cam.deviceId);`
  and render the picker in the `.controls` div next to the Start/Record buttons:
  ```tsx
  <DevicePicker kind="videoinput" label="camera" devices={cam.devices} value={cam.deviceId}
    onChange={cam.setDeviceId} needsPermission={cam.needsPermission} onEnableLabels={cam.enableLabels} />
  ```
- [ ] Wire the same into `app/apps/stage/src/routes/Altar.tsx` — in `Gate`, add the imports, `const cam = useDevices("videoinput", "cam.altar", "cam");`, pass `cam.deviceId` to `usePoseLandmarker(onFrame, cam.deviceId)`, and render the `<DevicePicker kind="videoinput" …>` near its camera controls.
- [ ] `pnpm --filter @channelers/stage test` (full stage suite green) and `pnpm --filter @channelers/stage typecheck`.
- [ ] Commit: `git add -A && git commit -m "feat(stage): choreo in-ear TTS + camera pickers on /bodyscan and /altar"`

---

## Task 7 — docs + env

**Files:** modify `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `app/CLAUDE.md`, `app/.env.example`.

**Steps:**
- [ ] `app/.env.example`: add under the TTS section:
  ```
  # Optional: model for the OpenAI TTS fallback used when ELEVENLABS_API_KEY is unset (keeps audio routable).
  OPENAI_TTS_MODEL=gpt-4o-mini-tts
  ```
- [ ] `docs/CHANGELOG.md`: new top entry (what/why/files-areas/verification/docs-touched) describing the device pickers + routable-TTS fallback + choreo TTS + camera pickers.
- [ ] `docs/ARCHITECTURE.md` §7: note the TTS fallback chain (ElevenLabs → OpenAI `gpt-4o-mini-tts` → speechSynthesis) and that per-device routing rides `setSinkId` on the MP3 path only. §12: mark the **earpiece-routing** and **scan-station webcam** open questions resolved-for-MVP (central machine + Scarlett via per-tab `setSinkId`; iPhone via Continuity Camera + the camera picker), and note the choreo-feed in-ear routing is now built (TTS on `/choreo`).
- [ ] `app/CLAUDE.md`: under `/channel`, `/choreo`, and the pose-station routes, note the output/camera pickers (`lib/devices.ts`, `components/DevicePicker.tsx`, `?out=`/`?cam=` overrides, per-tab sessionStorage) and the Brain TTS fallback.
- [ ] `pnpm -r typecheck` (sanity) and full suites green: `pnpm --filter @channelers/brain test` + `pnpm --filter @channelers/stage test`.
- [ ] Commit: `git add -A && git commit -m "docs: device pickers + routable TTS fallback (CHANGELOG, ARCHITECTURE §7/§12, app CLAUDE, .env.example)"`
