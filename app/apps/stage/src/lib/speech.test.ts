import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import { speak, speakSequence, createRecognizer, isSpeaking, onSpeakingChange, stopSpeaking } from "./speech";

/** An <audio> stand-in that records what was played and lets a test fire its lifecycle events. */
class SeqAudio {
  static instances: SeqAudio[] = [];
  static played: string[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  preservesPitch = false;
  playbackRate = 1;
  sinkId = "";
  private listeners: Record<string, Array<() => void>> = {};
  constructor(public src: string) {
    SeqAudio.instances.push(this);
  }
  setSinkId = vi.fn(async (id: string) => {
    this.sinkId = id;
  });
  play = vi.fn(async () => {
    SeqAudio.played.push(this.src);
  });
  pause = vi.fn(() => this.fire("pause"));
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type: string) {
    (this.listeners[type] ?? []).forEach((fn) => fn());
  }
}

/** Wire up the MP3 path so each fetched clip's text rides through to the Audio src. */
function stubSeqAudio() {
  SeqAudio.instances = [];
  SeqAudio.played = [];
  vi.stubGlobal("Audio", SeqAudio);
  vi.stubGlobal("URL", { createObjectURL: (b: { _text: string }) => b._text, revokeObjectURL: vi.fn() });
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      const { text } = JSON.parse(init.body as string) as { text: string };
      return Promise.resolve({ ok: true, status: 200, blob: async () => ({ _text: text }) });
    }),
  );
}

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

test("applies the playback rate and preserves pitch on the MP3 element", async () => {
  let made: { playbackRate: number; preservesPitch: boolean } | undefined;
  class FakeAudio {
    onended: unknown = null;
    onerror: unknown = null;
    playbackRate = 1;
    preservesPitch = false;
    constructor(public src: string) {
      made = this;
    }
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
  }
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob() }));
  await speak("slow down", { archetype: "tree", rate: 0.7 });
  expect(made?.playbackRate).toBe(0.7);
  expect(made?.preservesPitch).toBe(true); // natural pitch, just slower
});

test("applies the rate to the browser-TTS fallback too (no keys)", async () => {
  let utter: { rate: number } | undefined;
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      rate = 1;
      constructor(public text: string) {
        utter = this;
      }
    },
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
  await speak("slow down", { rate: 0.7 });
  expect(utter?.rate).toBe(0.7);
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

test("speakSequence plays clips back-to-back — the next starts only after the previous ends", async () => {
  stubSeqAudio();
  const seq = speakSequence([{ text: "cue one" }, { text: "prepare" }]);
  await vi.waitFor(() => expect(SeqAudio.played).toEqual(["cue one"])); // first plays, second waits
  SeqAudio.instances[0]!.fire("ended"); // first clip finishes…
  await vi.waitFor(() => expect(SeqAudio.played).toEqual(["cue one", "prepare"])); // …now the second
  SeqAudio.instances[1]!.fire("ended");
  await seq;
});

test("speakSequence routes each clip to its own sink (dual-channel broadcast)", async () => {
  stubSeqAudio();
  const seq = speakSequence([
    { text: "intro", sinkId: "room" },
    { text: "numbers", sinkId: "ear" },
  ]);
  await vi.waitFor(() => expect(SeqAudio.played).toEqual(["intro"]));
  expect(SeqAudio.instances[0]!.sinkId).toBe("room"); // intro → room speakers
  SeqAudio.instances[0]!.fire("ended");
  await vi.waitFor(() => expect(SeqAudio.played).toEqual(["intro", "numbers"]));
  expect(SeqAudio.instances[1]!.sinkId).toBe("ear"); // numbers → performer's in-ear
  SeqAudio.instances[1]!.fire("ended");
  await seq;
});

test("a later speak() preempts an in-flight sequence — its remaining clips don't play", async () => {
  stubSeqAudio();
  const seq = speakSequence([{ text: "cue one" }, { text: "prepare" }]);
  await vi.waitFor(() => expect(SeqAudio.played).toEqual(["cue one"]));
  await speak("new cue"); // preempts: stopSpeaking() pauses the in-flight clip and bumps the generation
  SeqAudio.instances[0]!.fire("ended"); // even if the first clip "ends" late, the sequence was abandoned
  await seq;
  expect(SeqAudio.played).toEqual(["cue one", "new cue"]); // "prepare" never voiced
});

test("onSpeakingChange reports true while the oracle MP3 plays and false once it ends", async () => {
  let made: { onended: (() => void) | null } | undefined;
  class FakeAudio {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) {
      made = this;
    }
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
  }
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob() }));

  stopSpeaking(); // normalise to a known-idle baseline before subscribing
  const events: boolean[] = [];
  const off = onSpeakingChange((v) => events.push(v));

  expect(isSpeaking()).toBe(false);
  await speak("the forms are processing", { archetype: "tree" });
  expect(isSpeaking()).toBe(true);
  expect(events).toEqual([true]);

  made!.onended!(); // the clip finishes on its own
  expect(isSpeaking()).toBe(false);
  expect(events).toEqual([true, false]);

  off();
});

test("stopSpeaking notifies subscribers that playback was cut", async () => {
  class FakeAudio {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) {}
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
  }
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob() }));

  await speak("an overlong divination", { archetype: "tree" });
  expect(isSpeaking()).toBe(true);

  const events: boolean[] = [];
  const off = onSpeakingChange((v) => events.push(v));
  stopSpeaking();
  expect(events).toEqual([false]);
  expect(isSpeaking()).toBe(false);

  off();
});

test("onSpeakingChange returns an unsubscribe that stops further notifications", async () => {
  class FakeAudio {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) {}
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
  }
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob() }));

  stopSpeaking();
  const events: boolean[] = [];
  const off = onSpeakingChange((v) => events.push(v));
  off();
  await speak("nobody is listening", { archetype: "tree" });
  expect(events).toEqual([]);
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
