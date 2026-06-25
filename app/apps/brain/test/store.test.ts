import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../src/store";

const NUM = () => Math.floor(Math.random() * 1e9); // unique per test (store is process-global)

describe("store registration (born on first touch by number)", () => {
  it("creates a waiting record with a uuid and the given number", () => {
    const n = NUM();
    const r = store.register(n);
    expect(r.number).toBe(n);
    expect(r.id).toMatch(/[0-9a-f-]{36}/);
    expect(r.location).toEqual(expect.objectContaining({ state: "waiting" }));
    expect(r.survey).toBeUndefined();
    expect(r.createdAt).toBeTruthy();
  });

  it("is idempotent: re-registering the same number returns the same record", () => {
    const n = NUM();
    const a = store.register(n);
    const b = store.register(n);
    expect(b.id).toBe(a.id);
    expect(store.getByNumber(n)?.id).toBe(a.id);
  });
});

describe("store upserts attach to the record by id", () => {
  it("upsertSurvey sets survey + intakeAt", () => {
    const r = store.register(NUM());
    const out = store.upsertSurvey(r.id, { name: "Jo", freeText: {}, phrases: [] });
    expect(out?.survey?.name).toBe("Jo");
    expect(out?.intakeAt).toBeTruthy();
  });

  it("setPoseTemplate sets poseTemplate + poseAt", () => {
    const r = store.register(NUM());
    const out = store.setPoseTemplate(r.id, { angles: [0.1], weights: [1] });
    expect(out?.poseTemplate?.angles).toEqual([0.1]);
    expect(out?.poseAt).toBeTruthy();
  });

  it("setArchetype sets archetype + personaAt; setPoseVerified sets poseVerifiedAt", () => {
    const r = store.register(NUM());
    expect(store.setArchetype(r.id, "tree")?.archetype).toBe("tree");
    expect(store.get(r.id)?.personaAt).toBeTruthy();
    expect(store.setPoseVerified(r.id)?.poseVerifiedAt).toBeTruthy();
  });

  it("returns undefined for unknown ids", () => {
    expect(store.upsertSurvey("nope", { name: "x", freeText: {}, phrases: [] })).toBeUndefined();
  });
});

describe("store milestone stamp + remove", () => {
  it("stampMilestone sets an arbitrary milestone timestamp", () => {
    const r = store.register(NUM());
    const out = store.stampMilestone(r.id, "sessionEndAt");
    expect(out?.sessionEndAt).toBeTruthy();
  });
  it("remove deletes the record and frees the number", () => {
    const n = NUM();
    const r = store.register(n);
    expect(store.remove(r.id)).toBe(true);
    expect(store.get(r.id)).toBeUndefined();
    expect(store.getByNumber(n)).toBeUndefined();
    // number is now reusable → a fresh record
    expect(store.register(n).id).not.toBe(r.id);
  });
  it("remove returns false for an unknown id", () => {
    expect(store.remove("nope")).toBe(false);
  });
});

describe("paper station milestone", () => {
  it("stamps paperAt via stampMilestone", () => {
    store.clear();
    const v = store.register(770001);
    expect(v.paperAt).toBeUndefined();
    store.stampMilestone(v.id, "paperAt");
    expect(store.get(v.id)?.paperAt).toBeTruthy();
  });
});

describe("waitingroom station milestone", () => {
  it("stamps waitingRoomAt via stampMilestone", () => {
    store.clear();
    const v = store.register(780001);
    expect(v.waitingRoomAt).toBeUndefined();
    store.stampMilestone(v.id, "waitingRoomAt");
    expect(store.get(v.id)?.waitingRoomAt).toBeTruthy();
  });
});

describe("store choreography first-pass", () => {
  it("stores a choreography first-pass on the record", () => {
    const v = store.register(NUM());
    store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] });
    const out = store.setChoreoFirstPass(v.id, { score: "Enter slowly." });
    expect(out?.choreoFirstPass?.score).toBe("Enter slowly.");
  });
  it("returns undefined for an unknown id", () => {
    expect(store.setChoreoFirstPass("nope", { score: "x" })).toBeUndefined();
  });
});
