import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { SurveyResponse, ScanResult, PoseVector, type ShowEvent } from "@channelers/shared";
import { z } from "zod";
import { store } from "./store";
import { Bus } from "./bus";
import { transform } from "./transform";
import { registerDivination } from "./divination";
import { transcribeWav } from "./stt";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
    done(null, body && body.length > 0 ? body : undefined);
  });

  const bus = new Bus(app.server);
  registerDivination(bus);

  app.get("/api/health", async () => ({ ok: true, at: new Date().toISOString() }));

  app.post("/api/stt", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "missing audio" });
    const wav = await file.toBuffer();
    if (!wav.length) return reply.code(400).send({ error: "empty audio" });
    try {
      return { text: await transcribeWav(wav) };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: "transcription failed" });
    }
  });

  app.get("/api/visitors", async () => store.list());

  // ── identity: register by number (create-or-fetch) + lookup ──
  const RegisterBody = z.object({ number: z.number().int() });
  app.post("/api/register", async (req, reply) => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return store.register(parsed.data.number);
  });

  app.get("/api/visitors/by-number/:number", async (req, reply) => {
    const { number } = req.params as { number: string };
    const v = store.getByNumber(Number(number));
    if (!v) return reply.code(404).send({ error: "unknown number" });
    return v;
  });

  // ── intake: attach survey to a registered record, fire the music seed ──
  const IntakeBody = z.object({ survey: SurveyResponse });
  app.post("/api/visitors/:id/intake", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = IntakeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const v = store.upsertSurvey(id, parsed.data.survey);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    bus.publish({ type: "visitor.submitted", profileId: v.id });
    void transform(v).then((seeds) => {
      store.setSeeds(v.id, seeds);
      bus.publish({ type: "seeds.ready", profileId: v.id });
    });
    return v;
  });

  // ── body-scan: persist the enrolled pose template ──
  const PoseBody = z.object({ template: PoseVector });
  app.post("/api/visitors/:id/pose", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = PoseBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const v = store.setPoseTemplate(id, parsed.data.template);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    return v;
  });

  // ── altar: set persona (the swappable seam, spec §6) ──
  const PersonaBody = z.object({ archetype: z.string() });
  app.post("/api/visitors/:id/persona", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = PersonaBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const v = store.setArchetype(id, parsed.data.archetype);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    bus.publish({ type: "oracle.selected", profileId: v.id, archetype: parsed.data.archetype });
    return v;
  });

  // ── altar: record a successful pose verify (also the manual-unlock path) ──
  app.post("/api/visitors/:id/verify", async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = store.setPoseVerified(id);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    return v;
  });

  // legacy scan + manual seeds regeneration (kept)
  app.post("/api/visitors/:id/scan", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ScanResult.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const v = store.addScan(id, parsed.data);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    bus.publish(
      parsed.data.kind === "pose"
        ? { type: "scan.pose", archetypeGuess: parsed.data.archetypeGuess, confidence: parsed.data.confidence }
        : { type: "scan.fiducial", cards: parsed.data.cards.map((c) => c.id) },
    );
    return v;
  });

  app.post("/api/visitors/:id/seeds", async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = store.get(id);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    const seeds = await transform(v);
    store.setSeeds(id, seeds);
    bus.publish({ type: "seeds.ready", profileId: id });
    return seeds;
  });

  app.post("/api/demo/echo", async () => {
    const samples: ShowEvent[] = [
      { type: "visitor.submitted", profileId: "demo" },
      { type: "scan.pose", archetypeGuess: "heron", confidence: 0.82 },
      { type: "scan.fiducial", cards: [3, 1, 4] },
      { type: "seeds.ready", profileId: "demo" },
      { type: "oracle.selected", profileId: "demo", archetype: "tree" },
      { type: "divination.started", profileId: "demo" },
      { type: "divination.ended", profileId: "demo" },
      { type: "souvenir.minted", profileId: "demo", url: "https://example.com/s/demo" },
    ];
    for (const e of samples) bus.publish(e);
    return { published: samples.length };
  });

  return app;
}
