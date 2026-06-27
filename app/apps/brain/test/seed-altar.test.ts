import { describe, it, expect } from "vitest";
import { SurveyResponse, PoseVector } from "@channelers/shared";
import { parseCount, sampleSurvey, samplePose } from "../src/seed-lib";

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
