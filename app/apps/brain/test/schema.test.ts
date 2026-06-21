import { describe, it, expect } from "vitest";
import { VisitorProfile, PoseVector, SurveyResponse } from "@channelers/shared";
import { WsClientMsg, Station } from "@channelers/shared";

describe("schema: PoseVector", () => {
  it("accepts an angle/weight vector", () => {
    expect(PoseVector.safeParse({ angles: [0.1, 0.2], weights: [1, 0.5] }).success).toBe(true);
  });
});

describe("schema: VisitorProfile", () => {
  it("accepts a freshly-registered record (number, no survey yet)", () => {
    const r = VisitorProfile.safeParse({
      id: "u1",
      number: 42,
      scans: [],
      location: { state: "waiting", since: "2026-06-19T00:00:00.000Z" },
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a fully-progressed record", () => {
    const r = VisitorProfile.safeParse({
      id: "u1", number: 42, scans: [],
      survey: { name: "Jo", freeText: {}, phrases: [] },
      archetype: "tree",
      poseTemplate: { angles: [0], weights: [1] },
      location: { state: "in_progress", station: "altar", since: "2026-06-19T00:00:00.000Z" },
      createdAt: "2026-06-19T00:00:00.000Z",
      intakeAt: "2026-06-19T00:01:00.000Z",
      poseAt: "2026-06-19T00:02:00.000Z",
      personaAt: "2026-06-19T00:03:00.000Z",
      poseVerifiedAt: "2026-06-19T00:04:00.000Z",
    });
    expect(r.success).toBe(true);
  });
});

describe("schema: SurveyResponse", () => {
  it("no longer carries archetype as a known field", () => {
    // archetype moved to the top-level record; survey is intake answers only.
    const r = SurveyResponse.safeParse({ name: "Jo", freeText: {}, phrases: [] });
    expect(r.success).toBe(true);
  });
});

describe("schema: Station + station.hello", () => {
  it("exports a Station enum", () => {
    expect(Station.safeParse("intake").success).toBe(true);
    expect(Station.safeParse("nope").success).toBe(false);
  });
  it("parses a station.hello command", () => {
    const r = WsClientMsg.safeParse({ kind: "station.hello", station: "bodyscan" });
    expect(r.success).toBe(true);
  });
  it("rejects station.hello with an unknown station", () => {
    expect(WsClientMsg.safeParse({ kind: "station.hello", station: "lobby" }).success).toBe(false);
  });
});
