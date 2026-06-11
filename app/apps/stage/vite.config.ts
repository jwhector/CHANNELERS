import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The stage app talks to the brain through these proxies, so the front-end and
// back-end share an origin in dev (no CORS surprises).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
