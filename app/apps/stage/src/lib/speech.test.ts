import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import { speak, createRecognizer } from "./speech";

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

test("routes the MP3 to the chosen sink and reports via:element", async () => {
  const setSinkId = vi.fn().mockResolvedValue(undefined);
  const playSpy = vi.fn().mockResolvedValue(undefined);
  class FakeAudio {
    onended: unknown = null;
    onerror: unknown = null;
    constructor(public src: string) {}
    play = playSpy;
    pause = vi.fn();
    setSinkId = setSinkId;
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

test("overlapping cues don't double-play — a later speak() preempts an in-flight one", async () => {
  // Tag each Audio by the cue text so we can see exactly what was played out loud.
  const played: string[] = [];
  class FakeAudio {
    onended: unknown = null;
    onerror: unknown = null;
    constructor(public src: string) {}
    play = vi.fn(async () => {
      played.push(this.src);
    });
    pause = vi.fn();
  }
  vi.stubGlobal("Audio", FakeAudio);
  // The blob carries the cue text; createObjectURL surfaces it as the Audio src.
  vi.stubGlobal("URL", {
    createObjectURL: (b: { _text: string }) => b._text,
    revokeObjectURL: vi.fn(),
  });
  // Deferred fetches: both speak() calls reach `await fetch` before either resolves —
  // exactly the window where the old stopSpeaking()-before-await guard does nothing.
  const resolvers: Array<() => void> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      const { text } = JSON.parse(init.body as string) as { text: string };
      return new Promise((resolve) => {
        resolvers.push(() => resolve({ ok: true, status: 200, blob: async () => ({ _text: text }) }));
      });
    }),
  );

  const first = speak("first cue");
  const second = speak("second cue");
  resolvers[0]!(); // first cue's MP3 arrives…
  resolvers[1]!(); // …then the second cue's, while the first is still settling
  await Promise.all([first, second]);

  expect(played).toEqual(["second cue"]); // only the latest cue is voiced — no overlap
});

class FakeRecorder {
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: unknown = null;
  onstop: unknown = null;
  constructor(public stream: unknown) {}
  start() {
    this.state = "recording";
  }
  stop() {}
}

test("createRecognizer records from the chosen mic when getDeviceId returns an id", async () => {
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  const rec = createRecognizer({ onFinal: () => {} }, { getDeviceId: () => "mic-2" });
  rec.start();
  await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: "mic-2" } } });
});

test("createRecognizer uses the default mic when no device is chosen", async () => {
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  const rec = createRecognizer({ onFinal: () => {} }, { getDeviceId: () => "" });
  rec.start();
  await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));
});
