import { beforeEach, describe, it, expect, vi } from "vitest";
import { synthesizeSpeech } from "../src/tts";
import { voiceForArchetype } from "@channelers/oracles";

// vitest hoists vi.hoisted + vi.mock above the imports, so the mock vars exist when ../src/tts loads.
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

beforeEach(() => {
  mockConfig.elevenLabsApiKey = undefined;
  mockConfig.openaiApiKey = undefined;
  convert.mockReset();
  speechCreate.mockReset();
});

describe("voiceForArchetype", () => {
  it("maps known + unknown archetypes", () => {
    expect(voiceForArchetype("tree")).toBe("pNInz6obpgDQGcFmaJgB");
    expect(voiceForArchetype("nope")).toBe("21m00Tcm4TlvDq8ikWAM");
  });
});

describe("synthesizeSpeech", () => {
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
    async function* fakeStream() {
      yield new Uint8Array([1]);
    }
    convert.mockResolvedValue(fakeStream());
    await synthesizeSpeech("hello", "tree");
    expect(convert).toHaveBeenCalledTimes(1);
    expect(speechCreate).not.toHaveBeenCalled();
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
