import { config as loadEnv } from "dotenv";

// Load the monorepo-root .env (the brain's cwd is apps/brain when run via pnpm).
// Missing file is fine — dotenv just no-ops and the brain falls back to stub seeds.
loadEnv({ path: "../../.env" });

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
  openaiApiKey: process.env.OPENAI_API_KEY,
  transformModel: process.env.TRANSFORM_MODEL ?? "gpt-4o",
  // Both default to gpt-4o; override per-role via env (ARCHITECTURE.md §5.3).
  oracleModel: process.env.ORACLE_MODEL ?? "gpt-4o",
  osc: {
    enabled: process.env.OSC_ENABLED === "true",
    host: process.env.OSC_HOST ?? "127.0.0.1",
    port: Number(process.env.OSC_PORT ?? 57121),
  },
  dispatcher: {
    /** Per-station slot capacity (spec §9). Altar slot is held through the whole reading. */
    slots: { intake: 2, bodyscan: 1, altar: 1 } as Record<"intake" | "bodyscan" | "altar", number>,
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
    /** Flip ON to auto-re-pool no-shows instead of just flagging them. */
    noShowAutoRepool: process.env.DISPATCH_NOSHOW_AUTOREPOOL === "true",
  },
};
