import { describe, it, expect } from "vitest";
import { ocrPage } from "../src/paper";

// setup.ts forces OPENAI_API_KEY="" → ocrPage takes the offline branch and returns null.
describe("ocrPage (offline)", () => {
  it("returns null when no OpenAI key is configured", async () => {
    const out = await ocrPage("data:image/jpeg;base64,AAAA");
    expect(out).toBeNull();
  });
});
