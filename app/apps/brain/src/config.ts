import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { Station } from "@channelers/shared";

// Load the monorepo-root .env (the brain's cwd is apps/brain when run via pnpm).
// Missing file is fine — dotenv just no-ops and the brain falls back to stub seeds.
loadEnv({ path: "../../.env" });

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
  // Single-origin deployment: when true the Brain also serves the stage's Vite build,
  // so one HTTPS origin answers the screens (relative /api + /ws) and the WS upgrade.
  // Off by default — dev uses Vite's proxy; the container sets SERVE_STAGE=true.
  serveStage: process.env.SERVE_STAGE === "true",
  // Absolute path to apps/stage/dist. Default resolves from this source file so it's
  // correct regardless of cwd; override with STAGE_DIST in other layouts.
  stageDist: process.env.STAGE_DIST ?? fileURLToPath(new URL("../../stage/dist", import.meta.url)),
  // WebSocket keepalive: ping every N ms so campus/venue proxies don't reap idle sockets
  // and half-open connections are detected. 0 disables.
  wsHeartbeatMs: Number(process.env.WS_HEARTBEAT_MS ?? 30_000),
  openaiApiKey: process.env.OPENAI_API_KEY,
  transformModel: process.env.TRANSFORM_MODEL ?? "gpt-4o",
  // Both default to gpt-4o; override per-role via env (ARCHITECTURE.md §5.3).
  oracleModel: process.env.ORACLE_MODEL ?? "gpt-4o",
  // OpenAI Whisper STT model for the divination mic (apps/brain/src/stt.ts).
  // Falls back to the local Xenova transcriber when OPENAI_API_KEY is unset.
  sttModel: process.env.STT_MODEL ?? "whisper-1",
  // ElevenLabs TTS for the oracle's voice into the performer's earpiece (apps/brain/src/tts.ts).
  // When the key is unset the client falls back to browser speechSynthesis.
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  elevenLabsModel: process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5",
  // OpenAI TTS fallback (apps/brain/src/tts.ts) when ELEVENLABS_API_KEY is unset but OPENAI_API_KEY is.
  // Returns routable MP3 so the stage's setSinkId output routing keeps working. Verified model id.
  openAiTtsModel: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
  // Choreography agent: the second live loop (apps/brain/src/choreo.ts). Mirrors the oracle model.
  choreoModel: process.env.CHOREO_MODEL ?? "gpt-4o",
  choreo: {
    /** When true, the per-turn cue reacts to the visitor utterance AND the oracle reply (spec §8);
     *  when false it runs in parallel from the utterance alone. Live-toggleable at /api/choreo/config. */
    reactToOracle: process.env.CHOREO_REACT_TO_ORACLE !== "false",
    /** "Dancers mimic the oracle" — sustained manual override (off by default). */
    mimicManual: false,
    /** Auto-mimic every Nth oracle turn (off by default). */
    mimicCadenceEnabled: false,
    mimicEveryNTurns: Number(process.env.CHOREO_MIMIC_EVERY_N ?? 3),
  },
  osc: {
    enabled: process.env.OSC_ENABLED === "true",
    host: process.env.OSC_HOST ?? "127.0.0.1",
    port: Number(process.env.OSC_PORT ?? 57121),
  },
  ableton: {
    /** Set this to arm the /agent endpoint the venue daemon dials home to. Unset → endpoint off. */
    agentToken: process.env.ABLETON_AGENT_TOKEN || undefined,
    agentPath: process.env.ABLETON_AGENT_PATH ?? "/agent",
  },
  dispatcher: {
    /** Per-station capacity. intake/bodyscan/altar are kiosk slots; `paper` is a kiosk-less group capacity. */
    slots: { intake: 2, bodyscan: 1, altar: 1, paper: 3 } as Record<Station, number>,
    /** Order fill() serves free slots in — scarce single gate (bodyscan) first, soaks last.
     *  Keeps the one bodyscan station from losing its only candidate to the 2-wide intake. */
    fillPriority: ["bodyscan", "intake", "altar", "paper"] as Station[],
    /** Kiosk-less group stations: always-online slots with no hardware binding. A member also
     *  listed in `timed` auto-completes on its dwell; otherwise it exits only by manual Done (#17). */
    groupStations: ["paper"] as Station[],
    /** Optional per-station dwell auto-complete — kept generic for a future timed station; none now.
     *  Shape: { paper: { dwellMs: 300_000 } }. */
    timed: {} as Partial<Record<Station, { dwellMs: number }>>,
    /** Per-visitor intro hold: a fresh registrant is ineligible for new assignment for this long
     *  after registration (replaces the old global K / warm-up). */
    introHoldMs: Number(process.env.DISPATCH_INTRO_HOLD_MS ?? 60_000),
    /** Anti-starvation: waiting longer than this jumps the random pick. */
    maxWaitMs: Number(process.env.DISPATCH_T_MAX_MS ?? 240_000),
    /** Called-but-not-arrived past this → flagged (or auto-repooled if noShowAutoRepool). */
    noShowMs: Number(process.env.DISPATCH_T_NOSHOW_MS ?? 90_000),
    /** No-show cooldown: a no-show number is held out of new assignment for this long. */
    noShowHoldMs: Number(process.env.DISPATCH_NOSHOW_HOLD_MS ?? 120_000),
    /** in_progress past this with no completion → auto-reap to waiting. */
    staleMs: Number(process.env.DISPATCH_T_STALE_MS ?? 300_000),
    /** Station-screen socket-drop grace before reaping its in_progress occupants. */
    graceMs: Number(process.env.DISPATCH_GRACE_MS ?? 20_000),
    /** Periodic re-evaluation cadence for the time-threshold detectors. */
    tickMs: Number(process.env.DISPATCH_TICK_MS ?? 5_000),
    /** Flip ON to skip the operator confirm step (pending auto-promotes to called). */
    autoConfirm: process.env.DISPATCH_AUTO_CONFIRM === "true",
    /** Flip ON to skip the performer arrival step (called auto-promotes to in_progress) — dev/stub flow. */
    autoArrive: process.env.DISPATCH_AUTO_ARRIVE === "true",
    /** Flip ON to auto-re-pool no-shows instead of just flagging them. */
    noShowAutoRepool: process.env.DISPATCH_NOSHOW_AUTOREPOOL === "true",
  },
};
