import { describe, it, expect } from "vitest";
import { resolveBase } from "../src/seed";
import { config } from "../src/config";

describe("seed resolveBase", () => {
  it("defaults to the local brain (backwards-compatible dev behaviour)", () => {
    expect(resolveBase({}, {})).toBe(`http://${config.host}:${config.port}`);
  });

  it("targets a remote deploy via SEED_BASE", () => {
    expect(resolveBase({}, { SEED_BASE: "https://channelers.fly.dev" })).toBe(
      "https://channelers.fly.dev",
    );
  });

  it("prefers the --base flag over SEED_BASE", () => {
    expect(
      resolveBase({ base: "https://flag.example" }, { SEED_BASE: "https://env.example" }),
    ).toBe("https://flag.example");
  });

  it("trims trailing slashes so `${BASE}${path}` never doubles up", () => {
    expect(resolveBase({ base: "https://channelers.fly.dev/" }, {})).toBe(
      "https://channelers.fly.dev",
    );
  });
});
