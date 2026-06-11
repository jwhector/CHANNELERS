import { config as loadEnv } from "dotenv";

// Load the monorepo-root .env (the brain's cwd is apps/brain when run via pnpm).
// Missing file is fine — dotenv just no-ops and the brain falls back to stub seeds.
loadEnv({ path: "../../.env" });

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  transformModel: process.env.TRANSFORM_MODEL ?? "claude-opus-4-8",
  // Live loop favours latency — Sonnet over Opus (ARCHITECTURE.md §5.3). Configurable.
  oracleModel: process.env.ORACLE_MODEL ?? "claude-sonnet-4-6",
  osc: {
    enabled: process.env.OSC_ENABLED === "true",
    host: process.env.OSC_HOST ?? "127.0.0.1",
    port: Number(process.env.OSC_PORT ?? 57121),
  },
};
