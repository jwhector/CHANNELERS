import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

// A tiny fixture standing in for `apps/stage/dist` so the SPA-fallback behavior
// is tested without a real Vite build.
const stageDist = fileURLToPath(new URL("./fixtures/stage-dist", import.meta.url));

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("single-origin static serving (serveStage)", () => {
  it("serves index.html for an unknown non-API GET route (SPA fallback)", async () => {
    app = await buildApp({ serveStage: true, stageDist });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/channel" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('data-fixture="stage"');
  });

  it("serves a built asset by its real path", async () => {
    app = await buildApp({ serveStage: true, stageDist });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("stage fixture asset");
  });

  it("does NOT serve the SPA shell for unknown /api routes — they stay JSON 404s", async () => {
    app = await buildApp({ serveStage: true, stageDist });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("data-fixture");
  });

  it("leaves unknown routes as default 404 when serveStage is off", async () => {
    app = await buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/channel" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("data-fixture");
  });
});
