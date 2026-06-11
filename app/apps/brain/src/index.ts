import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { SurveyResponse, ScanResult, type ShowEvent } from "@channelers/shared";
import { config } from "./config";
import { store } from "./store";
import { Bus } from "./bus";
import { transform } from "./transform";
import { registerDivination } from "./divination";
import { transcribeWav } from "./stt";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

// Accept body-less POSTs (e.g. /seeds, /demo/echo) whatever the content-type — no 415s.
// The built-in application/json parser still handles real JSON bodies (the survey).
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
    const text = await transcribeWav(wav);
    return { text };
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: "transcription failed" });
  }
});

app.get("/api/visitors", async () => store.list());

app.post("/api/visitors", async (req, reply) => {
  const parsed = SurveyResponse.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const profile = store.create(parsed.data);
  bus.publish({ type: "visitor.submitted", profileId: profile.id });
  // Auto-generate seeds so Anna/Jeff get them early and the lobby shows visitors as ready.
  // Fire-and-forget: the stub fallback in transform() means this never blocks.
  void transform(profile).then((seeds) => {
    store.setSeeds(profile.id, seeds);
    bus.publish({ type: "seeds.ready", profileId: profile.id });
  });
  return profile;
});

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

// Integration demo for Anna & Jeff: emit one of every event so they can wire up receivers.
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

await app.listen({ host: config.host, port: config.port });
console.log(`[brain] http://${config.host}:${config.port}  •  ws://${config.host}:${config.port}/ws`);
