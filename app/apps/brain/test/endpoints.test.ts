import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

async function register(n: number) {
  const res = await app.inject({ method: "POST", url: "/api/register", payload: { number: n } });
  return res.json() as any;
}

describe("registration + lookup", () => {
  it("registers by number and is idempotent", async () => {
    const a = await register(101);
    const b = await register(101);
    expect(a.number).toBe(101);
    expect(b.id).toBe(a.id);
  });

  it("looks a visitor up by number", async () => {
    await register(102);
    const res = await app.inject({ method: "GET", url: "/api/visitors/by-number/102" });
    expect(res.statusCode).toBe(200);
    expect(res.json().number).toBe(102);
  });

  it("404s an unknown number", async () => {
    const res = await app.inject({ method: "GET", url: "/api/visitors/by-number/999999" });
    expect(res.statusCode).toBe(404);
  });
});

describe("station upserts attach to the record", () => {
  it("intake → pose → persona → verify progress the milestones", async () => {
    const v = await register(200);
    const intake = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/intake`,
      payload: { survey: { name: "Jo", freeText: {}, phrases: [] } } });
    expect(intake.json().survey.name).toBe("Jo");
    expect(intake.json().intakeAt).toBeTruthy();

    const pose = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/pose`,
      payload: { template: { angles: [0.1, 0.2], weights: [1, 1] } } });
    expect(pose.json().poseTemplate.angles).toEqual([0.1, 0.2]);

    const persona = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/persona`,
      payload: { archetype: "tree" } });
    expect(persona.json().archetype).toBe("tree");
    expect(persona.json().personaAt).toBeTruthy();

    const verify = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/verify` });
    expect(verify.json().poseVerifiedAt).toBeTruthy();
  });

  it("404s a station write to an unknown id", async () => {
    const res = await app.inject({ method: "POST", url: "/api/visitors/nope/pose",
      payload: { template: { angles: [], weights: [] } } });
    expect(res.statusCode).toBe(404);
  });
});

describe("divination guards", () => {
  it("a registered-but-unprepared visitor is not oracle-ready", async () => {
    const v = await register(300);
    // No intake, no persona, no verify → derived oracleReady must be false.
    const ready = !!v.personaAt && !!v.poseVerifiedAt && !v.sessionEndAt;
    expect(ready).toBe(false);
  });
});
