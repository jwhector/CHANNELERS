import { buildApp } from "./app";
import { config } from "./config";

const app = await buildApp();
await app.listen({ host: config.host, port: config.port });
console.log(`[brain] http://${config.host}:${config.port}  •  ws://${config.host}:${config.port}/ws`);
