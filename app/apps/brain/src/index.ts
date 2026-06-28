import { buildApp } from "./app";
import { config } from "./config";
import { hydrateFromSnapshot, startSnapshotLoop, writeSnapshot, serializeStore } from "./persistence";

const snapshotPath = config.persistence.path;

// Recover participant data before serving traffic (no-op + 0 when the file is absent).
if (snapshotPath) {
  const restored = hydrateFromSnapshot(snapshotPath);
  console.log(`[brain] persistence on (${snapshotPath}) — restored ${restored} visitor(s)`);
}

const app = await buildApp();
await app.listen({ host: config.host, port: config.port });
console.log(`[brain] http://${config.host}:${config.port}  •  ws://${config.host}:${config.port}/ws`);

if (snapshotPath) {
  const stop = startSnapshotLoop(snapshotPath, config.persistence.intervalMs);
  // Flush a final snapshot on a graceful redeploy (Fly sends SIGTERM/SIGINT). A hard crash is
  // already covered by the periodic loop (≤ intervalMs of loss).
  const shutdown = () => {
    stop();
    writeSnapshot(snapshotPath, serializeStore());
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
