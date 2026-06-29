import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import { SurveyResponse, ScanResult, PoseVector, Station, ChoreoConfig, type ShowEvent } from "@channelers/shared";
import { z } from "zod";
import { store } from "./store";
import { Bus } from "./bus";
import { transform } from "./transform";
import { registerDivination } from "./divination";
import { registerTuning } from "./tuning";
import { createDispatcher } from "./dispatcher";
import { transcribeWav } from "./stt";
import { synthesizeSpeech } from "./tts";
import { generateFirstPass, getChoreoConfig, setChoreoConfig } from "./choreo";
import { ocrPage, savePaperDebugFrame } from "./paper";
import { config } from "./config";
import { initAbleton } from "./ableton";

/** `serveStage`/`stageDist` default to `config`; tests inject a fixture dir. */
export async function buildApp(
  opts: { serveStage?: boolean; stageDist?: string } = {},
): Promise<FastifyInstance> {
  const serveStage = opts.serveStage ?? config.serveStage;
  const stageDist = opts.stageDist ?? config.stageDist;

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
    done(null, body && body.length > 0 ? body : undefined);
  });

  const bus = new Bus(app.server);
  initAbleton(app.server, config.ableton.agentToken, config.ableton.agentPath);
  registerDivination(bus);
  registerTuning(bus);
  const dispatcher = createDispatcher(bus);
  app.addHook("onClose", async () => {
    dispatcher.stop();
    bus.dispose();
  });

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

  const TtsBody = z.object({ text: z.string().min(1), archetype: z.string() });
  app.post("/api/tts", async (req, reply) => {
    const parsed = TtsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const mp3 = await synthesizeSpeech(parsed.data.text, parsed.data.archetype);
      if (!mp3) return reply.code(204).send();
      return reply.type("audio/mpeg").send(mp3);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: "tts failed" });
    }
  });

  // ── choreography: live timing toggle (reactToOracle), §8 ──
  app.get("/api/choreo/config", async () => getChoreoConfig());
  app.post("/api/choreo/config", async (req, reply) => {
    const parsed = ChoreoConfig.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return setChoreoConfig(parsed.data);
  });

  // ── paper station: capture → OCR → animate (identity-agnostic spectacle, spec 2026-06-22) ──
  // Body is a data: URL (the stage grabs a webcam frame on a physical button). gpt-4o vision OCRs
  // it; on no-key/failure we emit placeholder text so the "into the matrix" animation never blocks.
  // Outcomes are logged (read vs. empty vs. error) — and, with PAPER_DEBUG_DIR set, the frame is
  // dumped to disk — so an unreliable feed is diagnosable instead of collapsing to one "illegible".
  const PAPER_FALLBACK_TEXT = "⋯ the page is illegible ⋯";
  const PaperFeedBody = z.object({ image: z.string().min(1) });
  app.post("/api/paper/feed", async (req, reply) => {
    const parsed = PaperFeedBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const fedAt = new Date().toISOString();
    let text: string | null = null;
    try {
      text = await ocrPage(parsed.data.image);
    } catch (err) {
      req.log.error({ err }, "paper OCR failed"); // degrade — never block the spectacle
    }
    if (text) req.log.info({ chars: text.length, preview: text.slice(0, 80) }, "paper OCR read");
    else req.log.warn("paper OCR returned nothing → placeholder");
    if (config.paper.debugDir) {
      await savePaperDebugFrame(config.paper.debugDir, parsed.data.image, text, fedAt, req.log);
    }
    const finalText = text && text.length > 0 ? text : PAPER_FALLBACK_TEXT;
    bus.publish({ type: "paper.fed", text: finalText, fedAt });
    return { text: finalText, fedAt };
  });

  app.get("/api/visitors", async () => store.list());

  // ── identity: register by number (create-or-fetch) + lookup ──
  const RegisterBody = z.object({ number: z.number().int() });
  app.post("/api/register", async (req, reply) => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const v = store.register(parsed.data.number);
    dispatcher.kick();
    return v;
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
    dispatcher.kick();
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
    dispatcher.kick();
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
    // Choreography first-pass = f(intake, archetype), generated now so it's ready as the reading
    // begins (spec §7). Fire-and-forget, mirroring the intake→seeds transform.
    void generateFirstPass(v).then((fp) => store.setChoreoFirstPass(v.id, fp));
    return v;
  });

  // ── altar: record a successful pose verify (also the manual-unlock path) ──
  app.post("/api/visitors/:id/verify", async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = store.setPoseVerified(id);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    return v;
  });

  // ── dispatcher: /console manual-override check-in + operator queue controls (spec §5, §9–§10) ──
  const CheckinBody = z.object({ number: z.number().int(), station: Station });
  app.post("/api/checkin", async (req, reply) => {
    const parsed = CheckinBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return dispatcher.checkin(parsed.data.number, parsed.data.station);
  });

  app.get("/api/dispatch", async () => dispatcher.snapshot());

  const VisitorIdBody = z.object({ visitorId: z.string() });
  const AssignBody = z.object({ visitorId: z.string(), slotId: z.string() });

  app.post("/api/dispatch/confirm", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.confirm(parsed.data.visitorId) };
  });
  app.post("/api/dispatch/arrive", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.arrive(parsed.data.visitorId) };
  });
  app.post("/api/dispatch/assign", async (req, reply) => {
    const parsed = AssignBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.assign(parsed.data.visitorId, parsed.data.slotId) };
  });
  app.post("/api/dispatch/repool", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.repool(parsed.data.visitorId) };
  });
  app.post("/api/dispatch/complete", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.markComplete(parsed.data.visitorId) };
  });
  app.post("/api/dispatch/remove", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return { ok: dispatcher.remove(parsed.data.visitorId) };
  });
  const AltarBody = z.object({ open: z.boolean() });
  app.post("/api/dispatch/altar", async (req, reply) => {
    const parsed = AltarBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    dispatcher.setAltarOpen(parsed.data.open);
    return { ok: true, altarOpen: parsed.data.open };
  });

  // Cross-device capture relay: the /station performer taps Capture; the bodyscan
  // kiosk (which holds the camera) hears this and persists the pose it currently sees.
  app.post("/api/bodyscan/capture", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    bus.broadcast({ kind: "station.cmd", station: "bodyscan", action: "capture", visitorId: parsed.data.visitorId });
    return { ok: true };
  });

  // The bodyscan kiosk reports its available cameras so an operator screen can pick one remotely.
  const CamerasBody = z.object({
    kioskId: z.string(),
    cameras: z.array(z.object({ id: z.string(), label: z.string() })),
    activeId: z.string().optional(),
  });
  app.post("/api/bodyscan/cameras", async (req, reply) => {
    const parsed = CamerasBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    dispatcher.setCameras(parsed.data.kioskId, parsed.data.cameras, parsed.data.activeId);
    return { ok: true };
  });

  // Operator picks a camera on /station → relay a set-camera command to the targeted kiosk.
  const SetCameraBody = z.object({ kioskId: z.string(), deviceId: z.string() });
  app.post("/api/bodyscan/camera", async (req, reply) => {
    const parsed = SetCameraBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    bus.broadcast({ kind: "station.cmd", station: "bodyscan", action: "set-camera", kioskId: parsed.data.kioskId, deviceId: parsed.data.deviceId });
    return { ok: true };
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

  // ── single-origin: serve the stage's Vite build + SPA fallback ──
  // One HTTPS origin then answers the screens (relative /api + /ws) with no CORS/proxy.
  // `wildcard: false` serves real files and lets misses fall through to the notFound
  // handler, which returns index.html for client-routed paths (/intake, /channel, …)
  // while leaving /api and /ws as genuine JSON 404s.
  if (serveStage) {
    await app.register(staticPlugin, { root: stageDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== "GET" || req.url.startsWith("/api") || req.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
