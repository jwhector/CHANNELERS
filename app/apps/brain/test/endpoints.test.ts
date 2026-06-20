import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";

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
  // A separate listening app so we can open a real WebSocket connection.
  // The process-global store is shared, so use numbers (9301, 9302) that
  // don't collide with any other test in this file.
  let gApp: FastifyInstance;
  let gPort: number;

  beforeAll(async () => {
    gApp = await buildApp();
    await gApp.listen({ host: "127.0.0.1", port: 0 });
    gPort = (gApp.server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await gApp.close();
  });

  /** Open a ws client, send one session.start command, and resolve with the
   *  first session.error message received (or reject after 3 s). */
  function sendAndAwaitError(visitorId: string): Promise<{ kind: string; visitorId?: string; message: string }> {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${gPort}/ws`);
      const timer = setTimeout(() => {
        sock.close();
        reject(new Error("timeout waiting for session.error"));
      }, 3000);
      sock.on("open", () => sock.send(JSON.stringify({ kind: "session.start", visitorId })));
      sock.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.kind === "session.error") {
          clearTimeout(timer);
          sock.close();
          resolve(msg);
        }
      });
      sock.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  it("visitor with no survey gets 'visitor has not completed intake'", async () => {
    // Register via inject (shares the same in-process store as gApp).
    const res = await gApp.inject({ method: "POST", url: "/api/register", payload: { number: 9301 } });
    const v = res.json() as any;

    const err = await sendAndAwaitError(v.id);
    expect(err.kind).toBe("session.error");
    expect(err.message).toBe("visitor has not completed intake");
  });

  it("visitor WITH a survey but NO archetype gets 'no oracle selected yet'", async () => {
    const res = await gApp.inject({ method: "POST", url: "/api/register", payload: { number: 9302 } });
    const v = res.json() as any;

    // Post an intake survey so the visitor passes the first guard.
    await gApp.inject({
      method: "POST",
      url: `/api/visitors/${v.id}/intake`,
      payload: { survey: { name: "TestUser", freeText: {}, phrases: [] } },
    });

    const err = await sendAndAwaitError(v.id);
    expect(err.kind).toBe("session.error");
    expect(err.message).toBe("no oracle selected yet");
  });
});
