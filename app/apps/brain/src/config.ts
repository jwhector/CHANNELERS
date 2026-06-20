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
};
