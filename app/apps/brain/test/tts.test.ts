import { beforeEach, describe, it, expect, vi } from "vitest";
import { synthesizeSpeech } from "../src/tts";
import { voiceForArchetype } from "@channelers/oracles";

// vitest hoists vi.hoisted + vi.mock above the imports, so the mock vars exist when ../src/tts loads.
const { mockConfig, convert } = vi.hoisted(() => ({
  mockConfig: { elevenLabsApiKey: undefined as string | undefined, elevenLabsModel: "eleven_flash_v2_5" },
  convert: vi.fn(),
}));
vi.mock("../src/config", () => ({ config: mockConfig }));
vi.mock("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: vi.fn(() => ({ textToSpeech: { convert } })),
}));

beforeEach(() => {
  mockConfig.elevenLabsApiKey = undefined;
  convert.mockReset();
});

describe("voiceForArchetype", () => {
  it("maps known + unknown archetypes", () => {
    expect(voiceForArchetype("tree")).toBe("pNInz6obpgDQGcFmaJgB");
    expect(voiceForArchetype("nope")).toBe("21m00Tcm4TlvDq8ikWAM");
  });
});

describe("synthesizeSpeech", () => {
  it("returns null when no ElevenLabs key", async () => {
    expect(await synthesizeSpeech("hi", "tree")).toBeNull();
    expect(convert).not.toHaveBeenCalled();
  });

  it("calls ElevenLabs with the archetype voice and returns a Buffer", async () => {
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
});
