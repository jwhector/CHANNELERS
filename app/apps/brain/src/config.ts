import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

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
    /** Per-station capacity. intake/bodyscan/altar are kiosk slots; `paper` is a timed group's capacity. */
    slots: { intake: 2, bodyscan: 1, altar: 1, paper: 4 } as Record<
      "intake" | "bodyscan" | "altar" | "paper", number
    >,
    /** Timed group stations: present ⇒ kiosk-less, always-online, completed by a dwell timer (spec 2026-06-22). */
    timed: { paper: { dwellMs: Number(process.env.PAPER_DWELL_MS ?? 300_000) } } as Partial<
      Record<"intake" | "bodyscan" | "altar" | "paper", { dwellMs: number }>
    >,
    /** Warm-up pool size — don't dispatch until this many are waiting OR T_warmup elapses. */
    K: Number(process.env.DISPATCH_K ?? 3),
    warmupMs: Number(process.env.DISPATCH_T_WARMUP_MS ?? 60_000),
    /** Anti-starvation: waiting longer than this jumps the random pick. */
    maxWaitMs: Number(process.env.DISPATCH_T_MAX_MS ?? 240_000),
    /** Called-but-not-arrived past this → flagged (or auto-repooled if noShowAutoRepool). */
    noShowMs: Number(process.env.DISPATCH_T_NOSHOW_MS ?? 90_000),
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
