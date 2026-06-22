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
