import { describe, it, expect } from "vitest";
import { ARCHETYPES, SurveyResponse, PoseVector } from "@channelers/shared";
import {
  completeStation,
  parseArchetype,
  parseCount,
  sampleSurvey,
  samplePose,
  type SeedClient,
} from "../src/seed-lib";

describe("seed parseCount", () => {
  it("defaults to the fallback when --count is absent", () => {
    expect(parseCount({}, 3)).toBe(3);
  });

  it("uses an explicit --count", () => {
    expect(parseCount({ count: "5" }, 3)).toBe(5);
  });

  it("rejects a non-integer --count", () => {
    expect(() => parseCount({ count: "abc" }, 3)).toThrow();
  });

  it("rejects a --count below 1", () => {
    expect(() => parseCount({ count: "0" }, 3)).toThrow();
  });
});

describe("seed parseArchetype", () => {
  it("defaults to the fallback when --archetype is absent", () => {
    expect(parseArchetype({}, "tree")).toBe("tree");
  });

  it("accepts a known archetype id", () => {
    const id = ARCHETYPES[0].id;
    expect(parseArchetype({ archetype: id }, "tree")).toBe(id);
  });

  it("throws on an unknown archetype", () => {
    expect(() => parseArchetype({ archetype: "not-a-real-archetype" }, "tree")).toThrow();
  });
});

describe("seed completeStation", () => {
  it("drives checkin then dispatch/complete with the right payloads", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client: SeedClient = {
      get: async () => ({}) as never,
      post: async (path, body) => {
        calls.push({ path, body });
        return {} as never;
      },
    };
    await completeStation(client, 9000, "v1", "paper");
    expect(calls).toEqual([
      { path: "/api/checkin", body: { number: 9000, station: "paper" } },
      { path: "/api/dispatch/complete", body: { visitorId: "v1" } },
    ]);
  });
});

describe("seed sampleSurvey", () => {
  it("produces a survey that passes the shared schema, carrying the given name", () => {
    const survey = sampleSurvey("Mara");
    expect(survey.name).toBe("Mara");
    expect(() => SurveyResponse.parse(survey)).not.toThrow();
  });
});

describe("seed samplePose", () => {
  it("produces a pose template that passes the shared schema", () => {
    const pose = samplePose();
    expect(() => PoseVector.parse(pose)).not.toThrow();
  });

  it("keeps angles and weights the same length (a well-formed pose vector)", () => {
    const pose = samplePose();
    expect(pose.angles.length).toBe(pose.weights.length);
    expect(pose.angles.length).toBeGreaterThan(0);
  });

  it("keeps every weight in the [0,1] confidence range", () => {
    for (const w of samplePose().weights) {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});
