import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateFacadeSource } from "../scripts/generate-facade";

describe("generated facade", () => {
  it("committed generated.ts matches a fresh generation (run `pnpm generate`)", () => {
    const committed = readFileSync(join(__dirname, "../src/facade/generated.ts"), "utf8");
    expect(committed).toBe(generateFacadeSource());
  });
});
