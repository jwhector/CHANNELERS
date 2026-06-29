import { describe, it, expect } from "vitest";
import { ocrPage, ocrTextFromResponse, buildOcrRequest } from "../src/paper";

// setup.ts forces OPENAI_API_KEY="" → ocrPage takes the offline branch and returns null.
describe("ocrPage (offline)", () => {
  it("returns null when no OpenAI key is configured", async () => {
    const out = await ocrPage("data:image/jpeg;base64,AAAA");
    expect(out).toBeNull();
  });
});

describe("ocrTextFromResponse", () => {
  it("trims and returns a legible reading", () => {
    expect(ocrTextFromResponse("  i confess nothing \n")).toBe("i confess nothing");
  });

  it("returns null for an empty / whitespace / missing result", () => {
    expect(ocrTextFromResponse("")).toBeNull();
    expect(ocrTextFromResponse("   \n ")).toBeNull();
    expect(ocrTextFromResponse(null)).toBeNull();
    expect(ocrTextFromResponse(undefined)).toBeNull();
  });
});

describe("buildOcrRequest", () => {
  it("requests the high-detail vision path (not the 512px default)", () => {
    const req = buildOcrRequest("gpt-4o", "data:image/jpeg;base64,AAAA");
    const img = (req.messages[0].content as Array<Record<string, any>>).find((p) => p.type === "image_url");
    expect(img?.image_url.detail).toBe("high");
    expect(img?.image_url.url).toContain("base64");
  });

  it("instructs a best-effort, non-paraphrasing transcription", () => {
    const req = buildOcrRequest("gpt-4o", "data:image/jpeg;base64,AAAA");
    const instr = (req.messages[0].content as Array<Record<string, any>>).find((p) => p.type === "text")?.text ?? "";
    expect(instr.toLowerCase()).toContain("best-effort");
    expect(instr.toLowerCase()).toContain("do not summarize");
  });
});
