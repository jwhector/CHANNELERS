import { beforeEach, describe, it, expect, vi } from "vitest";
import { transcribeWav } from "../src/stt";

// vitest hoists vi.hoisted + vi.mock above the imports, so the mock vars exist when ../src/stt loads.
const { mockConfig, create, toFile, transcriber } = vi.hoisted(() => ({
  mockConfig: { openaiApiKey: undefined as string | undefined, sttModel: "whisper-1" },
  create: vi.fn(),
  toFile: vi.fn(async (buf: Buffer, name: string) => ({ buf, name })),
  transcriber: vi.fn(async () => ({ text: "local words" })),
}));
vi.mock("../src/config", () => ({ config: mockConfig }));
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

describe("transcribeWav", () => {
  it("uses the local Xenova transcriber when no key", async () => {
    expect(await transcribeWav(makeWav())).toBe("local words");
    expect(create).not.toHaveBeenCalled();
  });

  it("uses the OpenAI Whisper API with config.sttModel when a key is set", async () => {
    mockConfig.openaiApiKey = "k";
    create.mockResolvedValue({ text: "cloud words" });
    expect(await transcribeWav(Buffer.from("anything"))).toBe("cloud words");
    expect(create).toHaveBeenCalledWith({ file: expect.anything(), model: "whisper-1" });
  });

  it("falls back to local when the OpenAI call throws", async () => {
    mockConfig.openaiApiKey = "k";
    create.mockRejectedValue(new Error("network"));
    expect(await transcribeWav(makeWav())).toBe("local words");
  });
});
