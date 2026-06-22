import { afterEach, describe, it, expect, vi, type Mock } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { synthesizeSpeech } from "../src/tts";

vi.mock("../src/tts", () => ({ synthesizeSpeech: vi.fn() }));

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  (synthesizeSpeech as Mock).mockReset();
});

describe("POST /api/tts", () => {
  it("204 when synthesis returns null (no key)", async () => {
    (synthesizeSpeech as Mock).mockResolvedValue(null);
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { text: "the forms are processing", archetype: "tree" },
    });
    expect(res.statusCode).toBe(204);
  });

  it("audio/mpeg bytes when synthesized", async () => {
    (synthesizeSpeech as Mock).mockResolvedValue(Buffer.from([1, 2, 3]));
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { text: "hello", archetype: "tree" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("audio/mpeg");
    expect(res.rawPayload).toEqual(Buffer.from([1, 2, 3]));
  });

  it("400 on empty text", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { text: "", archetype: "tree" },
    });
    expect(res.statusCode).toBe(400);
  });
});
