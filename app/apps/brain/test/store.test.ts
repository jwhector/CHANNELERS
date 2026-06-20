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
