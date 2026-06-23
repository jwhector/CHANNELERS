import { describe, it, expect } from "vitest";
import { transform } from "../src/transform";
import { Seeds, type VisitorProfile } from "@channelers/shared";

const ts = "2026-06-21T00:00:00.000Z";
const profile: VisitorProfile = {
  id: "t1", number: 1, scans: [],
  location: { state: "waiting", since: ts }, createdAt: ts,
  survey: { name: "Jo", freeText: { lost: "my keys" }, phrases: [] },
};

describe("transform (music-only, §7)", () => {
  it("returns a music seed and no dance/persona (offline stub)", async () => {
    const seeds = await transform(profile);
    expect(seeds.music.mood).toBeTruthy();
    expect((seeds as Record<string, unknown>).dance).toBeUndefined();
    expect((seeds as Record<string, unknown>).persona).toBeUndefined();
    expect(Seeds.safeParse(seeds).success).toBe(true);
  });
});
