import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only noise filter. When a proxied WebSocket client (a kiosk/operator screen)
// refreshes or navigates away while the brain is mid-broadcast, Vite's `/ws` proxy
// writes a frame to the just-closed socket and logs a scary `ws proxy socket error:
// write EPIPE` / `read ECONNRESET` stack. It's a harmless dev-proxy disconnect race
// (the brain is unaffected; production has no Vite proxy), so we swallow exactly
// those lines and let every other error through untouched.
const logger = createLogger();
const origError = logger.error.bind(logger);
logger.error = (msg, opts) => {
  if (
    typeof msg === "string" &&
    msg.includes("ws proxy socket error") &&
    /EPIPE|ECONNRESET/.test(msg)
  ) {
    return;
  }
  origError(msg, opts);
};

// The stage app talks to the brain through these proxies, so the front-end and
// back-end share an origin in dev (no CORS surprises).
export default defineConfig({
  plugins: [react()],
  customLogger: logger,
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
